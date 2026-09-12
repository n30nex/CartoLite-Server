import { stableHash as stableVisualHash } from './trafficVisuals';
import { canvasColorWithAlpha as withAlpha, displayColor, displayPreferences, displayResidueAge, lightScene, lineDash, residueLifetime } from './displayPreferences';
import type * as maplibregl from 'maplibre-gl';
import type { EndpointV2, ObserverPacketEventV2, PacketView, RoutePacketView, RouteSegmentView } from './types';
import { TerrainProjector, surfaceArc, surfacePathPoint, surfaceTrail, traceSurfacePath, type SurfacePoint } from './terrainProjection';
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
export const LONG_HAUL_MIN_KM = 75;

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
  longHaul: boolean;
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
  longHaul: boolean;
}

export interface PacketAnimationEmphasis {
  longHaul?: boolean;
}

interface NodeWake {
  endpoint: EndpointV2;
  color: string;
  signature: PacketSignature;
  addedAt: number;
}

export type ScreenPoint = SurfacePoint;

export interface PacketTrail {
  tail: ScreenPoint;
  head: ScreenPoint;
  length: number;
  points?: readonly ScreenPoint[];
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

export function packetEndpointDistanceKm(packet: PacketView): number {
  if (packet.mode !== 'route' || packet.segments.length === 0) return 0;
  const first = packet.segments[0]!;
  const last = packet.segments[packet.segments.length - 1]!;
  return geographicDistanceKm(first.from, last.to);
}

export function potentialLongHaulPacket(packet: PacketView): boolean {
  return packetEndpointDistanceKm(packet) >= LONG_HAUL_MIN_KM;
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
  readonly projection: TerrainProjector;
  private readonly context: CanvasRenderingContext2D;
  private readonly residueCanvas: HTMLCanvasElement;
  private readonly residueContext: CanvasRenderingContext2D;
  private readonly reducedMotionQuery: MediaQueryList;
  private readonly lowPowerQuery: MediaQueryList;
  private activeRoutes: ActiveRoute[] = [];
  private activeObservers: ActiveObserver[] = [];
  private residue: Residue[] = [];
  private nodeWakes: NodeWake[] = [];
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
    this.projection = new TerrainProjector(map);
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
    this.map.on('terrain', this.handleMapMove);
    this.map.on('sourcedata', this.handleTerrainData);
    this.resize();
  }

