# Chronoscope

Open Chronoscope under Experimental. Known nodes and geographic groups occupy the Now plane. Newly observed packet shapes travel along their confirmed segments, descend, and settle into a growing 3D session sculpture. Color and the shared live-packet signature identify the sanitized packet type. Stack spacing compresses as it grows; height is not a linear measurement. Observer-only activity stays local. Positions and height are illustrative, not radio trajectories, antenna heights, signal strength or coverage.

## Explore

In Sculpture, drag to orbit, right-drag or use two fingers to pan, and pinch or scroll to zoom. Arrow keys pan; Shift-arrows rotate and tilt. Home fits the scene. The camera stays still until you move it or explicitly enable Follow. Appearance changes preserve the camera and observations.

The Time panel offers Sculpture, Flat and Slice. Fall time (30, 60 or 120 seconds) applies to new sculpture shapes. Flat and Slice inspect the recent time window; Slice holds a four-second interval around the chosen age. Freeze holds time while leaving the camera usable. New observations received during frozen inspection never turn into replayed live motion. Clear session sculpture empties the retained observations.

Use region checkboxes to focus the view, Find to inspect public nodes, or click a shape/recent-activity entry to inspect confirmed segments. Sound remains opt-in and follows the existing packet timeline, never the decorative fall or settling effects.

## Bounded session

Every page load starts empty. The sculpture retains at most 1,024 observations and 4,096 confirmed segments, evicting whole oldest observations at the cap. No packet is reconstructed from route totals or server history. Hidden traffic is not backfilled. Flat/Slice show only their selected recent window. Session sculpture data is not persisted.

The renderer batches strokes and shaded glyphs on the GPU, keeps geometry buffers bounded, uploads active ranges only, and reduces decoration before readability. A labelled 2D time-window fallback remains available if WebGL2 is unavailable. Context recovery preserves the camera, retained state and user freeze choice.

Worldwide operators enable this page with `chronoscope` in `EXTRA_PAGES`. Map and Netgraph remain available independently.

**Freeze / Resume** is also available directly in the dock; **Space** toggles it
when the scene has keyboard focus. On phones, optional Follow is in View.
Decorative descent eases into the stack, with bounded arrival rings. Once every
shape has settled, the sculpture redraws on input or feed changes rather than
rebuilding idle geometry. Packet travel and sound keep their original timing.
