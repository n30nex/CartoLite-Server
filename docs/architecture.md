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

MapLibre owns stable geography, nodes, heat, and route geometry. The historical route texture covers the complete Web Mercator world at overview zooms; detail zooms use the same exact straight route segments in a compact WebGL line buffer. Canvas owns only transient packet cores, wakes, sparks, handoffs, and 45-second residue. The browser keeps map and sound settings locally.

## Worldwide visual refresh

The map and Netgraph share recovery, keyboard Finder, packet timing, colours and hop audio. Terrain paths use bounded geographic samples with cache invalidation on camera and DEM changes; date-line strokes are split without creating new hops. Netgraph derives Maidenhead groups locally from public coordinates and uses adaptive Canvas2D effects. No country data, database, new service, geocoder, or public schema fields are required. See [the port notes](upstream-refresh-0.2.0.md).
