# Experimental views: graphics and interaction audit

Scope: Chronoscope, Firehose and Pachinko in Canada and Worldwide. Baseline:
Canada 0.21.3 / Worldwide 0.12.4, including their exact-release synthetic desktop,
phone and landscape captures. No application builds or browser captures run on
the workstation; qualification and new captures run in Actions.

## Findings and patch

| Finding | Change |
| --- | --- |
| Home fitting only shrinks and fits around the orbit target, wasting space around asymmetric machines. | Fit and center the projected scene bounds inside the space left by permanent controls. Keep camera orientation and manual framing intact. |
| Small bright points lose their category color in a white core; trails and impacts are faint. | Analytically shade the colored cores, add a compact highlight and antialiased rim, strengthen directional trails and contain arrival glows. Keep the same batched renderer. |
| Pachinko lanes are difficult to distinguish and broad impact rings cross nearby lanes. | Add subdued category-colored rails in one instanced draw, a more frontal default camera and smaller peg-contact flashes. |
| Pause removes illumination, and Pachinko lane flashes do not retain their phase on resume or clear. | Freeze the effect clock while keeping the captured illumination; preserve lane timing on resume and clear every pulse with the session. |
| Chronoscope descent stops abruptly and settled geometry keeps rebuilding once a second. | Ease the decorative descent, add bounded settling rings and a subtle floor grid, and stop scheduled redraws once the sculpture is still. Flat/Slice retain window updates. |
| Chronoscope Freeze is buried in Time. | Add a direct Freeze/Resume action and a scene-focused Space shortcut. On phones, keep six primary touch targets by moving optional Follow into View. |
| Camera recovery and detailed inspection require gestures. | Add Angle, Front and Above camera actions to Firehose/Pachinko without changing the pile, plus larger touch hit areas. |
| Status text can be clipped or visually lost against the scene. | Use compact cards with the shared interface palette and a stable two-line status footprint; measure contrast against the actual card surface. |
| Chronoscope labels can run off a phone's edge. | Bound long labels and keep their backplates inside the viewport while retaining collision-aware placement. |
| Pachinko bucket labels stay tiny with enlarged text. | Reflow the counters into two readable rows for Large text, keeping the compact default row. |
| Inspector highlights can outlive a drained packet. | Clear the stale highlight and explain that the displayed public details belong to a packet that has drained. |
| Every physics snapshot updates the same counters and controls. | Coalesce HUD updates with one bounded trailing timer; keep physics, GPU interpolation and audio independent. |

## Delivery order

1. Shared framing, controls and graphics changes in both repositories.
2. Synthetic functional and visual checks, including camera presets, pause/resume,
   drained inspection, idle rendering, 320 px phones and short landscape layouts.
3. Full existing privacy, performance, capacity, context-loss, reduced-motion,
   cross-tab/theme and native-platform gates in Actions. Inspect the resulting
   screenshots before promotion; preserve all measured performance limits.
4. Publish tested Worldwide AMD64/ARM64 digests and deploy Canada's tested digest
   after a fresh encrypted backup and isolated restore. Verify the public views,
   live traffic, checkpoint writes and at least five healthy minutes.

No new rendering dependency, full-screen bloom, synthetic live activity or backend
traffic field is introduced. Category meanings, confirmed routes, retained-event
caps, physics ownership and sound scheduling remain unchanged. Reduced motion and
the existing Chronoscope Canvas fallback remain supported. Manual camera changes
and appearance changes preserve retained observations.

Release notes record the exact source, screenshots and verified outcomes. Planned
qualification is not a claim that an untested candidate is deployed.
