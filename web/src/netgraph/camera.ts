import { adaptiveSurfacePath, surfacePathPoint, type SurfacePoint } from '../terrainProjection';

/** Diagram coordinates: x/y retain geographic packing; z is schematic height. */
export interface GraphPoint { x: number; y: number; z?: number }
export interface GraphCamera { x: number; y: number; zoom: number; yaw: number; tilt: number; distance: number }
export interface GraphViewport { left: number; right: number; top: number; bottom: number }
export interface ProjectedPoint extends SurfacePoint { depth: number; visible: boolean }
export const GRAPH_TILT = Math.PI / 4;
export const MAX_GRAPH_TILT = Math.PI * 0.36;
const hidden = (): ProjectedPoint => ({ x: -1_000_000, y: -1_000_000, scale: 0, depth: Infinity, visible: false });

/** Cache trigonometry once per camera change, not once per node/path sample. */
export class GraphProjection {
  private readonly cy: number;
  private readonly sy: number;
  private readonly ct: number;
  private readonly st: number;
  constructor(readonly camera: Readonly<GraphCamera>, readonly width: number, readonly height: number) {
    this.cy = Math.cos(camera.yaw); this.sy = Math.sin(camera.yaw);
    this.ct = Math.cos(camera.tilt); this.st = Math.sin(camera.tilt);
  }

  project(point: GraphPoint): ProjectedPoint {
    const { camera } = this;
    const dx = point.x - camera.x, dy = point.y - camera.y;
    const x = dx * this.cy - dy * this.sy, y = dx * this.sy + dy * this.cy;
    const z = camera.tilt === 0 ? 0 : (point.z ?? 0);
    const depth = y * this.st - z * this.ct;
    const denominator = camera.distance + depth;
    if (!Number.isFinite(denominator) || denominator < camera.distance * 0.08) return hidden();
    const scale = camera.tilt === 0 ? 1 : camera.distance / denominator;
    return { x: this.width / 2 + x * camera.zoom * scale,
      y: this.height / 2 + (y * this.ct - z * this.st) * camera.zoom * scale,
      scale, depth, visible: true };
  }

  /** Inverse ray/ground intersection for pointer anchoring and planar panning. */
  ground(x: number, y: number): GraphPoint {
    const u = (x - this.width / 2) / this.camera.zoom;
    const v = (y - this.height / 2) / this.camera.zoom;
    const denominator = Math.max(0.08, this.ct - v * this.st / this.camera.distance);
    const ry = v / denominator;
    const rx = u * (1 + ry * this.st / this.camera.distance);
    return { x: this.camera.x + rx * this.cy + ry * this.sy,
      y: this.camera.y - rx * this.sy + ry * this.cy };
  }

  endpoint(point: GraphPoint): ProjectedPoint {
    const p = this.project(point);
    if (!p.visible || this.camera.tilt === 0) return p;
    const step = 8 / (this.camera.zoom * (p.scale ?? 1));
    const east = this.project({ ...point, x: point.x + step });
    const south = this.project({ ...point, y: point.y + step });
    if (east.visible && south.visible) p.ground = [(east.x - p.x) / 8, (east.y - p.y) / 8, (south.x - p.x) / 8, (south.y - p.y) / 8];
    return p;
  }
}

export function graphArcPoint(from: GraphPoint, to: GraphPoint, progress: number, crossArea: boolean): GraphPoint {
  const t = Math.max(0, Math.min(1, progress));
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  const lift = Math.min(600, Math.max(24, span * (crossArea ? 0.18 : 0.1)));
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t,
    z: (from.z ?? 0) * (1 - t) + (to.z ?? 0) * t + 4 * t * (1 - t) * lift };
}

export function projectGraphPath(projection: GraphProjection, from: GraphPoint, to: GraphPoint, crossArea: boolean): SurfacePoint[] {
  if (projection.camera.tilt === 0) return [{ ...projection.project(from), progress: 0 }, { ...projection.project(to), progress: 1 }];
  const middle = graphArcPoint(from, to, 0.5, crossArea);
  const control = { ...middle, z: 2 * middle.z! - ((from.z ?? 0) + (to.z ?? 0)) / 2 };
  const hull = [projection.project(from), projection.project(control), projection.project(to)];
  // With positive homogeneous depth the projected quadratic stays inside its
  // control hull. Reject off-screen ink before allocating adaptive samples.
  if (hull.every(p => p.visible) && (hull.every(p => p.x < -128) || hull.every(p => p.x > projection.width + 128)
    || hull.every(p => p.y < -128) || hull.every(p => p.y > projection.height + 128))) return [];
  // A quadratic arch needs at most 33 samples. All consumers share this path,
  // including Canvas/GPU effects, audio visibility and picking.
  const dx = to.x - from.x, dy = to.y - from.y, z = from.z ?? 0, dz = (to.z ?? 0) - z;
  const lift = middle.z! - z - dz / 2;
  const sampled = adaptiveSurfacePath(t => projection.project({ x: from.x + dx * t, y: from.y + dy * t,
    z: z + dz * t + 4 * t * (1 - t) * lift }), 4, 2);
  let clipped = false;
  return sampled.filter(point => {
    if (!(point as ProjectedPoint).visible) { clipped = true; return false; }
    if (clipped) point.breakBefore = true;
    clipped = false;
    return true;
  });
}

export function graphPathPoint(path: readonly SurfacePoint[], progress: number): SurfacePoint {
  if (!path.length || progress < (path[0]!.progress ?? 0) || progress > (path.at(-1)!.progress ?? 1)) return hidden();
  if (progress === (path[0]!.progress ?? 0)) return path[0]!;
  if (progress === (path.at(-1)!.progress ?? 1)) return path.at(-1)!;
  for (let i = 1; i < path.length; i++) {
    if (progress < (path[i]!.progress ?? 1)) {
      if (path[i]!.breakBefore) return hidden();
      break;
    }
  }
  return surfacePathPoint(path, progress);
}

export function distanceToGraphPath(path: readonly SurfacePoint[], x: number, y: number): number {
  let distance = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    if (b.breakBefore) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / Math.max(0.0001, dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(x - a.x - dx * t, y - a.y - dy * t));
  }
  return distance;
}

export function fitGraphCamera(camera: GraphCamera, points: readonly GraphPoint[], width: number, height: number, view: GraphViewport, maximumZoom = 3): GraphCamera {
  if (!points.length) return camera;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const next = { ...camera, x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: 1 };
  const cx = (view.left + view.right) / 2, cy = (view.top + view.bottom) / 2;
  for (let pass = 0; pass < 5; pass++) {
    let projection = new GraphProjection(next, width, height);
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const p of points) {
      const q = projection.project(p);
      if (!q.visible) continue;
      left = Math.min(left, q.x); right = Math.max(right, q.x); top = Math.min(top, q.y); bottom = Math.max(bottom, q.y);
    }
    if (!Number.isFinite(left)) return camera;
    const ratio = Math.min(Math.max(24, view.right - view.left - 48) / Math.max(1, right - left), Math.max(24, view.bottom - view.top - 48) / Math.max(1, bottom - top));
    const zoom = Math.max(0.002, Math.min(maximumZoom, next.zoom * ratio));
    const factor = zoom / next.zoom;
    next.zoom = zoom;
    projection = new GraphProjection(next, width, height);
    const center = projection.ground(cx, cy);
    const target = projection.ground(width / 2 + ((left + right) / 2 - width / 2) * factor, height / 2 + ((top + bottom) / 2 - height / 2) * factor);
    next.x += target.x - center.x; next.y += target.y - center.y;
  }
  return next;
}
