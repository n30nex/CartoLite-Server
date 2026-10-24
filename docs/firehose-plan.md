# Firehose delivery

Add a session-local physical sculpture to Canada 0.20.0 and Worldwide 0.11.0.
Newly observed public packets fall from a labelled 3D spout into an open box.
Confirmed segments become flexible chains; observer-only receptions are single
beads. Position, tumbling and gravity are an illustration, not geography, RF
propagation or packet timing. No payloads or additional backend data are needed.

## Interaction

- Start empty, viewed from an elevated isometric-like perspective.
- Default drag tilts the box under world gravity. Orbit mode provides independent
  full camera rotation. Both modes support pan, pinch/wheel zoom and Home.
- Beads collide, settle, slide and spill over the rim into a pit. Pour out tips
  the box upside down rather than removing the contents instantly; right it again
  to keep collecting. A hard clear remains available in the settings sheet.
- The inlet can be paused. Hidden, disconnected and paused intervals are never
  backfilled or replayed. Existing sound remains opt-in and responds to new events,
  never repeated collisions.
- Keep controls compact, keyboard accessible and usable at 320px. Share appearance
  and sound preferences without resetting the physical pile or camera. Respect
  reduced motion and offer an explicit resume action for the physical scene.

## Rendering and resource contract

Use Three.js for GPU-batched rendering and Rapier WASM in a dedicated worker for
rigid-body collision/rope constraints. The physics is off the UI thread; rendering
uses the GPU. These are lazy Firehose-only dependencies, not a new app framework.
Use bounded particle/joint/event budgets, sleeping bodies, fixed physics steps,
bounded input queues and a fixed transferable-buffer pool. The live pile cannot
grow memory forever. Recycle only drained groups; disclose events omitted at the
detail cap instead of inventing traffic or silently cutting route components.
The renderer keeps depth-correct bright packet cores and restrained glow. Reduce
decoration/resolution before readability. Handle context loss, resize, hidden
tabs, worker failure and disposal without resetting other views' preferences.

## Validation and delivery

1. Build the real empty box, inlet, pit and worker simulation; verify collision,
   connected/disconnected topology, settling, tilt, drain and bounded resources
   with synthetic fixtures in GitHub Actions.
2. Integrate the compact dock, themes, sound, inspection/help and Canada Android
   navigation. Capture desktop, phone and landscape scenes; test pointer/touch,
   keyboard, reduced motion, graphics loss and background recovery.
3. Run existing API/privacy/topology/performance checks plus Firehose stress
   checks. Keep other views from loading Three.js or Rapier. Publish exact tested
   images and Android artifacts through existing Actions release paths.
4. Deploy Canada after a fresh encrypted backup and isolated restore, verify all
   public views and at least five healthy minutes, then update product pages and
   private operations records. Preserve rollback, container hardening and data.
