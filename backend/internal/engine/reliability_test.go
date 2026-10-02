package engine

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/n30nex/cartolite-server/backend/internal/meshcore"
	"github.com/n30nex/cartolite-server/backend/internal/mqtt"
)

func TestRegionAliasesDoNotRegressPublicNodeEvents(t *testing.T) {
	state := newTestEngine(t)
	now := time.Now().UnixMilli()
	older, _ := state.upsertNode("YKF", "AA112233", "Older", "repeater", false, 43.4, -80.4, true, now)
	newer, _ := state.upsertNode("YYZ", "AA112233", "Newer", "repeater", false, 43.5, -80.5, true, now+10)
	var events []NodeV2
	state.SetPublisher(func(event Event) {
		if event.Name == "node" {
			events = append(events, event.Data.(NodeEventV2).Node)
		}
	})
	state.upsertNode("YKF", "AA112233", "Old update", "repeater", false, 43.6, -80.6, true, now+2)
	if state.nodeIDs[nodePublicID(older)] != newer || len(events) != 0 {
		t.Fatal("older region alias replaced the current public node")
	}
	state.upsertNode("YKF", "AA112233", "Latest", "repeater", false, 43.7, -80.7, true, now+20)
	if state.nodeIDs[nodePublicID(older)] != older || len(events) != 1 || events[0].Lat != 43.7 {
		t.Fatal("newest observation did not become the public representative")
	}
	// A switch back within the freshness throttle must still publish the
	// different representative, even if that alias's own metadata did not move.
	state.upsertNode("YYZ", "AA112233", "Newer", "repeater", false, 43.5, -80.5, true, now+30)
	if len(events) != 2 || events[1].Lat != 43.5 {
		t.Fatal("freshness throttle hid a changed public representative")
	}
	state.upsertNode("YKF", "AA112233", "Latest", "repeater", false, 43.7, -80.7, true, now+40)
	delete(state.nodes, nodeMapKey(older.Region, older.Key))
	state.refreshNodeID(nodePublicID(older))
	if state.nodeIDs[nodePublicID(older)] != newer {
		t.Fatal("removal lost the surviving region alias")
	}
}

func TestShutdownPersistsEveryAcceptedQueuedObservation(t *testing.T) {
	state := newTestEngine(t)
	const count = 20
	for i := 1; i <= count; i++ {
		if !state.Submit(mqtt.Message{
			Topic:   mqtt.Topic{Region: "YKF", PublisherKey: fmt.Sprintf("%08X", i), Kind: "status"},
			Payload: map[string]any{"latitude": 43.4, "longitude": -80.4, "name": "Fixture"},
			HeardAt: time.Now().UnixMilli(),
		}) {
			t.Fatal("bounded fixture was not accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	go state.Run(ctx)
	select {
	case <-state.done:
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown did not finish")
	}
	if state.Submit(mqtt.Message{}) || state.QueueDepth() != 0 || state.OperationalStats().Processed != count {
		t.Fatal("shutdown lost queued input or admitted work after the checkpoint")
	}
	nodes, _, err := loadCheckpoint(state.checkpoint)
	if err != nil || len(nodes) != count {
		t.Fatalf("accepted observations missing from final checkpoint: nodes=%d error=%v", len(nodes), err)
	}
}

func TestUnpositionedRegionAliasRetainsKnownPositionWithoutResolvingMissingHop(t *testing.T) {
	state := newTestEngine(t)
	now := time.Now().UnixMilli()
	positioned, _ := state.upsertNode("YKF", "AA112233", "Known", "repeater", false, 43.4, -80.4, true, now)
	state.upsertNode("YYZ", "AA112233", "No position", "repeater", false, 0, 0, false, now+100)
	id := nodePublicID(positioned)
	if state.nodeIDs[id] != positioned {
		t.Fatal("a coordinate-free alias hid the known public position")
	}
	// The public position index must never supply private RF resolution evidence.
	if state.nodes[nodeMapKey("YYZ", positioned.Key)].HasCoords {
		t.Fatal("coordinates leaked into an unpositioned private region record")
	}
	observer, _ := state.upsertNode("YYZ", "CC112233", "Observer", "unknown", true, 43.5, -80.5, true, now+100)
	rssi := -70.0
	segments, changed := state.resolveAndRecord(
		mqtt.Message{Topic: mqtt.Topic{Region: "YYZ"}, RSSI: &rssi, HeardAt: now + 100},
		meshcore.Packet{HashSize: 1, Path: []string{"AA"}, PayloadType: meshcore.PayloadControl}, nil, observer, "Control",
	)
	if changed || len(segments) != 0 {
		t.Fatal("public position index created a guessed private hop")
	}
	state.refreshNodeID(id)
	if state.nodeIDs[id] != positioned {
		t.Fatal("index reconstruction lost the known public position")
	}
}

// Compare the retained removal scan with the new per-observation index update.
// Both operate on the same synthetic identity table; setup is outside timing.
func BenchmarkNodeRepresentative(b *testing.B) {
	for _, count := range []int{100, maxNodes} {
		for _, method := range []string{"scan", "indexed"} {
			b.Run(fmt.Sprintf("%d/%s", count, method), func(b *testing.B) {
				state := &Engine{nodes: make(map[string]*privateNode), nodeIDs: make(map[string]*privateNode)}
				var changed *privateNode
				for i := 1; i <= count; i++ {
					changed = &privateNode{Key: fmt.Sprintf("%08X", i), Region: "YKF", LastSeen: 1}
					state.nodes[nodeMapKey(changed.Region, changed.Key)] = changed
					state.selectNodeID(changed)
				}
				id := nodePublicID(changed)
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					changed.LastSeen++
					if method == "scan" {
						state.refreshNodeID(id)
					} else {
						state.selectNodeID(changed)
					}
				}
			})
		}
	}
}
