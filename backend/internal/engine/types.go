package engine

type EndpointV2 struct {
	ID    string  `json:"id"`
	Label string  `json:"label"`
	Lat   float64 `json:"lat"`
	Lng   float64 `json:"lng"`
}

type NodeV2 struct {
	ID       string  `json:"id"`
	Label    string  `json:"label"`
	Role     string  `json:"role"`
	Observer bool    `json:"observer"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	LastSeen int64   `json:"lastSeen"`
}

type RouteV2 struct {
	ID          string  `json:"id"`
	FromID      string  `json:"fromId"`
	ToID        string  `json:"toId"`
	PacketCount int64   `json:"packetCount"`
	LastHeard   int64   `json:"lastHeard"`
	Intensity   int     `json:"intensity"`
	LastKind    string  `json:"lastKind"`
	Traffic     float64 `json:"traffic"`
}

type PublicStatus struct {
	Feed         string `json:"feed"`
	Activity     string `json:"activity"`
	LastPacketAt int64  `json:"lastPacketAt,omitempty"`
	Dropped      int64  `json:"dropped"`
	Version      string `json:"version"`
	GitSHA       string `json:"gitSha"`
}

type StateV2 struct {
	SchemaVersion int          `json:"schemaVersion"`
	BootID        string       `json:"bootId"`
	Seq           uint64       `json:"seq"`
	ServerTime    int64        `json:"serverTime"`
	Status        PublicStatus `json:"status"`
	Map           MapV2        `json:"map"`
	Nodes         []NodeV2     `json:"nodes"`
	Routes        []RouteV2    `json:"routes"`
}

type MapV2 struct {
	Center [2]float64 `json:"center"`
	Zoom   float64    `json:"zoom"`
}

type RouteSegmentV2 struct {
	RouteID string `json:"routeId"`
	FromID  string `json:"fromId"`
	ToID    string `json:"toId"`
}

type PacketEventV2 struct {
	Seq         uint64           `json:"seq"`
	ID          string           `json:"id"`
	At          int64            `json:"at"`
	PayloadType string           `json:"payloadType"`
	Mode        string           `json:"mode"`
	Segments    []RouteSegmentV2 `json:"segments,omitempty"`
	Observer    *EndpointV2      `json:"observer,omitempty"`
}

type NodeEventV2 struct {
	Seq  uint64 `json:"seq"`
	Node NodeV2 `json:"node"`
}

type StatusEventV2 struct {
	Seq    uint64       `json:"seq"`
	Status PublicStatus `json:"status"`
}

type ResetEventV2 struct {
	Seq    uint64 `json:"seq"`
	BootID string `json:"bootId"`
}

type Event struct {
	Name string
	Seq  uint64
	Data any
}

type OperationalStats struct {
	Processed              int64
	SnapshotBytes          int64
	PublicNodes            int64
	PublicRoutes           int64
	CheckpointBytes        int64
	CheckpointDurationMS   int64
	LastCheckpointAt       int64
	LastCheckpointNodes    int64
	LastCheckpointRoutes   int64
	PrunedCheckpointNodes  int64
	PrunedCheckpointRoutes int64
}

type privateNode struct {
	Region        string  `json:"region"`
	Key           string  `json:"key"`
	Label         string  `json:"label"`
	Role          string  `json:"role"`
	Observer      bool    `json:"observer"`
	Lat           float64 `json:"lat"`
	Lng           float64 `json:"lng"`
	HasCoords     bool    `json:"hasCoords"`
	LastSeen      int64   `json:"lastSeen"`
	LastPublished int64   `json:"-"`
}

type privateRoute struct {
	ID          string  `json:"id"`
	FromID      string  `json:"fromId"`
	ToID        string  `json:"toId"`
	PacketCount int64   `json:"packetCount"`
	LastHeard   int64   `json:"lastHeard"`
	LastKind    string  `json:"lastKind,omitempty"`
	Traffic     float64 `json:"traffic,omitempty"`
}
