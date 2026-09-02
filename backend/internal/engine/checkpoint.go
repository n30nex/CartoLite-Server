package engine

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
)

type checkpointV1 struct {
	SchemaVersion int             `json:"schemaVersion"`
	Nodes         []*privateNode  `json:"nodes"`
	Routes        []*privateRoute `json:"routes"`
}

func loadCheckpoint(path string) (map[string]*privateNode, map[string]*privateRoute, error) {
	nodes := make(map[string]*privateNode)
	routes := make(map[string]*privateRoute)
	body, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nodes, routes, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("read checkpoint: %w", err)
	}
	var saved checkpointV1
	if err := json.Unmarshal(body, &saved); err != nil {
		return nil, nil, fmt.Errorf("decode checkpoint (move the corrupt file aside to recover): %w", err)
	}
	if saved.SchemaVersion != 1 {
		return nil, nil, fmt.Errorf("unsupported checkpoint schema %d (move the file aside to recover)", saved.SchemaVersion)
	}
	for _, node := range saved.Nodes {
		if node == nil || node.Region == "" || node.Key == "" {
			return nil, nil, fmt.Errorf("checkpoint contains an invalid node")
		}
		decodedKey, keyErr := hex.DecodeString(node.Key)
		if keyErr != nil || len(decodedKey) < 4 || len(decodedKey) > 64 || node.Key != strings.ToUpper(node.Key) || !validCheckpointRegion(node.Region) || normalizeRole(node.Role) != node.Role || sanitizeLabel(node.Label, node.Role, node.Observer) != node.Label {
			return nil, nil, fmt.Errorf("checkpoint contains unsafe node data")
		}
		if node.HasCoords && !validCoords(node.Lat, node.Lng) {
			return nil, nil, fmt.Errorf("checkpoint contains invalid coordinates")
		}
		key := nodeMapKey(node.Region, node.Key)
		if nodes[key] != nil {
			return nil, nil, fmt.Errorf("checkpoint contains a duplicate node")
		}
		nodes[key] = node
	}
	allowedNodeIDs := make(map[string]struct{}, len(nodes))
	for _, node := range nodes {
		allowedNodeIDs[nodePublicID(node)] = struct{}{}
	}
	for _, route := range saved.Routes {
		if route == nil || route.ID == "" || route.FromID == "" || route.ToID == "" || route.PacketCount < 1 {
			return nil, nil, fmt.Errorf("checkpoint contains an invalid route")
		}
		if (route.LastKind != "" && !validRouteKind(route.LastKind)) || math.IsNaN(route.Traffic) || math.IsInf(route.Traffic, 0) || route.Traffic < 0 || route.Traffic > maxRouteTraffic {
			return nil, nil, fmt.Errorf("checkpoint contains unsafe route activity")
		}
		if _, ok := allowedNodeIDs[route.FromID]; !ok {
			return nil, nil, fmt.Errorf("checkpoint route references a missing endpoint")
		}
		if _, ok := allowedNodeIDs[route.ToID]; !ok || route.ID != routePublicID(route.FromID, route.ToID) || routes[route.ID] != nil {
			return nil, nil, fmt.Errorf("checkpoint contains an unsafe route")
		}
		if route.LastKind == "" {
			route.LastKind = "Other"
		}
		if route.Traffic == 0 {
			route.Traffic = 1
		}
		routes[route.ID] = route
	}
	return nodes, routes, nil
}

func preflightCheckpoint(path string) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("checkpoint path is empty")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create checkpoint directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".cartolite-write-check-*.tmp")
	if err != nil {
		return fmt.Errorf("checkpoint directory is not writable: %w", err)
	}
	from := tmp.Name()
	to := from + ".renamed"
	cleanup := func() {
		_ = os.Remove(from)
		_ = os.Remove(to)
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("secure checkpoint preflight: %w", err)
	}
	if _, err := tmp.Write([]byte("ok")); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("write checkpoint preflight: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("sync checkpoint preflight: %w", err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("close checkpoint preflight: %w", err)
	}
	if err := os.Rename(from, to); err != nil {
		cleanup()
		return fmt.Errorf("checkpoint directory does not support atomic rename: %w", err)
	}
	if err := os.Remove(to); err != nil {
		cleanup()
		return fmt.Errorf("remove checkpoint preflight: %w", err)
	}
	return nil
}

func validCheckpointRegion(value string) bool {
	if value == "" || len(value) > 16 || value != strings.ToUpper(value) {
		return false
	}
	for _, char := range value {
		if (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '_' || char == '-' {
			continue
		}
		return false
	}
	return true
}

func writeCheckpoint(path string, nodes map[string]*privateNode, routes map[string]*privateRoute) error {
	saved := checkpointV1{SchemaVersion: 1, Nodes: make([]*privateNode, 0, len(nodes)), Routes: make([]*privateRoute, 0, len(routes))}
	for _, node := range nodes {
		copy := *node
		saved.Nodes = append(saved.Nodes, &copy)
	}
	for _, route := range routes {
		copy := *route
		saved.Routes = append(saved.Routes, &copy)
	}
	body, err := json.Marshal(saved)
	if err != nil {
		return fmt.Errorf("encode checkpoint: %w", err)
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create checkpoint directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".state-v1-*.tmp")
	if err != nil {
		return fmt.Errorf("create checkpoint temp file: %w", err)
	}
	tmpName := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpName) }
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("secure checkpoint temp file: %w", err)
	}
	if _, err := tmp.Write(body); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("write checkpoint: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("sync checkpoint: %w", err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("close checkpoint: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		cleanup()
		return fmt.Errorf("replace checkpoint: %w", err)
	}
	if directory, err := os.Open(dir); err == nil {
		_ = directory.Sync()
		_ = directory.Close()
	}
	return nil
}
