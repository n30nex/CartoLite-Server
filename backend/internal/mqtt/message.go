package mqtt

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	regionPattern = regexp.MustCompile(`^[A-Z0-9_-]{1,16}$`)
	keyPattern    = regexp.MustCompile(`^[0-9A-F]{8,128}$`)
)

type Topic struct {
	Region       string
	PublisherKey string
	Kind         string
}

type Message struct {
	Topic        Topic
	RawHex       string
	Payload      map[string]any
	ObserverName string
	ObserverKey  string
	RSSI         *float64
	SNR          *float64
	HeardAt      int64
}

func ParseTopic(value string) (Topic, error) {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	if len(parts) != 4 || parts[0] != "meshcore" {
		return Topic{}, fmt.Errorf("unexpected topic shape")
	}
	region := strings.ToUpper(strings.TrimSpace(parts[1]))
	key := strings.ToUpper(strings.TrimSpace(parts[2]))
	kind := strings.ToLower(strings.TrimSpace(parts[3]))
	if !regionPattern.MatchString(region) {
		return Topic{}, fmt.Errorf("invalid region")
	}
	if !validKey(key) {
		return Topic{}, fmt.Errorf("invalid publisher key")
	}
	if kind != "packets" && kind != "status" {
		return Topic{}, fmt.Errorf("unsupported subtopic")
	}
	return Topic{Region: region, PublisherKey: key, Kind: kind}, nil
}

func Normalize(topic string, body []byte, receivedAt time.Time) (Message, error) {
	info, err := ParseTopic(topic)
	if err != nil {
		return Message{}, err
	}
	if receivedAt.IsZero() {
		receivedAt = time.Now()
	}
	out := Message{Topic: info, HeardAt: receivedAt.UnixMilli()}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return out, nil
	}
	var payload map[string]any
	if json.Unmarshal(trimmed, &payload) != nil {
		out.RawHex = strings.TrimSpace(string(trimmed))
		return out, nil
	}
	out.Payload = payload
	out.RawHex = firstString(payload, "raw", "packet", "packet_raw", "packetHex", "payloadHex", "payload_hex", "data", "raw_hex")
	out.ObserverName = firstString(payload, "origin", "observer", "observer_name", "name", "node_name")
	out.ObserverKey = strings.ToUpper(firstString(payload, "origin_id", "observer_id", "public_key", "pubkey"))
	if !validKey(out.ObserverKey) {
		out.ObserverKey = info.PublisherKey
	}
	out.RSSI = firstNumber(payload, "RSSI", "rssi", "last_rssi")
	out.SNR = firstNumber(payload, "SNR", "snr", "last_snr")
	if parsed := firstTime(payload, "timestamp", "time", "received_at", "heard_at", "ts"); !parsed.IsZero() {
		if delta := parsed.Sub(receivedAt); delta <= 5*time.Minute && delta >= -5*time.Minute {
			out.HeardAt = parsed.UnixMilli()
		}
	}
	return out, nil
}

func Coordinates(payload map[string]any) (float64, float64, bool) {
	lat := firstNumber(payload, "latitude", "lat", "gps_latitude")
	lng := firstNumber(payload, "longitude", "lon", "lng", "gps_longitude")
	if lat == nil || lng == nil || *lat < -90 || *lat > 90 || *lng < -180 || *lng > 180 {
		return 0, 0, false
	}
	return *lat, *lng, true
}

func Name(payload map[string]any) string {
	return firstString(payload, "name", "node_name", "origin", "observer", "observer_name")
}

func Role(payload map[string]any) string {
	if value := strings.ToLower(firstString(payload, "role", "node_role", "nodeType", "type")); value != "" {
		switch value {
		case "repeater", "companion", "room_server", "sensor":
			return value
		}
	}
	if value := firstNumber(payload, "node_type", "nodeType"); value != nil {
		switch int(*value) {
		case 1:
			return "companion"
		case 2:
			return "repeater"
		case 3:
			return "room_server"
		case 4:
			return "sensor"
		}
	}
	return "unknown"
}

func firstString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key]; ok {
			switch typed := value.(type) {
			case string:
				if typed = strings.TrimSpace(typed); typed != "" {
					return typed
				}
			case float64:
				return strconv.FormatFloat(typed, 'f', -1, 64)
			}
		}
	}
	return ""
}

func firstNumber(values map[string]any, keys ...string) *float64 {
	for _, key := range keys {
		if value, ok := values[key]; ok {
			switch typed := value.(type) {
			case float64:
				copy := typed
				return &copy
			case string:
				if parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64); err == nil {
					return &parsed
				}
			}
		}
	}
	return nil
}

func firstTime(values map[string]any, keys ...string) time.Time {
	for _, key := range keys {
		value, ok := values[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return epoch(int64(typed))
		case string:
			text := strings.TrimSpace(typed)
			for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05"} {
				if parsed, err := time.Parse(layout, text); err == nil {
					return parsed
				}
			}
			if parsed, err := strconv.ParseInt(text, 10, 64); err == nil {
				return epoch(parsed)
			}
		}
	}
	return time.Time{}
}

func epoch(value int64) time.Time {
	if value > 9_999_999_999 {
		return time.UnixMilli(value)
	}
	return time.Unix(value, 0)
}

func validKey(value string) bool {
	return len(value)%2 == 0 && keyPattern.MatchString(value)
}
