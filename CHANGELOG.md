# Changelog

## 0.1.0 - 2026-09-02

- Create the standalone CartoLite Server distribution from CartoLite 0.9.1.
- Accept valid public node coordinates across the Web Mercator world and use a global home view.
- Accept every syntactically valid MQTT region by default; retain an optional exact `REGION_ALLOWLIST` for operators who need one.
- Remove the Canadian broker default, Canadian coordinate gate, MeshMapper regions, Canadian route-texture bounds, and Canadaverse deployment configuration.
- Remove CartoLite Labs and every related renderer, image asset, route, test, and document.
- Remove the Android project, app links, signing material, download links, and mobile release documentation.
- Add a source-build Docker Compose flow using each operator's own CARTO key as a BuildKit secret.
- Preserve public API schema v2, MQTT/SSE recovery, route and packet visuals, musical traffic, node inspection, privacy assertions, checkpoint safety, and hardened runtime defaults.
