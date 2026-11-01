package engine

import (
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/n30nex/cartolite-server/backend/internal/meshcore"
	"github.com/n30nex/cartolite-server/backend/internal/mqtt"
	"github.com/n30nex/cartolite-server/backend/internal/scopes"
)

func TestScopeHearingAttributionIsIndependentOfRoutes(t *testing.T) {
	for _, width := range []int{1, 2, 3} {
		t.Run(string(rune('0'+width)), func(t *testing.T) {
			e := newTestEngine(t)
			now := time.Now().UnixMilli()
			aKey, bKey, oKey := strings.Repeat("AA", 32), strings.Repeat("BB", 32), strings.Repeat("CC", 32)
			a, _ := e.upsertNode("YKF", aKey, "Relay", "repeater", false, 43.4, -80.4, true, now)
			e.upsertNode("YKF", bKey, "Room", "room_server", false, 43.5, -80.5, true, now)
			e.upsertNode("YKF", oKey, "Receiver", "companion", true, 43.6, -80.6, true, now)
			path := append([]byte{}, []byte(strings.Repeat("\xAA", width))...)
			path = append(path, path...)
			path = append(path, []byte(strings.Repeat("\xBB", width))...)
			raw := append([]byte{byte(meshcore.PayloadControl<<2) | 1, byte((width-1)<<6 | 3)}, path...)
			m := mqtt.Message{Topic: mqtt.Topic{Region: "YKF", PublisherKey: oKey, Kind: "packets"}, ObserverKey: oKey, HeardAt: now, ReceivedAt: now, RawHex: hex.EncodeToString(raw)}
			e.process(m)
			e.process(m) // Two hearings, not a claim of two RF transmissions.
			snapshot := e.scopes.Snapshot(e.scopeNodeIDs(true), now, true)
			if len(e.routes) != 0 {
				t.Fatal("scope evidence invented a route without RF metadata")
			}
			var count int64
			for _, n := range snapshot.Nodes {
				if n.ID == nodePublicID(a) {
					count = n.Scopes[0].Repeats[2]
				}
				if n.ID != nodePublicID(a) && n.Scopes[0].Repeats[2] != 0 {
					t.Fatal("receiver or room got repeat credit")
				}
			}
			if count != 2 {
				t.Fatalf("duplicate path identity counted incorrectly: %d", count)
			}
			// An unlocated, unknown-role identity sharing the full path prefix
			// invalidates attribution; role/position filtering cannot hide it.
			collision := strings.Repeat("AA", width) + strings.Repeat("DD", 32-width)
			e.upsertNode("YKF", collision, "Unknown", "unknown", false, 0, 0, false, now)
			e.process(m)
			snapshot = e.scopes.Snapshot(e.scopeNodeIDs(true), now, true)
			for _, n := range snapshot.Nodes {
				if n.ID == nodePublicID(a) && n.Scopes[0].Repeats[2] != 2 {
					t.Fatal("ambiguous prefix received repeat credit")
				}
			}
		})
	}
}

func TestScopeCountersExcludeNonLiveDirectAndTrace(t *testing.T) {
	e := newTestEngine(t)
	now := time.Now().UnixMilli()
	key := strings.Repeat("AA", 32)
	e.upsertNode("YKF", key, "Relay", "repeater", false, 43.4, -80.4, true, now)
	base := mqtt.Message{Topic: mqtt.Topic{Region: "YKF", PublisherKey: strings.Repeat("CC", 32), Kind: "packets"}, HeardAt: now, ReceivedAt: now, RawHex: "2d01aa"}
	for _, mutate := range []func(*mqtt.Message){
		func(m *mqtt.Message) { m.Retained = true },
		func(m *mqtt.Message) { m.ReportedAt = now - 10*time.Minute.Milliseconds() },
		func(m *mqtt.Message) { m.Duplicate = true },
		func(m *mqtt.Message) { m.RawHex = "2e01aa" },
		func(m *mqtt.Message) { m.RawHex = "2501aa" },
	} {
		m := base
		mutate(&m)
		e.process(m)
	}
	if len(e.scopes.Save().Buckets) != 0 {
		t.Fatal("non-live/direct/trace traffic received credit")
	}
	e.process(base)
	e.updateScopeSnapshot(time.Now())
	var snap scopes.Snapshot
	if err := json.Unmarshal(e.ScopesJSON(), &snap); err != nil || len(snap.Nodes) != 1 {
		t.Fatal("missing aggregate snapshot", err)
	}
	if strings.Contains(string(e.ScopesJSON()), key) {
		t.Fatal("private identity leaked")
	}
	if err := writeCheckpoint(e.checkpoint, e.nodes, e.routes, e.scopes.Save()); err != nil {
		t.Fatal(err)
	}
	restored, err := New(Options{Checkpoint: e.checkpoint})
	if err != nil || len(restored.scopes.Save().Buckets) != 1 {
		t.Fatal("scope restore failed", err)
	}
}

func TestScopeReportsJoinKnownFullIdentityAcrossReceivingAreas(t *testing.T) {
	e := newTestEngine(t)
	now := time.Now().UnixMilli()
	key := strings.Repeat("AB", 32)
	e.upsertNode("YTZ", key, "Fixture", "repeater", false, 43, -80, true, now)
	message := mqtt.Message{Topic: mqtt.Topic{Region: "YKF", Kind: "neighbors"}, ReceivedAt: now, ScopeReports: []scopes.Report{
		{Key: key, Region: "YKF", Source: "mqtt-neighbor", List: true, Entries: []scopes.Entry{{Name: "#ykf"}}},
		{Key: strings.Repeat("CD", 32), Region: "YKF", Source: "mqtt-neighbor", List: true, Entries: []scopes.Entry{{Name: "#unknown"}}},
	}}
	e.process(message)
	if len(e.nodes) != 1 || len(e.routes) != 0 || len(e.scopes.Save().Reports) != 1 {
		t.Fatal("report created topology or failed to join a known full identity")
	}
}
