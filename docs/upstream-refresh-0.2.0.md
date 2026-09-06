# CartoLite 0.11.0 port to the worldwide server

This release carries the applicable map, animation, navigation, recovery and Netgraph work from CartoLite 0.9.1 through 0.11.0 into CartoLite Server. It preserves the independent server's global home view, worldwide coordinate acceptance, optional exact `REGION_ALLOWLIST`, broad MQTT topic default, separate map preferences, and operator-owned BuildKit basemap key.

## Worldwide adaptations

- Netgraph replaces the Canadian partition and US fallback cities with standard coordinate-derived Maidenhead squares. Newly reported nodes receive an area immediately; a coordinate change across a square updates its grouping. No regional datasets or workers are downloaded.
- Geographic interpolation uses the short longitude delta at the date line. Canvas strokes break at the canonical world-map seam, and static route geometry takes the same short path. The split is visual: it creates no extra RF hop, packet, or audio note.
- Projection footprints sample inward at the longitude and Web Mercator latitude limits. Terrain and camera caches are invalidated without resetting packet clocks.
- Historical routes use native MapLibre terrain draping in 3D. Flat regional views retain the lightweight historical renderer; the global texture bounds remain worldwide.
- The distribution includes Map and Netgraph. Labs, country-specific map overlays, Android packaging, hosted-service configuration and universal prebuilt images remain outside its scope.

## Validation

GitHub Actions runs frontend tests/build/budget, Go tests/vet/race, a hardened container against synthetic MQTT, privacy and load checks, focused worldwide/terrain browser regressions, the complete desktop/mobile suite, and the image vulnerability gate. Browser evidence remains an Actions artifact. The maintainer's CI basemap key is an Actions secret only; it is never part of the source release.

The global fixtures cover multiple continents and both hemispheres, preserved saved views, global Netgraph grouping, date-line paths and sound admission, 3D/Topo coupling, reduced motion, pointer/touch navigation, startup retry and reconnect behaviour.

## Rendering limits

Terrain is exaggerated 1.35 times for readability. Canvas2D packet overlays follow terrain projection but have no shared mountain depth buffer, so full mountain occlusion is future work. Elevation tiles do not establish antenna height, RF coverage, signal strength or line of sight. The map keeps a canonical world seam rather than inventing a route across the globe.

The rendering research follows the pinned MapLibre 5.19.0 [terrain projection](https://github.com/maplibre/maplibre-gl-js/blob/v5.19.0/src/ui/map.ts), [multidirectional hillshade example](https://github.com/maplibre/maplibre-gl-js/blob/v5.19.0/test/examples/add-a-multidirectional-hillshade-layer.html), and [terrain draping implementation](https://github.com/maplibre/maplibre-gl-js/blob/v5.19.0/src/render/render_to_texture.ts).
