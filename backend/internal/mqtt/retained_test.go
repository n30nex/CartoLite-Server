package mqtt

import (
	"testing"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
)

type retainedTestMessage struct {
	paho.Message
	retained bool
}

func (m retainedTestMessage) Topic() string   { return "meshcore/YKF/AA112233/packets" }
func (m retainedTestMessage) Payload() []byte { return []byte(`{"raw":"1100","timestamp":1}`) }
func (m retainedTestMessage) Retained() bool  { return m.retained }

func TestTransportPreservesRetainedFlagAndReceiptTime(t *testing.T) {
	for _, retained := range []bool{false, true} {
		var received []Message
		client := NewClient(ClientConfig{Regions: map[string]struct{}{"YKF": {}}}, nil, func(message Message) bool {
			received = append(received, message)
			return true
		}, nil)
		client.onMessage(nil, retainedTestMessage{retained: retained})
		if len(received) != 1 || received[0].Retained != retained || received[0].ReceivedAt <= 0 {
			t.Fatal("transport lost retained or receipt-time information")
		}
		if received[0].ReportedAt != 1_000 || received[0].HeardAt != received[0].ReceivedAt {
			t.Fatal("reported time was replaced by the ordinary live-delivery fallback")
		}
	}
}

func TestNormalizeKeepsReportedTimeSeparateFromLiveFallback(t *testing.T) {
	received := time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name, body string
		reported   int64
		heard      int64
	}{
		{"missing", `{"raw":"1100"}`, 0, received.UnixMilli()},
		{"old", `{"raw":"1100","timestamp":"2026-10-11T12:00:00Z"}`, received.Add(-24 * time.Hour).UnixMilli(), received.UnixMilli()},
		{"recent", `{"raw":"1100","timestamp":"2026-10-12T11:59:00Z"}`, received.Add(-time.Minute).UnixMilli(), received.Add(-time.Minute).UnixMilli()},
		{"boundary", `{"raw":"1100","timestamp":"2026-10-12T11:55:00Z"}`, received.Add(-MaxLiveDelay).UnixMilli(), received.Add(-MaxLiveDelay).UnixMilli()},
		{"near future", `{"raw":"1100","timestamp":"2026-10-12T12:01:00Z"}`, received.Add(time.Minute).UnixMilli(), received.UnixMilli()},
		{"future", `{"raw":"1100","timestamp":"2026-10-13T12:00:00Z"}`, received.Add(24 * time.Hour).UnixMilli(), received.UnixMilli()},
		{"malformed", `{"raw":"1100","timestamp":"not a time"}`, 0, received.UnixMilli()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			message, err := Normalize("meshcore/YKF/AA112233/packets", []byte(tc.body), received)
			if err != nil || message.ReceivedAt != received.UnixMilli() || message.ReportedAt != tc.reported || message.HeardAt != tc.heard {
				t.Fatal("normalization mixed receipt, reported and live observation time")
			}
		})
	}
}
