package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestTerminalPageAndCanonicalURL(t *testing.T) {
	server := &Server{static: fstest.MapFS{
		"terminal/index.html": {Data: []byte("<title>CartoLite Terminal</title>")},
	}}
	handler := server.Handler()
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(method, "/terminal?node=synthetic", nil))
		if response.Code != http.StatusPermanentRedirect || response.Header().Get("Location") != "/terminal/?node=synthetic" {
			t.Fatalf("Terminal redirect: %d %q", response.Code, response.Header().Get("Location"))
		}
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(method, "/terminal/", nil))
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "public, no-cache, no-transform" {
			t.Fatalf("Terminal response: %d", response.Code)
		}
		if method == http.MethodGet && !strings.Contains(response.Body.String(), "CartoLite Terminal") {
			t.Fatal("wrong Terminal document")
		}
	}
}
