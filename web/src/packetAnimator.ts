import type maplibregl from 'maplibre-gl';
import type { EndpointV2, ObserverPacketEventV2, PacketView, RoutePacketView, RouteSegmentView } from './types';
import {
  normalizePacketKind,
  packetSignature,
  payloadColor,
  type PacketSignature,
} from './trafficVisuals';

export { payloadColor } from './trafficVisuals';

export const SINGLE_HOP_MS = 2100;
export const MIN_ROUTE_MS = 1300;
export const MAX_ROUTE_MS = 3200;
export const AFTERGLOW_MS = 1200;
export const RESIDUE_MS = 45_000;
export const RESIDUE_REDRAW_MS = 250;
export const SOURCE_IGNITION_MS = 160;
export const RELAY_SPARK_MS = 260;
export const DESTINATION_BLOOM_MS = 440;
export const OBSERVER_PING_MS = 1200;
export const RESIDUE_HOT_MS = 4_500;
export const MAX_ACTIVE_EFFECTS = 32;
export const MAX_RESIDUE = 480;
export const LOW_POWER_MAX_ACTIVE_EFFECTS = 16;
export const LOW_POWER_MAX_RESIDUE = 240;
export const NODE_WAKE_MS = 6_000;
export const MAX_NODE_WAKES = 160;
export const LOW_POWER_MAX_NODE_WAKES = 72;

const EARTH_RADIUS_KM = 6371.0088;
const MIN_SEGMENT_KM = 0.025;
const DISTANCE_SATURATION_KM = 300;
const EXTRA_HOP_MS = 110;

export type VisualQuality = 'full' | 'balanced' | 'low';

interface ActiveRoute {
  packet: RoutePacketView;
  color: string;
  signature: PacketSignature;
  started: number;
  duration: number;
  weights: number[];
  completedSegments: number;
  staticMotion?: RouteMotion;
  staticOnly?: boolean;
}

interface ActiveObserver {
  packet: ObserverPacketEventV2;
  color: string;
  signature: PacketSignature;
  started: number;
}

interface Residue {
  segment: RouteSegmentView;
  color: string;
  signature: PacketSignature;
  addedAt: number;
}

