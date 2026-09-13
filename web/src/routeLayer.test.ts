import { describe, expect, it } from 'vitest';
import type { Feature, LineString } from 'geojson';
import { collapseCollinearPositions, historicalRouteVertices, routeMayIntersectView, STROKE_VERTEX_FLOATS } from './routeLayer';

describe('historical route WebGL geometry', () => {
  it('removes redundant straight subdivisions without flattening relief or reversing a path', () => {
    expect(collapseCollinearPositions([[0, 0, 0], [0.5, 0.5, 0.5], [1, 1, 1]])).toEqual([[0, 0, 0], [1, 1, 1]]);
    expect(collapseCollinearPositions([[0, 0, 0], [0.5, 0.5, 0.6], [1, 1, 1]])).toHaveLength(3);
    expect(collapseCollinearPositions([[0, 0, 0], [1, 0, 0], [0.5, 0, 0]])).toHaveLength(3);
  });
  it('culls distant terrain work but keeps crossing routes and date-line views', () => {
    expect(routeMayIntersectView([-123, 49], [-122, 49], [-81, 43, -79, 44])).toBe(false);
    expect(routeMayIntersectView([-82, 43.5], [-78, 43.5], [-81, 43, -79, 44])).toBe(true);
    expect(routeMayIntersectView([-179, 40], [-177, 41], [175, 39, 185, 42])).toBe(true);
    expect(routeMayIntersectView([179, 40], [180, 41], [-185, 39, -175, 42])).toBe(true);
    expect(routeMayIntersectView([0, 40], [1, 41], [175, 39, -175, 42])).toBe(false);
    expect(routeMayIntersectView([10, 40], [-169, 40], [170, 39, -160, 41])).toBe(true);
  });
  it('keeps one exact line segment for every route', () => {
    const routes: Feature<LineString>[] = [
      route('a', [[-0.13, 51.51], [18.42, -33.93]], '#54d7c6', 0),
      route('b', [[103.82, 1.35], [151.21, -33.87]], '#f0ca54', 3),
    ];

    const vertices = historicalRouteVertices(routes);

    expect(vertices).toHaveLength(routes.length * 6 * STROKE_VERTEX_FLOATS);
    expect(vertices[12]).toBe(0);
    expect(vertices[6 * STROKE_VERTEX_FLOATS + 12]).toBe(3);
    expect([...vertices].every(Number.isFinite)).toBe(true);
    expect(routes[0]?.geometry.coordinates).toEqual([[-0.13, 51.51], [18.42, -33.93]]);
  });
  it('splits date-line routes into short strokes', () => {
    const vertices = historicalRouteVertices([route('seam', [[179, 40], [-179, 41]], '#4de7c4', 1)]);
    expect(vertices).toHaveLength(12 * STROKE_VERTEX_FLOATS);
    for (let i = 0; i < vertices.length; i += STROKE_VERTEX_FLOATS) expect(Math.abs(vertices[i]! - vertices[i + 3]!)).toBeLessThan(0.01);
  });
});

function route(
  id: string,
  coordinates: LineString['coordinates'],
  color: string,
  windowBand: number,
): Feature<LineString> {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'LineString', coordinates },
    properties: { color, opacity: 0.7, windowBand },
  };
}
