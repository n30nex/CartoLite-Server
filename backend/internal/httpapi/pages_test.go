package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
)

func TestOptionalPagesGateDocumentsAndNavigation(t *testing.T) {
	for _, extras := range [][]string{nil, {"terminal"}, {"terminal", "chronoscope", "firehose"}} {
		t.Run(strings.Join(extras, ","), func(t *testing.T) {
			assets := fstest.MapFS{}
			for _, name := range []string{"index.html", "netgraph/index.html", "terminal/index.html", "chronoscope/index.html", "firehose/index.html"} {
				assets[name] = &fstest.MapFile{Data: []byte(`<!doctype html><html lang="en"><title>synthetic</title></html>`)}
			}
			server := &Server{static: assets, extraPages: extras}
			handler := server.Handler()
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				for _, page := range []string{"map", "netgraph", "terminal", "chronoscope", "firehose"} {
					enabled := page == "map" || page == "netgraph" || slices.Contains(extras, page)
					for _, suffix := range []string{"", "/", "/index.html"} {
						target := "/" + page + suffix
						if page == "map" {
							target = "/"
						}
						response := httptest.NewRecorder()
						handler.ServeHTTP(response, httptest.NewRequest(method, target+"?node=synthetic", nil))
						want := http.StatusOK
						if !enabled {
							want = http.StatusNotFound
						} else if page != "map" && suffix == "" {
							want = http.StatusPermanentRedirect
						}
						if response.Code != want {
							t.Fatalf("%s %s = %d, want %d", method, target, response.Code, want)
						}
						if method == http.MethodHead && response.Body.Len() != 0 {
							t.Fatal("HEAD returned a body")
						}
						if method == http.MethodGet && want == http.StatusOK && !strings.Contains(response.Body.String(), `data-extra-pages="`+strings.Join(extras, ",")+`"`) {
							t.Fatal("document does not carry the startup page choice")
						}
						if want == http.StatusNotFound && response.Header().Get("Cache-Control") != "no-store" {
							t.Fatal("disabled page can remain cached after re-enabling")
						}
					}
				}
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/config", nil))
			var config struct{ Pages []string }
			if err := json.Unmarshal(response.Body.Bytes(), &config); err != nil || !slices.Equal(config.Pages, append([]string{"map", "netgraph"}, extras...)) {
				t.Fatalf("public page choices do not match HTML: %s", response.Body.String())
			}
		})
	}
}
