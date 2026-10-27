package mqtt

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
)

type lifecycleToken struct {
	paho.Token
	done   chan struct{}
	waited chan struct{}
	once   sync.Once
}

func newLifecycleToken() *lifecycleToken {
	return &lifecycleToken{done: make(chan struct{}), waited: make(chan struct{})}
}

func (t *lifecycleToken) Done() <-chan struct{} {
	t.once.Do(func() { close(t.waited) })
	return t.done
}
func (t *lifecycleToken) Error() error { return nil }

type lifecycleBroker struct {
	paho.Client
	open          atomic.Bool
	disconnects   atomic.Int64
	tokens        chan *lifecycleToken
	subscriptions chan *lifecycleToken
}

func (b *lifecycleBroker) IsConnected() bool      { return b.open.Load() }
func (b *lifecycleBroker) IsConnectionOpen() bool { return b.open.Load() }
func (b *lifecycleBroker) Disconnect(uint)        { b.disconnects.Add(1); b.open.Store(false) }
func (b *lifecycleBroker) Subscribe(string, byte, paho.MessageHandler) paho.Token {
	token := <-b.tokens
	b.subscriptions <- token
	return token
}

func lifecycleFixture() (*Client, *lifecycleBroker, chan bool) {
	feed := make(chan bool, 16)
	broker := &lifecycleBroker{tokens: make(chan *lifecycleToken, 4), subscriptions: make(chan *lifecycleToken, 4)}
	client := NewClient(ClientConfig{Enabled: true, Topic: "meshcore/#"},
		slog.New(slog.NewTextHandler(io.Discard, nil)), nil, func(ready bool) { feed <- ready })
	client.client = broker
	return client, broker, feed
}

func waitLifecycle[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-time.After(2 * time.Second):
		t.Fatal("synthetic MQTT lifecycle step did not finish")
		var zero T
		return zero
	}
}

func TestStopDisconnectsBeforeConnectionAndCannotBeReactivated(t *testing.T) {
	client, broker, _ := lifecycleFixture()
	client.stop()
	client.stop()
	if broker.disconnects.Load() != 1 || client.Ready() {
		t.Fatal("pending connection was not stopped exactly once")
	}
	broker.open.Store(true) // A late callback must not restart subscription work.
	client.connectionUp(context.Background(), broker)
	if client.Ready() || client.Status().Connected || len(broker.subscriptions) != 0 {
		t.Fatal("late connection callback reactivated a stopped client")
	}
}

func TestStartWithCancelledContextDoesNotInitiateConnection(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	client := NewClient(ClientConfig{Enabled: true}, nil, nil, nil)
	client.Start(ctx)
	if client.client != nil {
		t.Fatal("a cancelled start created a retrying client")
	}
}

func TestNewConnectionCancelsOldSubscriptionBeforeItCanMarkReady(t *testing.T) {
	client, broker, feed := lifecycleFixture()
	defer client.stop()
	broker.open.Store(true)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	oldCtx, cancelOld := context.WithCancel(ctx)
	client.cancelSubscription = cancelOld
	oldToken, newToken := newLifecycleToken(), newLifecycleToken()
	broker.tokens <- oldToken
	oldFinished := make(chan struct{})
	go func() { client.subscribe(oldCtx, broker); close(oldFinished) }()
	waitLifecycle(t, oldToken.waited)

	broker.tokens <- newToken
	client.connectionUp(ctx, broker)
	waitLifecycle(t, oldFinished)
	waitLifecycle(t, newToken.waited)
	close(oldToken.done) // Simulate a late SUBACK from the previous connection.
	if client.Ready() {
		t.Fatal("old subscription completion marked the new connection ready")
	}
	close(newToken.done)
	for !waitLifecycle(t, feed) {
	}
	if !client.Ready() {
		t.Fatal("current subscription did not establish readiness")
	}
	client.connectionLost(broker, errors.New("old loss notification"))
	if !client.Ready() {
		t.Fatal("late loss callback cleared an open connection")
	}
	broker.open.Store(false)
	client.connectionLost(broker, errors.New("current connection lost"))
	if client.Ready() || client.Status().Connected {
		t.Fatal("current connection loss left readiness enabled")
	}
}

func TestSubscriptionAndTokenWaitStopPromptlyOnCancellation(t *testing.T) {
	client, broker, _ := lifecycleFixture()
	broker.open.Store(true)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client.cancelSubscription = cancel
	token := newLifecycleToken()
	broker.tokens <- token
	finished := make(chan struct{})
	go func() { client.subscribe(ctx, broker); close(finished) }()
	waitLifecycle(t, token.waited)
	client.stop()
	waitLifecycle(t, finished)
	close(token.done)
	if client.Ready() || client.Status().Connected || broker.disconnects.Load() != 1 {
		t.Fatal("cancelled subscription left live readiness or retry work")
	}
	if waitToken(ctx, token, time.Second) {
		t.Fatal("completed token took precedence over cancellation")
	}
	if waitToken(context.Background(), newLifecycleToken(), time.Nanosecond) {
		t.Fatal("an incomplete token ignored the timeout")
	}
}
