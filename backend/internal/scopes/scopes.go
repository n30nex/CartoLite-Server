// Package scopes keeps bounded, private evidence. It never establishes a route.
package scopes

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	Hour            = int64(time.Hour / time.Millisecond)
	MaxNames        = 64
	maxBuckets      = 65_536
	maxReports      = 10_000
	maxReportBytes  = 2 * 1024 * 1024
	maxCandidates   = 256
	reportRetention = 30 * 24 * Hour
)

// Name preserves case. MeshCore's named public scopes use the # prefix; private
// scopes keep their $ prefix. Unknown transport codes are never used as names.
func Name(value string) (string, bool) {
	if value == "*" {
		return value, true
	}
	if value == "" || value == "?" || value != strings.TrimSpace(value) || len(value) > 65 || !utf8.ValidString(value) {
		return "", false
	}
	for _, r := range value {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || r == ',' {
			return "", false
		}
	}
	if value[0] != '#' && value[0] != '$' {
		value = "#" + value
	}
	if len(value) < 2 || len(value) > 65 {
		return "", false
	}
	// Identity/fingerprint fields are not a safe substitute for a scope name.
	if raw, err := hex.DecodeString(value[1:]); err == nil && len(raw) >= 8 {
		return "", false
	}
	return value, true
}

