package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRuntimeBasemapConfiguration(t *testing.T) {
	t.Setenv("MQTT_ENABLED", "false")
	t.Setenv("BASEMAP_PROVIDER", "openfreemap")
	t.Setenv("CARTO_BASEMAP_API_KEY_FILE", filepath.Join(t.TempDir(), "absent"))
	cfg, err := Load("test", "abc")
	if err != nil || cfg.MapProvider != "openfreemap" || cfg.CartoBrowserKey != "" {
		t.Fatal("key-free default failed", err)
	}
	t.Setenv("BASEMAP_PROVIDER", "carto")
	if _, err := Load("test", "abc"); err == nil {
		t.Fatal("missing CARTO key accepted")
	}
	keyPath := filepath.Join(t.TempDir(), "browser-key")
	t.Setenv("CARTO_BASEMAP_API_KEY_FILE", keyPath)
	for _, value := range []string{"", "two keys", strings.Repeat("x", 8193)} {
		if err := os.WriteFile(keyPath, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := Load("test", "abc"); err == nil {
			t.Fatal("invalid browser key accepted")
		}
	}
	if err := os.WriteFile(keyPath, []byte("synthetic-public-browser-key\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err = Load("test", "abc")
	if err != nil || cfg.CartoBrowserKey != "synthetic-public-browser-key" {
		t.Fatal("runtime browser key not loaded", err)
	}
	t.Setenv("BASEMAP_PROVIDER", "https://untrusted.invalid/style")
	if _, err := Load("test", "abc"); err == nil {
		t.Fatal("arbitrary map provider accepted")
	}
}
