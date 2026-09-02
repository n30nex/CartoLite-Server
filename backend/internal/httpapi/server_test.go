package httpapi

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/n30nex/cartolite-server/backend/internal/engine"
)

func testHandler(t *testing.T, ready bool) http.Handler {
	t.Helper()
	state, err := engine.New(engine.Options{Checkpoint: filepath.Join(t.TempDir(), "state-v1.json"), QueueSize: 64, Version: "test", GitSHA: "abc"})
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(state, NewHub(state.BootID()), func() bool { return ready }, "test", "abc")
	if err != nil {
		t.Fatal(err)
	}
	return server.Handler()
}

func TestStaticCachePolicy(t *testing.T) {
	server := &Server{static: fstest.MapFS{
		"index.html":         {Data: []byte("<title>CartoLite Server</title>")},
		"assets/main-abc.js": {Data: []byte("export {}")},
	}}
	handler := server.Handler()

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "CartoLite Server") {
		t.Fatalf("root did not serve the map entry: status=%d body=%q", response.Code, response.Body.String())
	}
	if cache := response.Header().Get("Cache-Control"); cache != "no-cache" {
		t.Fatalf("HTML cache policy = %q", cache)
	}

	asset := httptest.NewRecorder()
	handler.ServeHTTP(asset, httptest.NewRequest(http.MethodGet, "/assets/main-abc.js", nil))
	if asset.Code != http.StatusOK || asset.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("asset cache response = status %d, cache %q", asset.Code, asset.Header().Get("Cache-Control"))
	}

	missing := httptest.NewRecorder()
	handler.ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/unknown", nil))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("unknown path returned %d", missing.Code)
	}
}

func TestPublicRoutesAndPrivateBoundaries(t *testing.T) {
	handler := testHandler(t, true)
	for _, path := range []string{"/healthz", "/readyz", "/api/state", "/"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("%s returned %d", path, response.Code)
		}
	}
	for _, path := range []string{"/api/v1/live/state", "/api/v1/debug/state", "/api/v1/nodes", "/api/v1/packets", "/ws"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("private path %s returned %d", path, response.Code)
		}
	}
}

func TestSecurityHeadersExcludeExternalGlyphOrigins(t *testing.T) {
	response := httptest.NewRecorder()
	testHandler(t, true).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	csp := response.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "https://*.basemaps.cartocdn.com") {
		t.Fatalf("CSP does not allow the configured vector map origin: %q", csp)
	}
	if !strings.Contains(csp, "https://tiles.mapterhorn.com") {
		t.Fatalf("CSP does not allow the configured terrain origin: %q", csp)
	}
	for _, origin := range []string{"https://demotiles.maplibre.org", "https://fonts.openmaptiles.org"} {
		if strings.Contains(csp, origin) {
			t.Fatalf("CSP still allows external glyph origin %q: %q", origin, csp)
		}
	}
	if policy := response.Header().Get("Permissions-Policy"); !strings.Contains(policy, "geolocation=()") || !strings.Contains(policy, "usb=()") {
		t.Fatalf("Permissions-Policy does not deny unused device access: %q", policy)
	}
	if hsts := response.Header().Get("Strict-Transport-Security"); hsts != "max-age=31536000" {
		t.Fatalf("unexpected HSTS policy: %q", hsts)
	}
}

func TestMissingFrontendAssetReturnsNotFound(t *testing.T) {
	response := httptest.NewRecorder()
	testHandler(t, true).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/missing-asset.svg", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("missing frontend asset returned %d", response.Code)
	}
}

func TestWebManifestUsesInstallableContentType(t *testing.T) {
	if contentType := staticContentType("site.webmanifest"); contentType != "application/manifest+json" {
		t.Fatalf("unexpected web manifest content type: %q", contentType)
	}
}

func TestGeoJSONUsesGeographicContentType(t *testing.T) {
	if contentType := staticContentType("assets/operator-overlay.abc123.geojson"); contentType != "application/geo+json" {
		t.Fatalf("unexpected region GeoJSON content type: %q", contentType)
	}
}

func TestSSERejectsCrossOrigin(t *testing.T) {
	handler := testHandler(t, true)
	request := httptest.NewRequest(http.MethodGet, "/api/events", nil)
	request.Host = "cartolite.example"
	request.Header.Set("Origin", "https://evil.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("cross-origin SSE returned %d", response.Code)
	}
}

func TestReadinessFailsClosed(t *testing.T) {
	handler := testHandler(t, false)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("disconnected MQTT readiness returned %d", response.Code)
	}
}

