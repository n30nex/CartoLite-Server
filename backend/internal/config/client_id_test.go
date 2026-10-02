package config

import (
	"strings"
	"testing"
)

func TestClientIdentityDefaultsAreUniqueAndExplicitIDsArePreserved(t *testing.T) {
	t.Setenv("MQTT_ENABLED", "false")
	t.Setenv("MQTT_CLIENT_ID", "")
	first, err := Load("test", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	second, err := Load("test", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if first.MQTTClientID == second.MQTTClientID || !strings.HasPrefix(first.MQTTClientID, "cartolite-") || len(first.MQTTClientID) > 23 {
		t.Fatal("default installations share a client ID or exceed the legacy limit")
	}
	t.Setenv("MQTT_CLIENT_ID", "my-existing-instance")
	explicit, err := Load("test", "fixture")
	if err != nil || explicit.MQTTClientID != "my-existing-instance" {
		t.Fatal("explicit broker identity was changed")
	}
}
