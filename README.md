<p align="center">
  <img src="docs/assets/cartolite-server-logo.png" width="180" alt="CartoLite Server logo">
</p>

<h1 align="center">CartoLite Server</h1>

<p align="center">
  <strong>A calm, musical live map for your MeshCore network.</strong><br>
  Turn a standard MQTT feed into a fast, privacy-safe topology experience you can host yourself.
</p>

<p align="center">
  <a href="https://github.com/n30nex/CartoLite-Server/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/n30nex/CartoLite-Server?style=flat-square&color=45dfc3"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/n30nex/CartoLite-Server?style=flat-square&color=53a7e8"></a>
  <a href="https://github.com/n30nex/CartoLite-Server"><img alt="Self-hosted" src="https://img.shields.io/badge/deployment-self--hosted-ab76dc?style=flat-square"></a>
</p>

<p align="center">
  <a href="#quick-start"><strong>Start self-hosting</strong></a> ·
  <a href="docs/deployment.md">Deployment guide</a> ·
  <a href="docs/privacy.md">Privacy boundary</a> ·
  <a href="https://github.com/n30nex/CartoLite-Server/releases/latest">Latest release</a>
</p>

![CartoLite Server showing active MeshCore nodes and routes across the Great Lakes](docs/assets/cartolite-overview.webp)

<p align="center"><sub>Live topology across the Great Lakes, with routes coloured by packet type.</sub></p>

## See your mesh move

CartoLite Server renders public MeshCore activity as a living map: packet trails travel hop by hop, recently heard routes hold a restrained glow, and packet types keep distinct colours. Optional Web Audio turns every visible live hop into a musical articulation. Stronger Topo shading and terrain-aware trails, ground rings, and route history add context in 3D; enabling 3D also enables Topo. The worldwide [Netgraph](docs/netgraph.md) adds a stable topology view grouped by Maidenhead grid squares, with touch navigation, synchronized traffic, and node inspection.

<table>
  <tr>
    <td width="68%">
      <img src="docs/assets/cartolite-inspector.webp" alt="CartoLite node inspector with newest-first neighbours and highlighted routes">
    </td>
    <td width="32%">
      <img src="docs/assets/cartolite-mobile.webp" alt="CartoLite responsive phone interface with its layers panel open">
    </td>
  </tr>
  <tr>
    <td align="center"><sub>Inspect a node, its newest neighbours, and connected routes.</sub></td>
    <td align="center"><sub>Touch-friendly controls keep the map primary on phones.</sub></td>
  </tr>
</table>

## Built for community operators

| | |
|---|---|
| **Live topology** | Vector geography, six route styles, packet-type heat, clusters, terrain and desktop 3D buildings. |
| **Make it yours** | Shared Map/Netgraph themes, preset and advanced line controls, readable light/dark palettes, and saved display choices. |
| **Find and inspect** | Search downloaded node labels, open node details, and browse neighbours sorted by last heard. |
| **Musical traffic** | A grouped choice of [30 sound voices](docs/sound-voices.md), using opt-in native browser audio and visible live hops only. |
| **Works worldwide** | Accept valid coordinates anywhere, or apply an exact region allowlist for a shared broker. |
| **Responsive and resilient** | Desktop and phone layouts, Live Follow, saved views, and automatic recovery after sleep or network loss. |
| **Small operational footprint** | One dependency-light Go service, one atomic checkpoint, no database, and a hardened container. |

## Privacy is the product boundary

The public API exposes only the minimum sanitized data needed to draw the live topology. CartoLite Server does **not** publish public keys, observer keys, raw paths, packet bodies, decoded messages, or resolver details. It includes no visitor analytics, accounts, chat, or message history.

See the exact guarantees in the [privacy documentation](docs/privacy.md) and the stable [public API v2 contract](docs/public-api.md).

## Quick start

You need Docker Engine, Docker Compose v2, and a standard MeshCore MQTT feed. The published image supports Intel/AMD servers and ARM64 hosts. OpenFreeMap works without an account or map key.

> [!IMPORTANT]
> No API keys, passwords, or tokens are bundled with this repository. `.env` and `.secrets/` are excluded from Git and the Docker build context.

Download the two installation files into a new folder:

```sh
curl -fLO https://github.com/n30nex/CartoLite-Server/releases/latest/download/compose.yml
curl -fL https://github.com/n30nex/CartoLite-Server/releases/latest/download/default.env.example -o .env
```

Set `MQTT_BROKER_URL`, `MQTT_TOPIC`, and any required MQTT username/password in `.env`, then start:

```sh
docker compose pull
docker compose up -d --no-build
curl --fail http://127.0.0.1:8080/readyz
```

Open [the map](http://localhost:8080/) or [Netgraph](http://localhost:8080/netgraph/). In Windows PowerShell, use `curl.exe` for the download commands. Existing installations should follow the [upgrade guide](docs/deployment.md#upgrades) and retain their current `.env` and data volume.

The default bind is loopback-only. Keep it behind a TLS reverse proxy for public operation, or deliberately set `CARTOLITE_BIND_ADDR=0.0.0.0` for trusted LAN access.

## MQTT input

MQTT bridge envelopes are limited to 64 KiB before normalization, and RF evidence must contain finite numbers. The geographic map requires WebGL2; Netgraph uses Canvas2D.

The subscriber defaults to `meshcore/#` and accepts the standard topic shape:

```text
meshcore/<region>/<publisher-key>/packets
meshcore/<region>/<publisher-key>/status
```

`REGION_ALLOWLIST` is empty by default, so every syntactically valid region is accepted. Set it to exact comma-separated labels such as `EU_WEST,AU_NSW` when a shared broker should feed separate public maps. Use `MQTT_TOPIC` to narrow the subscription itself.

The server accepts the standard packet/status JSON or raw packet hex published by a MeshCore MQTT bridge. Unknown topic shapes and malformed messages are counted and ignored.

## Map providers

OpenFreeMap supplies the default vector map and buildings. Terrain comes from Mapterhorn. Both are attributed in the map.

CARTO remains optional through `compose.carto.yml` and a mounted browser-key file. Configuration is read at startup, so the same published image works for every operator. Browser keys are visible to visitors by design; MQTT credentials remain server-only. See the [provider configuration](docs/deployment.md#optional-carto-provider).

## Project scope

This repository contains the standalone server, browser map, and worldwide Netgraph. It has no country boundary, default region allowlist, Android app, Labs, analytics, database, chat, history, or operator dashboard.

## Documentation

- [Audit roadmap and current work](docs/roadmap.md)
- [Deployment](docs/deployment.md)
- [Architecture](docs/architecture.md)
- [Privacy boundary](docs/privacy.md)
- [Public API v2](docs/public-api.md)
- [Data sources](docs/data-sources.md)
- [Sound and animation](docs/sound-and-animation.md)
- [Worldwide Netgraph](docs/netgraph.md)
- [Upstream refresh and validation](docs/upstream-refresh-0.2.0.md)
- [Security policy](SECURITY.md)

## License

[MIT](LICENSE). CartoLite Server is derived from the CartoLite map system and keeps its privacy-first public-data boundary.