  add(packet: PacketView, emphasis: PacketAnimationEmphasis = {}): void {
    if (this.paused || !this.packetNearViewport(packet)) return;
    const color = payloadColor(packet.payloadType);
    const kind = normalizePacketKind(packet.payloadType);
    const signature = packetSignature(packet.payloadType);
    const started = performance.now();
    this.canvas.dataset.lastPacketKind = kind;
    this.canvas.dataset.lastSignature = signature;
    this.canvas.dataset.lastPacketRange = emphasis.longHaul ? 'long-haul' : 'standard';
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
        longHaul: Boolean(emphasis.longHaul),
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
          this.residue.push({ segment, color, signature, addedAt: started, longHaul: route.longHaul });
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
      this.projection.reset();
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

  refreshAppearance(): void {
    this.residueContentDirty = true;
    this.residueProjectionDirty = true;
    this.canvas.dataset.routePreset = displayPreferences().preset;
    this.requestFrame();
  }

  destroy(): void {
    this.setPaused(true);
    this.reducedMotionQuery.removeEventListener('change', this.handleReducedMotionChange);
    this.lowPowerQuery.removeEventListener('change', this.handleLowPowerChange);
    this.map.off('resize', this.resize);
    this.map.off('move', this.handleMapMove);
    this.map.off('terrain', this.handleMapMove);
    this.map.off('sourcedata', this.handleTerrainData);
    this.projection.reset();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(this.qualityMode() === 'low' ? 1.25 : 1.5, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.dataset.pixelRatio = String(dpr);
    if (this.dpr === dpr && this.canvas.width === width && this.canvas.height === height) return;
    this.projection.reset();
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
    this.projection.reset();
    this.residueProjectionDirty = true;
    this.requestFrame();
  };

  private handleTerrainData = (event: { sourceId?: string }): void => {
    const source = this.map.getTerrain?.()?.source;
    if (source && event.sourceId === source) this.handleMapMove();
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
      for (const item of this.residue) delay = Math.min(delay, Math.max(0, item.addedAt + residueLifetime() - now));
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
    const liveResidue = this.residue.filter((item) => now - item.addedAt < residueLifetime());
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
      this.residue.push({ segment, color: item.color, signature: item.signature, addedAt, longHaul: item.longHaul });
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

  private drawResidue(context: CanvasRenderingContext2D, item: Residue, now: number): void {
    const style = residueStyle(displayResidueAge(now - item.addedAt));
    const rangeBoost = item.longHaul ? 1.28 : 1;
    const detail = Math.max(0.3, Math.min(1, (this.map.getZoom() - 3) / 7));
    const bloomOpacity = this.reducedMotion ? style.life * 0.12 : style.bloomOpacity;
    const coreOpacity = this.reducedMotion ? style.life * 0.34 : style.coreOpacity;
    const bloomWidth = this.reducedMotion ? 5.2 : style.bloomWidth;
    const coreWidth = this.reducedMotion ? 1.8 : style.coreWidth;
    const coreColor = this.reducedMotion ? item.color : blendWithWhite(item.color, style.hot * 0.16);
    traceSurfacePath(context, this.projection.projectSegment(item.segment));
    context.strokeStyle = withAlpha(item.color, Math.min(0.7, bloomOpacity * rangeBoost * detail) * displayPreferences().glow);
    context.lineWidth = bloomWidth * rangeBoost * detail;
    context.stroke();
    context.setLineDash(lineDash());
    context.strokeStyle = withAlpha(coreColor, Math.min(0.96, coreOpacity * rangeBoost));
    context.lineWidth = Math.max(1, coreWidth * detail) * (displayPreferences().width / 1.6) * (item.longHaul ? 1.18 : 1);
    context.stroke();
    context.setLineDash([]);
  }

  private drawResidueSparkles(now: number): void {
    if (this.map.getZoom() < 5 || displayPreferences().glow < 0.25) return;
    const quality = this.qualityMode();
    const count = quality === 'full' ? 3 : quality === 'balanced' ? 2 : 1;
    const limit = quality === 'full' ? 160 : quality === 'balanced' ? 120 : 96;
    for (const item of this.residue.slice(-limit)) {
      const path = this.projection.projectSegment(item.segment);
      const style = residueStyle(displayResidueAge(now - item.addedAt));
      if (style.life <= 0.025) continue;
      const age = Math.max(0, now - item.addedAt);
      const sparkleCount = Math.min(4, count + (item.longHaul ? 1 : 0));
      for (let index = 0; index < sparkleCount; index += 1) {
        const progress = residueSparkleProgress(item.segment.routeId, age, index);
        const point = surfacePathPoint(path, progress);
        const twinkle = 0.32 + 0.68 * Math.abs(Math.sin(age / 240 + index * 2.1));
        const radius = quality === 'low' ? 0.85 : 0.9 + index * 0.12;
        this.context.fillStyle = withAlpha(item.color, style.life * twinkle * 0.82);
        this.context.beginPath();
        this.context.arc(point.x, point.y, radius * (point.scale ?? 1), 0, Math.PI * 2);
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
    surfaceArc(context, point, radius);
    context.stroke();
    if (item.signature === 'double' && life > 0.12) {
      context.beginPath();
      surfaceArc(context, point, Math.max(3, radius - 5));
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

    this.clearResidueCanvas();
    this.residueContext.save();
    this.residueContext.globalCompositeOperation = 'source-over';
    this.residueContext.lineCap = 'round';
    for (const item of this.residue) {
      this.drawResidue(this.residueContext, item, now);
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
      const path = this.projection.projectSegment(segment);
      const head = surfacePathPoint(path, motion.localProgress);
      const points = surfaceTrail(path, motion.localProgress, (quality === 'full' ? 46 : quality === 'balanced' ? 38 : 28) * (head.scale ?? 1) * displayPreferences().trailLength);
      const trail: PacketTrail = { points, tail: points[0]!, head, length: points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y), 0) };
      const before = surfacePathPoint(path, Math.max(0, motion.localProgress - 0.01));
      const after = surfacePathPoint(path, Math.min(1, motion.localProgress + 0.01));
      let tangent = { x: after.x - before.x, y: after.y - before.y };
      if (path[0]!.progress !== undefined) {
        for (let index = 1; index < path.length; index += 1) {
          const from = path[index - 1]!;
          const to = path[index]!;
          if (!to.breakBefore && from.progress! <= motion.localProgress && to.progress! >= motion.localProgress) {
            tangent = { x: to.x - from.x, y: to.y - from.y };
            break;
          }
        }
      }
      this.canvas.dataset.projectionSamples = String(path.length);
      this.drawProgressiveTrail(trail, item.color, quality, item.longHaul);
      if (quality !== 'low') {
        this.drawTrailSparks(trail, item.color, item.packet.id, elapsed, quality === 'full' ? 3 : 2);
      }
      this.drawPacketCore(head, item.color, quality, item.longHaul);
      if (quality !== 'low') {
        this.drawPacketSignature(head, tangent, item.color, item.signature, elapsed);
        if (item.longHaul) this.drawLongHaulMarker(head, tangent, item.color, elapsed);
      }
    }
    const first = item.packet.segments[0];
    if (first) this.drawBloom(
      this.point(first.from),
      item.color,
      pulseTiming(elapsed, SOURCE_IGNITION_MS),
      item.longHaul ? 13 : 10,
      item.longHaul ? 29 : 21,
      quality === 'low',
    );
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
        item.longHaul,
      );
    }
  }

  private drawProgressiveTrail(
    trail: PacketTrail,
    color: string,
    quality: VisualQuality,
    longHaul = false,
  ): void {
    if (trail.length <= 0.01) return;
    const glow = this.context.createLinearGradient(trail.tail.x, trail.tail.y, trail.head.x, trail.head.y);
    glow.addColorStop(0, withAlpha(color, 0));
    glow.addColorStop(0.42, withAlpha(color, quality === 'low' ? 0.08 : longHaul ? 0.18 : 0.12));
    glow.addColorStop(1, withAlpha(color, quality === 'low' ? (longHaul ? 0.56 : 0.42) : longHaul ? 0.72 : 0.56));
    this.context.strokeStyle = glow;
    const width = quality === 'full' ? 7.2 : quality === 'balanced' ? 5.8 : 3.8;
    this.context.lineWidth = width * (longHaul ? 1.42 : 1) * (trail.head.scale ?? 1);
    traceSurfacePath(this.context, trail.points ?? [trail.tail, trail.head]);
    this.context.globalAlpha = displayPreferences().glow;
    this.context.stroke();
    this.context.globalAlpha = 1;
    const core = this.context.createLinearGradient(trail.tail.x, trail.tail.y, trail.head.x, trail.head.y);
    core.addColorStop(0, withAlpha(color, 0));
    core.addColorStop(0.58, withAlpha(color, longHaul ? 0.5 : 0.36));
    core.addColorStop(1, withAlpha(color, 0.98));
    this.context.strokeStyle = core;
    this.context.lineWidth = (quality === 'low' ? 1.3 : 1.65) * (longHaul ? 1.2 : 1) * (trail.head.scale ?? 1) * displayPreferences().packetSize;
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
      const point = surfacePathPoint(trail.points ?? [trail.tail, trail.head], progress);
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
      const path = this.projection.projectSegment(segment);
      this.drawStaticSegment(path, item.color, opacity, item.signature);
      visibleEndpoint = path[path.length - 1];
    }
    if (motion && completedSegments < item.packet.segments.length) {
      const segment = item.packet.segments[motion.segmentIndex];
      if (segment) {
        const path = surfaceTrail(this.projection.projectSegment(segment), motion.localProgress, Infinity);
        this.drawStaticSegment(path, item.color, opacity, item.signature);
        visibleEndpoint = path[path.length - 1];
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

  private drawStaticSegment(points: readonly ScreenPoint[], color: string, opacity: number, _signature: PacketSignature): void {
    this.context.strokeStyle = withAlpha(color, opacity * 0.2 * displayPreferences().glow);
    this.context.lineWidth = 7;
    traceSurfacePath(this.context, points);
    this.context.stroke();
    this.context.strokeStyle = withAlpha(color, opacity * 0.75);
    this.context.lineWidth = displayPreferences().width;
    this.context.setLineDash(lineDash());
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
    surfaceArc(this.context, point, observerRadius(age));
    this.context.stroke();
    this.context.fillStyle = withAlpha('#ffffff', life * 0.9);
    this.context.beginPath();
    this.context.arc(point.x, point.y, 1.25, 0, Math.PI * 2);
    this.context.fill();
  }

  private drawPacketCore(point: ScreenPoint, color: string, quality: VisualQuality, longHaul = false): void {
    const scale = (point.scale ?? 1) * displayPreferences().packetSize;
    const radius = (quality === 'low' ? 4 : 6.5) * (longHaul ? 1.38 : 1) * scale;
    const glow = this.context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    glow.addColorStop(0, withAlpha(color, 0.86));
    glow.addColorStop(0.35, withAlpha(color, 0.42));
    glow.addColorStop(1, withAlpha(color, 0));
    this.context.fillStyle = glow;
    this.context.beginPath();
    this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    this.context.globalAlpha = displayPreferences().glow;
    this.context.fill();
    this.context.globalAlpha = 1;
    this.context.fillStyle = displayColor(color);
    this.context.beginPath();
    this.context.arc(point.x, point.y, (quality === 'low' ? 1.5 : 1.85) * (longHaul ? 1.18 : 1) * scale, 0, Math.PI * 2);
    this.context.fill();
    if (quality !== 'low') {
      this.context.strokeStyle = withAlpha(color, 0.9);
      this.context.lineWidth = 0.85;
      this.context.beginPath();
      this.context.arc(point.x, point.y, (longHaul ? 4.2 : 2.8) * scale, 0, Math.PI * 2);
      this.context.stroke();
    }
  }

  private drawLongHaulMarker(
    point: ScreenPoint,
    tangent: ScreenPoint,
    color: string,
    elapsed: number,
  ): void {
    const distance = Math.hypot(tangent.x, tangent.y) || 1;
    const normalX = -tangent.y / distance;
    const normalY = tangent.x / distance;
    const x = point.x + normalX * 13;
    const y = point.y + normalY * 13;
    const breath = 0.72 + Math.sin(elapsed / 260) * 0.12;
    this.context.save();
    this.context.font = '600 8px ui-monospace, SFMono-Regular, Consolas, monospace';
    this.context.textAlign = 'center';
    this.context.textBaseline = 'middle';
    this.context.fillStyle = withAlpha('#031015', 0.82);
    this.context.fillRect(x - 8, y - 5, 16, 10);
    this.context.strokeStyle = withAlpha(color, breath);
    this.context.lineWidth = 0.9;
    this.context.strokeRect(x - 8, y - 5, 16, 10);
    this.context.fillStyle = withAlpha(color, Math.min(1, breath + 0.16));
    this.context.fillText('DX', x, y + 0.5);
    this.context.restore();
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
      surfaceArc(this.context, point, radius * 0.62);
      this.context.stroke();
      return;
    }
    const gradient = this.context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, withAlpha(blendWithWhite(color, 0.3), timing.opacity * 0.62 * displayPreferences().glow));
    gradient.addColorStop(0.2, withAlpha(color, timing.opacity * 0.5 * displayPreferences().glow));
    gradient.addColorStop(1, withAlpha(color, 0));
    this.context.fillStyle = gradient;
    this.context.beginPath();
    surfaceArc(this.context, point, radius);
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
    surfaceArc(this.context, point, radius);
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
    longHaul = false,
  ): void {
    if (timing.opacity <= 0) return;
    const radius = 5 + easeOutCubic(timing.progress) * (simple ? (longHaul ? 12 : 8) : longHaul ? 22 : 14);
    this.context.strokeStyle = withAlpha(color, timing.opacity * 0.72);
    this.context.lineWidth = simple ? (longHaul ? 1.55 : 1.2) : longHaul ? 1.9 : 1.5;
    this.context.beginPath();
    surfaceArc(this.context, point, radius);
    this.context.stroke();
    if (simple) return;
    this.context.strokeStyle = withAlpha(color, timing.opacity * 0.28);
    this.context.beginPath();
    surfaceArc(this.context, point, radius * 0.58);
    this.context.stroke();
  }

  private endpointGlow(point: { x: number; y: number }, color: string, opacity: number): void {
    const gradient = this.context.createRadialGradient(point.x, point.y, 0, point.x, point.y, 14);
    gradient.addColorStop(0, withAlpha(blendWithWhite(color, 0.28), opacity * 0.72));
    gradient.addColorStop(0.22, withAlpha(color, opacity * 0.58));
    gradient.addColorStop(1, withAlpha(color, 0));
    this.context.fillStyle = gradient;
    this.context.beginPath();
    surfaceArc(this.context, point, 14);
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
    this.canvas.dataset.projectionMode = this.projection.enabled() ? 'terrain' : 'flat';
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
    return packet.segments.some((segment) => {
      const path = this.projection.projectSegment(segment);
      return path.some((point, index) => index > 0 && !point.breakBefore && segmentNearViewport(path[index - 1]!, point, width, height));
    });
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

  private point(endpoint: EndpointV2): ScreenPoint {
    return this.projection.projectEndpoint(endpoint);
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


function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - clamp(value), 3);
}

function blendWithWhite(color: string, amount: number): string {
  color = displayColor(color);
  const value = color.startsWith('#') ? color.slice(1) : 'ffffff';
  const blend = clamp(amount);
  const channels = [0, 2, 4].map((start) => {
    const channel = Number.parseInt(value.slice(start, start + 2), 16);
    return Math.round(channel + ((lightScene() ? 0 : 255) - channel) * blend)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}