interface NodeWake {
  endpoint: EndpointV2;
  color: string;
  signature: PacketSignature;
  addedAt: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

interface ProjectedResidue {
  from: ScreenPoint;
  control: ScreenPoint;
  to: ScreenPoint;
}

export interface QuadraticRoute {
  from: ScreenPoint;
  control: ScreenPoint;
  to: ScreenPoint;
}

export interface QuadraticSlice {
  control: ScreenPoint;
  head: ScreenPoint;
  tangent: ScreenPoint;
}

export interface PacketTrail {
  tail: ScreenPoint;
  head: ScreenPoint;
  length: number;
}

export interface RouteMotion {
  segmentIndex: number;
  localProgress: number;
  completedSegments: number;
}

export interface ResidueStyle {
  life: number;
  bloomOpacity: number;
  coreOpacity: number;
  bloomWidth: number;
  coreWidth: number;
  hot: number;
}

export function packetDuration(hops: number, totalDistanceKm?: number): number {
  const hopCount = Math.max(1, Math.floor(hops));
  if (totalDistanceKm === undefined) {
    return Math.min(MAX_ROUTE_MS, SINGLE_HOP_MS + Math.max(0, hopCount - 1) * 360);
  }
  const distance = Math.max(0, Number.isFinite(totalDistanceKm) ? totalDistanceKm : 0);
  const distanceProgress = Math.sqrt(Math.min(1, distance / DISTANCE_SATURATION_KM));
  const distanceDuration = MIN_ROUTE_MS + (MAX_ROUTE_MS - MIN_ROUTE_MS) * distanceProgress;
  return Math.round(Math.min(MAX_ROUTE_MS, distanceDuration + Math.max(0, hopCount - 1) * EXTRA_HOP_MS));
}

export function geographicDistanceKm(from: EndpointV2, to: EndpointV2): number {
  const latitudeA = degreesToRadians(from.lat);
  const latitudeB = degreesToRadians(to.lat);
  const latitudeDelta = latitudeB - latitudeA;
  const longitudeDelta = degreesToRadians(to.lng - from.lng);
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const haversine = sinLatitude * sinLatitude + Math.cos(latitudeA) * Math.cos(latitudeB) * sinLongitude * sinLongitude;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

export function segmentTravelWeights(segments: readonly RouteSegmentView[]): number[] {
  if (segments.length === 0) return [];
  const distances = segments.map((segment) => {
    const distance = geographicDistanceKm(segment.from, segment.to);
    return Number.isFinite(distance) ? Math.max(MIN_SEGMENT_KM, distance) : MIN_SEGMENT_KM;
  });
  const total = distances.reduce((sum, distance) => sum + distance, 0);
  return distances.map((distance) => distance / total);
}

export function routeDistanceKm(segments: readonly RouteSegmentView[]): number {
  return segments.reduce((total, segment) => total + geographicDistanceKm(segment.from, segment.to), 0);
}

export function routeDuration(segments: readonly RouteSegmentView[]): number {
  if (segments.length === 0) return 0;
  return packetDuration(segments.length, routeDistanceKm(segments));
}

export function interpolateScreenPoint(from: ScreenPoint, to: ScreenPoint, progress: number): ScreenPoint {
  const amount = clamp(progress);
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
  };
}

export function routeCurve(from: ScreenPoint, to: ScreenPoint, seed: string, strength = 1): QuadraticRoute {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const distance = Math.hypot(deltaX, deltaY);
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  if (distance <= 0.01) return { from, control: midpoint, to };
  const side = stableVisualHash(seed) % 2 === 0 ? 1 : -1;
  const bend = Math.min(68, distance * 0.16) * clamp(strength);
  return {
    from,
    control: {
      x: midpoint.x - deltaY / distance * bend * side,
      y: midpoint.y + deltaX / distance * bend * side,
    },
    to,
  };
}

export function quadraticPoint(route: QuadraticRoute, progress: number): ScreenPoint {
  const amount = clamp(progress);
  const inverse = 1 - amount;
  return {
    x: inverse * inverse * route.from.x + 2 * inverse * amount * route.control.x + amount * amount * route.to.x,
    y: inverse * inverse * route.from.y + 2 * inverse * amount * route.control.y + amount * amount * route.to.y,
  };
}

export function quadraticSlice(route: QuadraticRoute, progress: number): QuadraticSlice {
  const amount = clamp(progress);
  const first = interpolateScreenPoint(route.from, route.control, amount);
  const second = interpolateScreenPoint(route.control, route.to, amount);
  return {
    control: first,
    head: interpolateScreenPoint(first, second, amount),
    tangent: { x: second.x - first.x, y: second.y - first.y },
  };
}

export function packetTrail(from: ScreenPoint, head: ScreenPoint, maxLength = 42): PacketTrail {
  const deltaX = head.x - from.x;
  const deltaY = head.y - from.y;
  const distance = Math.hypot(deltaX, deltaY);
  const length = Math.min(Math.max(0, maxLength), distance);
  if (distance <= 0.01) return { tail: { ...head }, head: { ...head }, length: 0 };
  return {
    tail: {
      x: head.x - deltaX / distance * length,
      y: head.y - deltaY / distance * length,
    },
    head: { ...head },
    length,
  };
}

export function visualQuality(lowPower: boolean, activeRoutes: number, activeObservers = 0): VisualQuality {
  const active = Math.max(0, activeRoutes) + Math.max(0, activeObservers);
  if (lowPower || active > 24) return 'low';
  if (active > 10) return 'balanced';
  return 'full';
}

export function segmentNearViewport(
  from: ScreenPoint,
  to: ScreenPoint,
  width: number,
  height: number,
  margin = Math.max(width, height) * 0.25
): boolean {
  return Math.max(from.x, to.x) >= -margin
    && Math.min(from.x, to.x) <= width + margin
    && Math.max(from.y, to.y) >= -margin
    && Math.min(from.y, to.y) <= height + margin;
}

export function shouldRefreshResidueCache(
  lastUpdatedAt: number,
  now: number,
  projectionDirty: boolean,
  contentDirty: boolean,
  interval = RESIDUE_REDRAW_MS,
): boolean {
  return projectionDirty || contentDirty || now - lastUpdatedAt >= interval;
}

export function routeMotion(weights: readonly number[], elapsed: number, duration: number): RouteMotion {
  if (weights.length === 0) return { segmentIndex: -1, localProgress: 0, completedSegments: 0 };
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  const progress = duration <= 0 ? 1 : clamp(elapsed / duration);
  let boundary = 0;
  let completedSegments = 0;
  for (const rawWeight of weights) {
    const weight = total > 0 ? Math.max(0, rawWeight) / total : 1 / weights.length;
    boundary += weight;
    if (boundary <= progress + Number.EPSILON * 8) completedSegments += 1;
    else break;
  }
  if (completedSegments >= weights.length) {
    return { segmentIndex: weights.length - 1, localProgress: 1, completedSegments: weights.length };
  }
  const segmentIndex = completedSegments;
  const segmentWeight = total > 0 ? Math.max(0, weights[segmentIndex] ?? 0) / total : 1 / weights.length;
  const segmentStart = boundary - segmentWeight;
  const localProgress = segmentWeight > 0 ? clamp((progress - segmentStart) / segmentWeight) : 1;
  return { segmentIndex, localProgress, completedSegments };
}

export function pulseTiming(age: number, duration: number): { progress: number; opacity: number } {
  if (age < 0 || age > duration || duration <= 0) return { progress: clamp(age / Math.max(1, duration)), opacity: 0 };
  const progress = clamp(age / duration);
  return { progress, opacity: Math.sin(Math.PI * progress) };
}

export function observerRadius(age: number): number {
  return 8 + clamp(Math.max(0, age) / OBSERVER_PING_MS) * 24;
}

export function nodeWakeLife(age: number): number {
  return Math.pow(1 - clamp(Math.max(0, age) / NODE_WAKE_MS), 2.4);
}

export function nodeWakeRadius(age: number, signature: PacketSignature, reducedMotion = false): number {
  if (reducedMotion) return 10;
  const life = nodeWakeLife(age);
  return 7 + (1 - life) * (signature === 'ripple' ? 24 : 15);
}

export function residueLife(age: number): number {
  const progress = clamp(Math.max(0, age) / RESIDUE_MS);
  return Math.pow(1 - progress, 2.15);
}

export function residueStyle(age: number): ResidueStyle {
  const life = residueLife(age);
  const hot = 1 - clamp(Math.max(0, age) / RESIDUE_HOT_MS);
  const widthLife = Math.sqrt(life);
  return {
    life,
    bloomOpacity: life * (0.12 + hot * 0.12),
    coreOpacity: life * (0.34 + hot * 0.48),
    bloomWidth: 1.4 + widthLife * 5.2,
    coreWidth: 0.65 + widthLife * 1.75,
    hot,
  };
}

export function residueSparkleProgress(seed: string, age: number, index: number): number {
  const phase = (stableVisualHash(`${seed}|${index}`) % 1000) / 1000;
  const speed = 0.000055 + Math.max(0, index) * 0.000009;
  return (phase + Math.max(0, age) * speed) % 1;
}

export function capNewest<T>(items: readonly T[], limit: number): T[] {
  const kept = Math.max(0, Math.floor(limit));
  return kept === 0 ? [] : items.slice(-kept);
}

export class PacketAnimator {
  private readonly context: CanvasRenderingContext2D;
  private readonly residueCanvas: HTMLCanvasElement;
  private readonly residueContext: CanvasRenderingContext2D;
  private readonly reducedMotionQuery: MediaQueryList;
  private readonly lowPowerQuery: MediaQueryList;
  private activeRoutes: ActiveRoute[] = [];
  private activeObservers: ActiveObserver[] = [];
  private residue: Residue[] = [];
  private nodeWakes: NodeWake[] = [];
  private projectedResidue = new Map<Residue, ProjectedResidue>();
  private frameId = 0;
  private residueTimer?: number;
  private paused = false;
  private reducedMotion: boolean;
  private lowPower: boolean;
  private reducedModeStartedAt = Number.NEGATIVE_INFINITY;
  private residueProjectionDirty = true;
  private residueContentDirty = true;
  private residueCacheUpdatedAt = Number.NEGATIVE_INFINITY;
  private dpr = 1;
  private scheduledWakeCount = 0;
  private appliedQuality?: VisualQuality;

