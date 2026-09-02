# CartoLite Server

CartoLite Server is a small, self-hosted live map for standard MeshCore MQTT traffic. It accepts valid coordinates worldwide and serves the map, sanitized API, and live SSE stream from one dependency-light Go process.

This edition has no country boundary, default region allowlist, Android app, Labs, analytics, database, chat, message history, or operator dashboard. It is intended for community operators who want to connect their own MQTT broker and publish a privacy-safe live topology.

## Features

- worldwide MapLibre map with CARTO vector geography;
- live packet trails, route glow, packet-type heat, node clusters, and 24-hour routes;
- opt-in Aurora, Wood, and Chimes Web Audio scenes;
- node search, node inspector, newest-first neighbours, Live Follow, hillshade, and 3D terrain;
- automatic snapshot and SSE recovery after sleep or network loss;
- one atomic checkpoint at `/data/state-v1.json` and no database;
- non-root, read-only, capability-free container with bounded memory and logs;
- no public keys, raw paths, packet bodies, message text, or visitor tracking.

## Quick start

Requirements: Docker Engine, Docker Compose v2, a standard MeshCore MQTT feed, and a CARTO Basemaps API key.

1. Copy `.env.example` to `.env`.
2. Create `.secrets/carto-basemap-api-key` and place only your CARTO browser key in it. The directory is excluded from Git and the Docker build context.
3. Set `MQTT_BROKER_URL`, `MQTT_TOPIC`, and optional MQTT credentials in `.env`.
4. Build and start your instance:

```sh
docker compose build --pull
docker compose up -d
curl --fail http://127.0.0.1:8080/readyz
```

The default bind is loopback-only. Set `CARTOLITE_BIND_ADDR=0.0.0.0` only when you intentionally want LAN access or have placed the service behind a TLS reverse proxy.

## MQTT contract

The subscriber defaults to `meshcore/#` and accepts the standard topic shape:

```text
meshcore/<region>/<publisher-key>/packets
meshcore/<region>/<publisher-key>/status
```

`REGION_ALLOWLIST` is empty by default, so every syntactically valid region is accepted. Set it to exact comma-separated labels such as `EU_WEST,AU_NSW` when one broker carries traffic that should be separated into different public maps. Wildcards are intentionally rejected in this setting; use `MQTT_TOPIC` for subscription scope.

The server expects the same packet/status JSON or raw packet hex published by the standard MeshCore MQTT bridge. Unknown topic shapes and malformed messages are counted and ignored.

## Basemap key

The CARTO key is supplied to Docker as a BuildKit secret. It stays out of source, Compose, image labels, and build logs, but it is necessarily visible in browser tile requests. Use a key whose CARTO project restrictions match your deployment.

CartoLite Server does not publish a universal prebuilt image because each operator should build with their own browser-visible basemap key.

## Documentation

- [Deployment](docs/deployment.md)
- [Architecture](docs/architecture.md)
- [Privacy boundary](docs/privacy.md)
- [Public API v2](docs/public-api.md)
- [Data sources](docs/data-sources.md)
- [Sound and animation](docs/sound-and-animation.md)
- [Security policy](SECURITY.md)

## License

MIT. CartoLite Server is derived from the CartoLite map system and keeps its privacy-first public-data boundary.
