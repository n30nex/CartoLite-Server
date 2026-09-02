import { describe, expect, it, vi } from 'vitest';
import type { Feature, LineString } from 'geojson';
import type { NodeV2, RouteV2 } from './types';
import { NEIGHBOR_ROUTE_RECENT_MS, recentNeighborRoutes } from './routeFocus';
import {
  activityHeatCollection,
  applyClusterHighlightFilter,
  applyClusterVisibility,
  applyHeatmapFocus,
  applyNodeFocus,
  applyNeighborRingVisibility,
  applyRouteHoverFilter,
  applyRouteHitLayerVisibility,
  applyRouteSelectionFilter,
  applyRouteVisibilityForZoom,
  applySelectedNodeFilter,
  canMoveLiveFollow,
  CLUSTER_LAYER_IDS,
  CLUSTER_HIGHLIGHT_LAYER_ID,
  dominantHeatKind,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  effectiveRouteWindowMS,
  HEAT_RENDER_BUDGET,
  HEATMAP_LAYER_IDS,
  isRouteInspectable,
  isPointInSafeArea,
  labelSortKey,
  LIVE_FOLLOW_MIN_INTERVAL_MS,
  mapPixelRatio,
  mapGlyphLabel,
  neighborNodeIDs,
  NEIGHBOR_NODE_LAYER_ID,
  NODE_HIT_LAYER_ID,
  neighborRouteFilter,
  nodeIDFilter,
  nodeLabelPriority,
  packetEndpoints,
  packetMatchesFollow,
  ROUTE_FILTER_LAYER_IDS,
  ROUTE_HOVER_LAYER_IDS,
  ROUTE_HIT_LAYER_ID,
  routeCollection,
  routeColorExpression,
  routeExactBandFilter,
  routeHydrationDelay,
  routeRenderCandidates,
  routeRepresentationForZoom,
  routeTrunkFilter,
  routeTrunkFeaturesForWindow,
  routeVisualCollection,
  routeVisualProperties,
  routeWindowBand,
  routeWindowLabel,
  SELECTED_NODE_OUTER_LAYER_ID,
  SELECTED_NODE_LAYER_ID,
  selectedNodeFilter,
  tooltipPosition
} from './map';
import { PACKET_KIND_COLORS, PACKET_KINDS, ROUTE_MAX_AGE_MS } from './trafficVisuals';

describe('worldwide map defaults', () => {
  it('starts from a global Web Mercator view', () => {
    expect(DEFAULT_CENTER).toEqual([0, 20]);
    expect(DEFAULT_ZOOM).toBe(1.4);
  });
});

describe('map glyph labels', () => {
  it('keeps readable text while removing glyph-server-hostile emoji ranges', () => {
    expect(mapGlyphLabel('🐺 Radio Côte-d’Or 📡')).toBe('Radio Côte-d’Or');
    expect(mapGlyphLabel('Краб Node')).toBe('Краб Node');
    expect(mapGlyphLabel('🦀📻')).toBe('MeshCore node');
  });
});

