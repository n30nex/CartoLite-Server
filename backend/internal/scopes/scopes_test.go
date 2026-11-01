package scopes

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestScopeWindowsReportsAndRestorePolicy(t *testing.T) {
	now := 50000*Hour + Hour/2
	key := strings.Repeat("AB", 32)
	s := New(nil, "mqtt-only", now-25*Hour)
	for _, age := range []int64{0, 1, 5, 6, 23, 24, 47, 48} {
		s.Observe(key, "#YKF", now-age*Hour, true)
	}
	s.Observe(key, "#YKF", now, false)
	if !s.PutReport(Report{Key: key, Region: "YKF", Source: "mqtt-self", At: now, List: true, Entries: []Entry{{Name: "#ykf", At: now}}, Default: "*", DefaultState: "named"}, now) {
		t.Fatal("report rejected")
	}
	snapshot := s.Snapshot(map[string]string{key: "n_public"}, now, true)
	e := snapshot.Nodes[0].Scopes[0]
	if e.Repeats != [3]int64{1, 3, 5} || e.Heard != [3]int64{1, 1, 1} || e.Name != "#YKF" {
		t.Fatalf("window evidence: %+v", e)
	}
	if len(snapshot.Nodes[0].Scopes) != 1 {
		t.Fatal("reported membership became a repeat vote")
	}
	body, _ := json.Marshal(snapshot)
	if strings.Contains(string(body), key) || strings.Contains(string(body), `"key"`) {
		t.Fatal("private identity in summary")
	}
	if !s.Prune(now, map[string]string{key: "n_public"}) || len(s.buckets) != 7 {
		t.Fatal("48-hour expiry failed")
	}
	restored := New(s.Save(), "mqtt-only", now)
	if len(restored.buckets) != 7 || restored.SessionStart != now {
		t.Fatal("checkpoint did not retain evidence and mark a new session")
	}
	foreign := s.Save()
	foreign.Policy = "canada"
	if got := New(foreign, "mqtt-only", now); len(got.buckets) != 0 || len(got.reports) != 0 || len(got.candidates) != 0 {
		t.Fatal("foreign scope state imported into MQTT-only edition")
	}
}

func TestScopeNamesAndAmbiguousTransport(t *testing.T) {
	key := strings.Repeat("AC", 32)
	now := 50000 * Hour
	s := New(nil, "mqtt-only", now)
	for _, name := range []string{"#YKF", "#ykf", "$constructor", "constructor", "__proto__", "*"} {
		if _, ok := Name(name); !ok {
			t.Fatalf("valid name rejected: %q", name)
		}
	}
	for _, name := range []string{"?", "", "#", "a\nb", " a", "a\u202eb", strings.Repeat("F", 64), strings.Repeat("a", 66)} {
		if _, ok := Name(name); ok {
			t.Fatalf("invalid name accepted: %q", name)
		}
	}
	s.PutReport(Report{Key: key, Region: "YKF", Source: "mqtt-self", List: true, Entries: []Entry{{Name: "#YKF"}, {Name: "#ykf"}}}, now)
	payload := []byte{1, 2, 3}
	code := transportCode("#YKF", 11, payload)
	if s.Match("YKF", [2]uint16{code, 0}, 11, payload) != "#YKF" || s.Match("ELSE", [2]uint16{code, 0}, 11, payload) != "?" {
		t.Fatal("name or receiving-region match failed")
	}
	if s.Match("YKF", [2]uint16{0, code}, 11, payload) != "?" {
		t.Fatal("second code guessed the received scope")
	}
	// Find a deterministic synthetic collision rather than making a false claim
	// that transport codes uniquely identify names.
	codes := map[uint16]string{}
	for i := 0; i < 100000; i++ {
		name := fmt.Sprintf("#test-%d", i)
		c := transportCode(name, 11, payload)
		if previous, ok := codes[c]; ok {
			s.candidates["YKF"] = []string{previous, name}
			if s.Match("YKF", [2]uint16{c, 0}, 11, payload) != "?" {
				t.Fatal("collision selected a name")
			}
			return
		}
		codes[c] = name
	}
	t.Fatal("fixture did not find a collision")
}

func TestReportsKeepEmptyUnknownAgeAndProviderSeparate(t *testing.T) {
	now := 50000 * Hour
	key := strings.Repeat("AD", 32)
	s := New(nil, "mqtt-only", now)
	r := Report{Key: key, Region: "YKF", Source: "mqtt-self", At: now, List: true, Entries: []Entry{}}
	if !s.PutReport(r, now) {
		t.Fatal("explicit empty rejected")
	}
	r.At = 0
	r.Entries = []Entry{{Name: "#old"}}
	if s.PutReport(r, now) {
		t.Fatal("unknown age overwrote a dated report")
	}
	r.Source = "meshmapper-reported"
	if s.PutReport(r, now) {
		t.Fatal("provider report accepted in MQTT-only store")
	}
	got := s.Snapshot(map[string]string{key: "n"}, now, true).Nodes[0]
	if len(got.Scopes) != 0 || !got.Reports[0].List || len(got.Reports[0].Entries) != 0 {
		t.Fatal("empty list conflated with absent or traffic evidence")
	}
	r.Source = "mqtt-neighbor"
	if !s.PutReport(r, now) {
		t.Fatal("unknown-age evidence rejected")
	}
	if s.reports[reportKey{key, "YKF", "mqtt-neighbor"}].At != 0 {
		t.Fatal("fabricated report timestamp")
	}
}

func TestScopeBucketsHaveHardCap(t *testing.T) {
	now := 50000 * Hour
	s := New(nil, "mqtt-only", now)
	for i := 0; i < maxBuckets+2; i++ {
		s.Observe(fmt.Sprintf("%064X", i), "*", now, true)
	}
	if len(s.buckets) != maxBuckets || s.LimitedAt != now {
		t.Fatal("bounded store or partial-coverage marker failed")
	}
}

func TestScopeReportsHaveASeparateMemoryBudget(t *testing.T) {
	now := 50000 * Hour
	s := New(nil, "mqtt-only", now)
	entries := make([]Entry, MaxNames)
	for i := range entries {
		entries[i] = Entry{Name: fmt.Sprintf("#scope-%02d-%s", i, strings.Repeat("x", 45))}
	}
	reports := make([]Report, 2000)
	for i := range reports {
		reports[i] = Report{Key: fmt.Sprintf("%064X", i), Region: "YKF", Source: "mqtt-self", List: true, Entries: entries}
	}
	s.PutReports(reports, now)
	if s.reportBytes > maxReportBytes || s.LimitedAt != now || len(s.reports) >= len(reports) {
		t.Fatal("report string budget was not enforced")
	}
}
