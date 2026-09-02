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
	cfg        ClientConfig
	log        *slog.Logger
	handle     func(Message) bool
	feed       func(bool)
	connected  atomic.Bool
	subscribed atomic.Bool
	malformed  atomic.Int64
	denied     atomic.Int64
	mu         sync.Mutex
	client     paho.Client
}

func NewClient(cfg ClientConfig, log *slog.Logger, handle func(Message) bool, feed func(bool)) *Client {
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
		SetTLSConfig(&tls.Config{MinVersion: tls.VersionTLS12})
	if c.cfg.Username != "" {
		opts.SetUsername(c.cfg.Username).SetPassword(c.cfg.Password)
	}
	opts.SetConnectionLostHandler(func(_ paho.Client, err error) {
		c.connected.Store(false)
		c.subscribed.Store(false)
		c.setFeed(false)
		c.log.Warn("mqtt connection lost", "error", err)
	})
	opts.SetOnConnectHandler(func(client paho.Client) {
		c.connected.Store(true)
		c.subscribed.Store(false)
		go func() {
			for client.IsConnected() {
				token := client.Subscribe(c.cfg.Topic, 0, c.onMessage)
				if token.WaitTimeout(10*time.Second) && token.Error() == nil {
					c.subscribed.Store(true)
					c.setFeed(true)
					c.log.Info("mqtt subscribed", "topic", c.cfg.Topic)
					return
				}
				c.setFeed(false)
				c.log.Error("mqtt subscribe failed; retrying", "topic", c.cfg.Topic, "error", token.Error())
				select {
				case <-ctx.Done():
					return
				case <-time.After(5 * time.Second):
				}
			}
		}()
	})
	c.mu.Lock()
	c.client = paho.NewClient(opts)
	client := c.client
	c.mu.Unlock()
	go func() {
		token := client.Connect()
		if !token.WaitTimeout(30 * time.Second) {
			c.log.Warn("mqtt initial connection is still pending")
			return
		}
		if err := token.Error(); err != nil {
			c.log.Error("mqtt connect failed", "error", err)
		}
	}()
	go func() {
		<-ctx.Done()
		c.mu.Lock()
		client := c.client
		c.mu.Unlock()
		if client != nil && client.IsConnected() {
			client.Disconnect(250)
		}
		c.connected.Store(false)
		c.subscribed.Store(false)
		c.setFeed(false)
	}()
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
