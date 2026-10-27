package engine

import (
	"encoding/binary"
	"encoding/json"
	"testing"
	"time"

	"github.com/n30nex/cartolite-server/backend/internal/meshcore"
	"github.com/n30nex/cartolite-server/backend/internal/mqtt"
)

func retainedAdvert(t *testing.T, received time.Time, reported int64) mqtt.Message {
	t.Helper()
	payload := make([]byte, 109)
	for i := range payload[:32] {
		payload[i] = 0x2a
	}
	payload[100] = 0x92
	lat, lng := int32(45_300_000), int32(-79_200_000)
	binary.LittleEndian.PutUint32(payload[101:105], uint32(lat))
	binary.LittleEndian.PutUint32(payload[105:109], uint32(lng))
	payload = append(payload, []byte("Retained fixture")...)
	body, err := json.Marshal(map[string]any{
		"raw":       packetHexPayload(meshcore.PayloadAdvert, 1, []byte{0xaa}, payload...),
		"timestamp": reported, "rssi": -80,
	})
	if err != nil {
		t.Fatal(err)
	}
	message, err := mqtt.Normalize("meshcore/YKF/CC112233/packets", body, received)
	if err != nil {
		t.Fatal(err)
	}
	message.Retained = true
	return message
}

func TestRetainedAdvertSeedsMetadataAtItsReportedAgeWithoutLiveActivity(t *testing.T) {
	state := newTestEngine(t)
	now := time.Now()
	reported := now.Add(-24 * time.Hour).UnixMilli()
	message := retainedAdvert(t, now, reported)
	var packets int
	state.SetPublisher(func(event Event) {
		if event.Name == "packet" {
			packets++
		}
	})
	if !state.process(message) {
		t.Fatal("dated retained advert did not seed a missing node")
	}
	if state.process(message) {
		t.Fatal("identical retained redelivery changed node freshness")
	}
	state.updateSnapshot(now)
	var public StateV2
	if err := json.Unmarshal(state.StateJSON(), &public); err != nil {
		t.Fatal(err)
	}
	if len(public.Nodes) != 1 || public.Nodes[0].Label != "Retained fixture" || public.Nodes[0].LastSeen != reported {
		t.Fatal("retained advert was missing or acquired the receipt time as its age")
	}
	if packets != 0 || len(public.Routes) != 0 || public.Status.LastPacketAt != 0 || public.Status.Activity != "quiet" {
		t.Fatal("metadata backfill was exposed as live traffic")
	}
	if err := writeCheckpoint(state.checkpoint, state.nodes, state.routes); err != nil {
		t.Fatal(err)
	}
	nodes, _, err := loadCheckpoint(state.checkpoint)
	if err != nil || len(nodes) != 1 {
		t.Fatal("retained metadata did not survive a checkpoint")
	}
	for _, node := range nodes {
		if node.LastSeen != reported {
			t.Fatal("checkpoint changed the retained observation age")
		}
	}
}

func TestRetainedDeliveryCannotCreateOrIncrementRoutes(t *testing.T) {
	state := newTestEngine(t)
	now := time.Now().UnixMilli()
	state.upsertNode("YKF", "AA112233", "Relay", "repeater", false, 43.4, -80.4, true, now-2_000)
	state.upsertNode("YKF", "CC112233", "Observer", "unknown", true, 43.5, -80.5, true, now-2_000)
	rssi := -80.0
	message := mqtt.Message{
		Topic:  mqtt.Topic{Region: "YKF", PublisherKey: "CC112233", Kind: "packets"},
		RawHex: packetHex(meshcore.PayloadControl, 1, 0xaa), RSSI: &rssi,
		ReceivedAt: now, ReportedAt: now - 1_000, HeardAt: now, Retained: true,
	}
	var packets int
	state.SetPublisher(func(event Event) {
		if event.Name == "packet" {
			packets++
		}
	})
	state.process(message)
	if packets != 0 || len(state.routes) != 0 || state.lastPacket != 0 {
		t.Fatal("retained path created a route, pulse or active status")
	}
	message.Retained = false
	state.process(message)
	if packets != 1 || len(state.routes) != 1 || state.lastPacket != now {
		t.Fatal("ordinary live packet lost its confirmed route")
	}
	message.Retained = true
	message.ReceivedAt += 60_000
	state.process(message)
	if packets != 1 || state.lastPacket != now {
		t.Fatal("retained replay produced live activity")
	}
	for _, route := range state.routes {
		if route.PacketCount != 1 || route.LastHeard != now {
			t.Fatal("retained replay changed historical route counts or freshness")
		}
	}
	// A path with no resolved segments must not produce an observer-only pulse either.
	message.RawHex = packetHex(meshcore.PayloadControl, 1)
	state.process(message)
	if packets != 1 {
		t.Fatal("retained delivery produced an observer-only pulse")
	}
}

func TestRetainedStatusUsesReportedTimeAndPreservesNewerMetadata(t *testing.T) {
	state := newTestEngine(t)
	now := time.Now().UnixMilli()
	message := mqtt.Message{
		Topic:      mqtt.Topic{Region: "YKF", PublisherKey: "CC112233", Kind: "status"},
		Payload:    map[string]any{"name": "Old observer", "role": "repeater", "lat": 43.4, "lng": -80.4},
		ReceivedAt: now, ReportedAt: now - 60_000, HeardAt: now, Retained: true,
	}
	if !state.process(message) {
		t.Fatal("dated retained status did not seed a missing observer")
	}
	node := state.nodes[nodeMapKey("YKF", "CC112233")]
	if node.LastSeen != message.ReportedAt {
		t.Fatal("retained status acquired a fresh receipt timestamp")
	}
	state.upsertNode("YKF", "CC112233", "Current observer", "companion", true, 43.5, -80.5, true, now)
	if state.process(message) || node.Label != "Current observer" || node.Role != "companion" || node.Lat != 43.5 || node.LastSeen != now {
		t.Fatal("retained status replaced newer node metadata")
	}
}

func TestRetainedUnknownFutureOrExpiredTimesDoNotInventFreshness(t *testing.T) {
	now := time.Now()
	for _, reported := range []int64{0, -1, now.Add(time.Minute).UnixMilli(), now.Add(-nodeRetentionWindow - time.Millisecond).UnixMilli()} {
		for _, kind := range []string{"packets", "status"} {
			state := newTestEngine(t)
			message := retainedAdvert(t, now, reported)
			message.Topic.Kind = kind
			message.Payload["lat"] = 43.4
			message.Payload["lng"] = -80.4
			if state.process(message) || len(state.nodes) != 0 || len(state.routes) != 0 || state.lastPacket != 0 {
				t.Fatal("unusable retained time was treated as a fresh observation")
			}
		}
	}
}
