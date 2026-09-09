package mqtt

import (
	"math"
	"strings"
	"testing"
	"time"
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
