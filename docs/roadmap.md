# Audit roadmap

Updated: 9 September 2026. This roadmap turns the end-to-end audit into tracked delivery work. Audit IDs A01–A12 are retained; F IDs track features and R IDs track validation risks.

This is the worldwide source-release roadmap. Shared work is paired with [CartoLite Canada](https://github.com/n30nex/CartoLite); A04/O1 is tracked upstream and is not an operator rollout for this repository.

## Status and completion rules

- **Planned:** accepted direction, implementation has not started.
- **Active:** current work package.
- **Implemented:** code and regression coverage are present; merge, release and runtime evidence are tracked separately below.
- **Review:** implementation and regression checks are in a pull request; consult its exact-commit Actions checks.
- **Done:** merged with passing checks. Release/deployment is recorded separately.
- **Needs setup:** an external configuration, provider choice, or physical test is required.

Each item needs its acceptance check, edition parity, and an exact CI result before it becomes Done. Code completion does not imply a production rollout. All build/test execution for roadmap work uses GitHub Actions. Fixtures must be synthetic.

## Milestones

| Milestone | Status | Deliverable / exit condition |
|---|---|---|
| M1 — Security and data correctness | Implemented | A01, A02, A03, A05 and A06 are implemented in the paired corrective release. Merge/release requires the existing full CI plus focused regressions in both editions. |
| O1 — Canada recovery operations | Needs setup | A04 and R09; independently verifiable backup, isolated restore, monitoring, and current deployment identity. This is a separate Canada operations package. |
| M2 — Usability and portable operation | Planned | A07–A12; honest count/window labels, optional storage, keyboard continuity, readable mobile counters, dependency/release policy, and identifiable worldwide installs. |
| M3 — Follow and display refinement | Planned | F01–F08; area-constrained follow, readable cards, shared display/motion controls, layer strengths, camera controls, cross-view selection and bounded discovery/focus. |
| M4 — Optional additions | Planned | F09–F12; bookmarks, ground elevation context, configured tile types and localization/exhibition polish. Provider-dependent work follows A01 and R08. |
| V1 — Resilience and scale evidence | Planned | R01–R09 exercised where their related code changes; improve measured bottlenecks and preserve privacy, rendering and runtime budgets. |

## Corrective backlog

| ID | Priority | Scope | Status | Work and acceptance |
|---|---|---|---|---|
| A01 | P1 | Both | Implemented | Upgrade MapLibre 5.19.0 to patched 6.4.1, adapt ESM imports and bundled worker setup, and scan runtime dependencies from the lockfile. Exact-revision type/build, map, terrain, route-layer, recovery and browser gates pass. Track WebGL2 as the map minimum. |
| A02 | P1 | Both | Implemented | Check source-prefix uniqueness before checking coordinates. A positioned/unpositioned collision never creates a guessed origin leg; independently resolved downstream hops remain visible. |
| A03 | P1 | Both | Implemented | Coalesce capacity-eviction resets after an authoritative snapshot. Crossing node/route caps leaves the browser consistent and bounded, with no dangling endpoint references or reset per packet. |
| A04 | P1 | Canada | Needs setup | Configure the documented encrypted off-host backup and restore path. Prove a checksummed isolated restore with the matching image/version and independent monitoring; preserve production throughout validation. |
| A05 | P2 | Both | Implemented | Reject non-finite RF/coordinate values and impose a bounded MQTT envelope before normalization. Synthetic invalid numbers and over-limit JSON/hex are rejected; valid RSSI-only and SNR-only packets still work. |
| A06 | P2 | Both | Implemented | Run retention maintenance during quiet periods and avoid unnecessary checkpoint writes. With no new messages, expired routes/nodes leave the API, checkpoint and connected client; quiet connected feeds remain ready. |
| A07 | P2 | Both | Planned | Label cumulative observation totals honestly and describe windows as “links heard within this period.” Never imply current totals are unique packets counted within the chosen interval. |
| A08 | P2 | Both map pages | Planned | Guard access to browser storage itself and fall back to in-memory preferences. A throwing storage getter cannot prevent startup or control use. |
| A09 | P2 | Both | Planned | Transfer keyboard selection focus to details, restore it on close, add Netgraph keyboard pan/zoom/reset, and bounded node/area browsing. Find → details → neighbour → close works without a pointer. |
| A10 | P2 | Both Netgraphs | Planned | Give every phone counter a visible or accessible name; prefer a concise nodes/links summary with optional area/component detail. Validate at 320–480 px without overlap. |
| A11 | P2 | Both delivery processes | Planned | Make dependency contributions testable without production credentials, retain trusted provider verification, enforce worldwide exact-revision merge/release checks and enable dependency alerting. M1 covers the runtime lockfile scan only. |
| A12 | P2 | Worldwide | Planned | Improve setup identity, require an instance-specific MQTT client ID, and refresh upgrade/rollback instructions. A documented install reports its actual revision/version; independent instances have distinct identities. |

P1 means next corrective work; P2 means the next refinement cycle. [MapLibre advisory GHSA-jrc7-96c5-q579](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579) affects the audited dependency. The audit established the vulnerable version, not exploitation of this application.

## Feature backlog

| ID | Milestone | Status | Feature and acceptance |
|---|---|---|---|
| F01 | M3 | Planned | **Follow scope:** Everywhere / This area / Selected node, plus confirmed-routes-only. Keep ten seconds as the default; a locked area never expands just because the camera moves. Expose existing selected-node filtering clearly. |
| F02 | M3 | Planned | **Follow card:** Hold, Next and Inspect, observation age, and a distinct observer-only state. Hold/pause stop an active camera ease; Inspect opens existing details and pauses the director. |
| F03 | M3 | Planned | **Shared Display menu:** interface theme, motion, text size and contrast across Map/Netgraph; Calm / Standard / Showcase presets and recoverable custom settings. Preserve OS reduced-motion preferences. |
| F04 | M3 | Planned | **Independent effect strength:** historical lines, packet glow, residue duration and heat strength. Reducing decoration keeps confirmed links available and sharp at distant zooms. |
| F05 | M3 | Planned | **Terrain/camera controls:** compass/reset north, scale, optional pitch, clearer shading vs 3D-height terminology, and zoom-aware terrain contrast. Labels and packet cores remain readable. |
| F06 | M3 | Planned | **Map ↔ Netgraph continuity:** open the selected public node in the other view; preserve useful context and explain nodes absent from that route window. |
| F07 | M3 | Planned | **Local discovery:** role, recently-seen and current-view filters with bounded empty-query browsing; worldwide grid filtering. Filters use downloaded public data and have an obvious reset. |
| F08 | M3 | Planned | **Netgraph focus:** isolate an area/component, mute unrelated decoration, and reduce competing traffic badges. Keep an obvious all-areas reset and preserve all underlying links. |
| F09 | M4 | Planned | **Local bookmarks / shareable views:** named centre/zoom/bearing/pitch/display presets. Shared URLs contain public view settings only, never private configuration or transient packet identifiers. |
| F10 | M4 | Planned | **Ground elevation context:** on-demand approximate ground height and endpoint height difference, optionally a selected-route profile. Remove visual exaggeration from numeric values and handle missing DEM data. Never present it as antenna height or RF coverage. |
| F11 | M4 | Needs setup | **Actual tile types:** operator-configured satellite/hybrid or another approved provider, after A01. Require explicit attribution, credential handling, allowed hosts, contrast and failure fallback. No provider entitlement is assumed. |
| F12 | M4 | Planned | **Locale / exhibition polish:** English/French Canada chrome, extensible worldwide translations, native locale formatting and selectable units; exhibition and explicit keep-awake preferences using existing patterns. |

M3 uses existing public data and browser-local settings. M4 terrain features use the existing DEM on demand; additional tile providers require configuration. Route coverage, antenna height, raw RF details and historical interval totals cannot be inferred from the present public state.

## Evidence and engineering backlog

| ID | Status | Validation / improvement |
|---|---|---|
| R01 — Date-line follow | Planned | Test both directions across 179°/−179° in pitched/rotated Follow at detail zoom, desktop and phone. Existing overview seam coverage does not prove this combination. |
| R02 — Time and replay | Planned | Separate receipt freshness from RF observation age; test out-of-order/future timestamps, retained MQTT messages and browser clock skew. Old/replayed observations must not masquerade as new activity. |
| R03 — Backend hot path | Planned | Profile sustained ingest at 10k nodes / 20k routes. Reduce whole-node scans in public-ID refresh only with measured evidence and unchanged identity semantics. |
| R04 — Recovery pressure | Planned | Test concurrent resync, stream capacity refusal and slow state readers; add bounded response work and retry jitter where justified. |
| R05 — Live event validation | Planned | Validate event shape and sequence before store mutation, reuse existing validators, and recover once on a malformed stream. |
| R06 — Budget / parity | Planned | Track page-entry and lazy assets alongside total bytes; extract cohesive helpers as touched. Record intentional Canada/worldwide differences and check shared fixes for drift. |
| R07 — Browser / device coverage | Planned | Add focused Firefox/WebKit evidence where feasible and physical Android GPU, sleep, audio and thermal checks for Canada. Browser emulation is not hardware validation. |
| R08 — Degraded services | Planned | Exercise basemap-key failure, DEM timeout, region-asset failure and missing WebGL2 independently. Retain useful status/data and explain unavailable features concisely. |
| R09 — Operational policy | Needs setup | Verify independent monitoring and off-host restore; document the response to lifetime drop alarms and distinguish present pressure from past drops without silently clearing the alarm. |

## Delivery and parity record

The audited baselines were Canada 0.12.0 (`2e827a4`) and Worldwide 0.3.1 (`6a446ee`). M1 is delivered through [Canada PR #70](https://github.com/n30nex/CartoLite/pull/70) and [Worldwide PR #9](https://github.com/n30nex/CartoLite-Server/pull/9), targeting releases [0.12.1](https://github.com/n30nex/CartoLite/releases/tag/v0.12.1) and [0.3.2](https://github.com/n30nex/CartoLite-Server/releases/tag/v0.3.2). Use those PR checks and release manifests for exact revisions and validation results.

The migration measured 474,482 compressed JS/CSS bytes for Canada and 446,084 for Worldwide in Actions, including the new 129,701-byte map worker. M1 now enforces total, non-map-worker, and map-worker caps separately. R06 still tracks entry-page/lazy-load measurement. Rendering timing and topology-count gates are unchanged.

For each work package, record its PR, exact checked commit, CI result, counterpart PR or scope exception, and any release/runtime proof. A green candidate PR remains Review until merged; a merged change remains undeployed until an exact release is rolled out and verified.

Preserve public schema v2, conservative route resolution, the single-service/atomic-checkpoint architecture and hardened runtime. Canada keeps its published-image promotion path, geographic scope, Labs and Android. Worldwide remains an independent source distribution with coordinate-derived areas, optional exact region filtering, and no Canada-only data, Labs or Android.
