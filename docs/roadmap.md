# CartoLite delivery roadmap

Updated 22 October 2026. Current audit: [end-to-end UI/UX review](ui-ux-audit-2026-10-17.md).
The [older roadmap](roadmap-archive-2026-09.md) is preserved as a dated record;
its Planned labels and build-size caps are not current instructions.

## Previously verified release baseline

Canada **0.17.4**, Worldwide **0.8.5**, Canada Android **1.1.2**. Already shipped:
shared appearance and six route presets; cinematic effects and quality/motion
controls; optional Map and Netgraph 3D; buildings/topography; scoped ten-second
Follow; region layout/dragging/filtering and live-only routes; compact phone
navigation; Terminal with improved geographic detail and bright packet glyphs;
Canada Labs and native Android navigation/recovery. Worldwide has key-free maps,
AMD64/ARM64 images and version-matched installer files. Hard build-size caps are
removed; runtime/performance/privacy/security gates remain.

The separate unfinished reliability work is not part of this shipped baseline.
It must be reviewed against current main before integration, preserving the new UI.

## Phases

| Phase | Status | Deliverable | Exit condition |
| --- | --- | --- | --- |
| 1. Everyday navigation and recovery | Delivered | UI01–UI06/UI15: live search refresh, dialog Back/Escape, quiet dismissible map notices, actionable empty Netgraph, reachable Follow actions, stable Labs feedback and this reconciled roadmap. Released in Canada 0.17.3 / Worldwide 0.8.4. | Baseline reproduction; focused tests pass without weakening assertions; full Actions gates; reviewed paired PRs; exact images, qualified Canada deployment and Worldwide installs. |
| 2. Controls, discovery and explanations | Delivered; [delivery status](https://github.com/n30nex/CartoLite-Server/releases/tag/v0.8.5) | UI07/UI08: relevant per-view controls (including a true High-quality override in Labs), consistent visible help, clearer active filters and route/live/observer-only explanations. Silent voice browsing and reliable immediate mute. | Keyboard/Back/focus, 320px/short landscape, enlarged text, sound opt-in and no duplicate feed/layout reset. |
| 3. Animation and visual clarity | Active: Terminal customization | UI09/UI10: semantic Terminal network ink, dense-label priority, purposeful live emphasis, consistent ground/perspective behavior and measured sustained quality. Review each Labs scene independently. | Fixed-time synthetic GPU/Canvas/audio comparisons; all themes/presets; terrain/buildings/date-line/context loss; unchanged 4k-node/7k-route and responsiveness gates. |
| 4. Recovery and release hardening | Planned integration | UI11/UI12: reconcile the separate retained/freshness/clock/region-loading work; clear development-tool advisories through existing dependency PRs; extend browser/accessibility coverage. | Conservative topology/privacy; real reconnect/failure scenarios; exact native images and checkpoint-preserving anonymous installs. No unrelated branch resets or local builds. |
| 5. Optional additions | Planned | UI13/UI14: named local views, public-only share links, bounded role/recent/in-view Find filters, EN/FR Canada chrome and worldwide locale/units. Approved extra tile providers remain a separate configuration decision. | Demonstrate a useful task, reversible saved settings and explicit data/coverage limitations before broadening the UI. |

## Scope and validation

- Both editions: Map, Netgraph, Terminal; layers, themes/presets, Find, inspectors,
  Follow, sound, status/error/empty states, keyboard/touch, suspension and recovery.
- Canada only: region registry, Packet Pond, Firefly Meadow, Mesh Loom, Little
  Mesh Villages and Android. Do not import these product features into Worldwide.
- First package changes hosted UI only; the existing signed Android app receives
  it without a new APK. Keep original identity/certificate for any future native
  release. Physical-device testing remains optional by owner instruction, and
  must never be claimed from emulator evidence.
- All builds/tests/browser artifacts run in Actions with synthetic fixtures.
  Keep the scratch, non-root, read-only container and public API v2 unchanged.
- Runtime performance and privacy are release gates. Artifact sizes are reports.
  Historical links remain still; actual live packets retain timing and meaning.

## Status rules and delivery

Planned means not implemented. Active means work underway. Implemented means
source and tests exist; it is not deployment proof. Delivered requires reviewed
merged code, exact passing main artifacts, release checks and the applicable
runtime/installation evidence. Record the paired PRs and release manifests for
each phase; private operational records hold target/backup/restore observations.

Phase 1 review: [Canada PR 102](https://github.com/n30nex/CartoLite/pull/102) and
[Worldwide PR 33](https://github.com/n30nex/CartoLite-Server/pull/33). The initial
commit is a deliberate failing baseline before fixes, not a release candidate.

Phase 1 was delivered on 17 October 2026:
[Canada 0.17.3](https://github.com/n30nex/CartoLite/releases/tag/v0.17.3) and
[Worldwide 0.8.4](https://github.com/n30nex/CartoLite-Server/releases/tag/v0.8.4).
Canada's [exact-main CI](https://github.com/n30nex/CartoLite/actions/runs/39064393830)
passed 224 frontend and 321 browser cases; its
[161 deployed browser checks](https://github.com/n30nex/CartoLite/actions/runs/39066754097)
passed without retries. Three live observations over 369.4 seconds confirmed
advancing traffic/checkpoints and zero drops/restarts after an encrypted backup
and isolated restore. That exact tested image was deployed and qualified.

Worldwide's [exact-main CI](https://github.com/n30nex/CartoLite-Server/actions/runs/39064086634)
passed 198 frontend and 273 browser cases, including native anonymous AMD64/ARM64
installs and checkpoint-preserving upgrades. One existing basemap startup wait
retried; all 64 new UI cases passed without retries. Published checksums,
provenance and screenshot hashes were verified for both editions.
[Product pages](https://github.com/n30nex/Canadaverse-Site/pull/91) were updated
and [checked live](https://github.com/n30nex/Canadaverse-Site/actions/runs/39067598801).
The existing Android 1.1.2 APK is unchanged; physical-device acceptance is not
claimed. Phase 2 implementation follows below; phases 3-5 remain planned.

## Phase 2 implementation

Canada 0.17.4 / Worldwide 0.8.5 add relevant per-view Display controls, reachable
Help, visible Netgraph filter scope with a scoped clear action, silent previous/next
voice browsing and immediate keyboard mute. Canada Labs restores explicit High
quality after automatic economy. Pending browser audio resumes cannot undo mute.
The new Find filters remain an optional addition; existing Find recovery is retained.

The linked release record carries final validation and delivery status. This
versioned roadmap records the source implementation; publication alone is not
proof of a healthy deployment. The release notes distinguish these stages.

## Next package: Terminal customization

Target Canada 0.18.0 / Worldwide 0.9.0. Add a compact Terminal options editor
inside Display with BBS, Amber, Green, CGA, EGA and Cel-shaded presets. Provide
separate semantic colours for geography, traffic, nodes, labels and interface,
colour-picker/hex/HSL sliders, independent map brightness, live glow and typography.
Keep a readable reset/editor surface even for low-contrast custom palettes.

Convert geography before drawing the existing network layers. Preserve solid
route cores, source topology, hit geometry and packet/audio timing. Offer Braille,
ASCII, pixel blocks or flat cel-shaded geography, and character or smooth packets.
Keep bounded sampling, quality/reduced-motion behavior, fallback and context recovery.
Fonts are bundled locally with their licences and only loaded by Terminal.

Migrate legacy phosphor/glyph/grid preferences; save the new profile separately
and synchronize Terminal tabs. Existing Map/Netgraph styles, layers and sound remain.
Actions must cover all presets, arbitrary colour separation, mobile bounds, font
loading, keyboard input, migration/reset, cross-tab behavior, unchanged live timing,
context recovery and the existing scale/privacy/installation gates. Exact-image
release and Canada qualification follow passing paired reviews. The remaining
phase 3 Labs/dense-label/terrain audit and phases 4-5 remain planned.

Owner-selected Terminal defaults (18 October): routes/live/heatmap/labels/roads/
buildings on; clusters/regions/Topo/3D off; 15-minute routes, 15% Topo shading;
BBS/ANSI fine Braille, Spectacle, Complete, High, system motion, standard text
and Neon routes. Terminal layer/display settings now use separate storage from
Map/Netgraph, while existing Terminal custom profiles and sound choices persist.

## Supplemental visual audit

The owner-supplied 15-page visual audit adds A01–A15, separate from this audit's
UI identifiers. [The follow-up](visual-audit-followup-2026-10-18.md) prioritizes a
measured selected-node/inspector layout and complete duration labels after the
Terminal package, then scope handoff, overview/selection clarity and control copy.
These findings remain planned until reproduced and verified on current code.

## Long-session browser reliability

Active: [22 October browser-session audit](browser-session-audit-2026-10-22.md).
Target Canada **0.18.1** and Worldwide **0.9.1**. Address retained GeoJSON
updates and terrain textures through the upstream renderer fixes; suspend hidden
feeds and refresh once on return. Synthetic resource/recovery checks and the
existing full Actions gates must pass before exact-image release and deployment.
Canada 0.18.0 / Worldwide 0.9.0 are the preceding Terminal customization releases.
