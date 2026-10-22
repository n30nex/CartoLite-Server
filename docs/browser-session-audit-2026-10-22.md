# Browser session reliability — 22 October 2026

The Canada service was healthy while a user reported Chrome slowing down after
leaving the map open. Host health does not establish browser health. This patch
targets Canada 0.18.1 and Worldwide 0.9.1 without a new native APK or traffic schema.

## Findings and changes

- Both editions pinned MapLibre 6.4.1. Its GeoJSON worker dispatch awaits the next
  pending update before releasing completed work. Under sustained pressure this
  retains completed payloads. Upstream fixed the queue in 6.12:
  [MapLibre #8585](https://github.com/maplibre/maplibre-gl-js/pull/8585).
- Terrain's unused drape textures remain pooled for the life of the old map.
  Upstream releases them at rest and when disabling terrain in 6.10:
  [MapLibre #8400](https://github.com/maplibre/maplibre-gl-js/pull/8400).
- Upgrade the pinned renderer to 6.15.0, including both fixes. The dependency
  lockfile is generated in Actions and reviewed before candidate validation.
- Hidden views stop animation/audio but previously kept consuming live events
  and updating topology/rendering sources. Close the shared feed when hidden,
  cancel its retries, and recover one fresh snapshot on return. Apply missed
  activity to state only; never replay it as live animation or sound. Pause the
  map/graph freshness redraws while hidden too.
- Keep visible live traffic, retained routes, appearance, selection and sound
  choices. No page-refresh timer, forced garbage collection, data truncation or
  new dependency is used as a runtime workaround.

## Validation

Actions owns builds, dependencies and browser evidence. A focused regression
keeps the real GeoJSON worker queue busy with synthetic data and verifies that
completed updates become collectable while newer work remains queued. Browser
garbage collection is diagnostic only and is never shipped in the application.

Sample heap, DOM/listeners and graphics-object counts with synthetic live traffic
and audio across Map, terrain, Terminal and Netgraph. Check hidden startup,
hidden retries, recovery completing while hidden, one refresh on return and
silent replay. Canada also covers Labs through the same feed. Retain every
existing mobile, terrain, privacy, 7,000-route, image and installation gate.

Short controlled runs expose this failure mode; they are not a claim that an
all-day session on the reporting user's hardware has been reproduced. Record
the exact baseline/candidate results before marking this package delivered.
