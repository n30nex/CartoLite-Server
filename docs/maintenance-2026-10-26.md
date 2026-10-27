# Dependency and repository maintenance — 26 October 2026

## Reviewed scope

At the start of this review, Canada had six open Dependabot PRs and no open issues;
Worldwide had no open issues or PRs. This patch replaces the stale proposals with
one version-aligned update in each repository. Release qualification is recorded
in the published release; a lock-refresh workflow result alone is not test proof.

| Canada PR | Decision |
|---|---|
| [#92](https://github.com/n30nex/CartoLite/pull/92) | Refresh all applicable Actions to current release commit pins; Java and registry login use newer fixes than the proposal. |
| [#90](https://github.com/n30nex/CartoLite/pull/90) | Update transitive source-map-js to 1.2.2. |
| [#82](https://github.com/n30nex/CartoLite/pull/82) | Use Node 24.22.1 LTS. The proposed Node 25 is end-of-life. |
| [#72](https://github.com/n30nex/CartoLite/pull/72) | Use Vitest/mocker 4.1.12, covering the newer advisory still affecting proposed 4.1.11. |
| [#68](https://github.com/n30nex/CartoLite/pull/68) | Move Docker and go.mod together to Go 1.27.3, with x/net 0.61.0 and x/sync 0.24.0. |
| [#25](https://github.com/n30nex/CartoLite/pull/25) | Keep the qualified MapLibre 6.15.0 / Playwright 1.61.1 pair and update Vite to 8.3.5. The old group would downgrade MapLibre; optional graphics upgrades were withdrawn after acceptance testing. |

TypeScript 5.9.3, jsdom 25.0.1 and patched Vitest 4 remain in place. Their unrelated
major-version migrations are not needed to resolve the identified advisories.
Three 0.186.1 and its existing types are already current. Dependabot continues to
surface future updates; minor/patch groups no longer absorb major migrations.

## Security and reliability

- Resolve source-map-js GHSA-68fv-2mgg-jv7q; Vitest/mocker GHSA-82fw-gwwq-j7x9
  and GHSA-qxg6-89mg-rqv8; and the Vite advisories fixed after 8.1.4.
- Audit **all** npm dependencies, including build/test tools, at every severity.
  The previous runtime-only scan missed these development dependencies.
- Enable Worldwide dependency alerts and add its missing Dependabot configuration.
- Keep actions pinned to reviewed commits, the browser image pinned by digest,
  and Playwright's package/image versions aligned.
- Validate a checkpoint-preserving Worldwide upgrade from the previous 0.12.2
  image as well as the existing legacy source upgrade.

## Documentation

Replace append-only README sections with current views, release screenshots,
compact feature summaries, installation and useful reference links. Explain
that CartoLite subscribes to an existing MQTT broker, where logs are read and
why a Docker container cannot reach its host broker through its own localhost.
Keep community examples and optional-page instructions visible.

## Qualification

An optional graphics-stack update and early map initialization change were
withdrawn after the deployed iPhone/WebKit Terminal check found missing geography.
Canada was rolled back with its advancing checkpoint preserved. The final patch
restores the previously qualified rendering code, MapLibre 6.15.0 and the matching
Playwright 1.61.1 browser image while retaining all security/toolchain fixes.
Worldwide 0.12.4 supersedes the initial 0.12.3 maintenance release.

Repeated saved-3D and mobile WebKit Terminal checks run before the full browser
suites, without retries. Original assertions and rendering/resource limits remain
unchanged. Whole-job orchestration allows five extra minutes for the added checks.

All builds, dependency resolution and automated validation run in Actions.
Normal PR and exact-main CI remain mandatory; no performance, privacy, topology,
container or resource gate is relaxed. No backend API or checkpoint schema changes.
Canada's native Android package is unchanged.

Sources: [Node release status](https://nodejs.org/en/about/previous-releases),
[Go release history](https://go.dev/doc/devel/release),
[MapLibre 6.16.0](https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.16.0),
[Playwright Docker version matching](https://playwright.dev/docs/docker),
GitHub dependency alerts and npm registry release metadata, reviewed 26 October 2026.
