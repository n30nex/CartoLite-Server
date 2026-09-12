# Architecture

```text
operator MQTT broker
        |
bounded ingest channel
        |
single-owner Go engine ---- atomic /data/state-v1.json
        |
sanitized public schema v2
        +---- GET /api/state
        +---- GET /api/events (SSE)
        +---- embedded MapLibre browser client
```

The engine owns nodes, private resolver indexes, routes, sequence numbers, and counters. MQTT callbacks normalize messages and enqueue bounded input. Slow SSE clients are disconnected instead of applying backpressure. Dirty public state is serialized at most once per second; durable state is checkpointed at most once every five minutes and on clean shutdown.

Public routes are created only when path prefixes resolve unambiguously to forwarder-capable nodes with valid worldwide Web Mercator coordinates and RF evidence. Missing or ambiguous information fails closed and can produce only an observer point, never an invented route.

The checkpoint contains current topology and private resolver material needed after restart. It contains no traffic history, message text, credentials, or packet capture. It is mode `0600`, written through a same-directory temporary file, synced, and atomically renamed. Routes expire after 24 hours; unreferenced nodes expire after 30 days.

The browser treats `/api/state` as authoritative and `/api/events` as a bounded low-latency delta stream. Boot changes, sequence gaps, expired replay cursors, visibility resume, and network restoration trigger one coalesced state refresh and stream replacement.

MapLibre owns stable geography, nodes, heat, buildings and route geometry. Batched WebGL stroke meshes support consistent widths, casings and patterns without enlarged route textures. Terrain paths use bounded adaptive samples; the same projection governs packet movement and route inspection. Date-line breaks never become extra hops or cross-world strokes. Canvas owns transient packet motion and configurable 0–45-second residue. One browser-local display profile is shared by Map and Netgraph; sound preferences remain independent.

`GET /api/config` is a separate schema-1 browser configuration response, containing only the selected provider and an optional public CARTO browser key. The server reads that key from a mounted file at startup. Published images contain no operator or CI key; OpenFreeMap is the default. Native amd64/arm64 images are tested and attested before digest promotion.

## Worldwide visual refresh

The map and Netgraph share recovery, keyboard Finder, packet timing, palettes, route styles and hop audio. Netgraph derives Maidenhead groups locally from public coordinates and uses adaptive Canvas2D effects. The traffic schema stays at v2. No country data, database, new service or geocoder is introduced. The earlier [0.2.0 port notes](upstream-refresh-0.2.0.md) describe that historical source release.
