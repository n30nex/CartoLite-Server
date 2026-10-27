package mqtt

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestNonFiniteNumbersDoNotBecomeRFOrCoordinates(t *testing.T) {
	for _, invalid := range []any{"NaN", "+Inf", "-Inf", "Infinity", math.NaN(), math.Inf(1), math.Inf(-1)} {
		if firstNumber(map[string]any{"rssi": invalid}, "rssi") != nil {
			t.Fatalf("accepted non-finite numeric input %v", invalid)
		}
		if _, _, ok := Coordinates(map[string]any{"lat": invalid, "lng": -80.0}); ok {
			t.Fatal("accepted a non-finite coordinate")
		}
	}
	value := firstNumber(map[string]any{"RSSI": "NaN", "rssi": "-75"}, "RSSI", "rssi")
	if value == nil || *value != -75 {
		t.Fatal("a finite fallback field was ignored")
	}
	message, err := Normalize("meshcore/YKF/AA112233/packets", []byte(`{"raw":"0901AA00AA","rssi":"NaN","snr":"7.4"}`), time.Now())
	if err != nil || message.RSSI != nil || message.SNR == nil || *message.SNR != 7.4 {
		t.Fatal("normalization did not retain only finite RF evidence")
	}
}

func TestQueuedEnvelopeKeepsOnlyBoundedMetadata(t *testing.T) {
	name := strings.Repeat("🌲", 1000)
	body, err := json.Marshal(map[string]any{
		"raw": "0901AA00AA", "origin": name, "name": name,
		"node_type": 2, "latitude": 43.4, "longitude": -80.4,
		"unneeded": map[string]any{"values": strings.Repeat("x", 20_000)},
	})
	if err != nil {
		t.Fatal(err)
	}
	message, err := Normalize("meshcore/YKF/AA112233/packets", body, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(message.Payload) != 4 || Role(message.Payload) != "repeater" || utf8.RuneCountInString(Name(message.Payload)) != 256 || utf8.RuneCountInString(message.ObserverName) != 256 {
		t.Fatal("queued envelope retained unused data or lost normalized metadata")
	}
	lat, lng, ok := Coordinates(message.Payload)
	if !ok || lat != 43.4 || lng != -80.4 || message.RawHex != "0901AA00AA" || message.QueueBytes() >= 4096 {
		t.Fatal("normalization changed useful observation data or retained excessive bytes")
	}
}

func TestFractionalNodeTypesCannotBecomeForwarders(t *testing.T) {
	for _, value := range []any{2.1, 2.9, "2.5", 3.1, 1e100} {
		if Role(map[string]any{"node_type": value}) != "unknown" {
			t.Fatalf("non-integral or out-of-range role %v became a node type", value)
		}
	}
}

func TestMQTTEnvelopeSizeIsBoundedBeforeNormalization(t *testing.T) {
	topic := "meshcore/YKF/AA112233/packets"
	for _, oversized := range []string{
		strings.Repeat("AA", maxMessageBytes/2+1),
		`{"raw":"` + strings.Repeat("AA", maxMessageBytes/2) + `"}`,
	} {
		if _, err := Normalize(topic, []byte(oversized), time.Now()); err == nil {
			t.Fatal("oversized MQTT payload reached normalization")
		}
	}
	valid := `{"raw":"0901AA00AA","rssi":-75}`
	body := valid + strings.Repeat(" ", maxMessageBytes-len(valid))
	message, err := Normalize(topic, []byte(body), time.Now())
	if err != nil || message.RawHex != "0901AA00AA" || message.RSSI == nil {
		t.Fatal("valid envelope at the byte limit was rejected")
	}
}
