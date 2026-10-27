<p align="center"><img src="docs/assets/cartolite-server-logo.png" width="140" alt="CartoLite Server"></p>

# CartoLite Server

**A live, visual home for your MeshCore network.**

[Install with Docker](#quick-start) · [Live examples](#live-examples) · [Latest release](https://github.com/n30nex/CartoLite-Server/releases/latest) · [Deployment guide](docs/deployment.md)

Turn a MeshCore MQTT feed into a geographic map, an interactive topology diagram and optional visual experiments. One small service, no database, and no map key required. Published images run on **Intel/AMD and ARM64**, including 64-bit Raspberry Pi hosts.

![CartoLite Server's current map and compact layer controls](https://github.com/n30nex/CartoLite-Server/releases/latest/download/map-overview-desktop.png)

*Current-release interface, captured in Actions with synthetic traffic. [More screenshots and verification](https://github.com/n30nex/CartoLite-Server/releases/latest).*

## Live examples

- [Canada](https://carto.canadaverse.org/) — the Canada edition, with Labs and its Android app.
- [EastMesh](https://carto.eastmesh.au/)
- [Flatus Lifir](https://move.flatuslifir.is/)

Community installations may run different releases and enable different pages.

## Quick start

You need **Docker Engine, Docker Compose v2 and access to a MeshCore MQTT broker**. CartoLite subscribes to that broker; it does not include an MQTT server or listen on port 1883. Your observers publish to the broker, and CartoLite reads the feed from it.

In a new installation directory, download:

```sh
curl -fLO https://github.com/n30nex/CartoLite-Server/releases/latest/download/compose.yml
curl -fL https://github.com/n30nex/CartoLite-Server/releases/latest/download/default.env.example -o .env
```

Edit `.env`: set `MQTT_BROKER_URL`, `MQTT_TOPIC` and any required username/password. Keep the file private. Then:

```sh
docker compose pull
docker compose up -d --no-build
curl --fail http://127.0.0.1:8080/readyz
```

Open [Map](http://localhost:8080/) or [Netgraph](http://localhost:8080/netgraph/). Use `curl.exe` in Windows PowerShell. **Upgrading?** Keep your existing `.env` and data volume; follow [upgrades and rollback](docs/deployment.md#upgrades) instead of overwriting them.

The default bind is loopback-only. For a public site, use a TLS reverse proxy. For trusted LAN access, explicitly set `CARTOLITE_BIND_ADDR=0.0.0.0`. See [deployment](docs/deployment.md) for both. A broker running on the host is not `localhost` from inside the container: use an address reachable from CartoLite's Docker network.

```sh
# Container status and recent operational logs
docker compose ps
docker compose logs --tail=100 -f cartolite
```

`/healthz` checks the process; `/readyz` also checks feed readiness. A connected, quiet mesh can be ready without new packets. No separate log-file path or inbound MQTT port is needed.

## Choose your pages

**Map and Netgraph are always enabled.** Other pages are optional:

| View | What you can do |
|---|---|
| **Map** | Watch confirmed hops on a geographic map; explore terrain, buildings, heatmaps and optional 3D. |
| **Netgraph** | Follow the topology with recognizable geographic groups, optional 3D, region filters and draggable region layouts. |
| **Terminal** | Turn the map into a live BBS display with Braille, ASCII, pixel and cel-shaded modes, six presets, custom colours and fonts. |
| **Chronoscope** | Orbit a growing, session-only sculpture of observed packets and routes. |
| **Firehose** | Watch linked packet beads tumble into a 3D box; tilt it to pour them out. |
| **Pachinko** | Watch individual packets bounce into colour-coded buckets and overflow into a drain. |

Enable any subset in `.env`, then apply the matching release's Compose file:

```dotenv
EXTRA_PAGES=terminal,chronoscope,firehose,pachinko
```

Leave it empty for Map and Netgraph only. This also applies to upgrades: set the extra pages you want to keep before recreating the service. The icon dock groups the experiments, and phones use one compact View picker. Labs and the native Android app belong to the Canada edition.

<p>
  <img src="https://github.com/n30nex/CartoLite-Server/releases/latest/download/firehose-active-flow-desktop.png" width="49%" alt="Luminous packets falling into the Firehose box">
  <img src="https://github.com/n30nex/CartoLite-Server/releases/latest/download/pachinko-live-desktop.png" width="49%" alt="Packets falling through Pachinko into type-specific buckets">
</p>

## Built for everyday use

- **Find, inspect and follow:** search public node names, inspect confirmed neighbours and routes, or use ten-second Live Follow with a countdown, area/node scopes and Hold/Next controls.
- **Make it yours:** Aurora, Glacier, Ember and Violet interface palettes; light/dark panels; Night, Daylight and Streets scenes; six route presets and advanced line controls. Terminal has its own colour/font studio.
- **Hear the mesh:** [31 opt-in sound voices](docs/sound-voices.md), including Dial-up Modem, with preview and volume controls. Only eligible visible live hops make sound.
- **Phone-friendly:** one compact view picker, coordinated sheets, touch controls, reduced-motion support and recovery after sleep or a lost connection.
- **A small service:** one Go process, bounded memory and one atomic topology checkpoint. No database, accounts, chat, visitor analytics or persistent packet history.

## Your feed and map provider

The default subscription is `meshcore/#`, using standard `meshcore/<region>/<publisher>/packets` and `.../status` topics. Use `MQTT_TOPIC` to narrow the feed or an exact comma-separated `REGION_ALLOWLIST` when sharing a broker. An empty allowlist accepts valid regions worldwide. Credentials remain server-only.

**OpenFreeMap** supplies the default vector map and buildings, with **Mapterhorn** terrain. No account or key is needed. Optional CARTO configuration uses an operator-supplied browser key at startup; it is not compiled into the image. See [provider configuration](docs/deployment.md#optional-carto-provider).

The container runs as a non-root user with a read-only filesystem, dropped capabilities, a persistent checkpoint volume and bounded logs/resources. Do not remove those settings when adapting Compose. See [architecture](docs/architecture.md) for retention and sizing context.

## Privacy and scope

Public data contains sanitized node labels, locations and confirmed topology. It does **not** expose keys, observer identities, raw paths, packet hashes, payloads, message text, credentials or resolver details. Route interpretation stays fail-closed; terrain and diagram heights are visual context, not radio coverage or antenna measurements. See [privacy](docs/privacy.md), [public API v2](docs/public-api.md) and [security reporting](SECURITY.md).

## Development and releases

Maintainer builds, tests, lockfile refreshes, screenshots and releases run in **GitHub Actions**. The toolchains are Node **24.22.1 LTS**, Go **1.27.3** and Playwright **1.61.1** with its matching pinned browser image. CI covers all npm dependencies, Go tests/vet/race, synthetic MQTT and privacy checks, browser/mobile rendering, long-session and performance checks, and container scanning.

The CI workflow's **Refresh dependency lockfiles** option exports a patch tied to its source commit for review. It does not run the qualification suite or publish an image. Apply the reviewed patch on the same branch, then run normal PR CI. See the [maintenance review](docs/maintenance-2026-10-26.md).

Green `main` publishes an attested `sha-<full-commit>` candidate. Versioned releases promote that tested digest without rebuilding and include installation files, a manifest, checksums and Actions screenshots.

Worldwide CI verifies native AMD64 and ARM64 images, anonymous pulls and checkpoint-preserving upgrades. [Source builds](docs/deployment.md#source-builds) remain available separately; the default Compose file consumes the published image.

## Documentation

[Deployment, upgrades and rollback](docs/deployment.md) · [Architecture](docs/architecture.md) · [Data sources](docs/data-sources.md) · [Netgraph](docs/netgraph.md) · [Terminal](docs/terminal-view-plan-2026-10-17.md) · [Chronoscope](docs/chronoscope.md) · [Firehose](docs/firehose.md) · [Pachinko](docs/pachinko.md) · [Sound](docs/sound-and-animation.md) · [Roadmap](docs/roadmap.md)

[MIT licensed](LICENSE). Derived from [CartoLite Canada](https://github.com/n30nex/CartoLite).
