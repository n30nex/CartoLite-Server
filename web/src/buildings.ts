import type { Map as MapLibreMap } from 'maplibre-gl';

export const BUILDING_SOURCE = 'building-tiles';
export const BUILDING_FOOTPRINTS = 'building-footprints';
export const BUILDING_EXTRUSIONS = 'building-extrusions';
export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';

export function updateBuildings(map: MapLibreMap, visible: boolean, terrain: boolean, desktop: boolean, light: boolean, existingSource?: string): void {
  if (!visible && !map.getLayer(BUILDING_FOOTPRINTS)) return;
  const source = existingSource ?? BUILDING_SOURCE;
  if (!map.getSource(source)) map.addSource(source, { type: 'vector', url: OPENFREEMAP_TILEJSON });
  const before = map.getLayer('basemap-water-labels') ? 'basemap-water-labels' : undefined;
  if (!map.getLayer(BUILDING_FOOTPRINTS)) map.addLayer({
    id: BUILDING_FOOTPRINTS, source, 'source-layer': 'building', type: 'fill', minzoom: 13,
    paint: { 'fill-color': '#405b61', 'fill-opacity': 0.3 },
  }, before);
  if (!map.getLayer(BUILDING_EXTRUSIONS)) map.addLayer({
    id: BUILDING_EXTRUSIONS, source, 'source-layer': 'building', type: 'fill-extrusion', minzoom: 13,
    filter: ['all', ['!=', ['get', 'hide_3d'], true], ['>', ['number', ['get', 'render_height'], 0], 0]],
    paint: {
      'fill-extrusion-color': '#506c73',
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, ['max', 0, ['number', ['get', 'render_height'], 0]]],
      'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, ['max', 0, ['min', ['number', ['get', 'render_min_height'], 0], ['number', ['get', 'render_height'], 0]]]],
      'fill-extrusion-opacity': 0.78,
      'fill-extrusion-vertical-gradient': true,
    },
  }, before);
  map.setLayoutProperty(BUILDING_FOOTPRINTS, 'visibility', visible ? 'visible' : 'none');
  map.setLayoutProperty(BUILDING_EXTRUSIONS, 'visibility', visible && terrain && desktop ? 'visible' : 'none');
  map.setPaintProperty(BUILDING_FOOTPRINTS, 'fill-color', light ? '#a8b8b2' : '#405b61');
  map.setPaintProperty(BUILDING_EXTRUSIONS, 'fill-extrusion-color', light ? '#bbc9c1' : '#506c73');
}