  constructor(private readonly map: maplibregl.Map, private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas2D is unavailable');
    this.context = context;
    this.residueCanvas = canvas.ownerDocument.createElement('canvas');
    const residueContext = this.residueCanvas.getContext('2d');
    if (!residueContext) throw new Error('Canvas2D residue cache is unavailable');
    this.residueContext = residueContext;
    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.lowPowerQuery = window.matchMedia('(max-width: 620px), (pointer: coarse)');
    this.reducedMotion = this.reducedMotionQuery.matches;
    this.lowPower = this.lowPowerQuery.matches;
    if (this.reducedMotion) this.reducedModeStartedAt = performance.now();
    this.updateMotionMode();
    this.draw = this.draw.bind(this);
    this.resize = this.resize.bind(this);
    this.reducedMotionQuery.addEventListener('change', this.handleReducedMotionChange);
    this.lowPowerQuery.addEventListener('change', this.handleLowPowerChange);
    this.map.on('resize', this.resize);
    this.map.on('move', this.handleMapMove);
    this.resize();
  }

  add(packet: PacketView): void {
    if (this.paused || !this.packetNearViewport(packet)) return;
    const color = payloadColor(packet.payloadType);
    const kind = normalizePacketKind(packet.payloadType);
    const signature = packetSignature(packet.payloadType);
    const started = performance.now();
    this.canvas.dataset.lastPacketKind = kind;
    this.canvas.dataset.lastSignature = signature;
    if (packet.mode === 'route') {
      if (packet.segments.length === 0) return;
      const route: ActiveRoute = {
        packet,
        color,
        signature,
        started,
        duration: routeDuration(packet.segments),
        weights: segmentTravelWeights(packet.segments),
        completedSegments: 0,
      };
      if (this.reducedMotion) {
        route.staticOnly = true;
        route.staticMotion = {
          segmentIndex: packet.segments.length - 1,
          localProgress: 1,
          completedSegments: packet.segments.length,
        };
        route.completedSegments = packet.segments.length;
        for (const segment of packet.segments) {
          this.residue.push({ segment, color, signature, addedAt: started });
          this.addNodeWake(segment.to, color, signature, started);
        }
        this.residue = capNewest(this.residue, this.residueLimit());
        this.nodeWakes = capNewest(this.nodeWakes, this.nodeWakeLimit());
        this.residueContentDirty = true;
      }
      const source = packet.segments[0]?.from;
      if (source) this.addNodeWake(source, color, signature, started);
      this.residueContentDirty = true;
      this.activeRoutes.push(route);
    } else {
      this.activeObservers.push({ packet, color, signature, started });
    }
    this.trimDecorations();
    this.updateMotionMode();
    this.requestFrame();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.activeRoutes = [];
      this.activeObservers = [];
      this.residue = [];
      this.nodeWakes = [];
      this.projectedResidue.clear();
      this.residueContentDirty = true;
      window.cancelAnimationFrame(this.frameId);
      if (this.residueTimer !== undefined) window.clearTimeout(this.residueTimer);
      this.frameId = 0;
      this.residueTimer = undefined;
      this.clearCanvas();
      this.clearResidueCanvas();
    } else {
      this.requestFrame();
    }
  }

