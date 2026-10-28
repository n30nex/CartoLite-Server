package meshcore

import (
	"regexp"
	"strings"
	"testing"
)

func TestHexCleanupPreservesPacketBytesAndSeparatorCompatibility(t *testing.T) {
	for _, value := range []string{"2d01aa00", "2D:01-AA 00", "\t2d\n01\u2603aa\u000000", strings.Repeat("Z", 64*1024-8) + "2d01aa00"} {
		packet, err := ParseHex(value)
		if err != nil || packet.PayloadType != PayloadControl || len(packet.Path) != 1 || packet.Path[0] != "AA" || len(packet.Payload) != 1 || packet.Payload[0] != 0 {
			t.Fatal("formatted input changed decoded packet bytes")
		}
	}
	for _, value := range []string{"", "ZZZ", "2d01aa0"} {
		if _, err := ParseHex(value); err == nil {
			t.Fatal("empty or odd hex became a packet")
		}
	}
}

var hexCleanupResult string

// Compare cleanup only, not whole-service throughput, using synthetic input.
func BenchmarkHexCleanup(b *testing.B) {
	legacy := regexp.MustCompile(`[^0-9a-fA-F]`)
	for _, input := range []struct{ name, value string }{
		{"plain", strings.Repeat("ab", 128)},
		{"separated", strings.Repeat("ab: ", 128)},
		{"malformed-envelope", strings.Repeat("Z", 64*1024)},
	} {
		for _, method := range []string{"regexp", "single-pass"} {
			b.Run(input.name+"/"+method, func(b *testing.B) {
				b.ReportAllocs()
				b.SetBytes(int64(len(input.value)))
				for i := 0; i < b.N; i++ {
					if method == "regexp" {
						hexCleanupResult = strings.ToUpper(legacy.ReplaceAllString(strings.TrimSpace(input.value), ""))
					} else {
						hexCleanupResult = cleanHex(input.value)
					}
				}
			})
		}
	}
}
