# Browser reliability bug-fix pass - 29 October 2026

Baseline: Canada 0.21.5 and Worldwide 0.12.6. The live Canada service was healthy
at preflight, with advancing traffic/checkpoints and zero reported drops,
restarts or application errors. Both repositories had no open issues or PRs.
This pass fixes browser behaviour and preserves the existing service and API v2.

## Confirmed bugs and fixes

| Problem | Correction | Regression coverage |
| --- | --- | --- |
| Device-clock errors can hide retained routes or show incorrect node ages; changing the clock can skip or stall Follow. | Anchor data age to the fresh HTTP Date header and monotonic elapsed time. Keep the cached JSON snapshot timestamp unchanged. Ignore failed/invalid clock samples and superseded requests; retain local-time fallback when no valid server reference exists. Use monotonic elapsed time for Follow dwell. | Unit tests cover cached snapshots, delayed bodies, out-of-order requests and clock changes. Browser cases cover Map, Terminal, Netgraph, Chronoscope, Firehose and Pachinko, plus Follow timing. |
| Live event JSON was trusted through type casts, allowing malformed node/status/packet data into the model. An unresolved multi-hop packet could also queue partial/dangling routes before returning null. | Validate stream envelopes and bodies before applying them or advancing the cursor. Recover from malformed data using the existing snapshot path. Resolve every endpoint before changing any route count or batch. | Malformed sequence, reset, role, coordinates, status, kind and segment fixtures; browser recovery after an invalid live kind; atomic route-history tests. |
| Canada Netgraph startup and recovery awaited region data, so a failed or stalled optional lookup could hide otherwise healthy live traffic. Missing assignments also fell back to unrelated outside-Canada metro names. | Start and recover the feed independently. Coalesce regional work, reject stale moved-node assignments, retry with bounded backoff or a compact menu action, and stop pending work on disposal. Unresolved nodes use public coordinates without invented region membership; saved filters stay restrictive. Preserve manual camera/selection on retry. | Stalled download during startup and stream recovery, failed lookup/retry, saved filters/spacing, keyboard focus, unassigned geometry and full retained topology. |
| An older Labs observation could move a route's last-use time backward and prematurely remove a recently active route from the reuse display. | Keep the newest observed last-use time. Use the same data-age clock for Labs metrics and snapshot-driven decoration. | Out-of-order metric fixture and existing Labs browser suites. |

The regional and Labs corrections are Canada-specific. Worldwide keeps its
coordinate-derived global grid and does not acquire country datasets or Labs.
Canada's partition geometry and successful outside-partition assignment rules
are unchanged. Chronoscope's unresolved coordinate fallback also avoids guessing
an outside-Canada metro. There are no new radio paths, payload fields, backend
endpoints, dependencies, saved settings or native APK changes.

## Validation and release

All builds, tests and browser artifacts run in GitHub Actions with synthetic
fixtures. Existing UI audit/recovery checks run first; the previous temporary
copy of selected cases is removed because those same cases remain in the full
suites. No assertions, per-case deadlines, scale fixtures or rendering limits
are relaxed. Retain Go/test/vet/race, frontend, privacy/security, all-page,
background-session and 7,000-route checks, plus Android API 26/36 compatibility.
Worldwide verifies native anonymous AMD64/ARM64 installation and upgrade from
the exact published 0.12.6 digest, as well as the legacy migration path.

Promote only the exact qualified main images. Canada deployment requires a new
encrypted off-host backup roundtrip, isolated restore, public acceptance and at
least five healthy minutes with advancing traffic and checkpoints. Release notes
and private operations records hold the actual qualification/deployment results;
source implementation alone is not runtime acceptance.
