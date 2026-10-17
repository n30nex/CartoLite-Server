# End-to-end UI/UX audit — 17 October 2026

## Scope and evidence

Audited shipped Canada 0.17.2, Worldwide 0.8.3 and Canada Android 1.1.2.
This covers Map, Netgraph, Terminal, every control/panel/legend/error path,
all four Canada Labs experiences and the Android wrapper. Worldwide intentionally
has no Labs, Canada region registry or Android package.

Evidence combines source/caller review with the exact released Actions captures:
Canada main [39051980550](https://github.com/n30nex/CartoLite/actions/runs/39051980550),
its [107 deployed browser checks](https://github.com/n30nex/CartoLite/actions/runs/39054076790),
and Worldwide main [39051422786](https://github.com/n30nex/CartoLite-Server/actions/runs/39051422786).
These include three scene themes, six route presets, reduced motion, 3D,
mobile/short landscape, WebKit, terrain/fallback and 4,000-node/7,000-route cases.
The first audit commit adds targeted before/after reproduction and captures for
all four Labs scenes. It deliberately leaves production code unchanged until
those checks establish the baseline. See the paired PR histories for results.

This is an end-to-end surface and interaction audit, not a claim that every GPU,
screen reader, physical phone, provider outage or packet density was tested.
Native API 26/36 emulator evidence exists; no physical device was accessed.
All new builds, tests and browser artifacts run in Actions using synthetic data.
Current build sizes are informational, not release-blocking caps.

## Surface inventory

| Surface / elements | Present behavior and evidence | Improvement / decision |
| --- | --- | --- |
| Map entry and navigation | Stationary initial camera, compact dock, selected-node continuity, phone picker and status are implemented. | Keep this hierarchy; repair About Back/Escape (UI01), then add consistent visible help. |
| Map Traffic | Routes, live packets, activity heatmap, clustering, route-age window and reversible combinations have distinct controls. | Retain their semantics. A heatmap is observed activity, never coverage. Add a concise active-layer explanation rather than more dock buttons. |
| Geography / regions | Road/place/node labels and Canada region tint/borders/visible legend work; labels and credits remain available on phones. | Review dense-label priority and layer-state discoverability in phase 2/3. Keep existing region geometry/assignment. |
| Terrain / buildings | Optional 3D enables Topo and Buildings; independent toggles, 50-degree initial pitch, 1x terrain height and desktop camera controls exist. | Keep shading distinct from visual height; expand steep-pitch, loaded/missing terrain and close-building comparisons. No antenna/RF height claims. |
| Map/Terminal inspection | Find selects a public node; cinematic layouts use the contextual sheet on desktop as well as phones, with focus-preserving replacement. | Do not replace the working inspector. Protect selection while closing a separate dialog (UI01). |
| Follow | Ten-second activity, scopes, Hold/Next/Inspect and manual interruption already exist. | Short-landscape captures clip the bottom actions; make actions and close controls continuously reachable (UI04). Clock/replay work belongs to the separate reliability integration. |
| Netgraph overview | Stable geographic groups, top-down start, optional 3D and area/component focus are shipped. | Improve empty-state recovery (UI03); keep schematic height explicit and preserve geographic identity. |
| Netgraph region tools | Spacing, whole-group dragging, keyboard movement, saved layouts and searchable multi-region selection are shipped. | Keep these features. Make filtering versus lack of observations clearer when no connections remain. |
| Netgraph inspection and routes | Node/connection cards, endpoint actions, approximate distance and live-only fading paths are shipped. | Improve discovery/help and selection contrast under dense backgrounds; never make hidden routes intercept pointer selection. |
| Terminal geography | GPU character sampling preserves roads, water, landcover, urban texture and labels. Amber/green/ANSI and cell sizes are separate preferences. | Pixel-to-category classification can confuse overlapping cartography and network ink; plan a semantic network overlay, using the same public geometry/timeline (UI09). |
| Terminal live effects | Bounded glow, white cores, colour-preserving fade and foreground labels are now shipped. | Preserve the improvement. Validate thin-core continuity at far zoom and 3D rather than adding wider blur. |
| Display / themes | Shared palettes, six presets, advanced controls, intensity, motion, text and quality synchronize across tabs. | Labs exposes network-style controls that do not directly style its scenes; Terminal overrides basemap appearance. Labs manual High quality also needs to override a latched automatic economy fallback in phase 2. Explain or restrict controls by surface (UI07), without discarding shared saved settings. |
| Sound | 31 voices, grouped choices, previews, gesture-unlocked resume, volume and visible-hop limits have automated evidence. | Preserve opt-in and timing. Evaluate a clearly labelled quick mute and easier voice browsing; physical listening remains unverified. |
| Status / failures | Starting, Live, Reconnecting, unavailable and map notices exist; decorative embeds suppress notices. | Repeated tile errors reopen a dismissed notice. Respect dismissal per problem category and offer a visible Netgraph fallback (UI02). Do not treat an idle map as proof failed tiles recovered. |
| Packet Pond | Ordered droplets/wakes/ripples over reactive water; reduced-motion and Canvas fallback paths exist. | Keep its identity; review background water versus live ripples at density and paused/resume transitions. |
| Firefly Meadow | Plants represent known nodes; packets follow ordered hops with local observer-only activity. | Preserve roomy spacing; compare persistent plant light with live emphasis and keyboard/touch explanations. |
| Mesh Loom | Seven geographic lanes, packet fibres and knots, kind legend; stretched phone legend was already repaired. | Keep the repair; review overlapping long labels and announce user actions separately from every packet (UI05). |
| Little Mesh Villages | Deterministic nodes/settlements, routed light sequences and coverage disclaimer; marked Beta. | Improve legend/discovery of settlement meaning and maintain the disclaimer. Match quality reduction to other Labs without inventing traffic. |
| Labs shared controls | One picker, Pause, Sound, Display, reset, exhibit and explanation dialog; one active feed/renderer. | Incoming packets overwrite reset feedback and continue announcing captions while paused. Hold user feedback and separate screen-reader announcements (UI05). |
| Android 1.1.2 | Canada-only navigation, fullscreen/start-view options, retained history, original certificate, renderer/network/error recovery. | First web fixes also repair hosted app behavior. Keep the native wrapper/signing unchanged; add future TalkBack/real-GPU acceptance when hardware is available. |
| Installation / product handoff | Worldwide has key-free maps and tested native AMD64/ARM64 images; installer defaults now match VERSION. Product links are current. | Preserve clean-install/upgrade and checksum/provenance gates; update product links with each qualified release. |

## Reproduction and first implementation

The unchanged-runtime baseline runs reproduced the targeted failures:
[Canada 39057066953](https://github.com/n30nex/CartoLite/actions/runs/39057066953)
(10 failing regressions plus the four-scene capture pass) and
[Worldwide 39057067196](https://github.com/n30nex/CartoLite-Server/actions/runs/39057067196)
(9 failing regressions). The failures cover UI01–UI05 rather than build errors.
The initial run uses desktop plus explicit 568x320 cases; the fixed candidate
expands the same assertions to Chromium desktop/phone/landscape and phone WebKit.

UI01–UI06 and UI15 are implemented in this candidate. Dialog state participates in Back
history; a modal Escape cannot clear underlying selection. Notices remember a
dismissed problem category for the page visit and expose Netgraph. Empty graphs
provide scoped recovery actions. Follow pins its header/actions during scrolling.
Labs holds user feedback for four seconds and separates announcements from live
packet captions. Existing route/packet clocks, sound scheduling, feeds and native
APK identity are unchanged. Merge/release/runtime evidence remains the delivery gate.

## Findings and acceptance

Priorities: P1 blocks navigation/recovery; P2 affects normal use/readability;
P3 is an enhancement requiring additional design/measurement.

| ID | Priority | Finding / source | Acceptance / scope |
| --- | --- | --- | --- |
| UI01 | P1 | Map/Terminal About is absent from `trackPanelHistory`; the document-level selection Escape handler does not exclude an open dialog. | Browser/Android Back closes About without leaving the view; Escape preserves the inspected node and restores focus. Both editions. |
| UI02 | P2 | `attachMapNotice` unconditionally shows every error after dismissal. | Repeated failures of the dismissed category stay quiet; different categories remain visible; Retry and Open Netgraph work; no provider URL/credential text escapes. Both editions and embeds. |
| UI03 | P2 | Netgraph explains an empty region selection but requires reopening hidden settings; other filtered-empty cases reuse a generic window message, and window totals can conceal an empty focus. | Direct Show all regions/Clear focus/24h actions where applicable; explain no confirmed connections; preserve saved layout, sound and unrelated settings; region changes use the existing automatic framing. Both editions. |
| UI04 | P2 | Follow's scrollable short-landscape card can clip Next/Inspect in the initial view. | Header close/Hold and bottom actions remain fully visible and hit-testable at 568x320; subject text remains scrollable. Map, Terminal and Netgraph in both editions. |
| UI05 | P2 | Labs packet callbacks replace user feedback immediately, including while paused; every packet uses the same polite live region. This also caused the released reset-caption retry. | Pause/reset/resume feedback lasts long enough to read, paused captions stay stable, and screen readers receive user/status announcements without a per-packet queue. Canada only. |
| UI06 | P2 | Main roadmap still labels delivered Follow/display/region/mobile work Planned and quotes retired size caps. | Current release baseline, phased backlog, scope/status definitions and archived old roadmap; separate unmerged reliability work from delivered UI. Both editions. |
| UI07 | P2 | Display controls have inconsistent local meaning across artistic Labs, Terminal and network views. | Surface-specific descriptions and only relevant local controls; shared settings stay available, synchronized and reversible. |
| UI08 | P2 | Gesture/keyboard guidance is fragmented across hidden descriptions, About, camera controls and Labs dialogs. | One compact discoverable help path per view; explain historical/live/observer-only activity and map-versus-schematic height. |
| UI09 | P2 | Terminal infers categories from composited colours rather than directly labelled network geometry. | Preserve route kind through road/water/building overlap and density; use existing geometry and timing, no extra feed or fabricated paths. |
| UI10 | P2 | Snapshot scale checks do not prove sustained touch/drag/audio/thermal behavior on real devices. | Bounded sustained density tests plus optional real-device observations; preserve all retained routes and timing, reduce decoration first. |
| UI11 | P2 | Regional startup and freshness/replay/clock fixes exist in a separate unfinished reliability workstream. | Review and integrate independently, proving retained/replayed traffic never appears live and failure recovery preserves filters. Do not claim those commits shipped here. |
| UI12 | P2 | Three open Canada dependency alerts concern development tools: source-map-js (high), vitest and @vitest/mocker (moderate). | Resolve through their existing dependency PRs, regenerate locks in Actions, keep runtime scans and source-build checks; no claim of production exploitation. |
| UI13 | P3 | Repeated local places/filters cannot be named and recalled as views. | Optional device-local bookmarks and public-only share links, with an obvious reset and no private identifiers/configuration. |
| UI15 | P1 | Map/Terminal Find can stay empty after an early query; open search lists do not reflect incoming node/topology changes. | Refresh only open searches when data arrives and after initial map load; preserve keyboard selection by public node ID and unchanged DOM rows. Both editions, including Netgraph live updates. |
| UI14 | P3 | Discovery and localization can better serve sparse networks and newcomers. | Bounded role/recent/in-view Find filters, honest no-data explanations, then EN/FR Canada chrome and extensible worldwide units/locale. |

The first fixed candidate's screenshots exposed a second short-screen problem:
sticky actions covered the Follow subject/countdown. The short-landscape card now
uses a compact grid, and the regression checks those contents as well as buttons.
A Worldwide WebKit retry exposed UI15: Find was queried before map layers were
ready, then never refreshed. New delayed-resource and live-arrival fixtures test
that recovery; unchanged rows and keyboard subjects remain stable during refresh.

## Animation review contract

Audit each family separately: historical strokes (still); live ignition/core/trail,
relay and arrival effects; route residue; node selection and emphasis; camera
transitions; region decorations; Terminal glyph/bloom; four Labs scenes; traffic
meter and silent preview. Existing source uses the shared packet timeline for
network audio/effects, bounded quality modes, reduced motion and explicit cleanup.
First-package changes touch controls/feedback only and must not retime packets.

For subsequent rendering changes compare all themes/presets against land/water,
dense and sparse scenes, flat/mountain terrain, building overlap, date-line
crossings, steep pitch, context loss, background tabs and missing resources.
Capture progress at fixed synthetic times and compare audio scheduling across
GPU/Canvas and quality modes. Browser emulation is not GPU/thermal certification.

## Delivery plan

See [the current roadmap](roadmap.md). First-package targets are Canada 0.17.3
and Worldwide 0.8.4; the Canada Android APK stays 1.1.2 because its hosted pages
receive the fixes. Ship only after unchanged full Actions gates, reviewed paired
PRs, exact-main artifacts, provenance/checksums and native Worldwide installs.
Canada requires exact-target verification, fresh encrypted backup, isolated
restore, public-view checks and at least five healthy minutes. Update product
links and private operational records after qualification.

## Platform reference

MapLibre's [tile manager lifecycle](https://github.com/maplibre/maplibre-gl-js/blob/main/src/tile/tile_manager.ts)
considers both loaded and errored tiles settled. An idle event is therefore not
proof that a tile failure recovered. Use sanitized categories and explicit retry.

[WAI's dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
expects Escape dismissal and focus returned to the invoking control. The
[status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
supports announcing important changes without moving focus or unnecessarily
interrupting work. These inform UI01/UI05; this audit does not claim WCAG certification.
