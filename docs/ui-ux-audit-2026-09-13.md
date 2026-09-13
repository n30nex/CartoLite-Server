# UI/UX audit — Canada and Worldwide

Audited baselines: Canada 0.14.1 (`c85ff956`), Worldwide 0.5.0 (`ab5a5836`).

## Scope and evidence

Reviewed the Map toolbar, layers, appearance, terrain/buildings, Find, node details,
Live Follow, sound, legends, loading/recovery, and responsive rules; Netgraph's
equivalent controls, counters, selection, and camera interactions; Canada Labs'
experiment, pause, sound, exhibit, and information controls; the Android wrapper's
navigation/recovery source; and Worldwide's installation/provider configuration.

The Canada public Map and Netgraph were inspected in a browser. In particular,
keyboard activation reproduced Find and Display remaining open together.
Worldwide findings were checked against its corresponding source and are covered
by the paired synthetic Actions suite. No separate Worldwide public instance or
physical Android handset was used for this audit.

## Findings included in this refinement

| Priority | Finding and evidence | Change | Acceptance check |
|---|---|---|---|
| P1 | Access to `localStorage` itself can throw before Map startup, and the audio constructor can prevent all three views starting. Existing catches around storage methods do not cover the getter. | A small in-memory fallback protects Map preferences and the audio constructor. | A blocked storage getter still permits Map, Netgraph, and Canada Labs startup. |
| P2 | Appearance, preview, and advanced controls precede the layer grid. At a normal desktop height, common layers extend below the menu's visible area. | Put Traffic and Map details first. Move Terrain/buildings and Appearance into native disclosures; keep the close control at the top while scrolling. | Common traffic toggles fit in the initial panel; expanded controls remain bounded on phones and landscape views. |
| P2 | Layer state relies on a small colored dot. An enabled Buildings layer may show nothing below neighborhood zoom. Camera/shading controls remain active when their layer is off. | Explicit On/Off labels, an enabled-layer count, zoom-aware building guidance, and disabled inactive camera/shading inputs. | Guidance changes at the building zoom threshold; 3D enables Topo/Buildings and their controls correctly. |
| P2 | The existing reset combines layer visibility, scene, style, and camera preferences. | Add Reset layers while retaining a clearly named full reset under Appearance. | Reset layers keeps scene, route preset, and sound preferences; the full reset still restores display defaults. |
| P2 | Netgraph's separate Display controller only coordinates with pointer dismissal. Enter can open Display over Find; Escape does not consistently restore menu focus. | Coordinate menu opening for pointer and keyboard activation and restore focus on dismissal. | Only one menu remains open through Find → Display → Sound; Escape returns to the initiating control. |
| P2 | Netgraph is keyboard-focusable but has no camera keyboard handler. | Arrow-key pan, plus/minus zoom, Home to fit, and an accessible keyboard hint. | Keyboard navigation changes the view without changing topology or intercepting form inputs. |
| P2 | At phone widths, Netgraph hides all counter labels and can crowd the controls row. | Show concise labels and place the summary below the controls. Preserve full labels for assistive technology. | Phone counters are named, visible, and do not overlap controls. |
| P2 | Node details call cumulative retained-link counts “packets,” which can suggest counts within the selected window. Replacing popup contents also recreates its close button without the original accessible name. | Label totals as observations, explain how the window filters links, and retain a named close button after updates. | Live updates keep a usable close control and cumulative totals are identified correctly. |
| P2 | Pausing Follow through its card or opening another control does not always stop an already-running camera ease. | Stop the current follow camera transition for those explicit pause actions. | Pause immediately stops camera motion; the existing ten-second activity dwell remains unchanged. |

## Further work

These remain separate, concrete follow-ups; this patch does not claim to complete
every older roadmap item.

1. **Inspector keyboard continuity:** move focus from search results into details,
   preserve the focused neighbour through live reordering, and restore focus to
   the originating control on close. The close-button naming defect is addressed
   here; the complete focus journey still needs a dedicated regression.
2. **Follow scope and actions:** offer an explicit area lock, Next, and Inspect,
   with a clear distinction between heard-at-node activity and confirmed routes.
3. **Motion and text preferences:** evaluate shared reduced-motion and text-size
   controls across Map and Netgraph. Labs has a separate artistic presentation;
   preserve its Pause and explanation affordances while considering consistency.
4. **Legends and dense selections:** continue testing the combined inspector,
   region legend, follow card, and provider notice in short landscape viewports.
   Avoid adding permanently visible panels to solve isolated overlaps.
5. **Worldwide first use:** distinguish an empty configured feed, a disconnected
   broker, and no routes in the selected window with actionable setup guidance.
6. **Native Android verification:** check system back, TalkBack, large system text,
   resume, and offline recovery on hardware. The web improvements reach the
   existing wrapper; this patch changes no native navigation policy.

## Design and validation rules

Keep one source of truth for appearance and retain existing preferences. Use
native disclosures, stable toggle labels, explicit pressed states, and keyboard
focus restoration, following the [WAI disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
and [button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/).

Build and test only in GitHub Actions with synthetic traffic. Preserve the existing
privacy, topology, rendering, size, and image checks. Inspect the resulting
desktop/mobile screenshots and verify the exact deployed Canada revision after
the final candidate passes. Runtime evidence is recorded separately from this
source audit.
