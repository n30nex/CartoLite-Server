# Chronoscope

Open `/chronoscope/` or choose **Chronoscope** in the dock (the **View** picker on phones). It turns recently observed public activity into a time sculpture. It needs no map tiles, extra key or backend service.

- **Sculpture:** radios stay on the Now plane, while completed packet traces settle into the time volume. Depth is time since this page received the event, not altitude or radio travel time.
- **Flat:** view the same selected observation window from above.
- **Slice:** freeze time and inspect the four-second interval around a chosen moment.

**Time** contains the 30-second, 60-second and two-minute windows, Freeze view, Return to live and recent packets that can be selected with the keyboard. A new page starts without earlier observations. Freeze holds the activity window while current feed and radio information keep updating. Returning to live never replays buffered packets or sound. Freeze and Slice inspection are temporary; reopening starts live in your last Sculpture or Flat view.

**Regions** filters one or several geographic groups. **Find** selects a radio and its observed activity. Selecting a trace opens its confirmed segments; gaps are preserved. An observer-only pulse records one receiver hearing activity, without drawing a connection.

Drag to pan, scroll or pinch to zoom, and use Fit to restore the overview. Arrow keys pan, +/− zoom and Home fits. Shift-left/right rotates Sculpture. Display shares themes, route styles, effects, motion and text preferences with Map and Netgraph. On phones, Display is in View. Sound remains opt-in and is silent while time is frozen. Follow uses the same ten-second live-only subjects and scopes as Netgraph.

The session buffer retains up to 1,024 complete events and 4,096 segments for at most two minutes. Capacity trimming is shown above the scene. A frozen view keeps one additional bounded snapshot. Nothing is saved across reloads. Background tabs stop ingesting/rendering; disconnected and hidden intervals remain unobserved. Historical route totals are never converted into invented activity.

Canada uses the existing region resolver; Worldwide uses its coordinate-derived geographic cells. Traces use the current schematic grouping, not a history of radio locations. New activity does not reframe the camera; use Fit or choose regions to change the overview. The time ruler stays readable as you pan or zoom the spatial view. Graphics fall back to Canvas2D when WebGL effects are unavailable; reduced motion and automatic detail preserve the data while limiting decoration.