  destroy(): void {
    this.setPaused(true);
    this.reducedMotionQuery.removeEventListener('change', this.handleReducedMotionChange);
    this.lowPowerQuery.removeEventListener('change', this.handleLowPowerChange);
    this.map.off('resize', this.resize);
    this.map.off('move', this.handleMapMove);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(this.qualityMode() === 'low' ? 1.25 : 1.5, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.dataset.pixelRatio = String(dpr);
    if (this.dpr === dpr && this.canvas.width === width && this.canvas.height === height) return;
    this.dpr = dpr;
    this.canvas.width = width;
    this.canvas.height = height;
    this.residueCanvas.width = width;
    this.residueCanvas.height = height;
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.residueContext.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.residueProjectionDirty = true;
    this.residueContentDirty = true;
    this.requestFrame();
  }

  private handleReducedMotionChange = (event: MediaQueryListEvent): void => {
    if (this.reducedMotion === event.matches) return;
    const now = performance.now();
    this.reducedMotion = event.matches;
    if (this.reducedMotion) {
      this.reducedModeStartedAt = now;
      for (const route of this.activeRoutes) {
        this.completeRoute(route, now);
        route.staticMotion = routeMotion(route.weights, now - route.started, route.duration);
      }
    } else {
      this.activeRoutes = this.activeRoutes.filter((route) => !route.staticOnly);
      for (const route of this.activeRoutes) route.staticMotion = undefined;
    }
    this.updateMotionMode();
    this.residueContentDirty = true;
    this.requestFrame();
  };

  private handleLowPowerChange = (event: MediaQueryListEvent): void => {
    if (this.lowPower === event.matches) return;
    this.lowPower = event.matches;
    this.trimDecorations();
    this.residue = capNewest(this.residue, this.residueLimit());
    this.nodeWakes = capNewest(this.nodeWakes, this.nodeWakeLimit());
    this.updateMotionMode();
  };

  private handleMapMove = (): void => {
    this.residueProjectionDirty = true;
    this.requestFrame();
  };

  private requestFrame = (): void => {
    if (this.paused || this.frameId !== 0 || !this.hasVisibleEffects()) return;
    if (this.residueTimer !== undefined) window.clearTimeout(this.residueTimer);
    this.residueTimer = undefined;
    this.frameId = window.requestAnimationFrame(this.draw);
  };

  private requestTimedFrame(now: number): void {
    if (this.paused || this.residueTimer !== undefined || this.frameId !== 0) return;
    let delay = Number.POSITIVE_INFINITY;
    if (this.residue.length > 0) {
      const redraw = this.qualityMode() === 'low' ? RESIDUE_REDRAW_MS * 2 : RESIDUE_REDRAW_MS;
      delay = Math.max(0, this.residueCacheUpdatedAt + redraw - now);
      for (const item of this.residue) delay = Math.min(delay, Math.max(0, item.addedAt + RESIDUE_MS - now));
    }
    if (this.nodeWakes.length > 0) {
      const redraw = this.qualityMode() === 'low' ? RESIDUE_REDRAW_MS * 2 : RESIDUE_REDRAW_MS;
      delay = Math.min(delay, Math.max(0, this.residueCacheUpdatedAt + redraw - now));
      for (const item of this.nodeWakes) delay = Math.min(delay, Math.max(0, item.addedAt + NODE_WAKE_MS - now));
    }
    if (this.reducedMotion) {
      for (const item of this.activeRoutes) {
        const staticStarted = Math.max(item.started, this.reducedModeStartedAt);
        const staticEnds = staticStarted + AFTERGLOW_MS;
        if (staticEnds > now) delay = Math.min(delay, staticEnds - now);
        delay = Math.min(delay, Math.max(0, item.started + item.duration + DESTINATION_BLOOM_MS - now));
      }
      for (const item of this.activeObservers) {
        const staticStarted = Math.max(item.started, this.reducedModeStartedAt);
        const staticEnds = staticStarted + AFTERGLOW_MS;
        if (staticEnds > now) delay = Math.min(delay, staticEnds - now);
        delay = Math.min(delay, Math.max(0, item.started + OBSERVER_PING_MS - now));
      }
    }
    if (!Number.isFinite(delay)) return;
    this.residueTimer = window.setTimeout(() => {
      this.residueTimer = undefined;
      this.requestFrame();
    }, delay);
  }

  private draw(now: number): void {
    this.frameId = 0;
    if (this.paused) return;
    this.clearCanvas();
    if (!this.reducedMotion) {
      for (const route of this.activeRoutes) this.completeRoute(route, now);
    }
    const liveResidue = this.residue.filter((item) => now - item.addedAt < RESIDUE_MS);
    if (liveResidue.length !== this.residue.length) {
      this.residue = liveResidue;
      this.residueContentDirty = true;
    }
    const liveWakes = this.nodeWakes.filter((item) => now - item.addedAt < NODE_WAKE_MS);
    if (liveWakes.length !== this.nodeWakes.length) {
      this.nodeWakes = liveWakes;
      this.residueContentDirty = true;
    }
    this.renderResidueCache(now);
    this.drawResidueCache();
    this.context.save();
    // Source-over preserves packet hue during bursts; additive blending made
    // overlapping cyan and amber effects wash out to white.
    this.context.globalCompositeOperation = 'source-over';
    this.context.lineCap = 'round';
    if (!this.reducedMotion) {
      this.drawResidueSparkles(now);
      for (const item of this.nodeWakes) this.drawNodeWake(this.context, item, now);
    }
    this.activeRoutes = this.activeRoutes.filter(
      (item) => now - item.started < item.duration + DESTINATION_BLOOM_MS,
    );
    this.activeObservers = this.activeObservers.filter(
      (item) => now - item.started < OBSERVER_PING_MS,
    );
    this.updateMotionMode();
    for (const route of this.activeRoutes) this.drawRoute(route, now);
    for (const observer of this.activeObservers) this.drawObserver(observer, now);
    this.context.restore();
    if (!this.reducedMotion && this.hasVisibleEffects()) this.requestFrame();
    else this.requestTimedFrame(now);
  }

  private completeRoute(item: ActiveRoute, now: number): void {
    const motion = routeMotion(item.weights, now - item.started, item.duration);
    let added = false;
    while (item.completedSegments < motion.completedSegments) {
      const index = item.completedSegments;
      const segment = item.packet.segments[index];
      if (!segment) break;
      const addedAt = item.started + cumulativeWeight(item.weights, index) * item.duration;
      this.residue.push({ segment, color: item.color, signature: item.signature, addedAt });
      this.addNodeWake(segment.to, item.color, item.signature, addedAt);
      item.completedSegments += 1;
      added = true;
    }
    if (added) {
      this.residue = capNewest(this.residue, this.residueLimit());
      this.nodeWakes = capNewest(this.nodeWakes, this.nodeWakeLimit());
      this.residueContentDirty = true;
    }
  }

  private drawResidue(context: CanvasRenderingContext2D, item: Residue, projected: ProjectedResidue, now: number): void {
    const { from, control, to } = projected;
    const style = residueStyle(now - item.addedAt);
    const bloomOpacity = this.reducedMotion ? style.life * 0.12 : style.bloomOpacity;
    const coreOpacity = this.reducedMotion ? style.life * 0.34 : style.coreOpacity;
    const bloomWidth = this.reducedMotion ? 5.2 : style.bloomWidth;
    const coreWidth = this.reducedMotion ? 1.8 : style.coreWidth;
    const coreColor = this.reducedMotion ? item.color : blendWithWhite(item.color, style.hot * 0.16);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.quadraticCurveTo(control.x, control.y, to.x, to.y);
    context.strokeStyle = withAlpha(item.color, bloomOpacity);
    context.lineWidth = bloomWidth;
    context.stroke();
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.quadraticCurveTo(control.x, control.y, to.x, to.y);
    context.setLineDash(item.signature === 'echo' ? [6, 5] : []);
    context.strokeStyle = withAlpha(coreColor, coreOpacity);
    context.lineWidth = coreWidth;
    context.stroke();
    context.setLineDash([]);
  }

  private drawResidueSparkles(now: number): void {
    const quality = this.qualityMode();
    const count = quality === 'full' ? 3 : quality === 'balanced' ? 2 : 1;
    const limit = quality === 'full' ? 160 : quality === 'balanced' ? 120 : 96;
    for (const item of this.residue.slice(-limit)) {
      const projected = this.projectedResidue.get(item);
      if (!projected) continue;
      const style = residueStyle(now - item.addedAt);
      if (style.life <= 0.025) continue;
      const age = Math.max(0, now - item.addedAt);
      for (let index = 0; index < count; index += 1) {
        const progress = residueSparkleProgress(item.segment.routeId, age, index);
        const point = quadraticPoint(projected, progress);
        const twinkle = 0.32 + 0.68 * Math.abs(Math.sin(age / 240 + index * 2.1));
        const radius = quality === 'low' ? 0.85 : 0.9 + index * 0.12;
        this.context.fillStyle = withAlpha(item.color, style.life * twinkle * 0.82);
        this.context.beginPath();
        this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        this.context.fill();
      }
    }
  }

  private drawNodeWake(context: CanvasRenderingContext2D, item: NodeWake, now: number): void {
    const life = nodeWakeLife(now - item.addedAt);
    if (life <= 0) return;
    const point = this.point(item.endpoint);
    const radius = nodeWakeRadius(now - item.addedAt, item.signature, this.reducedMotion);
    context.strokeStyle = withAlpha(item.color, life * (item.signature === 'double' ? 0.6 : 0.38));
    context.lineWidth = item.signature === 'double' ? 1.5 : 1;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.stroke();
    if (item.signature === 'double' && life > 0.12) {
      context.beginPath();
      context.arc(point.x, point.y, Math.max(3, radius - 5), 0, Math.PI * 2);
      context.stroke();
    }
  }

  private renderResidueCache(now: number): void {
    if (!shouldRefreshResidueCache(
      this.residueCacheUpdatedAt,
      now,
      this.residueProjectionDirty,
      this.residueContentDirty,
      this.qualityMode() === 'low' ? RESIDUE_REDRAW_MS * 2 : RESIDUE_REDRAW_MS,
    )) return;

    if (this.residueProjectionDirty) this.projectedResidue.clear();
    const live = new Set(this.residue);
    for (const item of this.projectedResidue.keys()) {
      if (!live.has(item)) this.projectedResidue.delete(item);
    }
    for (const item of this.residue) {
      if (!this.projectedResidue.has(item)) {
        const from = this.point(item.segment.from);
        const to = this.point(item.segment.to);
        const curve = routeCurve(from, to, `${item.segment.routeId}|${item.signature}`, 0);
        this.projectedResidue.set(item, {
          from,
          control: curve.control,
          to,
        });
      }
    }

    this.clearResidueCanvas();
    this.residueContext.save();
    this.residueContext.globalCompositeOperation = 'source-over';
    this.residueContext.lineCap = 'round';
    for (const item of this.residue) {
      const projected = this.projectedResidue.get(item);
      if (projected) this.drawResidue(this.residueContext, item, projected, now);
    }
    if (this.reducedMotion) {
      for (const item of this.nodeWakes) this.drawNodeWake(this.residueContext, item, now);
    }
    this.residueContext.restore();
    this.residueProjectionDirty = false;
    this.residueContentDirty = false;
    this.residueCacheUpdatedAt = now;
  }

  private drawResidueCache(): void {
    this.context.save();
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.globalCompositeOperation = 'source-over';
    this.context.drawImage(this.residueCanvas, 0, 0);
    this.context.restore();
  }

  private drawRoute(item: ActiveRoute, now: number): void {
    const elapsed = Math.max(0, now - item.started);
    const quality = this.qualityMode();
    if (this.reducedMotion) {
      const staticAge = Math.max(0, now - Math.max(item.started, this.reducedModeStartedAt));
      const opacity = Math.max(0, 1 - staticAge / AFTERGLOW_MS);
      if (item.staticOnly) this.drawStaticEndpoints(item, opacity);
      else this.drawStaticRoute(item, opacity, item.staticMotion);
      return;
    }
    const motion = routeMotion(item.weights, elapsed, item.duration);
    const segment = item.packet.segments[motion.segmentIndex];
    if (segment && elapsed <= item.duration) {
      const from = this.point(segment.from);
      const to = this.point(segment.to);
      const curve = routeCurve(from, to, `${segment.routeId}|${item.signature}`, 0);
      const slice = quadraticSlice(curve, motion.localProgress);
      const trail = packetTrail(curve.from, slice.head, quality === 'full' ? 46 : quality === 'balanced' ? 38 : 28);
      this.drawProgressiveTrail(trail, item.color, quality);
      if (quality !== 'low') {
        this.drawTrailSparks(trail, item.color, item.packet.id, elapsed, quality === 'full' ? 3 : 2);
      }
      this.drawPacketCore(slice.head, item.color, quality);
      if (quality !== 'low') {
        this.drawPacketSignature(slice.head, slice.tangent, item.color, item.signature, elapsed);
      }
    }
    const first = item.packet.segments[0];
    if (first) this.drawBloom(this.point(first.from), item.color, pulseTiming(elapsed, SOURCE_IGNITION_MS), 10, 21, quality === 'low');
    for (let index = 0; index < item.packet.segments.length - 1; index += 1) {
      const arrivedAt = cumulativeWeight(item.weights, index) * item.duration;
      const timing = pulseTiming(elapsed - arrivedAt, RELAY_SPARK_MS);
      const relay = item.packet.segments[index]?.to;
      const next = item.packet.segments[index + 1]?.to;
      if (relay && next && timing.opacity > 0 && quality !== 'low') this.drawRelaySpark(this.point(relay), this.point(next), item.color, timing);
    }
    const last = item.packet.segments[item.packet.segments.length - 1];
    if (last) {
      this.drawDestinationShimmer(
        this.point(last.to),
        item.color,
        pulseTiming(elapsed - item.duration, DESTINATION_BLOOM_MS),
        quality === 'low',
      );
    }
  }

  private drawProgressiveTrail(
    trail: PacketTrail,
    color: string,
    quality: VisualQuality,
  ): void {
    if (trail.length <= 0.01) return;
    const glow = this.context.createLinearGradient(trail.tail.x, trail.tail.y, trail.head.x, trail.head.y);
    glow.addColorStop(0, withAlpha(color, 0));
    glow.addColorStop(0.42, withAlpha(color, quality === 'low' ? 0.08 : 0.12));
    glow.addColorStop(1, withAlpha(color, quality === 'low' ? 0.42 : 0.56));
    this.context.strokeStyle = glow;
    this.context.lineWidth = quality === 'full' ? 7.2 : quality === 'balanced' ? 5.8 : 3.8;
    this.context.beginPath();
    this.context.moveTo(trail.tail.x, trail.tail.y);
    this.context.lineTo(trail.head.x, trail.head.y);
    this.context.stroke();
    const core = this.context.createLinearGradient(trail.tail.x, trail.tail.y, trail.head.x, trail.head.y);
    core.addColorStop(0, withAlpha(color, 0));
    core.addColorStop(0.58, withAlpha(color, 0.36));
    core.addColorStop(1, withAlpha(color, 0.98));
    this.context.strokeStyle = core;
    this.context.lineWidth = quality === 'low' ? 1.3 : 1.65;
    this.context.beginPath();
    this.context.moveTo(trail.tail.x, trail.tail.y);
    this.context.lineTo(trail.head.x, trail.head.y);
    this.context.stroke();
  }

  private drawTrailSparks(
    trail: PacketTrail,
    color: string,
    seed: string,
    elapsed: number,
    count: number,
  ): void {
    const hash = stableVisualHash(seed);
    for (let index = 0; index < count; index += 1) {
      const progress = 0.25 + index * (0.48 / Math.max(1, count - 1));
      const point = interpolateScreenPoint(trail.tail, trail.head, progress);
      const shimmer = 0.32 + 0.48 * Math.abs(Math.sin(elapsed / 180 + (hash % 17) + index * 1.8));
      const radius = 0.65 + ((hash >>> (index * 3)) & 3) * 0.12;
      this.context.fillStyle = withAlpha(color, shimmer);
      this.context.beginPath();
      this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      this.context.fill();
    }
  }

  private drawStaticRoute(item: ActiveRoute, opacity: number, motion?: RouteMotion): void {
    const completedSegments = motion?.completedSegments ?? item.packet.segments.length;
    let visibleEndpoint: ScreenPoint | undefined;
    for (let index = 0; index < completedSegments; index += 1) {
      const segment = item.packet.segments[index];
      if (!segment) continue;
      const from = this.point(segment.from);
      const to = this.point(segment.to);
      const curve = routeCurve(from, to, `${segment.routeId}|${item.signature}`, 0);
      this.drawStaticSegment(curve, item.color, opacity, item.signature);
      visibleEndpoint = to;
    }
    if (motion && completedSegments < item.packet.segments.length) {
      const segment = item.packet.segments[motion.segmentIndex];
      if (segment) {
        const from = this.point(segment.from);
        const curve = routeCurve(from, this.point(segment.to), `${segment.routeId}|${item.signature}`, 0);
        const slice = quadraticSlice(curve, motion.localProgress);
        this.drawStaticSegment({ from, control: slice.control, to: slice.head }, item.color, opacity, item.signature);
        visibleEndpoint = slice.head;
      }
    }
    const first = item.packet.segments[0];
    if (first) this.endpointGlow(this.point(first.from), item.color, opacity);
    if (visibleEndpoint) this.endpointGlow(visibleEndpoint, item.color, opacity);
  }

  private drawStaticEndpoints(item: ActiveRoute, opacity: number): void {
    const first = item.packet.segments[0];
    const last = item.packet.segments[item.packet.segments.length - 1];
    if (first) this.endpointGlow(this.point(first.from), item.color, opacity);
    if (last) this.endpointGlow(this.point(last.to), item.color, opacity);
  }

  private drawStaticSegment(route: QuadraticRoute, color: string, opacity: number, signature: PacketSignature): void {
    this.context.strokeStyle = withAlpha(color, opacity * 0.2);
    this.context.lineWidth = 7;
    this.context.beginPath();
    this.context.moveTo(route.from.x, route.from.y);
    this.context.quadraticCurveTo(route.control.x, route.control.y, route.to.x, route.to.y);
    this.context.stroke();
    this.context.strokeStyle = withAlpha(color, opacity * 0.75);
    this.context.lineWidth = 1.8;
    this.context.setLineDash(signature === 'echo' ? [6, 5] : []);
    this.context.stroke();
    this.context.setLineDash([]);
  }

  private drawObserver(item: ActiveObserver, now: number): void {
    const age = Math.max(0, now - item.started);
    const visibleAge = this.reducedMotion ? Math.max(0, now - Math.max(item.started, this.reducedModeStartedAt)) : age;
    const life = Math.pow(Math.max(0, 1 - visibleAge / OBSERVER_PING_MS), 1.5);
    const point = this.point(item.packet.observer);
    if (this.reducedMotion) {
      this.endpointGlow(point, item.color, life);
      return;
    }
    this.context.strokeStyle = withAlpha(item.color, life * 0.95);
    this.context.lineWidth = 1.35;
    this.context.beginPath();
    this.context.arc(point.x, point.y, observerRadius(age), 0, Math.PI * 2);
    this.context.stroke();
    this.context.fillStyle = withAlpha('#ffffff', life * 0.9);
    this.context.beginPath();
    this.context.arc(point.x, point.y, 1.25, 0, Math.PI * 2);
    this.context.fill();
  }

  private drawPacketCore(point: ScreenPoint, color: string, quality: VisualQuality): void {
    const radius = quality === 'low' ? 4 : 6.5;
    const glow = this.context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    glow.addColorStop(0, withAlpha(color, 0.86));
    glow.addColorStop(0.35, withAlpha(color, 0.42));
    glow.addColorStop(1, withAlpha(color, 0));
    this.context.fillStyle = glow;
    this.context.beginPath();
    this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    this.context.fill();
    this.context.fillStyle = color;
    this.context.beginPath();
    this.context.arc(point.x, point.y, quality === 'low' ? 1.5 : 1.85, 0, Math.PI * 2);
    this.context.fill();
    if (quality !== 'low') {
      this.context.strokeStyle = withAlpha(color, 0.9);
      this.context.lineWidth = 0.85;
      this.context.beginPath();
      this.context.arc(point.x, point.y, 2.8, 0, Math.PI * 2);
      this.context.stroke();
    }
  }

  private drawPacketSignature(
    point: ScreenPoint,
    tangent: ScreenPoint,
    color: string,
    signature: PacketSignature,
    elapsed: number,
  ): void {
    const distance = Math.hypot(tangent.x, tangent.y) || 1;
    const directionX = tangent.x / distance;
    const directionY = tangent.y / distance;
    const phase = (elapsed % 520) / 520;
    this.context.save();
    this.context.strokeStyle = withAlpha(color, 0.72);
    this.context.fillStyle = withAlpha(color, 0.72);
    this.context.lineWidth = 1.05;
    if (signature === 'ripple') {
      this.context.beginPath();
      this.context.arc(point.x, point.y, 3 + phase * 6, 0, Math.PI * 2);
      this.context.stroke();
    } else if (signature === 'echo') {
      for (const offset of [6, 12]) {
        this.context.beginPath();
        this.context.moveTo(point.x - directionX * offset - directionY * 2.5, point.y - directionY * offset + directionX * 2.5);
        this.context.lineTo(point.x - directionX * offset + directionY * 2.5, point.y - directionY * offset - directionX * 2.5);
        this.context.stroke();
      }
    } else if (signature === 'orbit') {
      const angle = phase * Math.PI * 2;
      this.context.beginPath();
      this.context.arc(point.x + Math.cos(angle) * 5, point.y + Math.sin(angle) * 5, 1.35, 0, Math.PI * 2);
      this.context.fill();
    } else if (signature === 'double') {
      for (const radius of [3.5, 6.5]) {
        this.context.beginPath();
        this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        this.context.stroke();
      }
    } else {
      const perpendicularX = -directionY;
      const perpendicularY = directionX;
      this.context.beginPath();
      this.context.moveTo(point.x - perpendicularX * 4, point.y - perpendicularY * 4);
      this.context.lineTo(point.x + perpendicularX * 4, point.y + perpendicularY * 4);
      this.context.stroke();
    }
    this.context.restore();
  }

  private drawBloom(
    point: { x: number; y: number },
    color: string,
    timing: { progress: number; opacity: number },
    startRadius: number,
    endRadius: number,
    simple: boolean,
  ): void {
    if (timing.opacity <= 0) return;
    const radius = startRadius + (endRadius - startRadius) * easeOutCubic(timing.progress);
    if (simple) {
      this.context.strokeStyle = withAlpha(color, timing.opacity * 0.58);
      this.context.lineWidth = 1.4;
      this.context.beginPath();
      this.context.arc(point.x, point.y, radius * 0.62, 0, Math.PI * 2);
      this.context.stroke();
      return;
    }
    const gradient = this.context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, withAlpha(blendWithWhite(color, 0.3), timing.opacity * 0.62));
    gradient.addColorStop(0.2, withAlpha(color, timing.opacity * 0.5));
    gradient.addColorStop(1, withAlpha(color, 0));
    this.context.fillStyle = gradient;
    this.context.beginPath();
    this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    this.context.fill();
  }

