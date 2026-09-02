package httpapi

import (
	"encoding/json"
	"sync"

	"github.com/n30nex/cartolite-server/backend/internal/engine"
)

const maxSSEClients = 256
const maxReplayEvents = 4096

type wireEvent struct {
	name string
	seq  uint64
	data []byte
}

type Hub struct {
	mu           sync.Mutex
	bootID       string
	nextID       uint64
	latest       uint64
	clients      map[uint64]chan wireEvent
	history      []wireEvent
	historyStart int
	historyLen   int
}

type subscription struct {
	events   <-chan wireEvent
	cancel   func()
	replay   []wireEvent
	latest   uint64
	reset    bool
	accepted bool
}

func NewHub(bootID string) *Hub {
	return &Hub{bootID: bootID, clients: make(map[uint64]chan wireEvent), history: make([]wireEvent, maxReplayEvents)}
}

func (h *Hub) ClientCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

func (h *Hub) Publish(event engine.Event) {
	body, err := json.Marshal(event.Data)
	if err != nil {
		return
	}
	wire := wireEvent{name: event.Name, seq: event.Seq, data: body}
	h.mu.Lock()
	defer h.mu.Unlock()
	if wire.seq == 0 || wire.seq <= h.latest {
		return
	}
	if h.latest > 0 && wire.seq != h.latest+1 {
		h.historyStart, h.historyLen = 0, 0
	}
	h.latest = wire.seq
	h.appendHistoryLocked(wire)
	for id, client := range h.clients {
		select {
		case client <- wire:
		default:
			close(client)
			delete(h.clients, id)
		}
	}
}

func (h *Hub) Subscribe(bootID string, after uint64, hasCursor bool) subscription {
	h.mu.Lock()
	if bootID != "" && bootID != h.bootID {
		result := subscription{latest: h.latest, reset: true, accepted: true}
		h.mu.Unlock()
		return result
	}
	if !hasCursor {
		after = h.latest
	}
	if after > h.latest || h.cursorPredatesHistoryLocked(after) {
		result := subscription{latest: h.latest, reset: true, accepted: true}
		h.mu.Unlock()
		return result
	}
	if len(h.clients) >= maxSSEClients {
		h.mu.Unlock()
		return subscription{}
	}
	h.nextID++
	id := h.nextID
	client := make(chan wireEvent, 256)
	h.clients[id] = client
	replay := h.replayAfterLocked(after)
	latest := h.latest
	h.mu.Unlock()
	return subscription{events: client, replay: replay, latest: latest, accepted: true, cancel: func() {
		h.mu.Lock()
		if current, ok := h.clients[id]; ok {
			close(current)
			delete(h.clients, id)
		}
		h.mu.Unlock()
	}}
}

func (h *Hub) appendHistoryLocked(event wireEvent) {
	if h.historyLen < len(h.history) {
		index := (h.historyStart + h.historyLen) % len(h.history)
		h.history[index] = event
		h.historyLen++
		return
	}
	h.history[h.historyStart] = event
	h.historyStart = (h.historyStart + 1) % len(h.history)
}

func (h *Hub) cursorPredatesHistoryLocked(after uint64) bool {
	if after >= h.latest {
		return false
	}
	if h.historyLen == 0 {
		return true
	}
	earliest := h.history[h.historyStart].seq
	return after+1 < earliest
}

func (h *Hub) replayAfterLocked(after uint64) []wireEvent {
	replay := make([]wireEvent, 0, h.historyLen)
	for offset := 0; offset < h.historyLen; offset++ {
		event := h.history[(h.historyStart+offset)%len(h.history)]
		if event.seq > after {
			replay = append(replay, event)
		}
	}
	return replay
}
