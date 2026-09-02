# Public API v2

All endpoints are public and intentionally sanitized. State responses use `Cache-Control: no-store`.

## Endpoints

- `GET /healthz` reports process liveness and build identity.
- `GET /readyz` succeeds only when checkpoint state is healthy, MQTT is connected and subscribed, the ingest queue is healthy, and no packets have been dropped. Normal RF silence remains ready.
- `GET /api/state` returns the authoritative `StateV2` snapshot.
- `GET /api/events?bootId=<boot>&after=<seq>` is a same-origin `text/event-stream` with 15-second keepalives. It replays a bounded sequence window before switching to live events; `Last-Event-ID` is honored on native reconnects. An expired cursor, changed boot, or retention-pruned topology receives `reset` and must rehydrate from `/api/state`.

## State schema

```ts
type StateV2 = {
  schemaVersion: 2;
  bootId: string;
  seq: number;
  serverTime: number;
  status: {
    feed: "connected" | "disconnected";
    activity: "active" | "quiet";
    lastPacketAt?: number;
    dropped: number;
    version: string;
    gitSha: string;
  };
  map: { center: [0, 20]; zoom: 1.4 };
  nodes: NodeV2[];
  routes: RouteV2[];
};

type NodeV2 = {
  id: string;
  label: string;
  role: "repeater" | "companion" | "room_server" | "sensor" | "unknown";
  observer: boolean;
  lat: number;
  lng: number;
  lastSeen: number;
};

type RouteV2 = {
  id: string;
  fromId: string;
  toId: string;
  packetCount: number;
  lastHeard: number;
  intensity: 0 | 1 | 2 | 3 | 4;
  lastKind: "Advert" | "Trace" | "Text" | "ACK" | "Control" | "Other";
  traffic: number;
};
```

Every `fromId` and `toId` references one node in the same snapshot. Endpoint labels and coordinates are not duplicated on routes. `lastKind` is the single sanitized kind from the newest packet observed on the route. `traffic` is a bounded activity score measured at `lastHeard`; clients decay it with a 15-minute half-life. It is not packet history or a per-kind counter. Routes older than 24 hours are omitted.

## Event stream

Event names are `hello`, `node`, `packet`, `status`, and `reset`. State-changing events carry the increasing sequence as their SSE `id`; `hello` deliberately has no SSE ID so a disconnect cannot skip its following replay.

Route packet events use the same normalized identifiers:

```ts
type RoutePacketEventV2 = {
  seq: number;
  id: string;
  at: number;
  payloadType: "Advert" | "Trace" | "Text" | "ACK" | "Control" | "Other";
  mode: "route";
  segments: Array<{ routeId: string; fromId: string; toId: string }>;
};
```

Observer packet events contain one sanitized `{ id, label, lat, lng }` point instead of `segments`. No event contains message content, public keys, raw paths, packet hashes, credentials, or resolver details.

## Compatibility

Schema v2 intentionally replaces the embedded `route.from` and `route.to` objects from v1. Clients must reject unknown `schemaVersion` values. Additive fields may appear within v2; removing or changing an existing field requires another schema version.
