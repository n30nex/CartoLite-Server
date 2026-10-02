# Changelog

## 0.6.3 - Reliability and ingest performance

- Replace full-table node identity scans on every update with an incremental index; retain known positions across coordinate-free region aliases and prevent stale alias events from moving nodes backwards.
- Keep reconnect catch-up in state and route counts without replaying it as fresh animation, sound, or Follow activity.
- Avoid rebuilding attached route geometry when only a node label or freshness changes.
- Drain accepted observations into the final checkpoint and cancel active event streams during shutdown.
- Generate unique clean-session MQTT identities for unconfigured installations; explicit broker IDs remain unchanged. Clear an old shared default when upgrading multiple installs on one broker.
- Record the end-to-end audit, synthetic regressions and index benchmark in docs/audit-2026-10-02.md.
- Verify anonymous published-image upgrades from the exact 0.6.2 image on AMD64 and ARM64, retaining the legacy 0.4.1 migration check.

## 0.6.2 - Compact map controls

- Fit the map legend into the bottom-left corner.
- Shrink desktop Map and Netgraph dock buttons while retaining full-size touch targets on phones and tablets.
- Put a 3D shortcut directly in the map dock, synchronized with Layers and saved preferences; entering 3D still enables Topo and Buildings.
- Compact theme-aware map credits and center their toggle, preserving all attribution links and keyboard access.

## 0.6.1 - Edge content integrity

- Prevent automatic proxy/CDN script injection into Map and Netgraph HTML with `Cache-Control: public, no-cache, no-transform`; keep the existing strict Content Security Policy and traffic API unchanged.

## 0.6.0 - Cinematic overhaul

- Add Spectacle, Calm and Minimal effects, automatic detail/graphics, shared motion and text-size controls while retaining saved styles and sound settings.
- Draw live packet cores, directional trails and terrain-aligned arrival effects with shared WebGL2 batches and Canvas fallback. Historical links stay still and packet/audio timing is unchanged.
- Introduce a compact dock, fixed node inspector, selection continuity between views, reversible layer combinations and native/browser Back handling for menus.
- Add scoped ten-second Follow with Hold, Next and Inspect; bring live directing and area/component focus to Netgraph.
- Reduce crowded labels and animated area badges, preserve every retained route, and improve light/dark contrast and keyboard focus.
- Add explicit voice preview and mute controls for the existing 30 sound voices.
- Preserve key-free OpenFreeMap, worldwide geographic grouping and tested AMD64/ARM64 Docker installation.

## 0.5.0 - 2026-09-12

- Add shared Map/Netgraph themes, six route presets, advanced styling controls and readable light/dark palettes.
- Add desktop buildings and camera controls, sharp configurable route strokes and adaptive date-line-safe terrain animation.
- Cull distant terrain work before projection, reuse endpoint samples, and bound terrain zoom for compatible building overlays and responsive close inspection.
- Default to key-free OpenFreeMap; provide optional CARTO browser configuration at runtime without embedding keys in images.
- Publish tested and attested amd64/arm64 Docker images, a pull-only Compose installation, source archives and checksum manifests.
- Validate native installations, checkpoint-preserving upgrades, anonymous image pulls, privacy, performance and browser behavior in Actions.

## 0.4.1 - 2026-09-12

- Keep desktop node details above live packet trails and map shading so traffic cannot obscure the card. Preserve the toolbar and phone sheet layer order.
- Add a synthetic browser regression that checks the inspector against the actual packet canvas, including when the canvas normally ignores pointer events.

## 0.4.0 - 2026-09-11

- Expand live packet sounds from 3 to 30 voices: keys, mallets, plucked strings, bells, synths, sonar-like pings and percussion.
- Add grouped voice selection, clear sound names and descriptions, and preserve saved choices across Map and Netgraph.
- Give voices distinct harmonic spectra, envelopes, pitch bends, filter sweeps and note lengths while keeping one oscillator per visible hop, synchronized starts, opt-in playback and existing volume/muting behavior.
- Add native offline audio rendering checks for all 30 voices, preference and picker regressions, and shared-view browser coverage. No audio samples, remote assets or runtime dependencies are added.

## 0.3.2 - 2026-09-09

- Add the paired audit roadmap and begin its security and data-correctness milestone.
- Attach maintainer-dispatched CI results to the exact commit so pull requests expose their real validation status.
- Upgrade to MapLibre 6.4.1, configure its bundled worker, and check shipped frontend dependencies in CI. The map now requires WebGL2; Netgraph retains Canvas2D.
- Omit ambiguous source legs even when a conflicting identity has no coordinates. Preserve independently confirmed downstream hops.
- Reject non-finite RF values and MQTT envelopes larger than 64 KiB before normalization.
- Reconcile connected browsers after capacity evictions using a coalesced reset and matching snapshot.
- Expire retained topology during quiet periods, avoid clean checkpoint rewrites, and retain failure/retry visibility.
- Add synthetic attribution-sanitizer, source-collision, RF, input-size, capacity, retention and checkpoint-retry regression coverage.

## 0.3.1 - 2026-09-06

- Clear expired Live Follow cards and map highlights when the feed goes quiet, while keeping Follow ready for fresh activity.
- Keep hover labels readable with the light interface theme.
- Add browser coverage for quiet-feed expiry after the ten-second dwell.

## 0.3.0 - 2026-09-06

- Keep secondary controls in one compact Map menu on desktop, tablet and phone. Add saved Night, Daylight and Streets map styles, light/dark interface choices, labels/roads/live-packet toggles and route/Topo strength sliders.
- Replace the blurry wide-zoom route texture with exact GPU lines at every flat-map zoom. Reduce distant residue and selection glow while retaining terrain-draped routes in 3D.
- Hold Live Follow activity for ten seconds with a public node/packet card and countdown. Prefer nearby queued traffic, preserve camera orientation, and pause with a Resume action when the user explores or hides the tab.
- Preserve live sources while changing styles and keep all preferences local to the browser. Add synthetic customization, pacing and responsive regression coverage. See [map customization](docs/map-customization.md).

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
