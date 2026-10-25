package config

import (
	"strings"
	"testing"
)

func TestOptionalPagesConfiguration(t *testing.T) {
	t.Setenv("MQTT_ENABLED", "false")
	for _, test := range []struct {
		input string
		want  string
		valid bool
	}{
		{"", "", true},
		{" firehose,terminal,firehose ", "terminal,firehose", true},
		{"terminal,chronoscope,firehose", "terminal,chronoscope,firehose", true},
		{"labs", "", false},
		{"firehos", "", false},
		{"terminal/firehose", "", false},
		{"<script>", "", false},
	} {
		t.Run(test.input, func(t *testing.T) {
			t.Setenv("EXTRA_PAGES", test.input)
			cfg, err := Load("test", "synthetic")
			if (err == nil) != test.valid || (test.valid && strings.Join(cfg.ExtraPages, ",") != test.want) {
				t.Fatalf("pages = %v, error = %v", cfg.ExtraPages, err)
			}
		})
	}
}
