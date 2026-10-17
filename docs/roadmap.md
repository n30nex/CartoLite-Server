# CartoLite delivery roadmap

Updated 17 October 2026. Current audit: [end-to-end UI/UX review](ui-ux-audit-2026-10-17.md).
The [older roadmap](roadmap-archive-2026-09.md) is preserved as a dated record;
its Planned labels and build-size caps are not current instructions.

## Shipped baseline

Canada **0.17.2**, Worldwide **0.8.3**, Canada Android **1.1.2**. Already shipped:
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
| 1. Everyday navigation and recovery | Implemented — candidate | UI01–UI06/UI15: live search refresh, dialog Back/Escape, quiet dismissible map notices, actionable empty Netgraph, reachable Follow actions, stable Labs feedback and this reconciled roadmap. Targets Canada 0.17.3 / Worldwide 0.8.4. | Baseline reproduction; focused tests pass without weakening assertions; full Actions gates; reviewed paired PRs; exact images, qualified Canada deployment and Worldwide installs. |
| 2. Controls, discovery and explanations | Planned | UI07/UI08 and discovery part of UI14: relevant per-view controls (including a true High-quality override in Labs), consistent visible help, clearer active filters and route/live/observer-only explanations. Refine voice browsing/quick mute without autoplay. | Keyboard/Back/focus, 320px/short landscape, enlarged text, sound opt-in and no duplicate feed/layout reset. |
| 3. Animation and visual clarity | Planned | UI09/UI10: semantic Terminal network ink, dense-label priority, purposeful live emphasis, consistent ground/perspective behavior and measured sustained quality. Review each Labs scene independently. | Fixed-time synthetic GPU/Canvas/audio comparisons; all themes/presets; terrain/buildings/date-line/context loss; unchanged 4k-node/7k-route and responsiveness gates. |
| 4. Recovery and release hardening | Planned integration | UI11/UI12: reconcile the separate retained/freshness/clock/region-loading work; clear development-tool advisories through existing dependency PRs; extend browser/accessibility coverage. | Conservative topology/privacy; real reconnect/failure scenarios; exact native images and checkpoint-preserving anonymous installs. No unrelated branch resets or local builds. |
| 5. Optional additions | Planned | UI13 and locale part of UI14: named local views, public-only share links, EN/FR Canada chrome and worldwide locale/units. Approved extra tile providers remain a separate configuration decision. | Demonstrate a useful task, reversible saved settings and explicit data/coverage limitations before broadening the UI. |

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

Phase 1 release evidence, when published: [Canada 0.17.3](https://github.com/n30nex/CartoLite/releases/tag/v0.17.3) and [Worldwide 0.8.4](https://github.com/n30nex/CartoLite-Server/releases/tag/v0.8.4). Remaining phases are planned, not shipped.
