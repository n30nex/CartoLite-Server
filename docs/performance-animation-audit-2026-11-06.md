# Performance and animation audit — 6 November 2026

Scope: Canada and Worldwide Map, Netgraph, Terminal, Chronoscope, Firehose and
Pachinko, plus Canada's Labs. Baselines are Canada 0.22.0 and Worldwide 0.13.1.
This is a source audit followed by a focused patch. Runtime speed and visual
qualification are established by Actions evidence, not by inspection alone.

## First patch: Canada 0.22.1 / Worldwide 0.13.2

| Finding | User effect | Change and verification |
| --- | --- | --- |
| `gpuEffects.ts` allocates corner objects, UV arrays and six temporary vertex arrays for each quad despite owning a reusable buffer. | Extra allocation and garbage collection during dense live effects. | Write scalar vertices directly into the existing typed buffer. Check geometry, UVs, hue, opacity, date-line breaks and atomic overflow fallback. Compare CPU construction with the immutable baseline on the same Actions runner. |
| `firehose/renderer.ts` marks both position textures dirty for every snapshot. | Repeated uploads of data already on the GPU. | Rotate existing texture ownership and upload only the new snapshot; update only active link components. Verify actual WebGL uploads while retiring transferred buffers. |
| The physics worker publishes unchanged resting snapshots twice a second and polls continuously. | Empty or settled machines keep waking the renderer. | Sleep after the final settled frame; explicitly wake for packets, rotation, clearing and draining. Cover pause, buffer starvation and sign-equivalent quaternions. Reset rendering-pressure samples after idle gaps. |
| Both Chronoscope renderers wait 16 ms and then wait for another animation frame. | Extra latency and reduced cadence during otherwise inexpensive motion. | Request the next animation frame directly for full motion. Preserve the existing heavy-work/economy and reduced-motion timers, frozen clocks and stationary settled sculptures. |
| Netgraph reads the automatic quality mode even when High or Economy is selected. | The displayed preference and actual effects resolution can disagree. | Apply the explicit setting consistently and sample automatic quality only in Automatic mode. Check both modes against the actual animation canvas size. |

No new dependency, rendering framework, backend traffic field, lower packet cap,
synthetic live activity or altered audio/route timing is introduced. Canada's
operator-selected MQTT-only configuration must be preserved during deployment.

## Next phases

1. **Ship the first patch.** Functional regressions, same-runner CPU evidence,
   desktop/mobile presentation, full existing performance/privacy/security gates,
   tested image promotion and observable live acceptance.
2. **Quality and recovery.** Canada's Labs currently reduce automatic quality
   without recovering it during the same scene; review recovery with hysteresis
   and paused/hidden sampling. Evaluate the existing dependency PRs separately,
   including [MapLibre 6.16.0](https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.16.0)
   mobile-worker/context recovery fixes. Preserve explicit High, reduced motion,
   appearance and layout through every transition.
3. **Sustained-work profiles.** Profile Chronoscope geometry rebuilding during
   camera-only/frozen inspection and Terminal glyph composition under dense live
   traffic. Extend existing long-session samples with justified resource-growth
   assertions; current sampling records heap/graphics counts but does not bound
   every form of growth. Do not claim an all-day device reproduction from a short
   synthetic run.

Map/terrain and Terminal retain their existing projection, date-line, cache and
7,000-route checks. Netgraph retains its geographic layout and cached static
links. The backend's existing bounded ingestion/checkpoint/privacy rules remain
in force; this package targets client-side work rather than changing topology.

## Evidence and limits

All builds, dependency work, tests and browser artifacts run in GitHub Actions.
The packet-batch comparison measures CPU geometry construction with synthetic
inputs, not complete-page FPS or a user's physical GPU. Baseline source is
materialized only in the test job and removed before building. New browser checks
run early and retain no-retry acceptance. Existing frame deadlines, route counts,
resource limits and checks remain mandatory.

Texture updates use the existing Three.js r186 public
[texture update](https://github.com/mrdoob/three.js/blob/r186/manual/pages/how-to-update-things.html)
and [buffer attribute](https://github.com/mrdoob/three.js/blob/r186/docs/pages/BufferAttribute.html)
APIs. Source inspection establishes the duplicated work; the release evidence
must record actual measured results, screenshots and any remaining limitations.

Status: implemented. Exact Actions results, measured comparisons and deployment
qualification accompany the versioned release notes. Source inspection alone does
not establish a speedup or a deployed release.
