package engine

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/n30nex/cartolite-server/backend/internal/mqtt"
)

func TestIngestByteBudgetIsReleasedWhenAcceptedQueueDrains(t *testing.T) {
	state := newTestEngine(t)
	// Use a larger count capacity so the byte ceiling, not the item ceiling,
	// rejects the synthetic burst of maximum-size raw envelopes.
	state.input = make(chan mqtt.Message, 4096)
	message, err := mqtt.Normalize("meshcore/YKF/AA112233/packets", []byte(strings.Repeat("Z", 64*1024)), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	accepted := 0
	for state.Submit(message) {
		accepted++
	}
	if accepted != int(maxIngestBytes/message.QueueBytes()) || state.QueueDepth() >= cap(state.input) || state.queuedBytes.Load() > maxIngestBytes || state.Dropped() != 1 {
		t.Fatal("byte admission was not bounded independently of message count")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	go state.Run(ctx)
	select {
	case <-state.done:
	case <-time.After(3 * time.Second):
		t.Fatal("accepted queue did not drain")
	}
	if state.queuedBytes.Load() != 0 || state.QueueDepth() != 0 || state.OperationalStats().Processed != int64(accepted) {
		t.Fatal("draining lost accepted messages or leaked the byte reservation")
	}
	if state.Submit(message) || state.queuedBytes.Load() != 0 {
		t.Fatal("stopped admission reserved bytes")
	}
}

func TestCountLimitReleasesRejectedMessageBudget(t *testing.T) {
	state := newTestEngine(t)
	state.input = make(chan mqtt.Message, 64)
	message := mqtt.Message{}
	for i := 0; i < cap(state.input); i++ {
		if !state.Submit(message) {
			t.Fatal("small message rejected before count capacity")
		}
	}
	before := state.queuedBytes.Load()
	if state.Submit(message) || state.queuedBytes.Load() != before {
		t.Fatal("full count queue retained rejected byte reservations")
	}
}