func FullKey(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, c := range value {
		if !(c >= '0' && c <= '9' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}

type Entry struct {
	Name string `json:"name"`
	At   int64  `json:"at,omitempty"`
}

// A present, successful empty List is different from a missing report. At=0
// means the report's age is unknown; delivery time is not substituted for it.
type Report struct {
	Key           string  `json:"key"`
	Region        string  `json:"region"`
	Source        string  `json:"source"`
	At            int64   `json:"at,omitempty"`
	List          bool    `json:"list"`
	Entries       []Entry `json:"entries"`
	Default       string  `json:"default,omitempty"`
	DefaultState  string  `json:"defaultState,omitempty"`
	DefaultSource string  `json:"defaultSource,omitempty"`
}

type Bucket struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Hour        int64  `json:"hour"`
	Reports     int64  `json:"reports"`
	Heard       int64  `json:"heard"`
	First       int64  `json:"first"`
	Last        int64  `json:"last"`
	FirstRepeat int64  `json:"firstRepeat,omitempty"`
	LastRepeat  int64  `json:"lastRepeat,omitempty"`
}

type Catalogue struct {
	Region string   `json:"region"`
	Names  []string `json:"names"`
	At     int64    `json:"at"`
}

// Provider state is opaque to the native store and never enters public JSON.
// Worldwide rejects the entire extension when the policy is not mqtt-only.
type Saved struct {
	Policy     string      `json:"policy"`
	Since      int64       `json:"since"`
	LastGap    int64       `json:"lastGap,omitempty"`
	LimitedAt  int64       `json:"limitedAt,omitempty"`
	Buckets    []Bucket    `json:"buckets"`
	Reports    []Report    `json:"reports"`
	Catalogues []Catalogue `json:"catalogues,omitempty"`
	Provider   []byte      `json:"provider,omitempty"`
}

type bucketKey struct {
	key, name string
	hour      int64
}
type reportKey struct{ key, region, source string }

// The engine's event loop owns Store. There is no network I/O in this package.
type Store struct {
	Policy                                  string
	Since, SessionStart, LastGap, LimitedAt int64
	buckets                                 map[bucketKey]*Bucket
	reports                                 map[reportKey]Report
	catalogues                              map[string]Catalogue
	candidates                              map[string][]string
	Provider                                []byte
	batching                                bool
	reportBytes                             int
}

func New(saved *Saved, policy string, now int64) *Store {
	s := &Store{Policy: policy, Since: now, SessionStart: now, LastGap: now,
		buckets: make(map[bucketKey]*Bucket), reports: make(map[reportKey]Report),
		catalogues: make(map[string]Catalogue), candidates: make(map[string][]string)}
	if saved == nil || saved.Policy != policy || saved.Since <= 0 || saved.Since > now {
		return s
	}
	s.Since = saved.Since
	s.LimitedAt = max(0, min(saved.LimitedAt, now))
	for _, b := range saved.Buckets {
		if len(s.buckets) >= maxBuckets {
			s.LimitedAt = now
			break
		}
		name, valid := Name(b.Name)
		if b.Name == "?" {
			name, valid = "?", true
		}
		if !FullKey(b.Key) || !valid || name != b.Name || b.Hour%Hour != 0 || b.Hour < now/Hour*Hour-47*Hour || b.Hour > now/Hour*Hour ||
			b.First < b.Hour || b.Last < b.First || b.Last >= b.Hour+Hour || b.Last > now || b.Reports < 0 || b.Heard < 0 || b.Reports > 1_000_000_000 || b.Heard > 1_000_000_000 {
			continue
		}
		k := bucketKey{b.Key, b.Name, b.Hour}
		if _, exists := s.buckets[k]; !exists {
			copy := b
			s.buckets[k] = &copy
		}
	}
	s.PutReports(saved.Reports, now)
	if policy == "canada" {
		for _, c := range saved.Catalogues {
			s.PutCatalogue(c, now)
		}
		if len(saved.Provider) <= 2*1024*1024 {
			s.Provider = append([]byte(nil), saved.Provider...)
		}
	}
	return s
}

func validRegion(value string) bool {
	if len(value) == 0 || len(value) > 16 {
		return false
	}
	for _, r := range value {
		if !(r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

func (s *Store) PutReport(r Report, now int64) bool {
	if !FullKey(r.Key) || !validRegion(r.Region) || len(r.Entries) > MaxNames || r.At < 0 || r.At > now || (r.At > 0 && r.At < now-reportRetention) {
		return false
	}
	switch r.Source {
	case "mqtt-self", "mqtt-neighbor", "mqtt-status":
	case "meshmapper-reported", "meshmapper-uploaded", "meshmapper-default":
		if s.Policy != "canada" {
			return false
		}
	default:
		return false
	}
	entries := make([]Entry, 0, len(r.Entries))
	seen := make(map[string]bool)
	for _, entry := range r.Entries {
		name, ok := Name(entry.Name)
		if !ok || entry.At < 0 || entry.At > now {
			return false
		}
		if !seen[name] {
			entries = append(entries, Entry{Name: name, At: entry.At})
			seen[name] = true
		}
	}
	if !r.List && len(entries) > 0 {
		return false
	}
	if r.DefaultState != "" && r.DefaultState != "named" && r.DefaultState != "none" && r.DefaultState != "unknown" {
		return false
	}
	if r.DefaultSource != "" && r.DefaultSource != "advert" && r.DefaultSource != "reported" {
		return false
	}
	if r.DefaultState == "named" {
		var ok bool
		r.Default, ok = Name(r.Default)
		if !ok {
			return false
		}
	} else {
		r.Default = ""
	}
	if !r.List && r.DefaultState == "" {
		return false
	}
	k := reportKey{r.Key, r.Region, r.Source}
	r.Entries = entries
	oldBytes := 0
	if old, exists := s.reports[k]; exists {
		if old.At > r.At {
			return false
		}
		oldBytes = reportCost(old)
	} else if len(s.reports) >= maxReports {
		s.LimitedAt = now
		return false
	}
	if s.reportBytes-oldBytes+reportCost(r) > maxReportBytes {
		s.LimitedAt = now
		return false
	}
	s.reportBytes += reportCost(r) - oldBytes
	s.reports[k] = r
	if !s.batching {
		s.rebuildCandidates(r.Region, now)
	}
	return true
}

func reportCost(r Report) int {
	cost := 256 + len(r.Key) + len(r.Region) + len(r.Source) + len(r.Default)
	for _, entry := range r.Entries {
		cost += 48 + len(entry.Name)
	}
	return cost
}

func (s *Store) PutReports(reports []Report, now int64) bool {
	s.batching = true
	regions := make(map[string]bool)
	for _, r := range reports {
		if s.PutReport(r, now) {
			regions[r.Region] = true
		}
	}
	s.batching = false
	for region := range regions {
		s.rebuildCandidates(region, now)
	}
	return len(regions) > 0
}

// Revocation/key changes remove provider-derived configuration and names only;
// native hearing counts remain observations from this installation's MQTT.
func (s *Store) ClearProvider(region string, now int64) {
	regions := make(map[string]bool)
	for key, r := range s.reports {
		if strings.HasPrefix(r.Source, "meshmapper-") && (region == "" || r.Region == region) {
			s.reportBytes -= reportCost(r)
			delete(s.reports, key)
			regions[r.Region] = true
		}
	}
	for name := range s.catalogues {
		if region == "" || name == region {
			delete(s.catalogues, name)
			regions[name] = true
		}
	}
	for name := range regions {
		s.rebuildCandidates(name, now)
	}
}

func (s *Store) PutCatalogue(c Catalogue, now int64) bool {
	if s.Policy != "canada" || !validRegion(c.Region) || len(c.Names) > MaxNames || c.At <= 0 || c.At > now || c.At < now-reportRetention {
		return false
	}
	if _, exists := s.catalogues[c.Region]; !exists && len(s.catalogues) >= 256 {
		return false
	}
	names := make([]string, 0, len(c.Names))
	for _, value := range c.Names {
		name, ok := Name(value)
		if !ok {
			return false
		}
		names = append(names, name)
	}
	c.Names = names
	s.catalogues[c.Region] = c
	s.rebuildCandidates(c.Region, now)
	return true
}

func (s *Store) rebuildCandidates(region string, now int64) {
	set := make(map[string]bool)
	add := func(name string) {
		if name != "" && name != "*" {
			set[name] = true
		}
	}
	for _, r := range s.reports {
		if r.Region != region || r.At > 0 && r.At < now-reportRetention {
			continue
		}
		for _, entry := range r.Entries {
			add(entry.Name)
		}
		add(r.Default)
	}
	if c, ok := s.catalogues[region]; ok && c.At >= now-reportRetention {
		for _, name := range c.Names {
			add(name)
		}
	}
	names := make([]string, 0, len(set))
	for name := range set {
		names = append(names, name)
	}
	sort.Strings(names)
	// Resolving with an incomplete candidate set could conceal a collision.
	if len(names) > maxCandidates {
		s.LimitedAt = now
		names = nil
	}
	s.candidates[region] = names
}

func transportCode(name string, payloadType byte, payload []byte) uint16 {
	key := sha256.Sum256([]byte(name))
	h := hmac.New(sha256.New, key[:16])
	_, _ = h.Write([]byte{payloadType})
	_, _ = h.Write(payload)
	value := binary.LittleEndian.Uint16(h.Sum(nil)[:2])
	if value == 0 {
		return 1
	}
	if value == 65535 {
		return 65534
	}
	return value
}

// The first transport code identifies the received scope. A second matching
// candidate is ambiguous; the other transport code does not resolve that scope.
func (s *Store) Match(region string, codes [2]uint16, kind byte, payload []byte) string {
	match := "?"
	for _, name := range s.candidates[region] {
		code := transportCode(name, kind, payload)
		if code == codes[0] {
			if match != "?" && match != name {
				return "?"
			}
			match = name
		}
	}
	return match
}

func (s *Store) Observe(key, name string, at int64, repeat bool) bool {
	if !FullKey(key) || at <= 0 {
		return false
	}
	if name != "?" {
		if normalized, ok := Name(name); !ok || normalized != name {
			return false
		}
	}
	k := bucketKey{key, name, at / Hour * Hour}
	b := s.buckets[k]
	if b == nil {
		if len(s.buckets) >= maxBuckets {
			s.LimitedAt = at
			return false
		}
		b = &Bucket{Key: key, Name: name, Hour: k.hour, First: at, Last: at}
		s.buckets[k] = b
	}
	if repeat {
		b.Reports = min(b.Reports+1, 1_000_000_000)
		if b.FirstRepeat == 0 {
			b.FirstRepeat = at
		}
		b.FirstRepeat, b.LastRepeat = min(b.FirstRepeat, at), max(b.LastRepeat, at)
	} else {
		b.Heard = min(b.Heard+1, 1_000_000_000)
	}
	b.First, b.Last = min(b.First, at), max(b.Last, at)
	return true
}

func (s *Store) Prune(now int64, keys map[string]string) bool {
	changed := false
	for k, b := range s.buckets {
		if b.Hour < now/Hour*Hour-47*Hour || keys[k.key] == "" {
			delete(s.buckets, k)
			changed = true
		}
	}
	regions := make(map[string]bool)
	for k, r := range s.reports {
		if keys[k.key] == "" || r.At > 0 && r.At < now-reportRetention {
			s.reportBytes -= reportCost(r)
			delete(s.reports, k)
			regions[r.Region] = true
			changed = true
		}
	}
	for region, c := range s.catalogues {
		if c.At < now-reportRetention {
			delete(s.catalogues, region)
			regions[region] = true
			changed = true
		}
	}
	for region := range regions {
		s.rebuildCandidates(region, now)
	}
	return changed
}

func (s *Store) Save() *Saved {
	out := &Saved{Policy: s.Policy, Since: s.Since, LastGap: s.LastGap, LimitedAt: s.LimitedAt, Provider: append([]byte(nil), s.Provider...)}
	for _, b := range s.buckets {
		out.Buckets = append(out.Buckets, *b)
	}
	for _, r := range s.reports {
		out.Reports = append(out.Reports, r)
	}
	for _, c := range s.catalogues {
		out.Catalogues = append(out.Catalogues, c)
	}
	return out
}

type Evidence struct {
	Name    string   `json:"name"`
	Repeats [3]int64 `json:"repeats"` // Current partial hour + preceding 0, 5, 23 hours.
	Heard   [3]int64 `json:"heard"`
	First   int64    `json:"first,omitempty"`
	Last    int64    `json:"last,omitempty"`
}

type PublicReport struct {
	Source        string  `json:"source"`
	At            int64   `json:"at,omitempty"`
	List          bool    `json:"list"`
	Entries       []Entry `json:"entries"`
	Default       string  `json:"default,omitempty"`
	DefaultState  string  `json:"defaultState,omitempty"`
	DefaultSource string  `json:"defaultSource,omitempty"`
}

type Node struct {
	ID      string         `json:"id"`
	Scopes  []Evidence     `json:"scopes"`
	Reports []PublicReport `json:"reports"`
}

type Snapshot struct {
	SchemaVersion int    `json:"schemaVersion"`
	ServerTime    int64  `json:"serverTime"`
	Since         int64  `json:"since"`
	SessionStart  int64  `json:"sessionStart"`
	LastGap       int64  `json:"lastGap"`
	LimitedAt     int64  `json:"limitedAt,omitempty"`
	Connected     bool   `json:"connected"`
	Nodes         []Node `json:"nodes"`
}

func (s *Store) Snapshot(ids map[string]string, now int64, connected bool) Snapshot {
	out := Snapshot{SchemaVersion: 1, ServerTime: now, Since: s.Since, SessionStart: s.SessionStart, LastGap: s.LastGap, LimitedAt: s.LimitedAt, Connected: connected, Nodes: []Node{}}
	nodes := make(map[string]*Node)
	counts := make(map[string]map[string]*Evidence)
	node := func(key string) *Node {
		id := ids[key]
		if id == "" {
			return nil
		}
		if nodes[id] == nil {
			nodes[id] = &Node{ID: id, Scopes: []Evidence{}, Reports: []PublicReport{}}
			counts[id] = make(map[string]*Evidence)
		}
		return nodes[id]
	}
	for _, b := range s.buckets {
		age := (now/Hour*Hour - b.Hour) / Hour
		if age < 0 || age >= 24 {
			continue
		}
		n := node(b.Key)
		if n == nil {
			continue
		}
		e := counts[n.ID][b.Name]
		if e == nil {
			e = &Evidence{Name: b.Name}
			counts[n.ID][b.Name] = e
		}
		for i, hours := range []int64{1, 6, 24} {
			if age < hours {
				e.Repeats[i] += b.Reports
				e.Heard[i] += b.Heard
			}
		}
		if b.Reports > 0 && b.FirstRepeat > 0 {
			if e.First == 0 {
				e.First = b.FirstRepeat
			}
			e.First, e.Last = min(e.First, b.FirstRepeat), max(e.Last, b.LastRepeat)
		}
	}
	for _, r := range s.reports {
		if r.At > 0 && r.At < now-reportRetention {
			continue
		}
		if n := node(r.Key); n != nil {
			n.Reports = append(n.Reports, PublicReport{Source: r.Source, At: r.At, List: r.List, Entries: r.Entries, Default: r.Default, DefaultState: r.DefaultState, DefaultSource: r.DefaultSource})
		}
	}
	for id, n := range nodes {
		for _, e := range counts[id] {
			n.Scopes = append(n.Scopes, *e)
		}
		sort.Slice(n.Scopes, func(i, j int) bool { return n.Scopes[i].Name < n.Scopes[j].Name })
		sort.Slice(n.Reports, func(i, j int) bool {
			if n.Reports[i].Source == n.Reports[j].Source {
				return n.Reports[i].At > n.Reports[j].At
			}
			return n.Reports[i].Source < n.Reports[j].Source
		})
		out.Nodes = append(out.Nodes, *n)
	}
	sort.Slice(out.Nodes, func(i, j int) bool { return out.Nodes[i].ID < out.Nodes[j].ID })
	return out
}
