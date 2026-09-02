package mqtt

import "testing"

func TestRegionAllowlistIsOptional(t *testing.T) {
	if !regionAllowed(nil, "EU_WEST") || !regionAllowed(map[string]struct{}{}, "AU") {
		t.Fatal("empty allowlist did not accept a valid worldwide region")
	}
	allowlist := map[string]struct{}{"EU_WEST": {}}
	if !regionAllowed(allowlist, "EU_WEST") || regionAllowed(allowlist, "US_WEST") {
		t.Fatal("configured allowlist did not stay exact")
	}
}
