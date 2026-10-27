package mqtt

import (
	"context"
	"crypto/tls"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
)

type ClientConfig struct {
	Enabled   bool
	BrokerURL string
	Topic     string
	ClientID  string
	Username  string
	Password  string
	Regions   map[string]struct{}
}

type Status struct {
	Enabled       bool  `json:"enabled"`
	Connected     bool  `json:"connected"`
	Subscribed    bool  `json:"subscribed"`
	Malformed     int64 `json:"malformed"`
	DeniedRegions int64 `json:"deniedRegions"`
}

type Client struct {
	cfg                ClientConfig
	log                *slog.Logger
	handle             func(Message) bool
	feed               func(bool)
	connected          atomic.Bool
	subscribed         atomic.Bool
	malformed          atomic.Int64
	denied             atomic.Int64
	mu                 sync.Mutex
	client             paho.Client
	cancelSubscription context.CancelFunc
	stopped            bool
}

func NewClient(cfg ClientConfig, log *slog.Logger, handle func(Message) bool, feed func(bool)) *Client {
	if log == nil {
		log = slog.Default()
	}
	return &Client{cfg: cfg, log: log, handle: handle, feed: feed}
}

func (c *Client) Start(ctx context.Context) {
	if !c.cfg.Enabled {
		c.log.Info("mqtt disabled")
		return
	}
	opts := paho.NewClientOptions().
		AddBroker(c.cfg.BrokerURL).
		SetClientID(c.cfg.ClientID).
		SetCleanSession(true).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(5 * time.Second).
		SetMaxReconnectInterval(5 * time.Minute).
		SetKeepAlive(60 * time.Second).
		SetPingTimeout(10 * time.Second).
		SetWriteTimeout(10 * time.Second).
		SetTLSConfig(&tls.Config{MinVersion: tls.VersionTLS12})
	if c.cfg.Username != "" {
		opts.SetUsername(c.cfg.Username).SetPassword(c.cfg.Password)
	}
	opts.SetConnectionLostHandler(c.connectionLost)
	opts.SetOnConnectHandler(func(client paho.Client) { c.connectionUp(ctx, client) })
	c.mu.Lock()
	if c.stopped || c.client != nil || ctx.Err() != nil {
		c.mu.Unlock()
		return
	}
	c.client = paho.NewClient(opts)
	client := c.client
	// Initiate before the cancellation watcher: shutdown must not race ahead of
	// a goroutine that has not called Connect yet.
	token := client.Connect()
	c.mu.Unlock()
	go func() {
		complete := waitToken(ctx, token, 30*time.Second)
		if ctx.Err() != nil {
			return
		}
		if !complete {
			c.log.Warn("mqtt initial connection is still pending")
			return
		}
		if err := token.Error(); err != nil {
			c.log.Error("mqtt connect failed", "error", err)
		}
	}()
	go func() {
		<-ctx.Done()
		c.stop()
	}()
}

func (c *Client) connectionUp(ctx context.Context, client paho.Client) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.stopped || ctx.Err() != nil || !client.IsConnectionOpen() {
		return
	}
	if c.cancelSubscription != nil {
		c.cancelSubscription()
	}
	connectionCtx, cancel := context.WithCancel(ctx)
	c.cancelSubscription = cancel
	c.connected.Store(true)
	c.subscribed.Store(false)
	c.setFeed(false)
	go c.subscribe(connectionCtx, client)
}

func (c *Client) connectionLost(client paho.Client, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Paho delivers callbacks asynchronously; an old loss notification must
	// not clear readiness after a new connection has opened.
	if c.stopped || client.IsConnectionOpen() {
		return
	}
	if c.cancelSubscription != nil {
		c.cancelSubscription()
	}
	c.connected.Store(false)
	c.subscribed.Store(false)
	c.setFeed(false)
	c.log.Warn("mqtt connection lost", "error", err)
}

func (c *Client) subscribe(ctx context.Context, client paho.Client) {
	for ctx.Err() == nil && client.IsConnectionOpen() {
		token := client.Subscribe(c.cfg.Topic, 0, c.onMessage)
		complete := waitToken(ctx, token, 10*time.Second)
		c.mu.Lock()
		if c.stopped || ctx.Err() != nil || !client.IsConnectionOpen() {
			c.mu.Unlock()
			return
		}
		if complete && token.Error() == nil {
			c.subscribed.Store(true)
			c.setFeed(true)
			c.mu.Unlock()
			c.log.Info("mqtt subscribed", "topic", c.cfg.Topic)
			return
		}
		c.mu.Unlock()
		c.log.Error("mqtt subscribe failed; retrying", "topic", c.cfg.Topic, "error", token.Error())
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}

func (c *Client) stop() {
	c.mu.Lock()
	if c.stopped {
		c.mu.Unlock()
		return
	}
	c.stopped = true
	if c.cancelSubscription != nil {
		c.cancelSubscription()
	}
	client := c.client
	c.connected.Store(false)
	c.subscribed.Store(false)
	c.setFeed(false)
	c.mu.Unlock()
	// Disconnect also cancels a pending initial connection or reconnect.
	if client != nil {
		client.Disconnect(250)
	}
}

func waitToken(ctx context.Context, token paho.Token, timeout time.Duration) bool {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return false
	case <-token.Done():
		return ctx.Err() == nil
	}
}

func (c *Client) onMessage(_ paho.Client, incoming paho.Message) {
	message, err := Normalize(incoming.Topic(), incoming.Payload(), time.Now())
	if err != nil {
		c.malformed.Add(1)
		return
	}
	if !regionAllowed(c.cfg.Regions, message.Topic.Region) {
		c.denied.Add(1)
		return
	}
	if c.handle != nil {
		message.Retained = incoming.Retained()
		c.handle(message)
	}
}

func regionAllowed(allowlist map[string]struct{}, region string) bool {
	if len(allowlist) == 0 {
		return true
	}
	_, allowed := allowlist[region]
	return allowed
}

func (c *Client) setFeed(value bool) {
	if c.feed != nil {
		c.feed(value)
	}
}

func (c *Client) Ready() bool {
	return c != nil && c.cfg.Enabled && c.connected.Load() && c.subscribed.Load()
}

func (c *Client) Status() Status {
	return Status{Enabled: c.cfg.Enabled, Connected: c.connected.Load(), Subscribed: c.subscribed.Load(), Malformed: c.malformed.Load(), DeniedRegions: c.denied.Load()}
}

func RedactBroker(value string) string {
	if at := strings.LastIndex(value, "@"); at >= 0 {
		if scheme := strings.Index(value, "://"); scheme >= 0 && scheme < at {
			return value[:scheme+3] + "redacted@" + value[at+1:]
		}
	}
	return value
}