describe('route layer visibility', () => {
  it('keeps individual routes active at every zoom', () => {
    const layerIDs = [
      'route-national-glow', 'route-national-core',
      'route-regional-glow', 'route-regional-core',
      'route-focus-glow', 'route-focus-core'
    ];
    const visibility = Object.fromEntries(layerIDs.map((id) => [id, 'none']));
    const setLayoutProperty = vi.fn((id: string, _name: string, value: string) => { visibility[id] = value; });
    const map = {
      getLayer: vi.fn((id: string) => layerIDs.includes(id) ? {} : undefined),
      getLayoutProperty: vi.fn((id: string) => visibility[id]),
      setLayoutProperty
    } as unknown as Parameters<typeof applyRouteVisibilityForZoom>[0];

    expect(applyRouteVisibilityForZoom(map, true, ROUTE_MAX_AGE_MS, 3.4)).toBe(true);
    expect(applyRouteVisibilityForZoom(map, true, ROUTE_MAX_AGE_MS, 3.4)).toBe(false);
    expect(setLayoutProperty).toHaveBeenCalledTimes(2);
    expect(setLayoutProperty.mock.calls).toContainEqual(['route-focus-core', 'visibility', 'visible']);
    expect(setLayoutProperty.mock.calls).not.toContainEqual(['route-national-core', 'visibility', 'visible']);

    setLayoutProperty.mockClear();
    expect(applyRouteVisibilityForZoom(map, true, ROUTE_MAX_AGE_MS, 8)).toBe(false);
    expect(setLayoutProperty).not.toHaveBeenCalled();

    expect(applyRouteVisibilityForZoom(map, false, ROUTE_MAX_AGE_MS, 3.4)).toBe(true);
    expect(visibility['route-focus-glow']).toBe('none');
    expect(visibility['route-focus-core']).toBe('none');
  });


  it('switches compact-trunk metrics without changing trunk geometry', () => {
    const geometry: LineString = { type: 'LineString', coordinates: [[-80, 43], [-79, 44]] };
    const trunk: Feature<LineString> = {
      type: 'Feature',
      id: 'trunk:test',
      geometry,
      properties: {
        routeCount: 99,
        routeCount1h: 12,
        color1h: '#abcdef',
        lastHeard1h: 1234,
        width1h: 2.5,
        glowWidth1h: 4.5,
        opacity1h: 0.6
      }
    };
    const selected = routeTrunkFeaturesForWindow([trunk], 60 * 60_000)[0]!;

    expect(selected.geometry).toBe(geometry);
    expect(selected.properties).toMatchObject({
      routeCount: 12,
      color: '#abcdef',
      lastHeard: 1234,
      width: 2.5,
      glowWidth: 4.5,
      opacity: 0.6
    });
    expect(trunk.properties?.routeCount).toBe(99);
  });

  it('shows the wide route hit target only while neighbor routes are interactive', () => {
    const setLayoutProperty = vi.fn();
    const map = {
      getLayer: vi.fn(() => ({})),
      setLayoutProperty
    } as unknown as Parameters<typeof applyRouteHitLayerVisibility>[0];

    expect(applyRouteHitLayerVisibility(map, true)).toBe(true);
    expect(applyRouteHitLayerVisibility(map, false)).toBe(true);
    expect(setLayoutProperty.mock.calls).toEqual([
      [ROUTE_HIT_LAYER_ID, 'visibility', 'visible'],
      [ROUTE_HIT_LAYER_ID, 'visibility', 'none']
    ]);
  });

  it('keeps recent-neighbor rings in lockstep with the Routes toggle', () => {
    const setLayoutProperty = vi.fn();
    const map = {
      getLayer: vi.fn(() => ({})),
      setLayoutProperty
    } as unknown as Parameters<typeof applyNeighborRingVisibility>[0];

    expect(applyNeighborRingVisibility(map, true)).toBe(true);
    expect(applyNeighborRingVisibility(map, false)).toBe(true);
    expect(setLayoutProperty.mock.calls).toEqual([
      [NEIGHBOR_NODE_LAYER_ID, 'visibility', 'visible'],
      [NEIGHBOR_NODE_LAYER_ID, 'visibility', 'none']
    ]);
  });
});

describe('map rendering budget', () => {
  it('caps high-density phone rendering while keeping desktop maps crisp', () => {
    expect(mapPixelRatio(3, true)).toBe(1.5);
    expect(mapPixelRatio(3, false)).toBe(2);
    expect(mapPixelRatio(1.25, true)).toBe(1.25);
    expect(mapPixelRatio(Number.NaN, false)).toBe(1);
  });

  it('coalesces busy historical-route refreshes without delaying the first build', () => {
    expect(routeHydrationDelay(1_000, 1_250)).toBe(7_750);
    expect(routeHydrationDelay(1_000, 9_000)).toBe(0);
    expect(routeHydrationDelay(1_000, 10_500)).toBe(0);
  });
});

