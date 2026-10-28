package engine

import (
	"bytes"
	"os"
	"testing"
	"time"

	"github.com/n30nex/cartolite-server/backend/internal/meshcore"
	"github.com/n30nex/cartolite-server/backend/internal/mqtt"
)

func TestPacketActivityDoesNotHideNewerRoleOrPositionMetadata(t *testing.T) {
	state := newTestEngine(t)
	t1 := time.Now().Add(-3 * time.Second).UnixMilli()
	t2, t3 := t1+1000, t1+2000
	node, _ := state.upsertNode("YKF", "AA112233", "Initial label", "repeater", true, 43.4, -80.4, true, t1)
	observer, _ := state.upsertNode("YKF", "CC112233", "Receiver", "unknown", true, 43.5, -80.5, true, t1)
	state.process(mqtt.Message{
		Topic:  mqtt.Topic{Region: "YKF", PublisherKey: "AA112233", Kind: "packets"},
		RawHex: packetHex(meshcore.PayloadControl, 1), ObserverName: "Latest label", HeardAt: t3,
	})
	if node.LastSeen != t3 || node.LabelSeenAt != t3 || node.RoleSeenAt != t1 || node.CoordsSeenAt != t1 {
		t.Fatal("packet activity advanced metadata clocks for omitted fields")
	}
	state.process(mqtt.Message{
		Topic:   mqtt.Topic{Region: "YKF", PublisherKey: "AA112233", Kind: "status"},
		Payload: map[string]any{"name": "Earlier label", "role": "companion", "lat": 43.6, "lng": -80.3}, HeardAt: t2,
	})
	if node.Role != "companion" || node.Lat != 43.6 || node.Lng != -80.3 || node.Label != "Latest label" || node.LastSeen != t3 {
		t.Fatal("activity hid a newer role/position correction, or older metadata replaced the confirmed label")
	}
	rssi := -80.0
	segments, routed := state.resolveAndRecord(
		mqtt.Message{Topic: mqtt.Topic{Region: "YKF"}, RSSI: &rssi, HeardAt: t3 + 1},
		meshcore.Packet{HashSize: 1, Path: []string{"AA"}, PayloadType: meshcore.PayloadControl}, nil, observer, "Control",
	)
	if routed || len(segments) != 0 {
		t.Fatal("corrected companion was still used as a forwarder")
	}
	state.updateSnapshot(time.Now())
	for _, field := range []string{"labelSeenAt", "roleSeenAt", "coordsSeenAt"} {
		if bytes.Contains(state.StateJSON(), []byte(field)) {
			t.Fatal("private metadata clock escaped into public API v2")
		}
	}
}

func TestUnchangedMetadataConfirmationsSurviveCheckpointAndRejectOlderValues(t *testing.T) {
	state := newTestEngine(t)
	t1 := time.Now().Add(-4 * time.Second).UnixMilli()
	node, _ := state.upsertNode("YKF", "AA112233", "Current label", "companion", true, 43.4, -80.4, true, t1)
	state.upsertNode("YKF", "AA112233", "Current label", "unknown", true, 0, 0, false, t1+3000)
	if _, changed := state.upsertNode("YKF", "AA112233", "", "companion", true, 43.4, -80.4, true, t1+2000); !changed {
		t.Fatal("confirmation of unchanged metadata was not marked for persistence")
	}
	if node.LabelSeenAt != t1+3000 || node.RoleSeenAt != t1+2000 || node.CoordsSeenAt != t1+2000 {
		t.Fatal("independent metadata confirmation times were lost")
	}
	if err := writeCheckpoint(state.checkpoint, state.nodes, state.routes); err != nil {
		t.Fatal(err)
	}
	restored, err := New(Options{Checkpoint: state.checkpoint})
	if err != nil {
		t.Fatal(err)
	}
	current, changed := restored.upsertNode("YKF", "AA112233", "Old label", "repeater", true, 44, -81, true, t1+1000)
	if changed || current.Label != node.Label || current.Role != "companion" || current.Lat != node.Lat || current.Lng != node.Lng || current.LastSeen != node.LastSeen {
		t.Fatal("checkpoint reload allowed older confirmed metadata to overwrite current values")
	}
}

func TestLegacyCheckpointDoesNotInventMetadataAgeFromActivity(t *testing.T) {
	state := newTestEngine(t)
	t1 := time.Now().Add(-3 * time.Second).UnixMilli()
	legacy := &privateNode{Region: "YKF", Key: "AA112233", Label: "Legacy", Role: "repeater", Observer: true, Lat: 43.4, Lng: -80.4, HasCoords: true, LastSeen: t1 + 2000}
	if err := writeCheckpoint(state.checkpoint, map[string]*privateNode{nodeMapKey(legacy.Region, legacy.Key): legacy}, nil); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(state.checkpoint)
	if err != nil || bytes.Contains(body, []byte("roleSeenAt")) {
		t.Fatal("legacy fixture unexpectedly had metadata clocks")
	}
	restored, err := New(Options{Checkpoint: state.checkpoint})
	if err != nil {
		t.Fatal(err)
	}
	node, changed := restored.upsertNode("YKF", legacy.Key, "Corrected", "companion", true, 43.6, -80.3, true, t1+1000)
	if !changed || node.Role != "companion" || node.Lat != 43.6 || node.LastSeen != legacy.LastSeen || node.RoleSeenAt != t1+1000 {
		t.Fatal("legacy activity time was incorrectly treated as a metadata watermark")
	}
}

func TestCheckpointRejectsImpossibleMetadataClocks(t *testing.T) {
	now := time.Now().UnixMilli()
	for _, field := range []string{"label", "role", "coords"} {
		for _, at := range []int64{-1, now + 1} {
			state := newTestEngine(t)
			node := &privateNode{Region: "YKF", Key: "AA112233", Label: "Fixture", Role: "repeater", LastSeen: now}
			switch field {
			case "label":
				node.LabelSeenAt = at
			case "role":
				node.RoleSeenAt = at
			case "coords":
				node.CoordsSeenAt = at
			}
			if err := writeCheckpoint(state.checkpoint, map[string]*privateNode{nodeMapKey(node.Region, node.Key): node}, nil); err != nil {
				t.Fatal(err)
			}
			if _, _, err := loadCheckpoint(state.checkpoint); err == nil {
				t.Fatal("invalid metadata freshness was accepted from a checkpoint")
			}
		}
	}
}
