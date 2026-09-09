package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/n30nex/cartolite-server/backend/internal/meshcore"
	"github.com/n30nex/cartolite-server/backend/internal/mqtt"
)

func TestUnpositionedSourceCollisionDoesNotCreateAnOriginLeg(t *testing.T) {
	state := newTestEngine(t)
	now := time.Now().UnixMilli()
	source, _ := state.upsertNode("YKF", "DD112233", "Positioned", "companion", false, 43.35, -80.35, true, now)
	state.upsertNode("YKF", "DD998877", "Unpositioned", "companion", false, 0, 0, false, now)
	hop, _ := state.upsertNode("YKF", "AA112233", "Relay", "repeater", false, 43.4, -80.4, true, now)
	observer, _ := state.upsertNode("YKF", "CC112233", "Observer", "unknown", true, 43.5, -80.5, true, now)
	rssi := -75.0
	state.process(mqtt.Message{
		Topic:       mqtt.Topic{Region: "YKF", PublisherKey: "CC112233", Kind: "packets"},
		ObserverKey: "CC112233", RSSI: &rssi, HeardAt: now,
		RawHex: packetHexPayload(meshcore.PayloadPlainText, 1, []byte{0xaa}, 0, 0xdd),
	})
	if len(state.routes) != 1 || state.routes[routePublicID(nodePublicID(hop), nodePublicID(observer))] == nil {
		t.Fatal("independently resolved relay-to-observer hop was not preserved")
	}
	if state.routes[routePublicID(nodePublicID(source), nodePublicID(hop))] != nil {
		t.Fatal("ambiguous source acquired a guessed origin leg")
	}
}

func TestResolverRequiresFiniteRFEvidence(t *testing.T) {
	invalid, infinite, valid := math.NaN(), math.Inf(1), -75.0
	for _, test := range []struct {
		name string
		rssi *float64
		snr  *float64
		want int
	}{
		{"missing", nil, nil, 0},
		{"nan", &invalid, nil, 0},
		{"infinity", nil, &infinite, 0},
		{"both invalid", &invalid, &infinite, 0},
		{"RSSI only", &valid, nil, 1},
		{"finite SNR despite bad RSSI", &invalid, &valid, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := newTestEngine(t)
			now := time.Now().UnixMilli()
			state.upsertNode("YKF", "AA112233", "Relay", "repeater", false, 43.4, -80.4, true, now)
			state.upsertNode("YKF", "CC112233", "Observer", "unknown", true, 43.5, -80.5, true, now)
			state.process(mqtt.Message{
				Topic:       mqtt.Topic{Region: "YKF", PublisherKey: "CC112233", Kind: "packets"},
				ObserverKey: "CC112233", RSSI: test.rssi, SNR: test.snr, HeardAt: now,
				RawHex: packetHex(meshcore.PayloadControl, 1, 0xaa),
			})
			if len(state.routes) != test.want {
				t.Fatalf("got %d routes, want %d", len(state.routes), test.want)
			}
		})
	}
}

// Observe the wire contract: the replacement snapshot must already be available
// when a client receives its reset cursor, with every route endpoint present.
func collectResetSnapshots(t *testing.T, state *Engine) *[]StateV2 {
	t.Helper()
	snapshots := []StateV2{}
	state.SetPublisher(func(event Event) {
		if event.Name != "reset" {
			return
		}
		var snapshot StateV2
		if err := json.Unmarshal(state.StateJSON(), &snapshot); err != nil {
			t.Fatal(err)
		}
		reset, ok := event.Data.(ResetEventV2)
		if !ok || reset.Seq != event.Seq || snapshot.Seq != event.Seq || reset.BootID != snapshot.BootID {
			t.Fatal("reset was published before its matching snapshot")
		}
		ids := make(map[string]bool, len(snapshot.Nodes))
		for _, node := range snapshot.Nodes {
			ids[node.ID] = true
		}
		for _, route := range snapshot.Routes {
			if !ids[route.FromID] || !ids[route.ToID] {
				t.Fatal("reset snapshot has a dangling route")
			}
		}
		snapshots = append(snapshots, snapshot)
	})
	return &snapshots
}

func TestNodeCapacityEvictionsCoalesceIntoOneAuthoritativeReset(t *testing.T) {
	state := newTestEngine(t)
	now := time.Now()
	for index := 0; index < maxNodes; index++ {
		node := &privateNode{
			Region: "YKF", Key: fmt.Sprintf("%08X", index+1), Label: "Fixture", Role: "repeater",
			HasCoords: true, Lat: 43.4, Lng: -80.4, LastSeen: now.Add(time.Duration(index) * time.Millisecond).UnixMilli(),
		}
		key := nodeMapKey(node.Region, node.Key)
		state.nodes[key] = node
		state.nodeIDs[nodePublicID(node)] = node
		state.indexNode(key, node)
	}
	oldID := nodePublicID(state.nodes[nodeMapKey("YKF", "00000001")])
	nextID := nodePublicID(state.nodes[nodeMapKey("YKF", "00000002")])
	routeID := routePublicID(oldID, nextID)
	state.routes[routeID] = &privateRoute{ID: routeID, FromID: oldID, ToID: nextID, PacketCount: 1, LastHeard: now.UnixMilli(), LastKind: "Text", Traffic: 1}
	state.updateSnapshot(now)
	resets := collectResetSnapshots(t, state)
	for _, key := range []string{"FFFF0001", "FFFF0002"} {
		state.upsertNode("YKF", key, "New fixture", "repeater", false, 43.5, -80.5, true, now.Add(time.Minute).UnixMilli())
	}
	if len(*resets) != 0 {
		t.Fatal("evictions reset clients per packet instead of on the snapshot clock")
	}
	state.updateSnapshot(now.Add(time.Minute))
	if len(*resets) != 1 || len((*resets)[0].Nodes) != maxNodes || len((*resets)[0].Routes) != 0 {
		t.Fatal("node-capacity reset did not provide bounded current topology")
	}
	for _, node := range (*resets)[0].Nodes {
		if node.ID == oldID || node.ID == nextID {
			t.Fatal("evicted identity survived in replacement snapshot")
		}
	}
	state.updateSnapshot(now.Add(2 * time.Minute))
	if len(*resets) != 1 {
		t.Fatal("unchanged topology emitted another reset")
	}
}

