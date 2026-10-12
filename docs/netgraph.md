# Worldwide Netgraph

Open `/netgraph/` from the map toolbar to see the same sanitized live feed as a stable topology diagram. Every connected node remains available; the selected time window controls visible historical links. The default is 15 minutes, and explicit window choices stay local to the browser.

Nodes are grouped by four-character Maidenhead grid squares, each two degrees of longitude by one degree of latitude. The area title shows the square code and its centre coordinates. This standard worldwide radio locator comes directly from public node coordinates: there is no country registry, geocoding service, or new backend field. These are display groups, not political boundaries or coverage predictions. See [ARRL's worldwide grid description](https://www.arrl.org/international-grid-chase-2018).

Live packets retain their hop order, protocol colours and synchronized sound. Matching packets receive bounded emphasis while a node is inspected. Area cues show LOCAL traffic or paired OUT/IN activity; DX identifies qualifying long-distance inter-area traffic. Other traffic remains visible and every visible hop keeps its musical note.

Use mouse/wheel, native touch gestures, or the zoom buttons. Reset fits the whole topology, including networks spanning continents. Finder supports Up/Down, Enter and Escape. On slower renderers, secondary decoration and compositing adapt to measured frame cost without dropping live hops or hiding topology. Reduced motion retains stable cues and fading residue.

### Arrange and filter regions

In Netgraph, open **Display → Region layout** to spread region centres from 100% to
400%. Drag a region label to move its whole bubble, or choose a region and use
the arrow buttons. **Reset region layout** restores the geographic arrangement.
Nodes keep their positions inside each bubble; routes and live packets follow
when the bubble moves. These controls change the diagram, not reported locations.

Use **Regions** to search IATA/region codes or names and select multiple regions.
**None** followed by one checkbox isolates a region; **All** restores the full mesh.
Only connections with both endpoints in the selected regions are shown. Search
and Follow respect this selection. Use **Routes** to hide standing connections;
live packets still illuminate their paths and leave a brief fading trace.
Layout, region choices and route visibility are remembered in this browser.