describe('optional map layers', () => {
  it('filters heat to the selected node neighborhood and clears on deselect', () => {
    const setFilter = vi.fn();
    const map = {
      getLayer: vi.fn(() => ({})),
      setFilter
    } as unknown as Parameters<typeof applyHeatmapFocus>[0];

    expect(applyHeatmapFocus(map, ['selected', 'neighbor'])).toBe(true);
    expect(setFilter.mock.calls).toEqual(HEATMAP_LAYER_IDS.map((layerID, index) => [
      layerID,
      ['all', ['==', ['get', 'kind'], PACKET_KINDS[index]], nodeIDFilter(['selected', 'neighbor'])]
    ]));
    setFilter.mockClear();
    expect(applyHeatmapFocus(map, [])).toBe(true);
    expect(setFilter.mock.calls).toEqual(HEATMAP_LAYER_IDS.map((layerID, index) => [
      layerID,
      ['==', ['get', 'kind'], PACKET_KINDS[index]]
    ]));
  });

  it('can disable clusters while exposing individual nodes at national zoom', () => {
    const visibility = Object.fromEntries(CLUSTER_LAYER_IDS.map((id) => [id, 'visible']));
    const nodeLayerIDs = ['nodes-glow', NEIGHBOR_NODE_LAYER_ID, SELECTED_NODE_OUTER_LAYER_ID,
      SELECTED_NODE_LAYER_ID, 'nodes', 'node-core', NODE_HIT_LAYER_ID];
    const setLayoutProperty = vi.fn((id: string, _name: string, value: string) => { visibility[id] = value; });
    const setLayerZoomRange = vi.fn();
    const map = {
      getLayer: vi.fn((id: string) => [...CLUSTER_LAYER_IDS, ...nodeLayerIDs].includes(id) ? {} : undefined),
      getLayoutProperty: vi.fn((id: string) => visibility[id]),
      setLayoutProperty,
      setLayerZoomRange,
    } as unknown as Parameters<typeof applyClusterVisibility>[0];

    expect(applyClusterVisibility(map, false)).toBe(true);
    expect(setLayoutProperty.mock.calls).toEqual(CLUSTER_LAYER_IDS.map((id) => [id, 'visibility', 'none']));
    expect(setLayerZoomRange.mock.calls).toEqual(nodeLayerIDs.map((id) => [id, 3, 24]));

    setLayoutProperty.mockClear();
    setLayerZoomRange.mockClear();
    expect(applyClusterVisibility(map, true)).toBe(true);
    expect(setLayoutProperty.mock.calls).toEqual(CLUSTER_LAYER_IDS.map((id) => [id, 'visibility', 'visible']));
    expect(setLayerZoomRange.mock.calls.every((call) => call[1] > 8)).toBe(true);
  });
});

describe('activity heatmap data', () => {
  it('caps dense heat summaries while retaining the strongest activity', () => {
    const now = 1_900_000_000_000;
    const routes = Array.from({ length: HEAT_RENDER_BUDGET + 5 }, (_, index) => route(
      `heat-${index}`,
      `node-${String(index).padStart(4, '0')}`,
      `node-${String(index).padStart(4, '0')}`,
      now
    ));
    routes.push(route('heat-hotspot', 'z-hotspot', 'z-hotspot', now, 'Other', 64));

    const collection = heatCollectionFor(routes, now);

    expect(collection.features).toHaveLength(HEAT_RENDER_BUDGET);
    expect(collection.features.some((feature) => feature.id === 'z-hotspot')).toBe(true);
  });

  it('deduplicates route endpoints and accumulates repeated activity', () => {
    const now = 1_900_000_000_000;
    const collection = heatCollectionFor([
      route('a-b', 'a', 'b', now),
      route('a-c', 'a', 'c', now)
    ], now);

    expect(collection.features.map((feature) => feature.id)).toEqual(['a', 'b', 'c']);
    expect(heatWeight(collection, 'a')).toBeGreaterThan(heatWeight(collection, 'b'));
    expect(heatWeight(collection, 'a')).toBeGreaterThan(heatWeight(collection, 'c'));
  });

  it('colors each hotspot by its strongest recent packet kind', () => {
    const now = 1_900_000_000_000;
    const collection = heatCollectionFor([
      route('text-a', 'hub', 'text', now, 'Text', 16),
      route('advert-a', 'hub', 'advert', now, 'Advert', 2),
    ], now);
    const hub = collection.features.find((feature) => feature.id === 'hub');

    expect(hub?.properties?.kind).toBe('Text');
    expect(dominantHeatKind(new Map<RouteV2['lastKind'], number>([
      ['Advert', 1],
      ['Trace', 1],
    ]))).toBe(PACKET_KINDS[0]);
  });

  it('counts a self route once and excludes endpoints with invalid coordinates', () => {
    const now = 1_900_000_000_000;
    const invalid = route('invalid-valid', 'invalid', 'valid', now);
    const routes = [
      route('self', 'self', 'self', now),
      route('pair', 'pair-a', 'pair-b', now),
      invalid
    ];
    const nodeMap = nodesFor(routes);
    nodeMap.set('invalid', { ...nodeMap.get('invalid')!, lat: 91 });
    const collection = activityHeatCollection(routes, nodeMap, now);

    expect(heatWeight(collection, 'self')).toBe(heatWeight(collection, 'pair-a'));
    expect(collection.features.some((feature) => feature.id === 'invalid')).toBe(false);
    expect(collection.features.some((feature) => feature.id === 'valid')).toBe(true);
  });

  it('bounds every weight and expires heat activity after 24 hours', () => {
    const now = 1_900_000_000_000;
    const fresh = route('fresh', 'fresh-a', 'fresh-b', now);
    const boundary = route('boundary', 'boundary-a', 'boundary-b', now - ROUTE_MAX_AGE_MS);
    const expired = route('expired', 'expired-a', 'expired-b', now - ROUTE_MAX_AGE_MS - 1);
    const collection = heatCollectionFor([fresh, boundary, expired], now);

    for (const feature of collection.features) {
      expect(Number(feature.properties?.weight)).toBeGreaterThanOrEqual(0);
      expect(Number(feature.properties?.weight)).toBeLessThanOrEqual(1);
    }
    expect(collection.features.some((feature) => feature.id === 'boundary-a')).toBe(true);
    expect(collection.features.some((feature) => feature.id === 'expired-a')).toBe(false);
    expect(heatWeight(collection, 'fresh-a')).toBeGreaterThan(heatWeight(collection, 'boundary-a'));
  });
});

