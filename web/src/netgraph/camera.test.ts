import { describe, expect, it } from 'vitest';
import { GraphProjection, GRAPH_TILT, fitGraphCamera, graphArcPoint, graphPathPoint, distanceToGraphPath, projectGraphPath, type GraphCamera } from './camera';

const camera: GraphCamera = { x: 100, y: -80, zoom: 0.8, yaw: 0, tilt: 0, distance: 5000 };
describe('Netgraph shared 3D geometry', () => {
  it('starts with the existing flat projection and reverses pan/zoom at every camera angle', () => {
    const point = { x: 300, y: 220 };
    expect(new GraphProjection(camera, 1200, 800).project(point)).toMatchObject({ x: 760, y: 640 });
    for (const tilt of [0, GRAPH_TILT, 1.1]) for (const yaw of [-2.8, 0, 1.4]) {
      const p = new GraphProjection({ ...camera, tilt, yaw }, 1200, 800);
      const screen = p.project(point), world = p.ground(screen.x, screen.y);
      expect(world.x).toBeCloseTo(point.x, 5); expect(world.y).toBeCloseTo(point.y, 5);
    }
  });

  it('views the ground from above: foreground is larger and raised links rise toward the camera', () => {
    for (const tilt of [Math.PI / 6, GRAPH_TILT, 1.1]) for (const yaw of [-2.8, 0, 1.4]) {
      const p = new GraphProjection({ ...camera, x: 0, y: 0, zoom: 1, tilt, yaw }, 1200, 800);
      const point = (y: number, z = 0) => ({ x: y * Math.sin(yaw), y: y * Math.cos(yaw), z });
      const front = p.project(point(600)), back = p.project(point(-600));
      expect(front.scale).toBeGreaterThan(1); expect(back.scale).toBeLessThan(1);
      expect(front.y).toBeGreaterThan(400); expect(back.y).toBeLessThan(400);
      for (const y of [-600, 0, 600]) {
        expect(p.project(point(y, 100)).y).toBeLessThan(p.project(point(y)).y);
      }
      // A point lifted along the viewing ray stays centered and gets nearer.
      const alongRay = p.project(point(300 * Math.sin(tilt), 300 * Math.cos(tilt)));
      expect(alongRay.x).toBeCloseTo(600); expect(alongRay.y).toBeCloseTo(400);
      expect(alongRay.depth).toBeCloseTo(-300);
      expect(alongRay.scale).toBeCloseTo(camera.distance / (camera.distance - 300));
    }
  });

  it('fits neighbours and arc crests into the space left by desktop and mobile inspectors', () => {
    const a = { x: -450, y: -100, z: 18 }, b = { x: 900, y: 450, z: 28 };
    const points = [a, b, graphArcPoint(a, b, 0.5, true)];
    for (const [width, height, view] of [[1200, 800, { left: 24, right: 810, top: 90, bottom: 690 }], [390, 844, { left: 24, right: 366, top: 90, bottom: 430 }]] as const) {
      for (const tilt of [0, GRAPH_TILT]) {
        const fitted = fitGraphCamera({ ...camera, yaw: 1.1, tilt }, points, width, height, view);
        const projection = new GraphProjection(fitted, width, height);
        for (const point of points) {
          const p = projection.project(point);
          expect(p.visible).toBe(true);
          expect(p.x).toBeGreaterThanOrEqual(view.left); expect(p.x).toBeLessThanOrEqual(view.right);
          expect(p.y).toBeGreaterThanOrEqual(view.top); expect(p.y).toBeLessThanOrEqual(view.bottom);
        }
      }
    }
  });

  it('uses the visible arch for picking and keeps directed hop progress at its real endpoints', () => {
    const projection = new GraphProjection({ ...camera, tilt: GRAPH_TILT }, 1200, 800);
    const a = { x: -500, y: 0, z: 18 }, b = { x: 600, y: 0, z: 18 };
    const path = projectGraphPath(projection, a, b, true);
    expect(path.length).toBeLessThanOrEqual(33);
    expect(graphPathPoint(path, 0)).toMatchObject({ x: projection.project(a).x, y: projection.project(a).y });
    expect(graphPathPoint(path, 1)).toMatchObject({ x: projection.project(b).x, y: projection.project(b).y });
    const crest = graphPathPoint(path, 0.5);
    expect(distanceToGraphPath(path, crest.x, crest.y)).toBeCloseTo(0);
    expect(distanceToGraphPath(path, crest.x, (projection.project(a).y + projection.project(b).y) / 2)).toBeGreaterThan(25);
    expect(path.every((p, i) => !i || p.progress! > path[i - 1]!.progress!)).toBe(true);
    const backwards = projectGraphPath(projection, b, a, true);
    expect(graphPathPoint(backwards, 0)).toMatchObject({ x: projection.project(b).x, y: projection.project(b).y });
  });

  it('clips behind-camera points without drawing or picking a line across the gap', () => {
    const projection = new GraphProjection({ ...camera, tilt: 1, distance: 1000 }, 1200, 800);
    expect(projection.project({ x: 0, y: 5000 }).visible).toBe(false);
    const broken = [{ x: 0, y: 0, progress: 0 }, { x: 100, y: 100, progress: 0.5, breakBefore: true }, { x: 110, y: 110, progress: 1 }];
    expect(distanceToGraphPath(broken, 50, 50)).toBeGreaterThan(50);
    expect(graphPathPoint(broken, 0.25).x).toBeLessThan(0);
  });

  it('fits a worldwide extent into a narrow phone without a minimum-zoom crop', () => {
    const points = [{ x: -20_000, y: -24_000 }, { x: 20_000, y: 24_000 }];
    const view = { left: 16, right: 304, top: 120, bottom: 500 };
    const fitted = fitGraphCamera({ ...camera, distance: 150_000, tilt: GRAPH_TILT }, points, 320, 640, view);
    const projection = new GraphProjection(fitted, 320, 640);
    for (const point of points) {
      const p = projection.project(point);
      expect(p.x).toBeGreaterThan(view.left); expect(p.x).toBeLessThan(view.right);
      expect(p.y).toBeGreaterThan(view.top); expect(p.y).toBeLessThan(view.bottom);
    }
  });
});
