package engine

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/n30nex/cartolite-server/backend/internal/config"
	"github.com/n30nex/cartolite-server/backend/internal/meshcore"
	"github.com/n30nex/cartolite-server/backend/internal/mqtt"
)

const (
	maxNodes                = 10_000
	maxRoutes               = 20_000
	maxEdgeKM               = 150.0
	snapshotInterval        = time.Second
	checkpointInterval      = 5 * time.Minute
	nodeFreshnessEventEvery = time.Minute
	nodeRetentionWindow     = 30 * 24 * time.Hour
	routeTrafficHalfLife    = 15 * time.Minute
	routeVisibilityWindow   = 24 * time.Hour
	maxRouteTraffic         = 64.0
)

var sensitiveLabelPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(0x)?[0-9a-f]{6,}`),
	regexp.MustCompile(`(?i)([0-9a-f]{2}\s*[:-]\s*){2,}[0-9a-f]{2}`),
	regexp.MustCompile(`(?i)([0-9a-f]{2}[ \t]+){2,}[0-9a-f]{2}`),
}

type Options struct {
	Checkpoint string
	QueueSize  int
	Version    string
	GitSHA     string
	Logger     *slog.Logger
}

type Engine struct {
	checkpoint           string
	version              string
	gitSHA               string
	bootID               string
	log                  *slog.Logger
	input                chan mqtt.Message
	feedWake             chan struct{}
	desiredFeed          atomic.Bool
	dropped              atomic.Int64
	seq                  atomic.Uint64
	checkpointOK         atomic.Bool
	snapshot             atomic.Value
	processed            atomic.Int64
	snapshotBytes        atomic.Int64
	publicNodes          atomic.Int64
	publicRoutes         atomic.Int64
	checkpointBytes      atomic.Int64
	checkpointDurationMS atomic.Int64
	lastCheckpointAt     atomic.Int64
	lastCheckpointNodes  atomic.Int64
	lastCheckpointRoutes atomic.Int64
	prunedNodes          atomic.Int64
	prunedRoutes         atomic.Int64
	checkpointDirty      bool
	done                 chan struct{}
	publish              func(Event)

	nodes      map[string]*privateNode
	nodeIDs    map[string]*privateNode
	prefixes   map[string]map[string]struct{}
	routes     map[string]*privateRoute
	feed       bool
	lastPacket int64
}

func New(options Options) (*Engine, error) {
	if options.QueueSize < 64 {
		options.QueueSize = 4096
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	nodes, routes, err := loadCheckpoint(options.Checkpoint)
	if err != nil {
		return nil, err
	}
	if err := preflightCheckpoint(options.Checkpoint); err != nil {
		return nil, err
	}
	bootID, err := randomID()
	if err != nil {
		return nil, fmt.Errorf("generate boot id: %w", err)
	}
	e := &Engine{
		checkpoint: options.Checkpoint,
		version:    options.Version,
		gitSHA:     options.GitSHA,
		bootID:     bootID,
		log:        options.Logger,
		input:      make(chan mqtt.Message, options.QueueSize),
		feedWake:   make(chan struct{}, 1),
		done:       make(chan struct{}),
		nodes:      nodes,
		nodeIDs:    make(map[string]*privateNode),
		prefixes:   make(map[string]map[string]struct{}),
		routes:     routes,
	}
	e.checkpointOK.Store(true)
	e.lastCheckpointNodes.Store(int64(len(e.nodes)))
	e.lastCheckpointRoutes.Store(int64(len(e.routes)))
	if info, statErr := os.Stat(options.Checkpoint); statErr == nil {
		e.checkpointBytes.Store(info.Size())
		e.lastCheckpointAt.Store(info.ModTime().UnixMilli())
	}
	for key, node := range e.nodes {
		id := nodePublicID(node)
		if current := e.nodeIDs[id]; current == nil || node.LastSeen > current.LastSeen {
			e.nodeIDs[id] = node
		}
		e.indexNode(key, node)
	}
	prunedRoutes, prunedNodes := e.pruneDurableState(time.Now().UnixMilli())
	e.checkpointDirty = prunedRoutes > 0 || prunedNodes > 0
	e.prunedRoutes.Add(int64(prunedRoutes))
	e.prunedNodes.Add(int64(prunedNodes))
	e.updateSnapshot(time.Now())
	return e, nil
}

func (e *Engine) SetPublisher(publish func(Event)) { e.publish = publish }

func (e *Engine) Submit(message mqtt.Message) bool {
	select {
	case e.input <- message:
		return true
	default:
		e.dropped.Add(1)
		return false
	}
}

func (e *Engine) SetFeed(connected bool) {
	e.desiredFeed.Store(connected)
	select {
	case e.feedWake <- struct{}{}:
	default:
	}
}

func (e *Engine) Run(ctx context.Context) {
	defer close(e.done)
	snapshotTick := time.NewTicker(snapshotInterval)
	checkpointTick := time.NewTicker(checkpointInterval)
	defer snapshotTick.Stop()
	defer checkpointTick.Stop()
	dirtySnapshot := true
	dirtyCheckpoint := e.checkpointDirty
	lastStatus := PublicStatus{}
	for {
		select {
		case <-ctx.Done():
			if dirtyCheckpoint {
				_, _ = e.flushCheckpoint(time.Now())
			}
			e.updateSnapshot(time.Now())
			return
		case message := <-e.input:
			e.processed.Add(1)
			if e.process(message) {
				dirtyCheckpoint = true
			}
			dirtySnapshot = true
		case <-e.feedWake:
			if desired := e.desiredFeed.Load(); e.feed != desired {
				e.feed = desired
				dirtySnapshot = true
			}
		case now := <-snapshotTick.C:
			status := e.publicStatus(now)
			if status != lastStatus {
				seq := e.seq.Add(1)
				e.emit(Event{Name: "status", Seq: seq, Data: StatusEventV2{Seq: seq, Status: status}})
				lastStatus = status
				dirtySnapshot = true
			}
			if dirtySnapshot {
				e.updateSnapshot(now)
				dirtySnapshot = false
			}
		case now := <-checkpointTick.C:
			if dirtyCheckpoint {
				pruned, saved := e.flushCheckpointAndReset(now)
				if pruned {
					dirtySnapshot = false
				}
				dirtyCheckpoint = !saved
			}
		}
	}
}

func (e *Engine) Wait() { <-e.done }

func (e *Engine) StateJSON() []byte {
	value, _ := e.snapshot.Load().([]byte)
	return append([]byte(nil), value...)
}

func (e *Engine) BootID() string          { return e.bootID }
func (e *Engine) Sequence() uint64        { return e.seq.Load() }
func (e *Engine) Dropped() int64          { return e.dropped.Load() }
func (e *Engine) QueueDepth() int         { return len(e.input) }
func (e *Engine) QueueHealthy() bool      { return len(e.input) < cap(e.input) }
func (e *Engine) CheckpointHealthy() bool { return e.checkpointOK.Load() }

func (e *Engine) OperationalStats() OperationalStats {
	return OperationalStats{
		Processed:              e.processed.Load(),
		SnapshotBytes:          e.snapshotBytes.Load(),
		PublicNodes:            e.publicNodes.Load(),
		PublicRoutes:           e.publicRoutes.Load(),
		CheckpointBytes:        e.checkpointBytes.Load(),
		CheckpointDurationMS:   e.checkpointDurationMS.Load(),
		LastCheckpointAt:       e.lastCheckpointAt.Load(),
		LastCheckpointNodes:    e.lastCheckpointNodes.Load(),
		LastCheckpointRoutes:   e.lastCheckpointRoutes.Load(),
		PrunedCheckpointNodes:  e.prunedNodes.Load(),
		PrunedCheckpointRoutes: e.prunedRoutes.Load(),
	}
}

func (e *Engine) process(message mqtt.Message) bool {
	if message.Topic.Kind == "status" {
		lat, lng, ok := mqtt.Coordinates(message.Payload)
		if !ok {
			return false
		}
		_, changed := e.upsertNode(message.Topic.Region, message.Topic.PublisherKey, mqtt.Name(message.Payload), mqtt.Role(message.Payload), true, lat, lng, true, message.HeardAt)
		return changed
	}
	observer, observerChanged := e.observePublisher(message)
	packet, err := meshcore.ParseHex(message.RawHex)
	if err != nil {
		return observerChanged
	}
	e.lastPacket = message.HeardAt
	changed := false
	var source *privateNode
	if packet.PayloadType == meshcore.PayloadAdvert {
		if advert, ok, parseErr := meshcore.ParseAdvert(packet.Payload); parseErr == nil && ok {
			lat, lng, hasCoords := 0.0, 0.0, false
			if advert.Latitude != nil && advert.Longitude != nil {
				lat, lng, hasCoords = *advert.Latitude, *advert.Longitude, true
			}
			source, changed = e.upsertNode(message.Topic.Region, advert.PublicKey, advert.Name, advert.Role, false, lat, lng, hasCoords, message.HeardAt)
		}
	}
	if source == nil {
		source = e.sourceNode(message.Topic.Region, packet)
	}
	payloadKind := meshcore.PayloadName(packet.PayloadType)
	segments, routed := e.resolveAndRecord(message, packet, source, observer, payloadKind)
	if routed {
		e.emitPacket(message.HeardAt, payloadKind, segments, nil)
	} else if observer != nil && observer.HasCoords {
		endpoint := endpointFor(observer)
		e.emitPacket(message.HeardAt, payloadKind, nil, &endpoint)
	}
	return changed || observerChanged || routed
}

func (e *Engine) observePublisher(message mqtt.Message) (*privateNode, bool) {
	key := message.ObserverKey
	if key == "" {
		key = message.Topic.PublisherKey
	}
	if lat, lng, ok := mqtt.Coordinates(message.Payload); ok {
		return e.upsertNode(message.Topic.Region, key, message.ObserverName, "unknown", true, lat, lng, true, message.HeardAt)
	}
	mapKey := nodeMapKey(message.Topic.Region, key)
	node := e.nodes[mapKey]
	if node == nil {
		return nil, false
	}
	changed := false
	topologyChanged := false
	if !node.Observer {
		node.Observer = true
		changed = true
		topologyChanged = true
	}
	if label := sanitizeLabel(message.ObserverName, node.Role, true); message.ObserverName != "" && label != node.Label {
		node.Label = label
		changed = true
		topologyChanged = true
	}
	if message.HeardAt > node.LastSeen {
		node.LastSeen = message.HeardAt
		changed = true
	}
	e.refreshNodeID(nodePublicID(node))
	if node.HasCoords && (topologyChanged || shouldPublishFreshness(node, message.HeardAt)) {
		e.emitNode(node)
	}
	return node, changed
}

func (e *Engine) sourceNode(region string, packet meshcore.Packet) *privateNode {
	if publicKey := meshcore.SourcePublicKey(packet); publicKey != "" {
		node := e.nodes[nodeMapKey(region, publicKey)]
		if node != nil && node.HasCoords {
			return node
		}
		return nil
	}
	prefix, ok := meshcore.SourcePrefix(packet)
	if !ok {
		return nil
	}
	matches := e.prefixes[prefixMapKey(region, 1, prefix)]
	positioned := make([]*privateNode, 0, len(matches))
	for nodeKey := range matches {
		if candidate := e.nodes[nodeKey]; candidate != nil && candidate.HasCoords {
			positioned = append(positioned, candidate)
		}
	}
	if len(positioned) != 1 {
		return nil
	}
	return positioned[0]
}

func (e *Engine) resolveAndRecord(message mqtt.Message, packet meshcore.Packet, source, observer *privateNode, payloadKind string) ([]RouteSegmentV2, bool) {
	if packet.InvalidForMap || (message.RSSI == nil && message.SNR == nil) {
		return nil, false
	}
	seen := make(map[string]struct{}, len(packet.Path))
	ordered := make([]*privateNode, 0, len(packet.Path)+2)
	if source != nil && source.HasCoords {
		ordered = append(ordered, source)
	}
	for _, prefix := range packet.Path {
		if _, duplicate := seen[prefix]; duplicate {
			return nil, false
		}
		seen[prefix] = struct{}{}
		matches := e.prefixes[prefixMapKey(message.Topic.Region, packet.HashSize, prefix)]
		forwarders := make([]*privateNode, 0, len(matches))
		for nodeKey := range matches {
			candidate := e.nodes[nodeKey]
			if candidate != nil && (candidate.Role == "repeater" || candidate.Role == "room_server") {
				forwarders = append(forwarders, candidate)
			}
		}
		if len(forwarders) != 1 || !forwarders[0].HasCoords {
			return nil, false
		}
		ordered = appendUniqueNode(ordered, forwarders[0])
	}
	if observer != nil && observer.HasCoords {
		ordered = appendUniqueNode(ordered, observer)
	}
	if len(ordered) < 2 {
		return nil, false
	}
	segments := make([]RouteSegmentV2, 0, len(ordered)-1)
	for index := 0; index+1 < len(ordered); index++ {
		from, to := ordered[index], ordered[index+1]
		if distanceKM(from.Lat, from.Lng, to.Lat, to.Lng) > maxEdgeKM && packet.PayloadType != meshcore.PayloadTrace {
			return nil, false
		}
		fromID, toID := nodePublicID(from), nodePublicID(to)
		routeID := routePublicID(fromID, toID)
		segments = append(segments, RouteSegmentV2{RouteID: routeID, FromID: fromID, ToID: toID})
	}
	for _, segment := range segments {
		route := e.routes[segment.RouteID]
		if route == nil {
			route = &privateRoute{ID: segment.RouteID, FromID: segment.FromID, ToID: segment.ToID}
			e.routes[segment.RouteID] = route
		}
		route.PacketCount++
		updateRouteActivity(route, message.HeardAt, payloadKind)
	}
	e.evictRoutes()
	return segments, len(segments) > 0
}

func (e *Engine) upsertNode(region, key, name, role string, observer bool, lat, lng float64, hasCoords bool, seenAt int64) (*privateNode, bool) {
	region, key = strings.ToUpper(strings.TrimSpace(region)), strings.ToUpper(strings.TrimSpace(key))
	mapKey := nodeMapKey(region, key)
	node := e.nodes[mapKey]
	created := node == nil
	if created {
		if len(e.nodes) >= maxNodes {
			e.evictOldestNode()
		}
		node = &privateNode{Region: region, Key: key, Role: normalizeRole(role), Observer: observer, LastSeen: seenAt}
		node.Label = sanitizeLabel(name, node.Role, observer)
		e.nodes[mapKey] = node
		e.nodeIDs[nodePublicID(node)] = node
		e.indexNode(mapKey, node)
	}
	changed := created
	topologyChanged := created
	if normalized := normalizeRole(role); normalized != "unknown" && node.Role != normalized {
		node.Role = normalized
		changed = true
		topologyChanged = true
	}
	if observer && !node.Observer {
		node.Observer = true
		changed = true
		topologyChanged = true
	}
	if strings.TrimSpace(name) != "" {
		if label := sanitizeLabel(name, node.Role, node.Observer); label != node.Label {
			node.Label = label
			changed = true
			topologyChanged = true
		}
	}
	if hasCoords && validCoords(lat, lng) && (!node.HasCoords || node.Lat != lat || node.Lng != lng) {
		node.Lat, node.Lng, node.HasCoords = lat, lng, true
		changed = true
		topologyChanged = true
	}
	if seenAt > node.LastSeen {
		node.LastSeen = seenAt
		changed = true
	}
	e.refreshNodeID(nodePublicID(node))
	if node.HasCoords && (topologyChanged || shouldPublishFreshness(node, seenAt)) {
		e.emitNode(node)
	}
	return node, changed
}

func (e *Engine) emitNode(node *privateNode) {
	node.LastPublished = node.LastSeen
	seq := e.seq.Add(1)
	e.emit(Event{Name: "node", Seq: seq, Data: NodeEventV2{Seq: seq, Node: publicNode(node)}})
}

func shouldPublishFreshness(node *privateNode, at int64) bool {
	return at > node.LastPublished && (node.LastPublished == 0 || at-node.LastPublished >= nodeFreshnessEventEvery.Milliseconds())
}

func (e *Engine) emitPacket(at int64, payloadType string, segments []RouteSegmentV2, observer *EndpointV2) {
	seq := e.seq.Add(1)
	mode := "route"
	if observer != nil {
		mode = "observer"
	}
	event := PacketEventV2{Seq: seq, ID: opaqueID("p", e.bootID+"|"+strconv.FormatUint(seq, 10)), At: at, PayloadType: payloadType, Mode: mode, Segments: segments, Observer: observer}
	e.emit(Event{Name: "packet", Seq: seq, Data: event})
}

func (e *Engine) emit(event Event) {
	if e.publish != nil {
		e.publish(event)
	}
}

func (e *Engine) updateSnapshot(now time.Time) {
	nowMillis := now.UnixMilli()
	state := StateV2{
		SchemaVersion: 2,
		BootID:        e.bootID,
		Seq:           e.seq.Load(),
		ServerTime:    now.UnixMilli(),
		Status:        e.publicStatus(now),
		Map:           MapV2{Center: [2]float64{0, 20}, Zoom: 1.4},
		Nodes:         make([]NodeV2, 0, len(e.nodeIDs)),
		Routes:        make([]RouteV2, 0, len(e.routes)),
	}
	for _, node := range e.nodeIDs {
		if node.HasCoords {
			state.Nodes = append(state.Nodes, publicNode(node))
		}
	}
	sort.Slice(state.Nodes, func(i, j int) bool { return state.Nodes[i].ID < state.Nodes[j].ID })
	for _, route := range e.routes {
		if !routeVisible(route.LastHeard, nowMillis) {
			continue
		}
		from, fromOK := e.nodeIDs[route.FromID]
		to, toOK := e.nodeIDs[route.ToID]
		if !fromOK || !toOK || !from.HasCoords || !to.HasCoords {
			continue
		}
		state.Routes = append(state.Routes, RouteV2{
			ID:          route.ID,
			FromID:      route.FromID,
			ToID:        route.ToID,
			PacketCount: route.PacketCount,
			LastHeard:   route.LastHeard,
			Intensity:   intensity(route.PacketCount),
			LastKind:    normalizeRouteKind(route.LastKind),
			Traffic:     publicRouteTraffic(route),
		})
	}
	sort.Slice(state.Routes, func(i, j int) bool { return state.Routes[i].ID < state.Routes[j].ID })
	body, err := json.Marshal(state)
	if err != nil {
		e.log.Error("public snapshot encode failed", "error", err)
		return
	}
	e.snapshotBytes.Store(int64(len(body)))
	e.publicNodes.Store(int64(len(state.Nodes)))
	e.publicRoutes.Store(int64(len(state.Routes)))
	e.snapshot.Store(body)
}

func (e *Engine) publicStatus(now time.Time) PublicStatus {
	feed, activity := "disconnected", "quiet"
	if e.feed {
		feed = "connected"
	}
	if e.lastPacket > 0 && now.UnixMilli()-e.lastPacket <= config.QuietAfter.Milliseconds() {
		activity = "active"
	}
	return PublicStatus{Feed: feed, Activity: activity, LastPacketAt: e.lastPacket, Dropped: e.dropped.Load(), Version: e.version, GitSHA: e.gitSHA}
}

func (e *Engine) flushCheckpoint(now time.Time) (bool, bool) {
	prunedRoutes, prunedNodes := e.pruneDurableState(now.UnixMilli())
	pruned := prunedRoutes > 0 || prunedNodes > 0
	started := time.Now()
	if err := writeCheckpoint(e.checkpoint, e.nodes, e.routes); err != nil {
		e.checkpointOK.Store(false)
		e.log.Error("checkpoint write failed", "error", err)
		return pruned, false
	}
	duration := time.Since(started)
	bytes := int64(0)
	if info, err := os.Stat(e.checkpoint); err == nil {
		bytes = info.Size()
	}
	e.checkpointOK.Store(true)
	e.checkpointBytes.Store(bytes)
	e.checkpointDurationMS.Store(duration.Milliseconds())
	e.lastCheckpointAt.Store(now.UnixMilli())
	e.lastCheckpointNodes.Store(int64(len(e.nodes)))
	e.lastCheckpointRoutes.Store(int64(len(e.routes)))
	e.prunedNodes.Add(int64(prunedNodes))
	e.prunedRoutes.Add(int64(prunedRoutes))
	e.log.Info("checkpoint saved",
		"bytes", bytes,
		"durationMs", duration.Milliseconds(),
		"nodes", len(e.nodes),
		"routes", len(e.routes),
		"prunedNodes", prunedNodes,
		"prunedRoutes", prunedRoutes,
	)
	return pruned, true
}

func (e *Engine) flushCheckpointAndReset(now time.Time) (bool, bool) {
	pruned, saved := e.flushCheckpoint(now)
	if !pruned {
		return false, saved
	}
	seq := e.seq.Add(1)
	e.updateSnapshot(now)
	e.emit(Event{Name: "reset", Seq: seq, Data: ResetEventV2{Seq: seq, BootID: e.bootID}})
	return true, saved
}

func (e *Engine) pruneDurableState(nowMillis int64) (int, int) {
	prunedRoutes := 0
	for id, route := range e.routes {
		if routeVisible(route.LastHeard, nowMillis) && e.nodeIDs[route.FromID] != nil && e.nodeIDs[route.ToID] != nil {
			continue
		}
		delete(e.routes, id)
		prunedRoutes++
	}

	referenced := make(map[string]struct{}, len(e.routes)*2)
	for _, route := range e.routes {
		referenced[route.FromID] = struct{}{}
		referenced[route.ToID] = struct{}{}
	}
	removedIDs := make(map[string]struct{})
	prunedNodes := 0
	for mapKey, node := range e.nodes {
		id := nodePublicID(node)
		if _, keep := referenced[id]; keep || nowMillis-node.LastSeen <= nodeRetentionWindow.Milliseconds() {
			continue
		}
		delete(e.nodes, mapKey)
		e.unindexNode(mapKey, node)
		removedIDs[id] = struct{}{}
		prunedNodes++
	}
	for id := range removedIDs {
		e.refreshNodeID(id)
	}
	return prunedRoutes, prunedNodes
}

func (e *Engine) indexNode(mapKey string, node *privateNode) {
	decoded, err := hex.DecodeString(node.Key)
	if err != nil || len(decoded) < 4 {
		return
	}
	for size := 1; size <= 4; size++ {
		prefix := strings.ToUpper(hex.EncodeToString(decoded[:size]))
		key := prefixMapKey(node.Region, size, prefix)
		if e.prefixes[key] == nil {
			e.prefixes[key] = make(map[string]struct{})
		}
		e.prefixes[key][mapKey] = struct{}{}
	}
}

func (e *Engine) unindexNode(mapKey string, node *privateNode) {
	decoded, err := hex.DecodeString(node.Key)
	if err != nil || len(decoded) < 4 {
		return
	}
	for size := 1; size <= 4; size++ {
		key := prefixMapKey(node.Region, size, strings.ToUpper(hex.EncodeToString(decoded[:size])))
		delete(e.prefixes[key], mapKey)
		if len(e.prefixes[key]) == 0 {
			delete(e.prefixes, key)
		}
	}
}

func (e *Engine) evictOldestNode() {
	var oldestKey string
	var oldest *privateNode
	for key, node := range e.nodes {
		if oldest == nil || node.LastSeen < oldest.LastSeen {
			oldestKey, oldest = key, node
		}
	}
	if oldest == nil {
		return
	}
	id := nodePublicID(oldest)
	delete(e.nodes, oldestKey)
	e.unindexNode(oldestKey, oldest)
	e.refreshNodeID(id)
	if e.nodeIDs[id] == nil {
		for routeID, route := range e.routes {
			if route.FromID == id || route.ToID == id {
				delete(e.routes, routeID)
			}
		}
	}
}

func (e *Engine) refreshNodeID(id string) {
	delete(e.nodeIDs, id)
	for _, node := range e.nodes {
		if nodePublicID(node) != id {
			continue
		}
		if current := e.nodeIDs[id]; current == nil || node.LastSeen > current.LastSeen {
			e.nodeIDs[id] = node
		}
	}
}

func (e *Engine) evictRoutes() {
	for len(e.routes) > maxRoutes {
		var oldestID string
		var oldest int64 = math.MaxInt64
		for id, route := range e.routes {
			if route.LastHeard < oldest {
				oldestID, oldest = id, route.LastHeard
			}
		}
		delete(e.routes, oldestID)
	}
}

func publicNode(node *privateNode) NodeV2 {
	return NodeV2{ID: nodePublicID(node), Label: node.Label, Role: normalizeRole(node.Role), Observer: node.Observer, Lat: node.Lat, Lng: node.Lng, LastSeen: node.LastSeen}
}

func endpointFor(node *privateNode) EndpointV2 {
	return EndpointV2{ID: nodePublicID(node), Label: node.Label, Lat: node.Lat, Lng: node.Lng}
}

func nodePublicID(node *privateNode) string { return opaqueID("n", node.Key) }

func routePublicID(from, to string) string {
	if to < from {
		from, to = to, from
	}
	return opaqueID("r", from+"|"+to)
}

func opaqueID(prefix, seed string) string {
	sum := sha256.Sum256([]byte(seed))
	return prefix + "-" + hex.EncodeToString(sum[:12])
}

func randomID() (string, error) {
	value := make([]byte, 12)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

func nodeMapKey(region, key string) string {
	return strings.ToUpper(region) + "|" + strings.ToUpper(key)
}
func prefixMapKey(region string, size int, prefix string) string {
	return strings.ToUpper(region) + "|" + strconv.Itoa(size) + "|" + strings.ToUpper(prefix)
}

func appendUniqueNode(nodes []*privateNode, node *privateNode) []*privateNode {
	if len(nodes) == 0 || nodePublicID(nodes[len(nodes)-1]) != nodePublicID(node) {
		return append(nodes, node)
	}
	return nodes
}

func normalizeRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "repeater", "companion", "room_server", "sensor":
		return strings.ToLower(strings.TrimSpace(role))
	default:
		return "unknown"
	}
}

func sanitizeLabel(value, role string, observer bool) string {
	value = strings.TrimSpace(strings.TrimRight(value, "\x00"))
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' || strings.ContainsRune("<>&\"'`=", r) {
			return -1
		}
		return r
	}, value)
	value = strings.Join(strings.Fields(value), " ")
	if isSensitiveHex(value) {
		value = ""
	}
	runes := []rune(value)
	if len(runes) > 18 {
		value = string(runes[:18])
	}
	value = strings.TrimSpace(value)
	if value != "" {
		return value
	}
	if observer {
		return "Observer"
	}
	switch normalizeRole(role) {
	case "repeater":
		return "Repeater"
	case "room_server":
		return "Room"
	case "companion":
		return "Companion"
	case "sensor":
		return "Sensor"
	default:
		return "Node"
	}
}

