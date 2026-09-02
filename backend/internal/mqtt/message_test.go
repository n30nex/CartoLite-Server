package mqtt

import (
	"testing"
	"time"
)

func TestParseTopicAndNormalize(t *testing.T) {
	topic := "meshcore/YKF/AABBCCDDEEFF0011/packets"
	received := time.Date(2026, 7, 12, 12, 0, 0, 0, time.UTC)
	message, err := Normalize(topic, []byte(`{"raw":"aabb","origin":"observer","rssi":-91,"timestamp":1}`), received)
	if err != nil {
		t.Fatal(err)
	}
	if message.Topic.Region != "YKF" || message.Topic.Kind != "packets" || message.RawHex != "aabb" {
		t.Fatalf("unexpected normalized message: %#v", message)
	}
	if message.HeardAt != received.UnixMilli() {
		t.Fatalf("stale broker timestamp was not clamped: %d", message.HeardAt)
	}
	if message.RSSI == nil || *message.RSSI != -91 {
		t.Fatal("RSSI was not normalized")
	}
}

func TestParseTopicRejectsBroadOrPrivateSubtopics(t *testing.T) {
	for _, topic := range []string{
		"meshcore/+/AABBCCDDEEFF0011/packets",
		"meshcore/YKF/AABBCCDDEEFF0011/internal",
		"other/YKF/AABBCCDDEEFF0011/packets",
	} {
		if _, err := ParseTopic(topic); err == nil {
			t.Fatalf("expected %q to be rejected", topic)
		}
	}
}

func TestCoordinatesRejectInvalidValues(t *testing.T) {
	if _, _, ok := Coordinates(map[string]any{"lat": 91.0, "lng": -80.0}); ok {
		t.Fatal("invalid latitude accepted")
	}
}

func TestRoleSupportsSyntheticStatusShapes(t *testing.T) {
	if got := Role(map[string]any{"role": "repeater"}); got != "repeater" {
		t.Fatalf("role string normalized to %q", got)
	}
	if got := Role(map[string]any{"node_type": 3.0}); got != "room_server" {
		t.Fatalf("numeric node type normalized to %q", got)
	}
}
