# Map, Netgraph, and display settings

Map keeps its everyday controls in the toolbar. Open **Map** for layers, appearance and camera settings. Netgraph has a matching **Display** menu. Menus scroll within the viewport; Escape closes them and returns keyboard focus to their button.

## Shared appearance

Night, Daylight and Streets remain available on Map. Netgraph uses the matching Night, Daylight and warm Paper backgrounds. One browser-local profile carries the scene, interface theme and route styling between both pages, including already-open tabs. Each view keeps its own camera/layout, and changing appearance preserves the current selection and live feed. Interface panels may follow the scene or stay explicitly light/dark. Packet and node ink follows the actual scene background.

Choose **Crisp**, **Neon**, **Dashed**, **Dotted**, **Ribbon** or **Comet**. Crisp is the default, with clear strokes and restrained glow. **Advanced route styling** controls pattern, width, opacity, glow, packet size, trail length and after-trail duration (0–45 seconds). Editing a slider selects Custom. The preview is silent. Reset route styling restores Crisp; the map’s full display reset also restores its layer choices without erasing sound preferences or the camera location.

Dense overview maps automatically reduce decorative glow and casings while preserving every route, line width and pattern. Historical paths remain still. Only received live packets drive motion and sound. Line strokes stay sharp as the map zooms, and colors distinguish the same sanitized packet categories in every scene. Labels remain readable as nodes age; node appearance and the inspector still communicate freshness.

## Buildings and terrain

**Buildings** shows mapped footprints at neighborhood zoom. Desktop 3D introduces height where the source provides it, respecting buildings that should not be extruded. Building heights are approximate map data, not radio or antenna heights.

Entering **3D** enables **Topo** and **Buildings**; either can then be switched off independently. Returning to 2D retains building footprints if Buildings remains enabled. Desktop camera settings offer a compass/reset north, pitch and terrain-height adjustment. New 3D views start near 50° pitch and 1× terrain height. Desktop orientation is remembered. Phones keep their existing optional terrain mode and fast 2D defaults; detailed camera controls and extrusions target the desktop layout.

Topo shading and terrain height have separate controls. Shading becomes gentler at close urban zooms. Packet paths and ground rings follow the terrain/camera projection; bounded adaptive sampling keeps travel timing independent of sample spacing. Paths remain readable through hills and buildings. Terrain and building data do not establish radio coverage, obstruction or line of sight.

## Live Follow

Live Follow holds each activity for ten seconds. Its card shows public node labels, sanitized packet kind, confirmed hop count and countdown. Observer-only activity says “heard here” and gains no inferred route. New traffic queues during the hold, with nearby activity preferred. Camera moves remain gradual and preserve 3D orientation.

Dragging, zooming, rotating, inspecting a node or hiding the tab pauses follow. Resume starts with fresh activity. When no replacement arrives, the card clears and waits. Closing it stops follow. No packet IDs, keys, messages or resolver details appear in the card.

## Availability and validation

A map notice explains unavailable tile details and offers Retry; traffic data and Netgraph remain usable independently. Display settings are optional browser-local storage. No accounts, analytics or server-side preference database are added.

Synthetic Actions checks cover themes, presets, storage migration and cross-tab updates, keyboard/menu behavior, actual building pixels, terrain/date-line projection, route/packet visibility, bounded performance and the public privacy contract.

OpenFreeMap supplies the default geography and building layer. Optional CARTO configuration is described in [Deployment](deployment.md). Netgraph areas remain coordinate-derived global grid squares.
