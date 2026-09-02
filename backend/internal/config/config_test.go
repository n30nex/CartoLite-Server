package config

import "testing"

func TestRegionAllowlistIsExact(t *testing.T) {
	t.Setenv("REGION_ALLOWLIST", "YKF,YYZ")
	regions, err := regionAllowlist()
	if err != nil || len(regions) != 2 {
		t.Fatalf("exact allowlist rejected: %v", err)
	}
	t.Setenv("REGION_ALLOWLIST", "YKF,*")
	if _, err := regionAllowlist(); err == nil {
		t.Fatal("wildcard allowlist entry accepted")
	}
}

func TestRegionAllowlistDefaultsToWorldwide(t *testing.T) {
	t.Setenv("REGION_ALLOWLIST", "")
	regions, err := regionAllowlist()
	if err != nil || len(regions) != 0 {
		t.Fatalf("empty allowlist should accept every valid region: %v, %#v", err, regions)
	}
}

func TestStatePathIsTheOnlyCheckpointSetting(t *testing.T) {
	t.Setenv("MQTT_ENABLED", "false")
	t.Setenv("STATE_PATH", "/data/expected.json")
	t.Setenv("CHECKPOINT_PATH", "/data/ignored.json")
	config, err := Load("test", "abc")
	if err != nil {
		t.Fatal(err)
	}
	if config.Checkpoint != "/data/expected.json" {
		t.Fatalf("checkpoint path = %q, want STATE_PATH", config.Checkpoint)
	}
}

func TestMQTTBrokerMustBeConfigured(t *testing.T) {
	t.Setenv("MQTT_ENABLED", "true")
	t.Setenv("MQTT_BROKER_URL", "")
	if _, err := Load("test", "abc"); err == nil {
		t.Fatal("enabled MQTT accepted an empty broker URL")
	}
}