func TestSSESubscribesBeforeHelloFlush(t *testing.T) {
	state, err := engine.New(engine.Options{Checkpoint: filepath.Join(t.TempDir(), "state-v1.json"), QueueSize: 64})
	if err != nil {
		t.Fatal(err)
	}
	hub := NewHub(state.BootID())
	server, err := New(state, hub, func() bool { return true }, "test", "abc")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	writer := &sseRaceWriter{header: make(http.Header)}
	writer.flush = func(count int) {
		if count == 1 {
			hub.Publish(engine.Event{Name: "packet", Seq: 1, Data: map[string]any{"seq": 1, "mode": "observer"}})
			time.AfterFunc(100*time.Millisecond, cancel)
			return
		}
		cancel()
	}
	request := httptest.NewRequest(http.MethodGet, "/api/events", nil).WithContext(ctx)
	server.events(writer, request)
	body := writer.body.String()
	if hello, packet := strings.Index(body, "event: hello"), strings.Index(body, "event: packet"); hello < 0 || packet <= hello {
		t.Fatalf("event published during hello flush was missed or reordered: %q", body)
	}
}

func TestSSESubscriberCapFailsClosed(t *testing.T) {
	hub := NewHub("test-boot")
	cancels := make([]func(), 0, maxSSEClients)
	for index := 0; index < maxSSEClients; index++ {
		subscription := hub.Subscribe("test-boot", 0, false)
		if !subscription.accepted {
			t.Fatalf("subscriber %d was rejected below cap", index)
		}
		cancels = append(cancels, subscription.cancel)
	}
	defer func() {
		for _, cancel := range cancels {
			cancel()
		}
	}()
	if subscription := hub.Subscribe("test-boot", 0, false); subscription.accepted {
		t.Fatal("subscriber above cap was accepted")
	}
}

func TestSSEHelloHasNoIDAndReplayIsOrdered(t *testing.T) {
	state, err := engine.New(engine.Options{Checkpoint: filepath.Join(t.TempDir(), "state-v1.json"), QueueSize: 64})
	if err != nil {
		t.Fatal(err)
	}
	hub := NewHub(state.BootID())
	hub.Publish(engine.Event{Name: "node", Seq: 1, Data: map[string]any{"seq": 1}})
	hub.Publish(engine.Event{Name: "packet", Seq: 2, Data: map[string]any{"seq": 2}})
	server, err := New(state, hub, func() bool { return true }, "test", "abc")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	writer := &sseRaceWriter{header: make(http.Header)}
	writer.flush = func(count int) {
		if count >= 3 {
			cancel()
		}
	}
	request := httptest.NewRequest(http.MethodGet, "/api/events?bootId="+state.BootID()+"&after=0", nil).WithContext(ctx)
	server.events(writer, request)
	body := writer.body.String()
	if !strings.HasPrefix(body, "event: hello\n") {
		t.Fatalf("hello unexpectedly carried an SSE id: %q", body)
	}
	first, second := strings.Index(body, "id: 1\n"), strings.Index(body, "id: 2\n")
	if first < 0 || second <= first {
		t.Fatalf("replay was not ordered after hello: %q", body)
	}
}

func TestSSEBootMismatchResetsAndCloses(t *testing.T) {
	state, err := engine.New(engine.Options{Checkpoint: filepath.Join(t.TempDir(), "state-v1.json"), QueueSize: 64})
	if err != nil {
		t.Fatal(err)
	}
	hub := NewHub(state.BootID())
	hub.Publish(engine.Event{Name: "status", Seq: 1, Data: map[string]any{"seq": 1}})
	server, err := New(state, hub, func() bool { return true }, "test", "abc")
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.events(response, httptest.NewRequest(http.MethodGet, "/api/events?bootId=old-boot&after=1", nil))
	if !strings.Contains(response.Body.String(), "event: reset") || strings.Contains(response.Body.String(), "event: hello") {
		t.Fatalf("boot mismatch response = %q", response.Body.String())
	}
}

func TestEventCursorUsesNewestValidCursor(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/events?bootId=boot&after=7", nil)
	request.Header.Set("Last-Event-ID", "9")
	bootID, after, set, err := eventCursor(request)
	if err != nil || bootID != "boot" || !set || after != 9 {
		t.Fatalf("cursor = %q, %d, %v, %v", bootID, after, set, err)
	}
	request.Header.Set("Last-Event-ID", "invalid")
	_, after, _, err = eventCursor(request)
	if err != nil || after != 7 {
		t.Fatalf("invalid Last-Event-ID should leave query cursor, got %d, %v", after, err)
	}
}

type sseRaceWriter struct {
	header http.Header
	body   bytes.Buffer
	flush  func(int)
	count  int
}

func (w *sseRaceWriter) Header() http.Header            { return w.header }
func (w *sseRaceWriter) WriteHeader(_ int)              {}
func (w *sseRaceWriter) Write(body []byte) (int, error) { return w.body.Write(body) }
func (w *sseRaceWriter) Flush() {
	w.count++
	if w.flush != nil {
		w.flush(w.count)
	}
}
