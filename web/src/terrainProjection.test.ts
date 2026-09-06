import { describe, expect, it, vi } from 'vitest';
import { geographicSegmentPoint, surfaceArc, surfacePathPoint, surfaceTrail, TerrainProjector } from './terrainProjection';
import type { EndpointV2 } from './types';

const endpoint = (lng: number, lat: number): EndpointV2 => ({ id: `${lng}:${lat}`, label: 'Synthetic', lng, lat });
const segment = { routeId: 'synthetic', from: endpoint(-116, 51), to: endpoint(-115, 51) };

describe('terrain-aware packet geometry', () => {
  it('keeps the flat path to two projections and samples intervening terrain in 3D', () => {
    let terrain = false;
    const project = vi.fn(([lng, lat]: [number, number]) => ({
      x: (lng + 116) * 100,
      y: lat - (terrain ? 30 * Math.sin((lng + 116) * Math.PI) : 0),
    }));
    const projection = new TerrainProjector({ project, getTerrain: () => terrain ? { source: 'dem' } : null, getZoom: () => 10 });
    expect(projection.projectSegment(segment)).toEqual([{ x: 0, y: 51 }, { x: 100, y: 51 }]);
    expect(project).toHaveBeenCalledTimes(2);
    terrain = true;
    projection.reset();
    const path = projection.projectSegment(segment);
    expect(path).toHaveLength(17);
    expect(surfacePathPoint(path, 0.5)).toMatchObject({ x: 50, y: 21 });
    expect(path[0]).toMatchObject({ x: 0, y: 51 });
    expect(path.at(-1)!.y).toBeCloseTo(51);
  });

  it('reuses samples until the camera or DEM changes, and keys moved endpoints separately', () => {
    let offset = 0;
    const project = vi.fn(([x, y]: [number, number]) => ({ x: x + offset, y }));
    const projection = new TerrainProjector({ project, getTerrain: () => ({ source: 'dem' }), getZoom: () => 10 });
    const first = projection.projectSegment(segment);
    const calls = project.mock.calls.length;
    expect(projection.projectSegment(segment)).toBe(first);
    expect(project).toHaveBeenCalledTimes(calls);
    offset = 100;
    projection.reset();
    expect(projection.projectSegment(segment)[0]!.x).toBe(first[0]!.x + 100);
    expect(projection.projectSegment({ ...segment, to: endpoint(-114, 51) }).at(-1)!.x).toBe(-14);
  });

  it('interpolates the geographic route in Mercator space before projecting', () => {
    const [lng, lat] = geographicSegmentPoint(endpoint(-120, 40), endpoint(-100, 60), 0.5);
    expect(lng).toBe(-110);
    expect(lat).toBeCloseTo(51.0652, 3);
    expect(geographicSegmentPoint(segment.from, segment.to, -1)[0]).toBe(-116);
    expect(geographicSegmentPoint(segment.from, segment.to, 2)[0]).toBe(-115);
  });

  it('clips trail length along the terrain path, including the first frame and static traces', () => {
    const path = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }];
    const trail = surfaceTrail(path, 1, 15);
    expect(trail).toEqual([expect.objectContaining({ x: 0, y: 5 }), path[1], expect.objectContaining(path[2]!)]);
    const start = surfaceTrail(path, 0, 46);
    expect(start).toHaveLength(1);
    expect(surfacePathPoint(start, 0.7)).toMatchObject(path[0]!);
    expect(surfaceTrail(path, 0.75, Infinity)).toEqual([path[0], path[1], expect.objectContaining({ x: 5, y: 10 })]);
    expect(surfaceTrail(path, 2, 15)).toEqual(trail);
  });

  it('gives ground rings the local camera basis while clamping head scale', () => {
    const step = 360 * 8 / (512 * 2 ** 10);
    const projection = new TerrainProjector({
      getTerrain: () => ({ source: 'dem' }), getZoom: () => 10,
      project: ([lng, lat]) => ({ x: lng / step * 8, y: lat / step * -4 }),
    });
    const point = projection.projectEndpoint(endpoint(0, 0));
    expect(point.ground).toEqual([1, 0, 0, -0.5]);
    expect(point.scale).toBe(1);
    const context = { save: vi.fn(), transform: vi.fn(), arc: vi.fn(), restore: vi.fn() };
    surfaceArc(context as unknown as CanvasRenderingContext2D, point, 12);
    expect(context.transform).toHaveBeenCalledWith(1, 0, 0, -0.5, 0, -0);
    expect(context.arc).toHaveBeenCalledWith(0, 0, 12, 0, Math.PI * 2);
    expect(context.restore).toHaveBeenCalledOnce();
  });
});