describe('stable route visual data', () => {
  it('keeps every eligible route exact while low zooms represent all of them in trunks', () => {
    const now = 1_900_000_000_000;
    const kinds: readonly RouteV2['lastKind'][] = ['Advert', 'Trace', 'Text', 'ACK', 'Control', 'Other'];
    const routes = Array.from({ length: 1_405 }, (_, index) => route(
      `bucket-${index}`,
      `from-${index % 120}`,
      `to-${(index * 17 + 23) % 120}`,
      now - (index % 5) * 4 * 60 * 60_000,
      kinds[index % kinds.length]!,
      1 + index % 64
    ));

    const candidates = routeRenderCandidates(routes, now);
    const collection = routeVisualCollection(candidates, nodesFor(routes), now);
    const exact = collection.features.filter((feature) => feature.properties?.representation === 'exact');
    const national = collection.features.filter((feature) => feature.properties?.representation === 'national');
    const regional = collection.features.filter((feature) => feature.properties?.representation === 'regional');

    expect(candidates).toHaveLength(routes.length);
    expect(exact).toHaveLength(routes.length);
    expect(new Set(exact.map((item) => item.id)).size).toBe(routes.length);
    expect(national.reduce((sum, feature) => sum + Number(feature.properties?.routeCount), 0)).toBe(routes.length);
    expect(regional.reduce((sum, feature) => sum + Number(feature.properties?.routeCount), 0)).toBe(routes.length);
    expect(national.length).toBeLessThan(exact.length);
    expect(regional.length).toBeLessThan(exact.length);
    expect(national.every((item) => Number(item.properties?.width) > 0 && Number(item.properties?.opacity) <= 1)).toBe(true);
  });

  it('never caps a selected route window and keeps its exact boundary', () => {
    const now = 1_900_000_000_000;
    const routes = Array.from({ length: 2_405 }, (_, index) => route(
      `route-${String(index).padStart(4, '0')}`,
      `from-${index}`,
      `to-${index}`,
      now - index
    ));
    routes.push(route('boundary', 'boundary-a', 'boundary-b', now - ROUTE_MAX_AGE_MS));
    routes.push(route('expired', 'expired-a', 'expired-b', now - ROUTE_MAX_AGE_MS - 1));

    const candidates = routeRenderCandidates(routes, now, ROUTE_MAX_AGE_MS);

    expect(candidates).toHaveLength(2_406);
    expect(candidates[0]?.id).toBe('boundary');
    expect(candidates.some((item) => item.id === 'route-0000')).toBe(true);
    expect(candidates.some((item) => item.id === 'route-2404')).toBe(true);
    expect(candidates.some((item) => item.id === 'expired')).toBe(false);
    expect(new Set(candidates.map((item) => item.id)).size).toBe(candidates.length);
  });

  it('returns every route in each selected age window instead of sampling', () => {
    const now = 1_900_000_000_000;
    const recent = Array.from({ length: 1_400 }, (_, index) => route(
      `recent-${index}`,
      `recent-from-${index}`,
      `recent-to-${index}`,
      now - index * 500
    ));
    const historical = Array.from({ length: 1_400 }, (_, index) => route(
      `historical-${index}`,
      `historical-from-${index}`,
      `historical-to-${index}`,
      now - 60 * 60_000 - index * 30_000
    ));

    const fifteenMinutes = routeRenderCandidates([...recent, ...historical], now, 15 * 60_000);
    const fullDay = routeRenderCandidates([...recent, ...historical], now, ROUTE_MAX_AGE_MS);

    expect(fifteenMinutes).toHaveLength(recent.length);
    expect(fullDay).toHaveLength(recent.length + historical.length);
    expect(fifteenMinutes.every((item) => now - item.lastHeard <= 15 * 60_000)).toBe(true);
    expect(fullDay.some((item) => now - item.lastHeard > 15 * 60_000)).toBe(true);
    expect(fullDay.map((item) => item.id)).toEqual(expect.arrayContaining(recent.map((item) => item.id)));
    expect(fullDay.map((item) => item.id)).toEqual(expect.arrayContaining(historical.map((item) => item.id)));
  });

  it('keeps local trunk accounting without drawing artificial same-cell loops', () => {
    const now = 1_900_000_000_000;
    const routes = [
      route('fresh', 'a', 'b', now - 5 * 60_000, 'Text', 8),
      route('historical', 'a', 'b', now - 12 * 60 * 60_000, 'Trace', 4)
    ];
    const collection = routeVisualCollection(routes, nodesFor(routes), now);
    const national = collection.features.filter((feature) => feature.properties?.representation === 'national');

    expect(national).toHaveLength(1);
    expect(national[0]?.properties).toMatchObject({
      local: true,
      routeCount15m: 1,
      routeCount1h: 1,
      routeCount6h: 1,
      routeCount24h: 2,
      routeCount: 2
    });
    const anchors = national[0]?.geometry.coordinates ?? [];
    expect(anchors.length).toBeGreaterThan(6);
    expect(anchors[0]).toEqual(anchors.at(-1));
    expect(routeTrunkFilter('national')).toEqual([
      'all',
      ['==', ['get', 'representation'], 'national'],
      ['==', ['get', 'local'], false]
    ]);
    expect(routeExactBandFilter(2)).toEqual([
      'all',
      ['==', ['get', 'representation'], 'exact'],
      ['==', ['get', 'windowBand'], 2]
    ]);
    expect(routeWindowBand(15 * 60_000)).toBe(0);
    expect(routeWindowBand(15 * 60_000 + 1)).toBe(1);
    expect(routeWindowBand(60 * 60_000 + 1)).toBe(2);
    expect(routeWindowBand(6 * 60 * 60_000 + 1)).toBe(3);
  });

  it('uses progressively wider automatic route windows as users zoom in', () => {
    expect(effectiveRouteWindowMS('auto', 4)).toBe(15 * 60_000);
    expect(effectiveRouteWindowMS('auto', 6)).toBe(60 * 60_000);
    expect(effectiveRouteWindowMS('auto', 8)).toBe(6 * 60 * 60_000);
    expect(effectiveRouteWindowMS('auto', 11)).toBe(ROUTE_MAX_AGE_MS);
    expect(routeWindowLabel('auto', 4)).toBe('Auto · 15m');
    expect(routeWindowLabel('24h', 4)).toBe('24h');
    expect(routeRepresentationForZoom(3.4)).toBe('individual-routes');
    expect(routeRepresentationForZoom(4.799)).toBe('individual-routes');
    expect(routeRepresentationForZoom(4.8)).toBe('individual-routes');
    expect(routeRepresentationForZoom(6.499)).toBe('individual-routes');
    expect(routeRepresentationForZoom(6.5)).toBe('individual-routes');
  });

  it('keeps the exact 24-hour boundary, expires older routes, and assigns trail colors', () => {
    const now = 1_900_000_000_000;
    const text = route('text', 'text-a', 'text-b', now, 'Text', 8);
    const boundary = route('boundary', 'boundary-a', 'boundary-b', now - ROUTE_MAX_AGE_MS, 'Trace', 4);
    const expired = route('expired', 'expired-a', 'expired-b', now - ROUTE_MAX_AGE_MS - 1, 'Advert', 16);
    const collection = routeCollectionFor([text, boundary, expired], now);

    expect(collection.features.map((feature) => feature.id)).toEqual(['text', 'boundary']);
    expect(collection.features.find((feature) => feature.id === 'text')?.properties).toMatchObject({
      color: PACKET_KIND_COLORS.Text,
      lastKind: 'Text',
      windowBand: 0
    });
    expect(collection.features.find((feature) => feature.id === 'boundary')?.properties).toMatchObject({
      color: PACKET_KIND_COLORS.Trace,
      lastKind: 'Trace',
      windowBand: 3
    });
    expect(routeColorExpression()).toEqual(['to-color', ['get', 'color']]);
  });

  it('keeps relative widths bounded and lets quiet routes thin naturally', () => {
    const now = 1_900_000_000_000;
    const quiet = route('quiet', 'quiet-a', 'quiet-b', now, 'Advert', 1);
    const busy = route('busy', 'busy-a', 'busy-b', now, 'ACK', 16);
    const collection = routeCollectionFor([quiet, busy], now);
    const quietProperties = collection.features.find((feature) => feature.id === 'quiet')?.properties;
    const busyProperties = collection.features.find((feature) => feature.id === 'busy')?.properties;

    expect(Number(busyProperties?.width)).toBeGreaterThan(Number(quietProperties?.width));
    expect(Number(busyProperties?.glowWidth)).toBeGreaterThan(Number(quietProperties?.glowWidth));
    for (const properties of [quietProperties, busyProperties]) {
      expect(Number(properties?.width)).toBeGreaterThanOrEqual(0.72);
      expect(Number(properties?.width)).toBeLessThanOrEqual(1.72);
      expect(Number(properties?.glowWidth)).toBeGreaterThanOrEqual(2);
      expect(Number(properties?.glowWidth)).toBeLessThanOrEqual(4.1);
    }
  });
});

