package meshcore

import "testing"

func TestParseOneBytePath(t *testing.T) {
	packet, err := Parse([]byte{byte(PayloadControl<<2) | 1, 2, 0xaa, 0xbb, 0x01})
	if err != nil {
		t.Fatal(err)
	}
	if packet.HashSize != 1 || packet.HopCount != 2 || len(packet.Path) != 2 || packet.Path[0] != "AA" {
		t.Fatalf("unexpected packet: %#v", packet)
	}
}

func TestFourBytePathOnlyAllowedForTrace(t *testing.T) {
	nonTrace, err := Parse([]byte{byte(PayloadControl<<2) | 1, 0xc1, 1, 2, 3, 4})
	if err != nil {
		t.Fatal(err)
	}
	if !nonTrace.InvalidForMap {
		t.Fatal("non-trace 4-byte path was accepted for map use")
	}
	trace, err := Parse([]byte{byte(PayloadTrace<<2) | 1, 0xc1, 1, 2, 3, 4})
	if err != nil || trace.InvalidForMap {
		t.Fatalf("trace exception was rejected: %#v, %v", trace, err)
	}
}

func TestSourceIdentitiesAreProtocolScoped(t *testing.T) {
	plain := Packet{PayloadType: PayloadPlainText, Payload: []byte{0, 0xaa, 1}}
	if prefix, ok := SourcePrefix(plain); !ok || prefix != "AA" {
		t.Fatalf("plain source prefix = %q, %v", prefix, ok)
	}
	key := make([]byte, 32)
	for index := range key {
		key[index] = byte(index + 1)
	}
	anon := Packet{PayloadType: PayloadAnonReq, Payload: append([]byte{0}, key...)}
	if got := SourcePublicKey(anon); len(got) != 64 {
		t.Fatalf("anonymous request source key length = %d", len(got))
	}
	if _, ok := SourcePrefix(Packet{PayloadType: PayloadGroupText, Payload: []byte{0, 0xaa}}); ok {
		t.Fatal("group text incorrectly exposed a source prefix")
	}
}
