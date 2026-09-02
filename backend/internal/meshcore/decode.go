package meshcore

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	PayloadRequest   = 0x00
	PayloadResponse  = 0x01
	PayloadPlainText = 0x02
	PayloadAck       = 0x03
	PayloadAdvert    = 0x04
	PayloadGroupText = 0x05
	PayloadAnonReq   = 0x07
	PayloadPath      = 0x08
	PayloadTrace     = 0x09
	PayloadControl   = 0x0B
)

var nonHex = regexp.MustCompile(`[^0-9a-fA-F]`)

type Packet struct {
	RouteType      int
	PayloadType    int
	PayloadVersion int
	HashSize       int
	HopCount       int
	Path           []string
	Payload        []byte
	InvalidForMap  bool
}

type Advert struct {
	PublicKey string
	Role      string
	Latitude  *float64
	Longitude *float64
	Name      string
}

func ParseHex(value string) (Packet, error) {
	clean := strings.ToUpper(nonHex.ReplaceAllString(strings.TrimSpace(value), ""))
	if clean == "" || len(clean)%2 != 0 {
		return Packet{}, fmt.Errorf("invalid packet hex")
	}
	raw, err := hex.DecodeString(clean)
	if err != nil {
		return Packet{}, fmt.Errorf("decode packet: %w", err)
	}
	return Parse(raw)
}

func Parse(raw []byte) (Packet, error) {
	if len(raw) < 2 {
		return Packet{}, fmt.Errorf("packet too short")
	}
	header := raw[0]
	out := Packet{RouteType: int(header & 0x03), PayloadType: int((header >> 2) & 0x0f), PayloadVersion: int((header >> 6) & 0x03)}
	offset := 1
	if out.RouteType == 0 || out.RouteType == 3 {
		if len(raw) < 6 {
			return Packet{}, fmt.Errorf("packet missing transport codes")
		}
		offset += 4
	}
	if offset >= len(raw) {
		return Packet{}, fmt.Errorf("packet missing path length")
	}
	pathHeader := raw[offset]
	offset++
	out.HashSize = int(pathHeader>>6) + 1
	out.HopCount = int(pathHeader & 0x3f)
	pathBytes := out.HashSize * out.HopCount
	if offset+pathBytes > len(raw) {
		return Packet{}, fmt.Errorf("packet path is truncated")
	}
	for index := 0; index < pathBytes; index += out.HashSize {
		out.Path = append(out.Path, strings.ToUpper(hex.EncodeToString(raw[offset+index:offset+index+out.HashSize])))
	}
	offset += pathBytes
	out.Payload = append([]byte(nil), raw[offset:]...)
	out.InvalidForMap = out.HashSize == 4 && out.PayloadType != PayloadTrace
	return out, nil
}

func ParseAdvert(payload []byte) (Advert, bool, error) {
	if len(payload) < 100 {
		return Advert{}, false, nil
	}
	out := Advert{PublicKey: strings.ToUpper(hex.EncodeToString(payload[:32])), Role: "unknown"}
	app := payload[100:]
	if len(app) == 0 {
		return out, true, nil
	}
	flags := app[0]
	out.Role = role(int(flags & 0x0f))
	offset := 1
	if flags&0x10 != 0 {
		if offset+8 > len(app) {
			return out, true, fmt.Errorf("advert location is truncated")
		}
		lat := float64(int32(binary.LittleEndian.Uint32(app[offset:offset+4]))) / 1_000_000
		offset += 4
		lng := float64(int32(binary.LittleEndian.Uint32(app[offset:offset+4]))) / 1_000_000
		offset += 4
		if validCoords(lat, lng) {
			out.Latitude, out.Longitude = &lat, &lng
		}
	}
	if flags&0x20 != 0 {
		offset += 2
	}
	if flags&0x40 != 0 {
		offset += 2
	}
	if offset > len(app) {
		return out, true, fmt.Errorf("advert metadata is truncated")
	}
	if flags&0x80 != 0 && offset < len(app) {
		name := app[offset:]
		if cut := strings.IndexByte(string(name), 0); cut >= 0 {
			name = name[:cut]
		}
		if utf8.Valid(name) {
			out.Name = strings.TrimSpace(string(name))
		}
	}
	return out, true, nil
}

func PayloadName(value int) string {
	switch value {
	case PayloadAdvert:
		return "Advert"
	case PayloadTrace:
		return "Trace"
	case PayloadPlainText, PayloadGroupText:
		return "Text"
	case PayloadAck:
		return "ACK"
	case PayloadControl:
		return "Control"
	default:
		return "Other"
	}
}

// SourcePublicKey returns a protocol-authenticated full source identity only
// for anonymous requests, whose payload carries the 32-byte key at bytes 1-32.
func SourcePublicKey(packet Packet) string {
	if packet.PayloadType != PayloadAnonReq || len(packet.Payload) < 33 {
		return ""
	}
	return strings.ToUpper(hex.EncodeToString(packet.Payload[1:33]))
}

// SourcePrefix returns the one-byte source hint present in these normal packet
// payloads. Callers must require a unique positioned node before using it.
func SourcePrefix(packet Packet) (string, bool) {
	switch packet.PayloadType {
	case PayloadRequest, PayloadResponse, PayloadPlainText, PayloadPath:
		if len(packet.Payload) >= 2 {
			return strings.ToUpper(hex.EncodeToString(packet.Payload[1:2])), true
		}
	}
	return "", false
}

func role(value int) string {
	switch value {
	case 1:
		return "companion"
	case 2:
		return "repeater"
	case 3:
		return "room_server"
	case 4:
		return "sensor"
	default:
		return "unknown"
	}
}

func validCoords(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}