describe('node neighbor focus', () => {
  it('filters the individual route hit source to recent edges touching the selected node', () => {
    const setFilter = vi.fn();
    const map = {
      getLayer: vi.fn(() => ({})),
      setFilter
    } as unknown as Parameters<typeof applyRouteSelectionFilter>[0];
    const expected = neighborRouteFilter('node-a');

    expect(applyRouteSelectionFilter(map, 'node-a')).toBe(true);
    expect(setFilter.mock.calls).toEqual(ROUTE_FILTER_LAYER_IDS.map((layerID) => [layerID, expected]));

    setFilter.mockClear();
    expect(applyRouteSelectionFilter(map, null)).toBe(true);
    expect(setFilter.mock.calls).toEqual([[ROUTE_HIT_LAYER_ID, null]]);
  });

  it('highlights only the selected node and safely skips a missing layer', () => {
    const setFilter = vi.fn();
    const present = {
      getLayer: vi.fn(() => ({})),
      setFilter
    } as unknown as Parameters<typeof applySelectedNodeFilter>[0];

    expect(applySelectedNodeFilter(present, 'node-b')).toBe(true);
    expect(setFilter.mock.calls).toEqual([
      [SELECTED_NODE_OUTER_LAYER_ID, selectedNodeFilter('node-b')],
      [SELECTED_NODE_LAYER_ID, selectedNodeFilter('node-b')]
    ]);

    const missing = {
      getLayer: vi.fn(() => undefined),
      setFilter: vi.fn()
    } as unknown as Parameters<typeof applySelectedNodeFilter>[0];
    expect(applySelectedNodeFilter(missing, 'node-b')).toBe(false);
    expect(missing.setFilter).not.toHaveBeenCalled();
  });

  it('keeps both route directions at the 24-hour boundary and excludes stale or unrelated edges', () => {
    const now = 1_900_000_000_000;
    const routes: RouteV2[] = [
      route('a-b', 'a', 'b', now),
      route('c-a', 'c', 'a', now - NEIGHBOR_ROUTE_RECENT_MS),
      route('a-d-stale', 'a', 'd', now - NEIGHBOR_ROUTE_RECENT_MS - 1),
      route('b-c', 'b', 'c', now)
    ];

    expect(recentNeighborRoutes(routes, 'a', now).map((item) => item.id)).toEqual(['a-b', 'c-a']);
    expect(recentNeighborRoutes(routes, 'a', now, 15 * 60_000).map((item) => item.id)).toEqual(['a-b']);
    expect(recentNeighborRoutes(routes, null, now)).toEqual([]);
    expect(isRouteInspectable(routes, 'a', 'a-b', now)).toBe(true);
    expect(isRouteInspectable(routes, 'a', 'a-d-stale', now)).toBe(false);
    expect(isRouteInspectable(routes, 'a', 'b-c', now)).toBe(false);
    expect(isRouteInspectable(routes, 'a', 'c-a', now, 15 * 60_000)).toBe(false);
  });

  it('deduplicates and sorts the neighbor node IDs without including the selected node', () => {
    const now = 1_900_000_000_000;
    const routes = [
      route('a-c', 'a', 'c', now),
      route('b-a', 'b', 'a', now),
      route('a-b', 'a', 'b', now),
      route('a-a', 'a', 'a', now)
    ];

    expect(neighborNodeIDs(routes, 'a')).toEqual(['b', 'c']);
    expect(neighborNodeIDs(routes, null)).toEqual([]);
  });

  it('dims context nodes, limits labels and glow, and prioritizes the selected label', () => {
    const setFilter = vi.fn();
    const setPaintProperty = vi.fn();
    const setLayoutProperty = vi.fn();
    const map = {
      getLayer: vi.fn(() => ({})),
      setFilter,
      setPaintProperty,
      setLayoutProperty
    } as unknown as Parameters<typeof applyNodeFocus>[0];

    expect(applyNodeFocus(map, 'a', ['a', 'b'], ['b'])).toBe(true);
    expect(setFilter).toHaveBeenCalledWith('nodes-glow', nodeIDFilter(['a', 'b']));
    expect(setFilter).toHaveBeenCalledWith(NEIGHBOR_NODE_LAYER_ID, nodeIDFilter(['b']));
    expect(setFilter).toHaveBeenCalledWith('node-labels', nodeIDFilter(['a', 'b']));
    expect(setLayoutProperty).toHaveBeenCalledWith('node-labels', 'symbol-sort-key', labelSortKey('a', ['b']));
    expect(setPaintProperty).toHaveBeenCalledWith('nodes', 'circle-opacity', expect.any(Array));
    expect(setPaintProperty).toHaveBeenCalledWith('node-core', 'circle-opacity', expect.any(Array));
  });

  it('adds and clears the filtered route spotlight without touching source data', () => {
    const setFilter = vi.fn();
    const setLayoutProperty = vi.fn();
    const map = {
      getLayer: vi.fn(() => ({})),
      setFilter,
      setLayoutProperty
    } as unknown as Parameters<typeof applyRouteHoverFilter>[0];

    expect(applyRouteHoverFilter(map, 'route-a')).toBe(true);
    expect(setFilter.mock.calls).toEqual(ROUTE_HOVER_LAYER_IDS.map((layerID) => [layerID, ['==', ['get', 'id'], 'route-a']]));
    expect(setLayoutProperty.mock.calls).toEqual(ROUTE_HOVER_LAYER_IDS.map((layerID) => [layerID, 'visibility', 'visible']));

    setFilter.mockClear();
    setLayoutProperty.mockClear();
    applyRouteHoverFilter(map, null);
    expect(setLayoutProperty.mock.calls).toEqual(ROUTE_HOVER_LAYER_IDS.map((layerID) => [layerID, 'visibility', 'none']));
  });

  it('targets one cluster for hover polish and clears it with an impossible ID', () => {
    const setFilter = vi.fn();
    const map = {
      getLayer: vi.fn(() => ({})),
      setFilter
    } as unknown as Parameters<typeof applyClusterHighlightFilter>[0];

    expect(applyClusterHighlightFilter(map, 42)).toBe(true);
    expect(applyClusterHighlightFilter(map, null)).toBe(true);
    expect(setFilter.mock.calls).toEqual([
      [CLUSTER_HIGHLIGHT_LAYER_ID, ['==', ['get', 'cluster_id'], 42]],
      [CLUSTER_HIGHLIGHT_LAYER_ID, ['==', ['get', 'cluster_id'], -1]]
    ]);
  });
});

