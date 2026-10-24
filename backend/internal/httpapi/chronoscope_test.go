package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestChronoscopePageAndCanonicalURL(t *testing.T) {
	server := &Server{static: fstest.MapFS{
		"chronoscope/index.html": {Data: []byte("<title>CartoLite Chronoscope</title>")},
	}}
	handler := server.Handler()
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(method, "/chronoscope?node=synthetic", nil))
		if response.Code != http.StatusPermanentRedirect || response.Header().Get("Location") != "/chronoscope/?node=synthetic" {
			t.Fatalf("Chronoscope redirect: %d %q", response.Code, response.Header().Get("Location"))
		}
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(method, "/chronoscope/", nil))
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "public, no-cache, no-transform" {
			t.Fatalf("Chronoscope response: %d", response.Code)
		}
		if method == http.MethodGet && !strings.Contains(response.Body.String(), "CartoLite Chronoscope") {
			t.Fatal("wrong Chronoscope document")
		}
	}
}
