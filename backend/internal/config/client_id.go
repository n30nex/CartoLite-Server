package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

// Clean MQTT sessions do not need a stable identity across process restarts.
// Keep generated IDs below the legacy 23-byte limit and avoid disconnecting
// another default installation that uses the same broker.
func defaultClientID() (string, error) {
	var suffix [6]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return "", fmt.Errorf("generate MQTT client identity: %w", err)
	}
	return "cartolite-" + hex.EncodeToString(suffix[:]), nil
}
