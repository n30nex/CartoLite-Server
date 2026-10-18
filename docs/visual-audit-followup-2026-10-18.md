# Supplemental visual-audit follow-up

The owner supplied **CartoLite UI/UX Audit, 17 October 2026** (15-page PDF) on
18 October. Its A01–A15 findings come from rendered Canada browser observations;
they are distinct from UI01–UI15 in the repository's source audit. They do not
establish backend/RF defects, clean-session defaults, hardware performance or
full accessibility conformance. Reproduce the relevant states against current
code with synthetic fixtures before marking a finding fixed. Do not commit the
live examples or captures as test data.

## Current Terminal package

Canada 0.18.0 / Worldwide 0.9.0 address the visual-hierarchy portion of A11:
geography is drawn separately from exact network strokes; colours, map brightness,
fonts and live treatment are adjustable; labels retain an opaque backing and
Large text support. The selected marker remains `@`, and stale markers can be
quieter without dimming their names. A visible Terminal status names the route
window or live-only/hidden state. This is not a claim that all A11 inspection,
naming and handoff work is finished.

The owner's later screenshots explicitly choose independent Terminal defaults:
fine ANSI/BBS Braille, Spectacle, Complete, High, system motion, Standard and Neon;
15-minute routes with the requested layers. These take precedence over the PDF's
suggestion to share every preference. Map and Netgraph keep their saved settings.

## Next focused packages

1. **Keep the subject visible — A01, A02, A07a.** Measure the actual mobile
   inspector, desktop summary/inspector rail and dock. Frame the selected node
   inside the remaining canvas on selection or explicit recovery; preserve manual
   panning. Add readable sheet states and a clear return to the map. Show complete
   duration values at 320px and with Large text. Validate Map and Netgraph in both
   editions; reuse the same framing for Terminal.
2. **Explain investigation scope — A03, A08, A15.** Keep selected identity across
   views and announce the destination's time/filter scope. Offer an explicit
   same-window action where appropriate, preserving Terminal's chosen defaults.
   Verify timestamp and retained-count meanings before changing labels. Keep the
   query during no-result recovery; distinguish quiet, filtered, paused and
   disconnected states.
3. **Readable overview and primary selection — A04, A05.** Collision-safe region
   names, stronger primary selection, quieter neighbours and a reachable node-type
   key. Retain every eligible connection and honest drill-down. Any optional
   aggregated summary must be labelled and reversible; never present representative
   region-centre lines as confirmed RF links.
4. **Consistent controls and outreach — A06, A07b, A09–A14.** Align panel/trigger
   names and reset scopes, make camera recovery and Follow scope easier to reach,
   use consistent Terminal naming, and clarify Labs keys, pause, sound and scene
   rotation. Labs remains Canada-only. Review each change with before/after scenes.

Use the existing Actions suites and synthetic scenes at desktop, 390px, 320px,
short landscape and Large text. Preserve keyboard/Back behavior, opt-in sound,
reduced motion, frame/route budgets, privacy and exact-image release checks.
