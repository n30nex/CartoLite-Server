import type { EndpointV2, RouteSegmentView } from './types';
import { longitudeDelta, routeCoordinate } from './worldGeometry';

export interface SurfacePoint {
  x: number;
  y: number;
  scale?: number;
  ground?: readonly [number, number, number, number];
  progress?: number;
  breakBefore?: boolean;
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
    const delta = longitudeDelta(from.lng, to.lng);
    const endLongitude = from.lng + delta;
    if (Math.abs(endLongitude) > 180) {
      const boundary = Math.sign(endLongitude) * 180;
      const crossing = (boundary - from.lng) / delta;
      const points: SurfacePoint[] = [];
      const times = [...new Set([...Array.from({ length: 17 }, (_, index) => index / 16), crossing])].sort((a, b) => a - b);
      for (const t of times) {
        const [lng, lat] = geographicSegmentPoint(from, to, t);
        const endpoint = { ...from, lng: t > crossing ? lng - Math.sign(boundary) * 360 : lng, lat };
        points.push({ ...this.projectEndpoint(endpoint), progress: t });
        if (t === crossing) points.push({ ...this.projectEndpoint({ ...endpoint, lng: -boundary }), progress: t, breakBefore: true });
      }
      if (this.paths.size >= 1024) this.paths.delete(this.paths.keys().next().value!);
      this.paths.set(key, points);
      return points;
    }
    const first = this.projectEndpoint(from);
    const last = this.projectEndpoint({ ...to, lng: endLongitude });
    const points = this.enabled() ? Array.from({ length: 17 }, (_, index): SurfacePoint => {
      const t = index / 16;
      if (index === 0) return first;
      if (index === 16) return last;
      const point = this.project(geographicSegmentPoint(from, to, t));
      return { ...point, scale: (first.scale ?? 1) + ((last.scale ?? 1) - (first.scale ?? 1)) * t };
    }) : [first, last];
    if (this.paths.size >= 1024) this.paths.delete(this.paths.keys().next().value!);
    this.paths.set(key, points);
    return points;
  }
}

export function surfacePathPoint(points: readonly SurfacePoint[], progress: number): SurfacePoint {
  if (points.length === 1) return points[0]!;
  if (points[0]!.progress !== undefined) {
    const t = Math.max(0, Math.min(1, progress));
    let index = 0;
    while (index < points.length - 1 && points[index + 1]!.progress! <= t) index += 1;
    if (index === points.length - 1) return points[index]!;
    const from = points[index]!;
    const to = points[index + 1]!;
    return surfacePathPoint([{ ...from, progress: undefined }, { ...to, progress: undefined }], (t - from.progress!) / (to.progress! - from.progress!));
  }
  const position = Math.max(0, Math.min(1, progress)) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(position));
  const from = points[index]!;
  const to = points[index + 1]!;
  const t = position - index;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t,
    scale: (from.scale ?? 1) + ((to.scale ?? 1) - (from.scale ?? 1)) * t };
}

export function surfaceTrail(points: readonly SurfacePoint[], progress: number, maxLength: number): SurfacePoint[] {
  progress = Math.max(0, Math.min(1, progress));
  const head = surfacePathPoint(points, progress);
  const trail = [head];
  let remaining = maxLength;
  let start = Math.floor(progress * (points.length - 1));
  if (points[0]!.progress !== undefined) {
    start = 0;
    while (start < points.length - 1 && points[start + 1]!.progress! <= progress) start += 1;
  }
  for (let index = Math.min(points.length - 1, start); index >= 0 && remaining > 0; index -= 1) {
    const next = points[index]!;
    const previous = trail[trail.length - 1]!;
    if (previous.breakBefore) {
      if (Number.isFinite(maxLength)) break;
      trail.push(next);
      continue;
    }
    const distance = Math.hypot(next.x - previous.x, next.y - previous.y);
    if (distance < 0.001) { previous.breakBefore ||= next.breakBefore; continue; }
    trail.push(distance > remaining ? surfacePathPoint([previous, next], remaining / distance) : next);
    remaining -= distance;
  }
  trail.reverse();
  return points[0]!.progress === undefined ? trail : trail.map((point) => ({ ...point, progress: undefined }));
}

export function traceSurfacePath(context: CanvasRenderingContext2D, points: readonly SurfacePoint[]): void {
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0 || point.breakBefore) context.moveTo(point.x, point.y);
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
