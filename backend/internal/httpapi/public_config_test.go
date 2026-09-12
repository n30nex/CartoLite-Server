package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPublicConfigHasOnlyBrowserMapSettings(t *testing.T) {
	t.Setenv("MQTT_PASSWORD", "synthetic-private-password")
	response := httptest.NewRecorder()
	testHandler(t, true).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	want := "{\"schemaVersion\":1,\"basemap\":{\"provider\":\"openfreemap\"}}\n"
	if response.Code != http.StatusOK || response.Body.String() != want {
		t.Fatalf("unexpected public config: %s", response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("public runtime configuration must not be cached")
	}
	server := &Server{basemap: PublicBasemapConfig{Provider: "carto", CartoBrowserKey: "synthetic-public-browser-key"}}
	response = httptest.NewRecorder()
	server.publicConfig(response, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	want = "{\"schemaVersion\":1,\"basemap\":{\"provider\":\"carto\",\"cartoBrowserKey\":\"synthetic-public-browser-key\"}}\n"
	if response.Body.String() != want {
		t.Fatalf("unexpected CARTO configuration: %s", response.Body.String())
	}
}
