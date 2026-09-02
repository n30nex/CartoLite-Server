package httpapi

import (
	"testing"

	"github.com/n30nex/cartolite-server/backend/internal/engine"
)

func TestHubAtomicallyReplaysThenStreamsLive(t *testing.T) {
	hub := NewHub("boot-one")
	for seq := uint64(1); seq <= 3; seq++ {
		hub.Publish(engine.Event{Name: "packet", Seq: seq, Data: map[string]any{"seq": seq}})
	}
	subscription := hub.Subscribe("boot-one", 1, true)
	if !subscription.accepted || subscription.reset || subscription.latest != 3 {
		t.Fatalf("unexpected subscription: %#v", subscription)
	}
	defer subscription.cancel()
	if len(subscription.replay) != 2 || subscription.replay[0].seq != 2 || subscription.replay[1].seq != 3 {
		t.Fatalf("replay = %#v", subscription.replay)
	}
	hub.Publish(engine.Event{Name: "packet", Seq: 4, Data: map[string]any{"seq": 4}})
	select {
	case event := <-subscription.events:
		if event.seq != 4 {
			t.Fatalf("live event seq = %d", event.seq)
		}
	default:
		t.Fatal("live event was not queued after replay boundary")
	}
}

func TestHubResetsWrongBootAndExpiredCursor(t *testing.T) {
	hub := NewHub("current-boot")
	for seq := uint64(1); seq <= uint64(maxReplayEvents+1); seq++ {
		hub.Publish(engine.Event{Name: "packet", Seq: seq, Data: map[string]any{"seq": seq}})
	}
	if subscription := hub.Subscribe("old-boot", uint64(maxReplayEvents+1), true); !subscription.reset || !subscription.accepted {
		t.Fatalf("wrong boot did not reset: %#v", subscription)
	}
	if subscription := hub.Subscribe("current-boot", 0, true); !subscription.reset || !subscription.accepted {
		t.Fatalf("expired cursor did not reset: %#v", subscription)
	}
	current := hub.Subscribe("current-boot", 0, false)
	if !current.accepted || current.reset || len(current.replay) != 0 || current.latest != uint64(maxReplayEvents+1) {
		t.Fatalf("cursorless subscription did not start live: %#v", current)
	}
	current.cancel()
}

func TestHubClientCountTracksLiveSubscriptions(t *testing.T) {
	hub := NewHub("boot")
	if count := hub.ClientCount(); count != 0 {
		t.Fatalf("initial client count = %d", count)
	}
	subscription := hub.Subscribe("boot", 0, false)
	if !subscription.accepted || hub.ClientCount() != 1 {
		t.Fatalf("live client count = %d", hub.ClientCount())
	}
	subscription.cancel()
	if count := hub.ClientCount(); count != 0 {
		t.Fatalf("client count after cancel = %d", count)
	}
}
