package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/n30nex/cartolite-server/backend/internal/config"
	"github.com/n30nex/cartolite-server/backend/internal/engine"
	"github.com/n30nex/cartolite-server/backend/internal/httpapi"
	"github.com/n30nex/cartolite-server/backend/internal/mqtt"
)

var (
	version = "dev"
	gitSHA  = "unknown"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		url := "http://127.0.0.1:8080/healthz"
		if len(os.Args) > 2 {
			url = os.Args[2]
		}
		if err := healthcheck(url); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	level := slog.LevelInfo
	switch strings.ToLower(strings.TrimSpace(os.Getenv("LOG_LEVEL"))) {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	cfg, err := config.Load(version, gitSHA)
	if err != nil {
		return err
	}
	state, err := engine.New(engine.Options{Checkpoint: cfg.Checkpoint, QueueSize: cfg.QueueSize, Version: cfg.Version, GitSHA: cfg.GitSHA, Logger: log})
	if err != nil {
		return err
	}
	hub := httpapi.NewHub(state.BootID())
	state.SetPublisher(hub.Publish)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go state.Run(ctx)
	go reportOperationalStats(ctx, log, state, hub)
	broker := mqtt.NewClient(mqtt.ClientConfig{
		Enabled: cfg.MQTTEnabled, BrokerURL: cfg.MQTTBrokerURL, Topic: cfg.MQTTTopic,
		ClientID: cfg.MQTTClientID, Username: cfg.MQTTUsername, Password: cfg.MQTTPassword, Regions: cfg.Regions,
	}, log, state.Submit, state.SetFeed)
	broker.Start(ctx)
	api, err := httpapi.New(state, hub, broker.Ready, cfg.Version, cfg.GitSHA)
	if err != nil {
		stop()
		state.Wait()
		return err
	}
	server := &http.Server{Addr: cfg.HTTPAddr, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 75 * time.Second}
	errors := make(chan error, 1)
	go func() {
		log.Info("cartolite listening", "address", cfg.HTTPAddr, "broker", mqtt.RedactBroker(cfg.MQTTBrokerURL), "version", cfg.Version, "gitSha", cfg.GitSHA)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errors <- err
		}
	}()
	select {
	case <-ctx.Done():
	case err := <-errors:
		stop()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		state.Wait()
		return err
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return err
	}
	state.Wait()
	return nil
}

func reportOperationalStats(ctx context.Context, log *slog.Logger, state *engine.Engine, hub *httpapi.Hub) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			stats := state.OperationalStats()
			log.Info("cartolite operational summary",
				"processed", stats.Processed,
				"sequence", state.Sequence(),
				"queueDepth", state.QueueDepth(),
				"dropped", state.Dropped(),
				"sseClients", hub.ClientCount(),
				"publicNodes", stats.PublicNodes,
				"publicRoutes", stats.PublicRoutes,
				"snapshotBytes", stats.SnapshotBytes,
				"checkpointBytes", stats.CheckpointBytes,
				"checkpointDurationMs", stats.CheckpointDurationMS,
				"lastCheckpointAt", stats.LastCheckpointAt,
				"checkpointNodes", stats.LastCheckpointNodes,
				"checkpointRoutes", stats.LastCheckpointRoutes,
				"prunedNodes", stats.PrunedCheckpointNodes,
				"prunedRoutes", stats.PrunedCheckpointRoutes,
			)
		}
	}
}

func healthcheck(url string) error {
	client := http.Client{Timeout: 3 * time.Second}
	response, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("healthcheck failed: %w", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("healthcheck returned %s", response.Status)
	}
	return nil
}
