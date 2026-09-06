# Map appearance and Live Follow

The toolbar keeps Live Follow, Find, Map, Sound and Home within reach. Map opens a compact, scrollable menu on desktop, tablet and phone. Click outside it, press Escape or use its close button to return to the map. Escape restores keyboard focus to the menu button.

Choose Night, Daylight or Streets. These are CartoLite vector styles using the existing CARTO streets tiles and authorization. Colours update in place: the camera, live feed, route sources, terrain, selection and layer choices stay alive. Interface colours can match the map or remain light or dark. Satellite imagery is not bundled because it requires a separately authorized provider; this release introduces no extra map account, external style URL or tile credential.

The menu includes route, heatmap, cluster, Topo, 3D, place-label, node-label, road and live-packet toggles. Route strength and Topo relief have independent sliders. Turning off live packets also pauses their sounds. Display choices stay in this browser; Restore display defaults resets them without losing the current camera view. Turning on 3D still enables Topo automatically.

Wide-zoom history now uses exact GPU line segments at every flat-map zoom. The previous fixed-resolution texture enlarged and softened those lines as the camera moved. Removing that texture also removes its canvas allocation and rebuild work. Live residue gets narrower and quieter at wide zooms; terrain routes retain native MapLibre draping. These lines visualize confirmed hops, not propagation or mountain occlusion.

Live Follow holds each packet for ten seconds. A small card shows its public node labels, sanitized packet kind, confirmed hop count and countdown. Observer-only packets say “heard here”; they do not acquire an inferred route. New traffic is queued during the hold, with nearby traffic preferred. Camera transitions are gradual, preserve 3D orientation and avoid further movement when the packet already fits. The starting zoom is retained as the detail limit so repeated long routes cannot permanently ratchet the camera outward.

Dragging, zooming, rotating, inspecting a node or hiding the tab pauses follow. Resume starts with fresh activity. Closing the card stops follow. When the ten-second hold ends with no replacement, the card and its map highlight clear and wait for a new packet instead of retaining stale activity. The card does not display packet IDs, keys, paths, messages or resolver details.

Validation uses synthetic fixtures in GitHub Actions: saved settings, keyboard controls, menu bounds, theme changes, route geometry, a ten-second countdown under incoming traffic, pause/resume, terrain and worldwide date-line regressions. Existing performance and privacy budgets remain in place.

References: [CARTO vector basemaps and authorization](https://carto.com/basemaps/apikey/), [MapLibre layer properties](https://maplibre.org/maplibre-style-spec/layers/), [MapLibre camera options](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/CameraForBoundsOptions/).
