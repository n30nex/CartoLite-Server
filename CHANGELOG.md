# Changelog

## 0.2.0 - 2026-09-05

- Bring the shared map improvements from CartoLite 0.9.1 through 0.11.0 to the worldwide self-hosted distribution.
- Add a worldwide Netgraph at `/netgraph/`, with stable topology, native touch pan/pinch/zoom, adaptive visual quality, synchronized hop audio, keyboard Finder navigation, node inspection, and selected-node packet emphasis. Group areas by standard Maidenhead grid squares derived from public coordinates, without country lists or external geocoding.
- Strengthen multidirectional Topo shading. Enabling 3D also enables and remembers Topo; disabling 3D retains Topo. Project packet trails, residue and ground rings through terrain, and drape historical routes in 3D while retaining the fast flat-map renderer.
- Keep date-line routes on their short geographic path. Split Canvas and historical strokes at the map seam without adding radio hops or musical notes.
- Improve responsive toolbar layout and recovery from closed streams, stalled state requests, malformed resets and startup failures. Preserve operator configuration, worldwide coordinate acceptance, optional exact region filtering, public API v2, and hardened runtime defaults.
- Validate synthetic worldwide, terrain, privacy, scale and desktop/mobile scenarios in GitHub Actions. Releases remain source-only; each operator supplies their own basemap key through a BuildKit secret.

## 0.1.0 - 2026-09-02

- Create the standalone CartoLite Server distribution from CartoLite 0.9.1.
- Accept valid public node coordinates across the Web Mercator world and use a global home view.
- Accept every syntactically valid MQTT region by default; retain an optional exact `REGION_ALLOWLIST` for operators who need one.
- Remove the Canadian broker default, Canadian coordinate gate, MeshMapper regions, Canadian route-texture bounds, and Canadaverse deployment configuration.
- Remove CartoLite Labs and every related renderer, image asset, route, test, and document.
- Remove the Android project, app links, signing material, download links, and mobile release documentation.
- Add a source-build Docker Compose flow using each operator's own CARTO key as a BuildKit secret.
- Preserve public API schema v2, MQTT/SSE recovery, route and packet visuals, musical traffic, node inspection, privacy assertions, checkpoint safety, and hardened runtime defaults.