func TestRouteCapacityEvictionsResetClientsBeforeAnyExpiry(t *testing.T) {
	state := newTestEngine(t)
	now := time.Now()
	nodes := make([]*privateNode, 202)
	for index := range nodes {
		nodes[index], _ = state.upsertNode("YKF", fmt.Sprintf("%08X", index+1), "Fixture", "repeater", false, 43.4, -80.4, true, now.UnixMilli())
	}
	oldest := []string{}
	for from := 0; from < len(nodes) && len(state.routes) < maxRoutes+2; from++ {
		for to := from + 1; to < len(nodes) && len(state.routes) < maxRoutes+2; to++ {
			fromID, toID := nodePublicID(nodes[from]), nodePublicID(nodes[to])
			id := routePublicID(fromID, toID)
			if len(oldest) < 2 {
				oldest = append(oldest, id)
			}
			state.routes[id] = &privateRoute{
				ID: id, FromID: fromID, ToID: toID, PacketCount: 1, LastKind: "Text", Traffic: 1,
				LastHeard: now.Add(time.Duration(len(state.routes)) * time.Millisecond).UnixMilli(),
			}
		}
	}
	state.updateSnapshot(now)
	resets := collectResetSnapshots(t, state)
	state.evictRoutes()
	state.updateSnapshot(now.Add(time.Minute))
	if len(*resets) != 1 || len((*resets)[0].Routes) != maxRoutes {
		t.Fatal("route-capacity reset did not provide the bounded snapshot")
	}
	for _, id := range oldest {
		if state.routes[id] != nil {
			t.Fatal("oldest route was not evicted")
		}
	}
}

func TestQuietMaintenanceExpiresStateWithoutRepeatedWrites(t *testing.T) {
	state := newTestEngine(t)
	now := time.Now()
	first, _ := state.upsertNode("YKF", "AA112233", "Quiet first", "repeater", false, 43.4, -80.4, true, now.Add(-nodeRetentionWindow+time.Second).UnixMilli())
	second, _ := state.upsertNode("YKF", "BB112233", "Quiet second", "repeater", false, 43.5, -80.5, true, now.Add(-nodeRetentionWindow+time.Second).UnixMilli())
	fromID, toID := nodePublicID(first), nodePublicID(second)
	id := routePublicID(fromID, toID)
	state.routes[id] = &privateRoute{ID: id, FromID: fromID, ToID: toID, PacketCount: 1, LastKind: "Text", Traffic: 1, LastHeard: now.Add(-routeVisibilityWindow + time.Second).UnixMilli()}
	if _, saved := state.flushCheckpointAndReset(now, true); !saved {
		t.Fatal("could not establish clean checkpoint")
	}
	resets := collectResetSnapshots(t, state)
	later := now.Add(2 * time.Second)
	if reset, saved := state.flushCheckpointAndReset(later, false); !reset || !saved {
		t.Fatal("quiet maintenance skipped expired state")
	}
	nodes, routes, err := loadCheckpoint(state.checkpoint)
	if err != nil || len(nodes) != 0 || len(routes) != 0 || len(*resets) != 1 {
		t.Fatal("expired topology survived checkpoint or client reconciliation")
	}
	lastSave := state.OperationalStats().LastCheckpointAt
	if reset, saved := state.flushCheckpointAndReset(later.Add(checkpointInterval), false); reset || !saved {
		t.Fatal("unchanged quiet maintenance did not remain idle")
	}
	if state.OperationalStats().LastCheckpointAt != lastSave {
		t.Fatal("clean quiet state caused an unnecessary checkpoint write")
	}
}

func TestFailedExpiryCheckpointStillResetsAndCanRetry(t *testing.T) {
	state := newTestEngine(t)
	now := time.Now()
	state.upsertNode("YKF", "AA112233", "Expired", "repeater", false, 43.4, -80.4, true, now.Add(-nodeRetentionWindow-time.Second).UnixMilli())
	path := state.checkpoint
	state.checkpoint = t.TempDir() // A directory cannot be replaced by the checkpoint file.
	resets := collectResetSnapshots(t, state)
	if reset, saved := state.flushCheckpointAndReset(now, false); !reset || saved || state.CheckpointHealthy() {
		t.Fatal("failed expiry save hid the topology reset or checkpoint failure")
	}
	state.checkpoint = path
	if reset, saved := state.flushCheckpointAndReset(now.Add(checkpointInterval), true); reset || !saved || !state.CheckpointHealthy() {
		t.Fatal("failed checkpoint could not be retried without a duplicate reset")
	}
	if len(*resets) != 1 || state.OperationalStats().PrunedCheckpointNodes != 1 {
		t.Fatal("pruning/reset was lost or counted twice across checkpoint retry")
	}
}
