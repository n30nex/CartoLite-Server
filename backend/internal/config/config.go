package config

import (
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr        string
	Checkpoint      string
	MQTTEnabled     bool
	MQTTBrokerURL   string
	MQTTTopic       string
	MQTTClientID    string
	MQTTUsername    string
	MQTTPassword    string
	Regions         map[string]struct{}
	QueueSize       int
	Version         string
	GitSHA          string
	MapProvider     string
	CartoBrowserKey string
}

func Load(version, gitSHA string) (Config, error) {
	c := Config{
		HTTPAddr:      env("HTTP_ADDR", ":8080"),
		Checkpoint:    env("STATE_PATH", "/data/state-v1.json"),
		MQTTEnabled:   envBool("MQTT_ENABLED", true),
		MQTTBrokerURL: strings.TrimSpace(os.Getenv("MQTT_BROKER_URL")),
		MQTTTopic:     env("MQTT_TOPIC", "meshcore/#"),
		MQTTClientID:  env("MQTT_CLIENT_ID", "cartolite-server"),
		MQTTUsername:  strings.TrimSpace(os.Getenv("MQTT_USERNAME")),
		MQTTPassword:  strings.TrimSpace(os.Getenv("MQTT_PASSWORD")),
		QueueSize:     envInt("MQTT_INGEST_QUEUE_SIZE", 4096),
		Version:       cleanBuildValue(version, "dev"),
		GitSHA:        cleanBuildValue(gitSHA, "unknown"),
		MapProvider:   strings.ToLower(env("BASEMAP_PROVIDER", "openfreemap")),
	}
	regions, err := regionAllowlist()
	if err != nil {
		return Config{}, err
	}
	c.Regions = regions
	if c.MapProvider != "openfreemap" && c.MapProvider != "carto" {
		return Config{}, fmt.Errorf("BASEMAP_PROVIDER must be openfreemap or carto")
	}
	if c.MapProvider == "carto" {
		keyPath := strings.TrimSpace(os.Getenv("CARTO_BASEMAP_API_KEY_FILE"))
		if keyPath == "" {
			return Config{}, fmt.Errorf("CARTO_BASEMAP_API_KEY_FILE is required for the carto provider")
		}
		file, err := os.Open(keyPath)
		if err != nil {
			return Config{}, fmt.Errorf("CARTO browser key file could not be opened")
		}
		key, readErr := io.ReadAll(io.LimitReader(file, 8193))
		file.Close()
		if readErr != nil || len(key) > 8192 {
			return Config{}, fmt.Errorf("CARTO browser key file could not be read or is too large")
		}
		c.CartoBrowserKey = strings.TrimSpace(string(key))
		if c.CartoBrowserKey == "" || strings.ContainsAny(c.CartoBrowserKey, "\r\n\t ") {
			return Config{}, fmt.Errorf("CARTO browser key file must contain one browser key")
		}
	}
	if c.MQTTEnabled && strings.TrimSpace(c.MQTTBrokerURL) == "" {
		return Config{}, fmt.Errorf("MQTT_BROKER_URL is required")
	}
	if (c.MQTTUsername == "") != (c.MQTTPassword == "") {
		return Config{}, fmt.Errorf("MQTT_USERNAME and MQTT_PASSWORD must be set together")
	}
	if c.QueueSize < 64 || c.QueueSize > 65536 {
		return Config{}, fmt.Errorf("MQTT_INGEST_QUEUE_SIZE must be between 64 and 65536")
	}
	return c, nil
}

func regionAllowlist() (map[string]struct{}, error) {
	raw := strings.TrimSpace(os.Getenv("REGION_ALLOWLIST"))
	out := make(map[string]struct{})
	for _, item := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ';' || r == ' ' }) {
		item = strings.ToUpper(strings.TrimSpace(item))
		if item == "" {
			continue
		}
		if item == "*" || item == "#" || strings.ContainsAny(item, "+/#") {
			return nil, fmt.Errorf("REGION_ALLOWLIST entries must be exact labels, got %q", item)
		}
		if len(item) > 16 {
			return nil, fmt.Errorf("REGION_ALLOWLIST entry too long: %q", item)
		}
		out[item] = struct{}{}
	}
	return out, nil
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func cleanBuildValue(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

const QuietAfter = time.Minute