  private drawRelaySpark(
    point: { x: number; y: number },
    toward: { x: number; y: number },
    color: string,
    timing: { progress: number; opacity: number },
  ): void {
    if (timing.opacity <= 0) return;
    const angle = Math.atan2(toward.y - point.y, toward.x - point.x);
    const radius = 3 + easeOutCubic(timing.progress) * 5;
    this.context.strokeStyle = withAlpha(color, timing.opacity * 0.78);
    this.context.lineWidth = 1.1;
    this.context.beginPath();
    this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    this.context.stroke();
    this.context.beginPath();
    this.context.moveTo(point.x + Math.cos(angle) * 3, point.y + Math.sin(angle) * 3);
    this.context.lineTo(point.x + Math.cos(angle) * 9, point.y + Math.sin(angle) * 9);
    this.context.stroke();
  }

  private drawDestinationShimmer(
    point: ScreenPoint,
    color: string,
    timing: { progress: number; opacity: number },
    simple: boolean,
  ): void {
    if (timing.opacity <= 0) return;
    const radius = 5 + easeOutCubic(timing.progress) * (simple ? 8 : 14);
    this.context.strokeStyle = withAlpha(color, timing.opacity * 0.72);
    this.context.lineWidth = simple ? 1.2 : 1.5;
    this.context.beginPath();
    this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    this.context.stroke();
    if (simple) return;
    this.context.strokeStyle = withAlpha(color, timing.opacity * 0.28);
    this.context.beginPath();
    this.context.arc(point.x, point.y, radius * 0.58, 0, Math.PI * 2);
    this.context.stroke();
  }

