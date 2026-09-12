# Privacy boundary

The traffic API publishes schema v2 nodes, routes, status, and sanitized packet kinds. It never publishes full node or observer keys, raw paths, packet hashes, packet payloads, message text, server credentials, resolver reasons, or MQTT region labels.

The separate `/api/config` response contains only public map-provider settings. Optional CARTO browser keys are intentionally client-visible; MQTT credentials and other server configuration are never included. The default OpenFreeMap provider needs no key, and published images contain no operator or CI map key.

The Node Finder searches already-downloaded public labels in the browser. Queries are neither sent nor persisted. Inspector content is built with DOM text nodes rather than HTML insertion.

The browser stores only separate desktop/mobile views, map layer and route-window choices, and `{enabled, volume, scene}` sound preferences. Remembered sound still requires a fresh user gesture. There are no cookies, accounts, analytics, advertising identifiers, or visitor logs.

Topography and 3D make attributed elevation-tile requests to Mapterhorn. Default geography/buildings use OpenFreeMap; optional CARTO geography uses the operator's public browser key. These tile requests contain no MeshCore traffic data or added visitor identifier.

The atomic server checkpoint contains current topology and private resolver keys needed for restart. Treat it as private operational data: back it up encrypted, never publish it, and never attach a live copy to an issue.
