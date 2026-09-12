import type { EndpointV2, RouteSegmentView } from './types';
import { routeCoordinate } from './worldGeometry';

export interface SurfacePoint {
  x: number;
  y: number;
  scale?: number;
  /** Geographic progress, independent of adaptive sample spacing. */
  progress?: number;
  ground?: readonly [number, number, number, number];
}

interface TerrainMap {
  project(coordinates: [number, number]): { x: number; y: number };
  getTerrain?(): { source: string } | null;
  getZoom?(): number;
}

const radians = Math.PI / 180;

export function geographicSegmentPoint(from: EndpointV2, to: EndpointV2, progress: number): [number, number] {
  return routeCoordinate([from.lng, from.lat], [to.lng, to.lat], progress);
}

export class TerrainProjector {
  private points = new Map<string, SurfacePoint>();
  private paths = new Map<string, readonly SurfacePoint[]>();

  constructor(private readonly map: TerrainMap) {}

  enabled(): boolean { return Boolean(this.map.getTerrain?.()); }
  project(coordinates: [number, number]): SurfacePoint { return this.map.project(coordinates); }

  reset(): void {
    this.points.clear();
    this.paths.clear();
  }

  projectEndpoint(endpoint: EndpointV2): SurfacePoint {
    if (!this.enabled()) return this.project([endpoint.lng, endpoint.lat]);
    const key = `${endpoint.lng}:${endpoint.lat}`;
    const cached = this.points.get(key);
    if (cached) return cached;
    const point: SurfacePoint = this.project([endpoint.lng, endpoint.lat]);
    const step = 360 * 8 / (512 * 2 ** (this.map.getZoom?.() ?? 0));
    const eastSign = endpoint.lng + step > 180 ? -1 : 1;
    const latitudeStep = step * Math.cos(endpoint.lat * radians);
    const northSign = endpoint.lat + latitudeStep > 85.051129 ? -1 : 1;
    const east = this.project([endpoint.lng + step * eastSign, endpoint.lat]);
    const north = this.project([endpoint.lng, endpoint.lat + latitudeStep * northSign]);
    const ground = [(east.x - point.x) / (8 * eastSign), (east.y - point.y) / (8 * eastSign), (north.x - point.x) / (8 * northSign), (north.y - point.y) / (8 * northSign)] as const;
    if (ground.every(Number.isFinite) && Math.max(...ground.map(Math.abs)) < 4) {
      point.ground = ground;
      point.scale = Math.max(0.55, Math.min(1.45, Math.hypot(ground[0], ground[1])));
    }
    if (this.points.size >= 1024) this.points.delete(this.points.keys().next().value!);
    this.points.set(key, point);
    return point;
  }

  projectSegment(segment: RouteSegmentView): readonly SurfacePoint[] {
    const { from, to } = segment;
    const key = `${from.lng}:${from.lat}:${to.lng}:${to.lat}`;
    const cached = this.paths.get(key);
    if (cached) return cached;
    const first = this.projectEndpoint(from);
    const last = this.projectEndpoint(to);
    const points = this.enabled() ? adaptiveSurfacePath((t) => {
      const point = t === 0 ? first : t === 1 ? last : this.project(geographicSegmentPoint(from, to, t));
      return { ...point, progress: t, scale: (first.scale ?? 1) + ((last.scale ?? 1) - (first.scale ?? 1)) * t };
    }) : [first, last];
    if (this.paths.size >= 1024) this.paths.delete(this.paths.keys().next().value!);
    this.paths.set(key, points);
    return points;
  }
}

/** Four seed intervals catch relief away from the midpoint; subdivision is capped at 65 vertices. */
export function adaptiveSurfacePath(project: (progress: number) => SurfacePoint): SurfacePoint[] {
  const sample = (t: number): SurfacePoint => ({ ...project(t), progress: t });
  const points: SurfacePoint[] = [];
  const split = (a: SurfacePoint, b: SurfacePoint, depth: number): void => {
    const m = sample((a.progress! + b.progress!) / 2);
    const error = Math.hypot(m.x - (a.x + b.x) / 2, m.y - (a.y + b.y) / 2);
    if (depth < 4 && Number.isFinite(error) && (error > 1.5 || Math.hypot(b.x - a.x, b.y - a.y) > 160)) {
      split(a, m, depth + 1);
      split(m, b, depth + 1);
    } else points.push(b);
  };
  let a = sample(0);
  points.push(a);
  for (let index = 1; index <= 4; index += 1) {
    const b = sample(index / 4);
    split(a, b, 0);
    a = b;
  }
  return points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) ? points : [];
}

function fraction(points: readonly SurfacePoint[], index: number): number {
  return points[index]!.progress ?? index / Math.max(1, points.length - 1);
}

function interpolatePoint(from: SurfacePoint, to: SurfacePoint, t: number): SurfacePoint {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t,
    scale: (from.scale ?? 1) + ((to.scale ?? 1) - (from.scale ?? 1)) * t };
}

export function surfacePathPoint(points: readonly SurfacePoint[], progress: number): SurfacePoint {
  if (points.length === 0) return { x: -1_000_000, y: -1_000_000, scale: 1 };
  if (points.length === 1) return points[0]!;
  progress = Math.max(0, Math.min(1, progress));
  let index = 0;
  while (index < points.length - 2 && fraction(points, index + 1) <= progress) index += 1;
  const from = points[index]!;
  const to = points[index + 1]!;
  const t = (progress - fraction(points, index)) / Math.max(0.000001, fraction(points, index + 1) - fraction(points, index));
  return interpolatePoint(from, to, t);
}

export function surfaceTrail(points: readonly SurfacePoint[], progress: number, maxLength: number): SurfacePoint[] {
  progress = Math.max(0, Math.min(1, progress));
  const head = surfacePathPoint(points, progress);
  const trail = [head];
  let remaining = maxLength;
  let start = points.length - 1;
  while (start > 0 && fraction(points, start) > progress) start -= 1;
  for (let index = start; index >= 0 && remaining > 0; index -= 1) {
    const next = points[index]!;
    const previous = trail[trail.length - 1]!;
    const distance = Math.hypot(next.x - previous.x, next.y - previous.y);
    if (distance < 0.001) continue;
    trail.push(distance > remaining ? interpolatePoint(previous, next, remaining / distance) : next);
    remaining -= distance;
  }
  return trail.reverse().map((point) => {
    if (point.progress === undefined) return point;
    const local = { ...point };
    delete local.progress;
    return local;
  });
}

export function traceSurfacePath(context: CanvasRenderingContext2D, points: readonly SurfacePoint[]): void {
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
}

export function surfaceArc(context: CanvasRenderingContext2D, point: SurfacePoint, radius: number): void {
  if (!point.ground) { context.arc(point.x, point.y, radius, 0, Math.PI * 2); return; }
  context.save();
  context.transform(...point.ground, point.x, point.y);
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.restore();
}
