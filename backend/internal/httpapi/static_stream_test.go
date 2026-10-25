package httpapi

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

type assetReadProbe struct {
	fs.FS
	reads int
}
type probedAsset struct {
	fs.File
	owner *assetReadProbe
}

func (f *assetReadProbe) Open(name string) (fs.File, error) {
	file, err := f.FS.Open(name)
	if err != nil {
		return nil, err
	}
	return &probedAsset{File: file, owner: f}, nil
}
func (f *probedAsset) Read(p []byte) (int, error) { f.owner.reads++; return f.File.Read(p) }

func TestAssetHEADDoesNotReadBodyAndGETPreservesBytes(t *testing.T) {
	body := strings.Repeat("synthetic-texture", 8192)
	assets := &assetReadProbe{FS: fstest.MapFS{"assets/material.png": {Data: []byte(body)}}}
	handler := (&Server{static: assets}).Handler()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodHead, "/assets/material.png", nil))
	if response.Code != http.StatusOK || response.Body.Len() != 0 || assets.reads != 0 {
		t.Fatalf("HEAD read asset data: status=%d reads=%d", response.Code, assets.reads)
	}
	length := response.Header().Get("Content-Length")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/assets/material.png", nil))
	if response.Code != http.StatusOK || response.Body.String() != body || response.Header().Get("Content-Length") != length || assets.reads == 0 {
		t.Fatal("streamed asset changed")
	}
	if !strings.Contains(response.Header().Get("Cache-Control"), "immutable") {
		t.Fatal("fingerprinted asset lost immutable caching")
	}
}