describe('visual hierarchy and soft follow', () => {
  it('keeps tooltips inside the viewport near every edge', () => {
    const viewport = { width: 360, height: 640 };
    const tooltip = { width: 180, height: 54 };
    expect(tooltipPosition({ x: 2, y: 2 }, viewport, tooltip)).toEqual({ x: 98, y: 14 });
    expect(tooltipPosition({ x: 358, y: 638 }, viewport, tooltip)).toEqual({ x: 262, y: 572 });
  });

  it('defines a dedicated enlarged node hit target', () => {
    expect(NODE_HIT_LAYER_ID).toBe('node-hit');
  });

  it('keeps only the central 60 percent inside the safe area', () => {
    const viewport = { width: 1_000, height: 500 };
    expect(isPointInSafeArea({ x: 200, y: 100 }, viewport)).toBe(true);
    expect(isPointInSafeArea({ x: 800, y: 400 }, viewport)).toBe(true);
    expect(isPointInSafeArea({ x: 199, y: 250 }, viewport)).toBe(false);
    expect(isPointInSafeArea({ x: 500, y: 401 }, viewport)).toBe(false);
    expect(isPointInSafeArea({ x: 0, y: 0 }, { width: 0, height: 0 })).toBe(false);
  });

  it('holds each live-follow view for five seconds', () => {
    expect(canMoveLiveFollow(0, 100)).toBe(true);
    expect(canMoveLiveFollow(10_000, 10_000 + LIVE_FOLLOW_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(canMoveLiveFollow(10_000, 10_000 + LIVE_FOLLOW_MIN_INTERVAL_MS)).toBe(true);
  });

  it('frames the complete route for cinematic follow without duplicating relays', () => {
    const alpha = { id: 'a', label: 'Alpha', lat: 43.6, lng: -79.4 };
    const bravo = { id: 'b', label: 'Bravo', lat: 44.1, lng: -78.8 };
    const charlie = { id: 'c', label: 'Charlie', lat: 45.2, lng: -77.5 };
    const endpoints = packetEndpoints({
      seq: 1,
      id: 'cinematic-route',
      at: 1,
      payloadType: 'Trace',
      mode: 'route',
      segments: [
        { routeId: 'a-b', from: alpha, to: bravo },
        { routeId: 'b-c', from: bravo, to: charlie },
      ],
    });

    expect(endpoints.map((endpoint) => endpoint.id)).toEqual(['a', 'b', 'c']);
    expect(packetEndpoints({
      seq: 2,
      id: 'observer',
      at: 2,
      payloadType: 'Advert',
      mode: 'observer',
      observer: alpha,
    })).toEqual([alpha]);
  });

  it('follows valid off-screen activity and narrows to a selected node when focused', () => {
    const alpha = { id: 'a', label: 'Alpha', lat: 43.6, lng: -79.4 };
    const bravo = { id: 'b', label: 'Bravo', lat: 49.2, lng: -123.1 };
    const packet = {
      seq: 3,
      id: 'off-screen-route',
      at: 3,
      payloadType: 'Trace' as const,
      mode: 'route' as const,
      segments: [{ routeId: 'a-b', from: alpha, to: bravo }]
    };

    expect(packetMatchesFollow(packet, null)).toBe(true);
    expect(packetMatchesFollow(packet, 'a')).toBe(true);
    expect(packetMatchesFollow(packet, 'elsewhere')).toBe(false);
  });

  it('uses decaying traffic for width while route age controls brightness', () => {
    const now = 1_900_000_000_000;
    const quiet = routeVisualProperties({ traffic: 0, lastHeard: now }, now, 1);
    const active = routeVisualProperties({ traffic: 64, lastHeard: now }, now, 1);
    const old = routeVisualProperties({ traffic: 64, lastHeard: now - 60 * 60_000 }, now, 1);

    expect(active.width).toBeGreaterThan(quiet.width);
    expect(active.glowWidth).toBeGreaterThan(quiet.glowWidth);
    expect(active.opacity).toBeGreaterThan(old.opacity);
    expect(active.width).toBeLessThanOrEqual(1.72);
    expect(active.glowWidth).toBeLessThanOrEqual(4.1);
    expect(old.width).toBeLessThan(active.width);
    expect(old.glowWidth).toBeLessThan(active.glowWidth);
    for (const visual of [quiet, active, old]) {
      expect(visual.trafficLevel).toBeGreaterThanOrEqual(0);
      expect(visual.trafficLevel).toBeLessThanOrEqual(1);
      expect(visual.opacity).toBeGreaterThanOrEqual(0);
      expect(visual.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('prioritizes fresh observers and repeaters over stale leaf nodes', () => {
    const now = 1_900_000_000_000;
    const observer = nodeLabelPriority({ role: 'companion', observer: true, lastSeen: now }, now);
    const repeater = nodeLabelPriority({ role: 'repeater', observer: false, lastSeen: now }, now);
    const stale = nodeLabelPriority({ role: 'unknown', observer: false, lastSeen: now - 48 * 60 * 60_000 }, now);

    expect(observer).toBeLessThan(repeater);
    expect(repeater).toBeLessThan(stale);
  });
});

function route(
  id: string,
  from: string,
  to: string,
  lastHeard: number,
  lastKind: RouteV2['lastKind'] = 'Other',
  traffic = 1
): RouteV2 {
  return {
    id,
    fromId: from,
    toId: to,
    packetCount: 1,
    lastHeard,
    intensity: 1,
    lastKind,
    traffic
  };
}

function nodesFor(routes: readonly RouteV2[]): Map<string, NodeV2> {
  const ids = [...new Set(routes.flatMap((item) => [item.fromId, item.toId]))].sort();
  return new Map(ids.map((id, index) => [id, {
    id,
    label: id.toUpperCase(),
    lat: 43.45 + index * 0.01,
    lng: -80.35 + index * 0.01,
    role: 'repeater' as const,
    observer: false,
    lastSeen: 1_900_000_000_000
  }]));
}

function heatCollectionFor(routes: readonly RouteV2[], now: number): ReturnType<typeof activityHeatCollection> {
  return activityHeatCollection(routes, nodesFor(routes), now);
}

function routeCollectionFor(routes: readonly RouteV2[], now: number): ReturnType<typeof routeCollection> {
  return routeCollection(routes, nodesFor(routes), now);
}

function heatWeight(collection: ReturnType<typeof activityHeatCollection>, id: string): number {
  const feature = collection.features.find((item) => item.id === id);
  if (!feature) throw new Error(`missing heat feature ${id}`);
  return Number(feature.properties?.weight);
}