  private endpointGlow(point: { x: number; y: number }, color: string, opacity: number): void {
    const gradient = this.context.createRadialGradient(point.x, point.y, 0, point.x, point.y, 14);
    gradient.addColorStop(0, withAlpha(blendWithWhite(color, 0.28), opacity * 0.72));
    gradient.addColorStop(0.22, withAlpha(color, opacity * 0.58));
    gradient.addColorStop(1, withAlpha(color, 0));
    this.context.fillStyle = gradient;
    this.context.beginPath();
    this.context.arc(point.x, point.y, 14, 0, Math.PI * 2);
    this.context.fill();
  }

  private trimDecorations(): void {
    const observerLimit = this.qualityMode() === 'low' ? LOW_POWER_MAX_ACTIVE_EFFECTS : MAX_ACTIVE_EFFECTS;
    // Route travel is never capped: every visible live hop keeps its directional
    // cue. Only observer rings and lingering decoration are bounded during bursts.
    this.activeObservers = capNewest(this.activeObservers, observerLimit);
    this.residue = capNewest(this.residue, this.residueLimit());
    this.nodeWakes = capNewest(this.nodeWakes, this.nodeWakeLimit());
  }

  private addNodeWake(endpoint: EndpointV2, color: string, signature: PacketSignature, addedAt: number): void {
    this.nodeWakes.push({ endpoint, color, signature, addedAt });
    this.scheduledWakeCount += 1;
    this.canvas.dataset.wakesScheduled = String(this.scheduledWakeCount);
  }

