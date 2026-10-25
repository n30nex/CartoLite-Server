package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestPachinkoPageAndCanonicalURL(t *testing.T) {
	server := &Server{extraPages: []string{"pachinko"}, static: fstest.MapFS{"pachinko/index.html": {Data: []byte("<html lang=\"en\"><title>Pachinko</title></html>")}}}
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, httptest.NewRequest(method, "/pachinko?node=synthetic", nil))
		if response.Code != http.StatusPermanentRedirect || response.Header().Get("Location") != "/pachinko/?node=synthetic" {
			t.Fatal("Pachinko canonical redirect failed")
		}
		response = httptest.NewRecorder()
		server.Handler().ServeHTTP(response, httptest.NewRequest(method, "/pachinko/", nil))
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "public, no-cache, no-transform" {
			t.Fatal("Pachinko document unavailable")
		}
		if method == http.MethodHead && response.Body.Len() != 0 {
			t.Fatal("HEAD returned a body")
		}
	}
}
