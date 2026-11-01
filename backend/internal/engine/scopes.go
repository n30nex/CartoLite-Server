package engine

import (
	"encoding/json"
	"time"

	"github.com/n30nex/cartolite-server/backend/internal/meshcore"
	"github.com/n30nex/cartolite-server/backend/internal/mqtt"
	"github.com/n30nex/cartolite-server/backend/internal/scopes"
)

const scopePolicy = "mqtt-only"

func (e *Engine) ScopesJSON() []byte {
	value, _ := e.scopeSnapshot.Load().([]byte)
	// Published buffers are immutable; HTTP readers do not need a private copy.
	return value
}

func (e *Engine) scopeNodeIDs(locatedOnly bool) map[string]string {
	ids := make(map[string]string, len(e.nodeIDs))
	for id, node := range e.nodeIDs {
		if scopes.FullKey(node.Key) && (!locatedOnly || node.HasCoords) {
			ids[node.Key] = id
		}
	}
	return ids
}

func (e *Engine) updateScopeSnapshot(now time.Time) {
	at := now.UnixMilli()
	if !e.feed {
		e.scopes.LastGap = at
	}
	body, err := json.Marshal(e.scopes.Snapshot(e.scopeNodeIDs(true), at, e.feed))
	if err == nil {
		e.scopeSnapshot.Store(body)
	}
}

func (e *Engine) processScopeReports(message mqtt.Message) bool {
	now := message.ReceivedAt
	if now <= 0 {
		now = time.Now().UnixMilli()
	}
	changed := false
	for _, report := range message.ScopeReports {
		// Joining is private and exact. A report cannot create a radio or position.
		node := e.nodeIDs[opaqueID("n", report.Key)]
		if node == nil || node.Key != report.Key || report.Region != message.Topic.Region {
			continue
		}
		changed = e.scopes.PutReport(report, now) || changed
	}
	return changed
}

func (e *Engine) recordScopeRepeats(message mqtt.Message, packet meshcore.Packet, observer *privateNode) bool {
	if message.Duplicate || packet.InvalidForMap || packet.PayloadVersion != 0 || packet.HashSize < 1 || packet.HashSize > 3 ||
		packet.PayloadType == meshcore.PayloadTrace || (packet.RouteType != 0 && packet.RouteType != 1) || len(packet.Payload) > 256 {
		return false
	}
	name := "*"
	if packet.RouteType == 0 {
		name = e.scopes.Match(message.Topic.Region, packet.TransportCodes, byte(packet.PayloadType), packet.Payload)
	}
	changed := false
	if observer != nil {
		changed = e.scopes.Observe(observer.Key, name, message.HeardAt, false)
	}
	seen := make(map[string]bool, len(packet.Path))
	for _, prefix := range packet.Path {
		matches := e.prefixes[prefixMapKey(message.Topic.Region, packet.HashSize, prefix)]
		// Check ambiguity BEFORE filtering roles/coordinates: another identity may
		// own the prefix, even if it has never supplied a position or role.
		if len(matches) != 1 {
			continue
		}
		for key := range matches {
			node := e.nodes[key]
			if node == nil || node.Role != "repeater" || seen[node.Key] {
				continue
			}
			current := e.nodeIDs[nodePublicID(node)]
			if current == nil || current.Role != "repeater" {
				continue
			}
			seen[node.Key] = true
			changed = e.scopes.Observe(node.Key, name, message.HeardAt, true) || changed
		}
	}
	return changed
}
