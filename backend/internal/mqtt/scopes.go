package mqtt

import (
	"strings"

	"github.com/n30nex/cartolite-server/backend/internal/scopes"
)

// Normalize only the explicit report fields; never retain the original envelope.
// Null/missing/timeout is not a successful empty reply. Neighbor reports do not
// create nodes or links, and their heard_secs_ago is not a scope-query timestamp.
func scopeReports(info Topic, payload map[string]any, at int64) []scopes.Report {
	var reports []scopes.Report
	add := func(key, source string, fields map[string]any) {
		key = strings.ToUpper(key)
		if !scopes.FullKey(key) || len(reports) >= 64 {
			return
		}
		r := scopes.Report{Key: key, Region: info.Region, Source: source, At: at, Entries: []scopes.Entry{}}
		if raw, exists := fields["scopes"]; exists && raw != nil {
			var names []string
			switch value := raw.(type) {
			case string:
				if len(value) > 4096 {
					return
				}
				if value != "" {
					names = strings.Split(value, ",")
				}
			case []any:
				if len(value) > scopes.MaxNames {
					return
				}
				for _, item := range value {
					name, ok := item.(string)
					if !ok {
						return
					}
					names = append(names, name)
				}
			default:
				return
			}
			if len(names) > scopes.MaxNames {
				return
			}
			for _, value := range names {
				name, ok := scopes.Name(strings.TrimSpace(value))
				if !ok {
					return
				}
				r.Entries = append(r.Entries, scopes.Entry{Name: name, At: at})
			}
			r.List = true
		}
		if value, ok := fields["default_scope"].(string); ok {
			if name, valid := scopes.Name(value); valid {
				r.Default, r.DefaultState = name, "named"
			}
		}
		if state, ok := fields["default_scope_state"].(string); ok && (state == "unknown" || state == "none") {
			r.Default, r.DefaultState = "", state
		}
		if r.List || r.DefaultState != "" {
			reports = append(reports, r)
		}
	}
	switch info.Kind {
	case "neighbors":
		if self, ok := payload["self"].(map[string]any); ok {
			add(info.PublisherKey, "mqtt-self", self)
		}
		if neighbors, ok := payload["neighbors"].([]any); ok && len(neighbors) <= 63 {
			for _, value := range neighbors {
				row, ok := value.(map[string]any)
				if !ok || row["status"] != "responded" {
					continue
				}
				if key, ok := row["pubkey"].(string); ok {
					add(key, "mqtt-neighbor", row)
				}
			}
		}
	case "status":
		add(info.PublisherKey, "mqtt-status", payload)
	}
	return reports
}
