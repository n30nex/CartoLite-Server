package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestFirehosePageRetainsStrictScriptPolicy(t *testing.T) {
	server := &Server{static: fstest.MapFS{
		"firehose/index.html": {Data: []byte("<title>CartoLite Firehose</title>")},
		"assets/firehose.worker-synthetic.js": {Data: []byte("/* synthetic worker */")},
		"assets/shared-synthetic.js": {Data: []byte("/* synthetic shared module */")},
	}}
	handler := server.Handler()
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(method, "/firehose?node=synthetic", nil))
		if response.Code != http.StatusPermanentRedirect || response.Header().Get("Location") != "/firehose/?node=synthetic" {
			t.Fatalf("Firehose redirect: %d %q", response.Code, response.Header().Get("Location"))
		}
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(method, "/firehose/", nil))
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "public, no-cache, no-transform" {
			t.Fatalf("Firehose response: %d", response.Code)
		}
		if strings.Contains(response.Header().Get("Content-Security-Policy"), "wasm-unsafe-eval") {
			t.Fatal("Document must not gain WebAssembly execution")
		}
	}
	for _, target := range []string{"/assets/firehose.worker-synthetic.js", "/assets/shared-synthetic.js"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
		csp := response.Header().Get("Content-Security-Policy")
		if response.Code != http.StatusOK || strings.Contains(csp, "'unsafe-eval'") || strings.Contains(csp, "script-src 'unsafe-inline'") {
			t.Fatalf("Unsafe script policy for %s", target)
		}
		if strings.Contains(csp, "'wasm-unsafe-eval'") {
			t.Fatalf("Wrong worker WebAssembly scope for %s", target)
		}
	}
}