  private hasVisibleEffects(): boolean {
    return this.activeRoutes.length > 0
      || this.activeObservers.length > 0
      || this.residue.length > 0
      || this.nodeWakes.length > 0;
  }

  private updateMotionMode(): void {
    const quality = this.qualityMode();
    const qualityChanged = this.appliedQuality !== undefined && this.appliedQuality !== quality;
    this.appliedQuality = quality;
    this.canvas.dataset.motionMode = this.reducedMotion ? 'static' : 'animated';
    this.canvas.dataset.powerMode = this.lowPower ? 'low' : 'full';
    this.canvas.dataset.qualityMode = quality;
    this.canvas.dataset.activeRoutes = String(this.activeRoutes.length);
    this.canvas.dataset.nodeWakes = String(this.nodeWakes.length);
    if (qualityChanged) this.resize();
  }

  private residueLimit(): number {
    return this.qualityMode() === 'low' ? LOW_POWER_MAX_RESIDUE : MAX_RESIDUE;
  }

  private nodeWakeLimit(): number {
    return this.qualityMode() === 'low' ? LOW_POWER_MAX_NODE_WAKES : MAX_NODE_WAKES;
  }

  private qualityMode(): VisualQuality {
    return visualQuality(this.lowPower, this.activeRoutes.length, this.activeObservers.length);
  }

