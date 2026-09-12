import { describe, expect, it, vi } from 'vitest';
import { longitudeDelta, routeCoordinate, splitWorldRoute } from './worldGeometry';
import { surfacePathPoint, surfaceTrail, TerrainProjector, traceSurfacePath } from './terrainProjection';
import { routeSoundPlan } from './audio';
import { historicalRouteVertices, STROKE_VERTEX_FLOATS } from './routeLayer';
import type { RoutePacketView } from './types';

describe('worldwide routes at the date line', () => {
  const packet: RoutePacketView = {
    seq: 1, id: 'world-seam', at: 1, mode: 'route', payloadType: 'Text',
    segments: [{ routeId: 'seam', from: { id: 'east', label: 'East', lng: 179, lat: 0 }, to: { id: 'west', label: 'West', lng: -179, lat: 0 } }],
  };

  it('keeps geographic interpolation on the short confirmed hop', () => {
    expect(longitudeDelta(179, -179)).toBe(2);
    expect(longitudeDelta(-179, 179)).toBe(-2);
    expect(routeCoordinate([179, 0], [-179, 0], 0.5)[0]).toBe(180);
    expect(splitWorldRoute([179, 0], [-179, 0])).toEqual([[[179, 0], [180, expect.closeTo(0)]], [[-180, expect.closeTo(0)], [-179, 0]]]);
  });

  it('breaks the canvas stroke at the seam without sweeping over Greenwich', () => {
    const projector = new TerrainProjector({ project: ([lng, lat]) => ({ x: lng + 180, y: lat + 50 }) });
    const path = projector.projectSegment(packet.segments[0]!);
    expect(path.filter((point) => point.breakBefore)).toHaveLength(1);
    expect(surfacePathPoint(path, 0.49).x).toBeGreaterThan(359);
    expect(surfacePathPoint(path, 0.51).x).toBeLessThan(1);
    expect(surfaceTrail(path, 0.6, 46).every((point) => point.x < 1)).toBe(true);
    const context = { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn() };
    traceSurfacePath(context as unknown as CanvasRenderingContext2D, path);
    expect(context.moveTo).toHaveBeenCalledTimes(2);
    expect(surfaceTrail(path, 0.6, Infinity).some((point) => point.breakBefore)).toBe(true);
  });

  it('keeps one sound per hop and never admits an off-screen seam jump', () => {
    const visible = new TerrainProjector({ project: ([lng, lat]) => ({ x: lng + 180, y: lat + 50 }) });
    const greenwich = new TerrainProjector({ project: ([lng, lat]) => ({ x: lng + 50, y: lat + 50 }) });
    expect(routeSoundPlan(packet, visible, 360, 100)).toHaveLength(1);
    expect(routeSoundPlan(packet, greenwich, 100, 100)).toEqual([]);
  });

  it('keeps historical route vertices at the two map edges', () => {
    const vertices = historicalRouteVertices([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[179, 0], [181, 0]] } }]);
    expect(vertices.length).toBe(12 * STROKE_VERTEX_FLOATS);
    expect(vertices[0]).toBeGreaterThan(0.99);
    expect(vertices[3]).toBe(1);
    expect(vertices[6 * STROKE_VERTEX_FLOATS]).toBe(0);
    expect(vertices[6 * STROKE_VERTEX_FLOATS + 3]).toBeLessThan(0.01);
  });
});
