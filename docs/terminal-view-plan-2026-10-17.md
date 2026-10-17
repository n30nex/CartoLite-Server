# Terminal view — Canada and Worldwide

Add `/terminal/` as the third view after Map and Netgraph. On phones it lives in
the existing compact view picker. The visual reference is a 1990s BBS atlas:
black land, dotted blue water, pale coastlines, yellow place names, ANSI traffic
and a compact coordinate/status line. Amber and green phosphor are alternatives.

## Implementation

Reuse the Map entry, public MapLibre custom-layer lifecycle and existing controls.
Use a two-pass WebGL2 character effect: one metadata pixel per cell, then a local
font atlas. Geographic pixels stay on the GPU; there is no readback or preserved
drawing buffer. A page-specific Canvas2D character renderer translates the existing packet
animation canvas into Braille or ASCII cells and places readable labels. It does not create another feed,
packet clock, topology model or geographic dataset. Historical routes stay still;
live motion and audio retain their existing scheduling. The original scene owns
hit testing, terrain, buildings, region assignments, pan, zoom and Follow.

Draw readable geographic/node labels over the character grid. Preserve Find,
inspection, route windows, layer combinations, region legend, Follow, sound and
optional 3D. Keep palette, glyph mode and cell size in a separate device preference.
Do not overwrite the user's Map/Netgraph style. Keep attribution visible. If
canvas readback fails, restore the ordinary map and offer a compact retry notice.
Pause background work when hidden and release all listeners on navigation.

The built Terminal document reuses the Map HTML and loads its own entry before Map;
explicit chunk boundaries keep Terminal dependencies out of other entries. No copied control
markup or new renderer framework. Terminal assets load only on its own URL.
Existing UI, worker, privacy and performance caps remain. Budget the optional
Terminal JS/CSS separately at 8 KiB gzip, with a browser assertion that other
views never download it. No new dependencies or public API fields.

## Delivery

1. Implement paired Canada/Worldwide frontend changes, navigation and tests.
2. Check synthetic geographic scenes, readable character output, live/quiet
   timing, all layer controls, selection, missing tiles, camera changes, reduced
   motion, storage failure, mobile bounds and the 7,000-route fixture in Actions.
3. Update Canada Android link/start-view restoration without changing signing
   identity. Use emulator validation; physical testing remains optional per the
   user's release instruction. Do not operate a disconnected user phone.
4. Review passing PRs and promote the exact tested images. Publish Canada 0.17.0,
   Worldwide 0.8.0 and Android 1.1.2 if its signed candidate passes verification.
5. Verify Canada's live target, encrypted off-host backup and isolated restore;
   deploy the tested digest and verify public views, traffic, checkpoint writes
   and at least five minutes of health. Update install/release and product links.

## Deliberate limits

This is a browser TUI, not a terminal emulator or remote shell. Character cells
quantize detail; several close nodes/routes may occupy a cell. Zoom, Find and
inspection retain access to the underlying data. Terrain and buildings are
character shading, not new claims about radio height or propagation. No historical
traffic is replayed as live activity. MapLibre still requires graphics support;
Netgraph remains available when the basemap cannot initialize.