func isSensitiveHex(value string) bool {
	for _, pattern := range sensitiveLabelPatterns {
		if pattern.MatchString(value) {
			return true
		}
	}
	return false
}

func validCoords(lat, lng float64) bool {
	return !math.IsNaN(lat) && !math.IsNaN(lng) && !math.IsInf(lat, 0) && !math.IsInf(lng, 0) && lat >= -85.051129 && lat <= 85.051129 && lng >= -180 && lng <= 180 && (lat != 0 || lng != 0)
}

func distanceKM(latA, lngA, latB, lngB float64) float64 {
	const earth = 6371.0088
	toRad := math.Pi / 180
	lat1, lat2 := latA*toRad, latB*toRad
	dLat, dLng := (latB-latA)*toRad, (lngB-lngA)*toRad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return earth * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func intensity(count int64) int {
	switch {
	case count >= 16:
		return 4
	case count >= 8:
		return 3
	case count >= 4:
		return 2
	case count >= 2:
		return 1
	default:
		return 0
	}
}

func updateRouteActivity(route *privateRoute, at int64, kind string) {
	kind = normalizeRouteKind(kind)
	traffic := route.Traffic
	if math.IsNaN(traffic) || math.IsInf(traffic, 0) || traffic < 0 {
		traffic = 0
	}
	if route.LastHeard <= 0 {
		route.LastHeard = at
		route.LastKind = kind
		route.Traffic = 1
		return
	}
	if at >= route.LastHeard {
		traffic *= routeTrafficDecay(at - route.LastHeard)
		route.LastHeard = at
		route.LastKind = kind
		traffic++
	} else {
		traffic += routeTrafficDecay(route.LastHeard - at)
	}
	route.Traffic = math.Min(maxRouteTraffic, traffic)
}

func routeTrafficDecay(elapsedMillis int64) float64 {
	if elapsedMillis <= 0 {
		return 1
	}
	return math.Exp2(-float64(elapsedMillis) / float64(routeTrafficHalfLife.Milliseconds()))
}

func routeVisible(lastHeard, now int64) bool {
	return lastHeard > 0 && now-lastHeard <= routeVisibilityWindow.Milliseconds()
}

func validRouteKind(kind string) bool {
	switch kind {
	case "Advert", "Trace", "Text", "ACK", "Control", "Other":
		return true
	default:
		return false
	}
}

func normalizeRouteKind(kind string) string {
	if validRouteKind(kind) {
		return kind
	}
	return "Other"
}

func publicRouteTraffic(route *privateRoute) float64 {
	traffic := route.Traffic
	if traffic <= 0 && route.PacketCount > 0 {
		traffic = 1
	}
	traffic = math.Max(0, math.Min(maxRouteTraffic, traffic))
	return math.Round(traffic*1000) / 1000
}
