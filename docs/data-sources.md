# Data sources

## Operator MQTT broker

All topology and activity originate from the operator-configured MeshCore MQTT feed. The server sends no traffic to a shared CartoLite service. MQTT credentials stay inside the server container environment and are never returned by an endpoint.

## Vector maps and buildings

The default map uses OpenFreeMap vector tiles and glyphs without registration or a key. CartoLite supplies its own Night, Daylight and Streets paint styles. The same OpenMapTiles-compatible source supplies building footprints and approximate heights; no precise building or antenna height is invented when data is missing.

Operators can choose CARTO using the runtime secret override described in [Deployment](deployment.md). Its browser-visible key is provided through `/api/config`, never built into the published image. Buildings still use OpenFreeMap in this mode. Requests go directly to the attributed provider and contain no MeshCore traffic. There is no raster basemap fallback.

## Optional terrain

Topography and 3D use Mapterhorn's public TileJSON endpoint at `https://tiles.mapterhorn.com/tilejson.json`. MapLibre reads its Terrarium elevation tiles only after a visitor enables Topography or 3D. No MQTT data or visitor identifier is added to those requests.

No country, regional-boundary, geocoding, weather, analytics, or history source is bundled.