  private packetNearViewport(packet: PacketView): boolean {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width <= 0 || height <= 0) return true;
    if (packet.mode === 'observer') {
      const point = this.point(packet.observer);
      return segmentNearViewport(point, point, width, height);
    }
    return packet.segments.some((segment) => segmentNearViewport(
      this.point(segment.from),
      this.point(segment.to),
      width,
      height
    ));
  }

  private clearCanvas(): void {
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    this.context.clearRect(0, 0, width, height);
  }

  private clearResidueCanvas(): void {
    const width = this.residueCanvas.width / this.dpr;
    const height = this.residueCanvas.height / this.dpr;
    this.residueContext.clearRect(0, 0, width, height);
  }

  private point(endpoint: EndpointV2): { x: number; y: number } {
    return this.map.project([endpoint.lng, endpoint.lat]);
  }
}

function cumulativeWeight(weights: readonly number[], index: number): number {
  let total = 0;
  for (let cursor = 0; cursor <= index; cursor += 1) total += weights[cursor] ?? 0;
  return clamp(total);
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function stableVisualHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - clamp(value), 3);
}

function blendWithWhite(color: string, amount: number): string {
  const value = color.startsWith('#') ? color.slice(1) : 'ffffff';
  const blend = clamp(amount);
  const channels = [0, 2, 4].map((start) => {
    const channel = Number.parseInt(value.slice(start, start + 2), 16);
    return Math.round(channel + (255 - channel) * blend)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

function withAlpha(color: string, alpha: number): string {
  const value = color.startsWith('#') ? color.slice(1) : 'ffffff';
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${clamp(alpha)})`;
}
