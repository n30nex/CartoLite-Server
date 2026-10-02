package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestShutdownCancelsAnActiveStream(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := newHTTPServer(ctx, "127.0.0.1:0", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "event: hello\ndata: {}\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	go func() { _ = server.Serve(listener) }()
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get("http://" + listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	cancel()
	shutdownCtx, stop := context.WithTimeout(context.Background(), time.Second)
	defer stop()
	if err := server.Shutdown(shutdownCtx); err != nil {
		t.Fatalf("active SSE request prevented shutdown: %v", err)
	}
	if _, err := io.ReadAll(response.Body); err != nil {
		t.Fatal(err)
	}
}
