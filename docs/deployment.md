# Deployment

## Install the published image

Docker Engine and Compose v2 are required. Published images support `linux/amd64` and `linux/arm64`, including 64-bit Raspberry Pi hosts. No Node, Go, source build or map-provider account is required.

In a new directory, download `compose.yml` and `default.env.example` from the latest release. Save the environment example as `.env`, then set your MQTT broker, topic and any required username/password. Choose a unique `MQTT_CLIENT_ID` for each instance.

```sh
docker compose pull
docker compose up -d --no-build
docker compose ps
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:8080/readyz
```

The map is at `http://localhost:8080/`; Netgraph is at `/netgraph/`. Default maps and buildings use OpenFreeMap without a key. `/api/config` contains only public map-provider settings; the traffic API remains schema v2.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `CARTOLITE_IMAGE` | versioned `ghcr.io/n30nex/cartolite-server` image | Published tag or exact release-manifest digest |
| `CARTOLITE_BIND_ADDR` | `127.0.0.1` | Host bind address |
| `CARTOLITE_PORT` | `8080` | Host HTTP port |
| `MQTT_BROKER_URL` | required | Your MeshCore broker URL (`tcp`, `ssl`, `ws`, or `wss`) |
| `MQTT_TOPIC` | `meshcore/#` | Subscription filter |
| `MQTT_CLIENT_ID` | `cartolite-server` | Must be unique per instance |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | empty | Configure both when authentication is required |
| `REGION_ALLOWLIST` | empty | Accept all valid regions, or exact comma-separated labels |
| `MQTT_INGEST_QUEUE_SIZE` | `4096` | Bounded ingest queue |
| `STATE_PATH` | `/data/state-v1.json` | Atomic checkpoint |
| `LOG_LEVEL` | `info` | Application logging |

Use the loopback bind behind a TLS reverse proxy for public operation. Set `CARTOLITE_BIND_ADDR=0.0.0.0` explicitly for appropriate LAN access. Keep the non-root user, read-only filesystem, dropped capabilities, data volume, health checks and resource/log limits supplied by Compose.

## Optional CARTO provider

Download `compose.carto.yml` from the same release. Store your site-restricted CARTO browser key in `.secrets/carto-basemap-api-key`. The file must be readable by the container’s UID 65532; on Linux, give that UID ownership and mode 0400. A custom host path can be set with `CARTO_BASEMAP_API_KEY_FILE` in `.env`.

```sh
docker compose -f compose.yml -f compose.carto.yml up -d --no-build
```

The override mounts the file at `/run/secrets/carto_basemap_api_key` and selects `BASEMAP_PROVIDER=carto`. The key is read at startup; restart the service after changing it. It is intentionally visible in browser configuration/tile requests, just as with the previous compiled browser key. It is never included in the published image. MQTT credentials are never returned by `/api/config`. OpenFreeMap remains the building source when CARTO is selected.

## Upgrades

Record the current image/digest and keep a private, verified checkpoint backup before upgrading. Retain the current `.env`, project name and `cartolite-data` volume. Download the new Compose file without replacing your environment file, set `CARTOLITE_IMAGE` to the new version or release-manifest digest, then run `docker compose pull` and `docker compose up -d --no-build`.

When upgrading from the 0.4.x source distribution, replace `cartolite-server:local` in `.env` with the published image. The default becomes key-free OpenFreeMap; add the CARTO override above to keep your existing provider. Old build-only version variables are no longer required. The checkpoint format is unchanged.

Verify health/readiness, retained nodes and routes, live traffic, Map and Netgraph after the upgrade. Roll back by selecting the recorded image and recreating only the CartoLite service; use the verified checkpoint recovery copy if state recovery is necessary. Never run `docker compose down -v` against an installation you intend to keep.

## Source builds

A source checkout can use `compose.build.yml` explicitly:

```sh
docker compose -f compose.yml -f compose.build.yml build --pull
docker compose -f compose.yml -f compose.build.yml up -d --no-build
```

Runtime provider configuration is identical for source-built and published images. Maintainer builds, tests and releases run only in GitHub Actions; no workstation build is used for a release.

## Release verification

Actions tests native amd64 and arm64 images, including synthetic MQTT/privacy/load checks and a checkpoint-preserving upgrade from 0.4.1. Browser checks run against the same frontend on amd64. Main publishes and attests the tested platform digests, assembles their index without rebuilding, and verifies anonymous pulls and the Compose recipe on both architectures. Tag releases promote that exact index and publish Compose files, source archives, a release manifest and SHA256SUMS.
