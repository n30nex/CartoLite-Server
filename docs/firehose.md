# Firehose

Open `/firehose/` or choose **Firehose** in the view picker. New live packets fall
from the spout into a physical box. A bead represents a node in that packet;
links preserve confirmed hops. Observer-only receptions become single beads.
The positions, tumbling and gravity are an illustration, not geography, radio
travel time or signal strength. No message text or private traffic is shown.

The box starts empty each time. Drag in **Tilt box** mode to slide and spill its
contents. **Orbit camera**, in Box, changes your viewpoint independently. Both
modes support right-drag/two-finger pan and wheel/pinch zoom. Arrow keys tilt or
orbit, Shift-arrows pan, +/− zoom, and Home restores the starting camera. **Pour** tips the box
upside down; **Right the box** restores it. Fallen chains disappear down the pit.

Pause stops physics, new beads and sound. Resume collects fresh activity only;
paused, hidden and disconnected intervals are not backfilled. Reduced motion
starts paused, with an explicit Resume available. Find inspects public nodes;
click a bead to inspect its packet. Sound remains opt-in and plays new packets,
never collisions. Display changes colours, link styles, glow, core size and
graphics resolution while preserving the pile and camera.

Auto graphics measures the scene as it runs. When frames become expensive it
reduces surface detail, glow and pixel density, then restores them after sustained
headroom. It never removes a retained bead or confirmed link to meet a frame budget.

Rendering is GPU-batched WebGL2. Rapier physics runs in a dedicated worker with
sleeping bodies, fixed steps and three reusable snapshot buffers. Graphics mode
and device class determine a finite session budget. Whole packet graphs are
admitted or omitted, never cut into misleading partial chains; very large graphs
or a full queue/detail cap are disclosed as omitted events. Drained groups free
space. The scene does not accumulate an unlimited history or fill during hidden
tabs. A WebGL2 or worker failure provides recovery and a link to Netgraph.
