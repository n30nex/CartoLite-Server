package httpapi

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/n30nex/cartolite-server/backend/internal/engine"
)

// Docker copies web/dist into this directory before the Go build.
//
//go:embed static/*
var embeddedStatic embed.FS

type Server struct {
	engine    *engine.Engine
	hub       *Hub
	mqttReady func() bool
	static    fs.FS
	version   string
	gitSHA    string
}

func New(engineState *engine.Engine, hub *Hub, mqttReady func() bool, version, gitSHA string) (*Server, error) {
	assets, err := fs.Sub(embeddedStatic, "static")
	if err != nil {
		return nil, fmt.Errorf("open embedded frontend: %w", err)
	}
	if _, err := fs.Stat(assets, "index.html"); err != nil {
		return nil, fmt.Errorf("embedded frontend has no index.html: %w", err)
	}
	return &Server{engine: engineState, hub: hub, mqttReady: mqttReady, static: assets, version: version, gitSHA: gitSHA}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /readyz", s.ready)
	mux.HandleFunc("GET /api/state", s.state)
	mux.HandleFunc("GET /api/events", s.events)
	mux.HandleFunc("/", s.frontend)
	return securityHeaders(mux)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": s.version, "gitSha": s.gitSHA, "bootId": s.engine.BootID()})
}

func (s *Server) ready(w http.ResponseWriter, _ *http.Request) {
	mqttOK := s.mqttReady != nil && s.mqttReady()
	checkpointOK := s.engine.CheckpointHealthy()
	noDrops := s.engine.Dropped() == 0
	queueOK := s.engine.QueueHealthy()
	status := http.StatusOK
	if !mqttOK || !checkpointOK || !noDrops || !queueOK {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{
		"ready":        status == http.StatusOK,
		"mqtt":         mqttOK,
		"checkpoint":   checkpointOK,
		"dropped":      s.engine.Dropped(),
		"queueDepth":   s.engine.QueueDepth(),
		"queueHealthy": queueOK,
	})
}

func (s *Server) state(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(s.engine.StateJSON())
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	_, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	bootID, after, hasCursor, err := eventCursor(r)
	if err != nil {
		http.Error(w, "invalid event cursor", http.StatusBadRequest)
		return
	}
	subscription := s.hub.Subscribe(bootID, after, hasCursor)
	if !subscription.accepted {
		http.Error(w, "too many event streams", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(w)
	if subscription.reset {
		reset, _ := json.Marshal(map[string]any{"seq": subscription.latest, "bootId": s.engine.BootID()})
		_ = writeSSEWithDeadline(w, controller, wireEvent{name: "reset", seq: subscription.latest, data: reset}, true)
		return
	}
	defer subscription.cancel()
	hello, _ := json.Marshal(map[string]any{"seq": subscription.latest, "bootId": s.engine.BootID()})
	if !writeSSEWithDeadline(w, controller, wireEvent{name: "hello", seq: subscription.latest, data: hello}, false) {
		return
	}
	for _, event := range subscription.replay {
		if !writeSSEWithDeadline(w, controller, event, true) {
			return
		}
	}
	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case event, open := <-subscription.events:
			if !open {
				return
			}
			if !writeSSEWithDeadline(w, controller, event, true) {
				return
			}
		case <-keepalive.C:
			_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			if err := controller.Flush(); err != nil {
				return
			}
			_ = controller.SetWriteDeadline(time.Time{})
		}
	}
}

func (s *Server) frontend(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/ws") || strings.HasPrefix(r.URL.Path, "/healthz/") || strings.HasPrefix(r.URL.Path, "/readyz/") {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "." || name == "" {
		name = "index.html"
	} else if strings.HasSuffix(r.URL.Path, "/") {
		name = path.Join(name, "index.html")
	}
	body, err := fs.ReadFile(s.static, name)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			http.NotFound(w, r)
			return
		}
		http.Error(w, "frontend unavailable", http.StatusInternalServerError)
		return
	}
	if path.Ext(name) == ".html" {
		w.Header().Set("Cache-Control", "no-cache")
	} else if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
	}
	if contentType := staticContentType(name); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(body)
	}
}

func staticContentType(name string) string {
	switch path.Ext(name) {
	case ".webmanifest":
		return "application/manifest+json"
	case ".geojson":
		return "application/geo+json"
	}
	return mime.TypeByExtension(path.Ext(name))
}

func sameOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Host != "" && strings.EqualFold(parsed.Host, r.Host)
}

func eventCursor(r *http.Request) (string, uint64, bool, error) {
	bootID := strings.TrimSpace(r.URL.Query().Get("bootId"))
	after := uint64(0)
	hasCursor := false
	if value := strings.TrimSpace(r.URL.Query().Get("after")); value != "" {
		parsed, err := strconv.ParseUint(value, 10, 64)
		if err != nil {
			return "", 0, false, err
		}
		after, hasCursor = parsed, true
	}
	if value := strings.TrimSpace(r.Header.Get("Last-Event-ID")); value != "" {
		if parsed, err := strconv.ParseUint(value, 10, 64); err == nil && (!hasCursor || parsed > after) {
			after, hasCursor = parsed, true
		}
	}
	return bootID, after, hasCursor, nil
}

func writeSSEWithDeadline(w http.ResponseWriter, controller *http.ResponseController, event wireEvent, includeID bool) bool {
	_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if err := writeSSE(w, event, includeID); err != nil {
		return false
	}
	if err := controller.Flush(); err != nil {
		return false
	}
	_ = controller.SetWriteDeadline(time.Time{})
	return true
}

func writeSSE(w http.ResponseWriter, event wireEvent, includeID bool) error {
	if includeID {
		if _, err := fmt.Fprintf(w, "id: %d\n", event.seq); err != nil {
			return err
		}
	}
	_, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.name, event.data)
	return err
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		w.Header().Set("Permissions-Policy", "accelerometer=(), bluetooth=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), serial=(), usb=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://*.basemaps.cartocdn.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.basemaps.cartocdn.com https://tiles.mapterhorn.com; worker-src 'self' blob:; child-src blob:")
		next.ServeHTTP(w, r)
	})
}
