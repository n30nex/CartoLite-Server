import { followViewport } from '../cinematicChrome';
import { surfaceArc, surfaceTrail, traceSurfacePath, type SurfacePoint } from '../terrainProjection';
import { GraphProjection, GRAPH_TILT, MAX_GRAPH_TILT, fitGraphCamera, graphArcPoint, graphPathPoint, distanceToGraphPath, projectGraphPath, type GraphCamera, type GraphPoint } from './camera';
import { canvasEffects } from '../gpuEffects';
import { canvasColorWithAlpha as colorWithAlpha, DISPLAY_EVENT, displayColor, displayPreferences, displayResidueAge, lightScene, lineDash, residueLifetime, prefersReducedMotion, effectStrength } from '../displayPreferences';
import type { ViewportProjector } from '../audio';
import {
  DESTINATION_BLOOM_MS,
  RELAY_SPARK_MS,
  SOURCE_IGNITION_MS,
  capNewest,
  drawPacketSignature,
  nodeWakeRadius,
  residueStyle,
  routeDuration,
  routeMotion,
  segmentNearViewport,
  segmentTravelWeights,
  shouldRefreshResidueCache,
  type ScreenPoint,
} from '../packetAnimator';
import {
  activeRegionFrames,
  capRegionActivity,
  planRegionTraffic,
  type RegionActivityCue,
  type RegionPulseFrame,
  type RegionTrafficPlan,
} from '../regionActivity';
import type { MapChanges } from '../state';
import {
  PACKET_KIND_COLORS,
  normalizePacketKind,
  packetSignature,
  payloadColor,
  type PacketKind,
  type PacketSignature,
} from '../trafficVisuals';
import type { EndpointV2, NodeRole, NodeV2, PacketView, RoutePacketView, RouteV2, StateV2 } from '../types';
import { nearestNetgraphArea, type NetgraphAreaAnchor } from './areas';
import { NetgraphQuality } from './quality';
import {
  buildNetgraphLayout,
  extendNetgraphLayout,
  focusedNodeIDs,
  graphTopologyChanged,
  netgraphWindowMS,
  routeTopology,
  routesInWindow,
  type NetgraphLayout,
  type NetgraphWindow,
} from './layout';

const ROLE_COLORS: Readonly<Record<NodeRole, string>> = {
  repeater: '#67ead2',
  companion: '#78cfff',
  room_server: '#d694ff',
  sensor: '#ffd06c',
  unknown: '#a6b4bf',
};

const MAX_RESIDUE = 480;
const LOW_POWER_MAX_RESIDUE = 240;
const VIEW_ANIMATION_MS = 360;

interface ActiveRoute {
  packet: RoutePacketView;
  color: string;
  signature: PacketSignature;
  started: number;
  duration: number;
  weights: number[];
  completedSegments: number;
  crossRegion: boolean;
  longHaul: boolean;
}

interface ObserverWake {
  endpoint: EndpointV2;
  color: string;
  signature: PacketSignature;
  started: number;
}

interface Residue {
  routeId: string;
  fromId: string;
  toId: string;
  color: string;
  signature: PacketSignature;
  addedAt: number;
}

interface ScreenNode {
  node: NodeV2;
  point: ScreenPoint;
  radius: number;
  degree: number;
}

interface LabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NetgraphRendererCallbacks {
  onNodeSelect(nodeID: string | null): void;
  onNodeHover(node: NodeV2 | null, point?: ScreenPoint): void;
  onRouteSelect?(routeIDs: string[]): void;
  onViewChange?(): void;
}

// Native private members keep renderer internals minifiable without renaming public/browser APIs.
export class NetgraphRenderer implements ViewportProjector {
  readonly #gpu: ReturnType<typeof canvasEffects>;
  readonly #graphContext: CanvasRenderingContext2D;
  readonly #packetContext: CanvasRenderingContext2D;
  readonly #residueCanvas: HTMLCanvasElement;
  readonly #residueContext: CanvasRenderingContext2D;
  readonly #nodesCanvas: HTMLCanvasElement;
  readonly #nodesContext: CanvasRenderingContext2D;
  #nodesDirty = true;
  #residueCacheAt = -Infinity;
  #residueDirty = true;
  #residueProjectionDirty = true;
  readonly #quality = new NetgraphQuality();
  #lastMotionAt = 0;
  readonly #glowSprites = new Map<string, HTMLCanvasElement>();
  readonly #regionLabelSprites = new Map<string, { canvas: HTMLCanvasElement; width: number }>();
  readonly #screenPoints = new Map<string, ScreenPoint>();
  readonly #screenPaths = new Map<string, readonly SurfacePoint[]>();
  #projection = new GraphProjection({ x: 0, y: 0, zoom: 1, yaw: 0, tilt: 0, distance: 1000 }, 1, 1);
  readonly #textWidths = new Map<string, number>();
  readonly #reducedMotionQuery: MediaQueryList;
  readonly #lowPowerQuery: MediaQueryList;
  readonly #resizeObserver?: ResizeObserver;
  #nodesByID = new Map<string, NodeV2>();
  #routesByID = new Map<string, RouteV2>();
  #adjacentRouteIDs = new Map<string, Set<string>>();
  #coordinateNodeIDs = new Map<string, string>();
  #assignedAreas = new Map<string, NetgraphAreaAnchor>();
  #regionAreasByTag = new Map<string, NetgraphAreaAnchor>();
  #regionActivityCues: RegionActivityCue[] = [];
  #topology = new Map<string, string>();
  #layout: NetgraphLayout = buildNetgraphLayout([], []);
  #visibleRoutes: RouteV2[] = [];
  #visibleRouteIDs = new Set<string>();
  #screenNodes: ScreenNode[] = [];
  #routeWindow: NetgraphWindow = '15m';
  #selectedNodeID: string | null = null;
  #selectedRouteID: string | null = null;
  #focusIDs: Set<string> | undefined;
  #focusMode: 'all' | 'area' | 'component' = 'all';
  #focusAnchorID: string | null = null;
  #hoveredNodeID: string | null = null;
  #activeRoutes: ActiveRoute[] = [];
  #observerWakes: ObserverWake[] = [];
  #residue: Residue[] = [];
  #staticFrame = 0;
  #motionFrame = 0;
  #viewFrame = 0;
  #residueCleanupTimer = 0;
  #width = 1;
  #height = 1;
  #dpr = 1;
  #centerX = 0;
  #centerY = 0;
  #scale = 1;
  #yaw = 0;
  #tilt = 0;
  #mode3D = false;
  #rotationGesture = false;
  #gestureYaw = 0;
  #gestureTilt = 0;
  #paintedView?: { x: number; y: number; scale: number };
  #initializedView = false;
  #paused = false;
  #dragMoved = false;
  readonly #pointers = new Map<number, ScreenPoint>();
  #pointerStart = { x: 0, y: 0 };
  #viewStart = { x: 0, y: 0 };
  #pinchStart?: { distance: number; scale: number; angle: number; yaw: number; anchor: ScreenPoint; offset: ScreenPoint };

  constructor(
    private readonly stage: HTMLElement,
    private readonly graphCanvas: HTMLCanvasElement,
    private readonly packetCanvas: HTMLCanvasElement,
    private readonly callbacks: NetgraphRendererCallbacks,
  ) {
    const graphContext = graphCanvas.getContext('2d');
    const packetContext = packetCanvas.getContext('2d');
    if (!graphContext || !packetContext) throw new Error('Canvas2D is unavailable');
    this.#gpu = canvasEffects(stage, packetCanvas);
    this.#graphContext = graphContext;
    this.#packetContext = packetContext;
    this.#residueCanvas = document.createElement('canvas');
    this.#residueCanvas.id = 'netgraph-residue-canvas';
    this.#residueCanvas.setAttribute('aria-hidden', 'true');
    this.#residueContext = this.#residueCanvas.getContext('2d')!;
    this.stage.insertBefore(this.#residueCanvas, packetCanvas);
    this.#nodesCanvas = document.createElement('canvas');
    this.#nodesContext = this.#nodesCanvas.getContext('2d')!;
    this.#reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.#lowPowerQuery = matchMedia('(max-width: 700px), (pointer: coarse)');
    this.stage.dataset.motionMode = prefersReducedMotion() ? 'static' : 'animated';
    this.stage.dataset.qualityMode = this.#quality.mode;
    this.handleResize = this.handleResize.bind(this);
    this.drawMotion = this.drawMotion.bind(this);
    this.stage.addEventListener('pointerdown', this.#handlePointerDown);
    this.stage.addEventListener('pointermove', this.#handlePointerMove);
    this.stage.addEventListener('pointerup', this.#handlePointerUp);
    this.stage.addEventListener('pointercancel', this.#handlePointerCancel);
    this.stage.addEventListener('lostpointercapture', this.#handlePointerCancel);
    this.stage.addEventListener('wheel', this.#handleWheel, { passive: false });
    this.stage.addEventListener('dblclick', this.#handleDoubleClick);
    this.stage.addEventListener('contextmenu', this.#handleContextMenu);
    this.#reducedMotionQuery.addEventListener('change', this.#handleMotionPreference);
    if (typeof ResizeObserver === 'function') {
      this.#resizeObserver = new ResizeObserver(this.handleResize);
      this.#resizeObserver.observe(stage);
    } else {
      window.addEventListener('resize', this.handleResize);
    }
    this.handleResize();
    window.addEventListener(DISPLAY_EVENT, this.#refreshAppearance);
  }

  #refreshAppearance = (): void => {
    this.#glowSprites.clear();
    this.#regionLabelSprites.clear();
    this.#nodesDirty = true;
    this.#residueDirty = true;
    this.#residueProjectionDirty = true;
    this.stage.dataset.routePreset = displayPreferences().preset;
    this.#requestStaticDraw();
    this.#handleMotionPreference();
  };

  render(state: Readonly<StateV2>, changes: MapChanges | null): void {
    if (!changes) return;
    const started = performance.now();
    const firstLayout = this.#layout.positions.size === 0;
    let visualChange = Boolean(changes.reset);
    let movedArea = false;
    if (changes.reset) this.#assignedAreas.clear();
    for (const node of changes.reset ? state.nodes : changes.nodes ?? []) {
      const area = nearestNetgraphArea(node.lat, node.lng);
      const previous = this.#assignedAreas.get(node.id);
      movedArea ||= Boolean(previous && previous.code !== area.code);
      this.#assignedAreas.set(node.id, area);
    }
    this.stage.dataset.regionAssignments = String(this.#assignedAreas.size);
    if (changes.reset) {
      this.#nodesByID = new Map(state.nodes.map((node) => [node.id, node]));
      this.#coordinateNodeIDs = new Map(state.nodes.map((node) => [coordinateKey(node.lng, node.lat), node.id]));
      this.#routesByID = new Map(state.routes.map((route) => [route.id, route]));
    } else {
      // Last-heard updates do not change the fixed graph geometry or its ink.
      for (const node of changes.nodes ?? []) {
        const previous = this.#nodesByID.get(node.id);
        const nodeInkChanged = !previous || previous.label !== node.label || previous.role !== node.role || previous.observer !== node.observer;
        visualChange ||= nodeInkChanged;
        this.#nodesDirty ||= nodeInkChanged;
        if (!previous || previous.observer !== node.observer) { this.#screenPoints.delete(node.id); this.#screenPaths.clear(); }
        if (previous && (previous.lng !== node.lng || previous.lat !== node.lat)) {
          const key = coordinateKey(previous.lng, previous.lat);
          if (this.#coordinateNodeIDs.get(key) === node.id) this.#coordinateNodeIDs.delete(key);
        }
        this.#nodesByID.set(node.id, node);
        this.#coordinateNodeIDs.set(coordinateKey(node.lng, node.lat), node.id);
      }
      const now = Date.now();
      const cutoff = now - netgraphWindowMS(this.#routeWindow);
      for (const route of changes.routes ?? []) {
        const previous = this.#routesByID.get(route.id);
        // Counts and precise last-heard times update inspection immediately,
        // but only a changed visible style needs thousands of links repainted.
        visualChange ||= !previous
          || previous.lastKind !== route.lastKind
          || previous.intensity !== route.intensity
          || Math.min(4, Math.floor((now - previous.lastHeard) / 900_000)) !== Math.min(4, Math.floor((now - route.lastHeard) / 900_000))
          || (previous.lastHeard >= cutoff) !== (route.lastHeard >= cutoff);
        this.#routesByID.set(route.id, route);
      }
    }

    if (changes.reset || movedArea || graphTopologyChanged(this.#topology, changes.routes ?? [], state.routes.length)) {
      if (firstLayout) {
        this.#layout = buildNetgraphLayout(state.nodes, state.routes, this.#assignedAreas);
      } else {
        this.#layout = extendNetgraphLayout(this.#layout, state.nodes, state.routes, this.#assignedAreas);
      }
      this.#topology = routeTopology(state.routes);
      this.#refreshFocus();
      this.#rebuildAdjacency(state.routes);
      this.#resetProjection();
      this.#residueProjectionDirty = true;
      this.#residueDirty = true;
      this.#nodesDirty = true;
      visualChange = true;
    }

    if (changes.reset || changes.routes?.length) {
      this.#visibleRoutes = routesInWindow(state.routes, Date.now(), this.#routeWindow);
      this.#visibleRouteIDs = new Set(this.#visibleRoutes.map((route) => route.id));
    }
    this.stage.dataset.totalNodes = String(state.nodes.length);
    this.stage.dataset.connectedNodes = String(this.#layout.connectedNodeIDs.size);
    this.stage.dataset.totalRoutes = String(state.routes.length);
    this.stage.dataset.visibleRoutes = String(this.#visibleRoutes.length);
    this.stage.dataset.components = String(this.#layout.componentCount);
    this.stage.dataset.areas = String(this.#layout.areas.length);
    this.stage.dataset.renderApplyMs = (performance.now() - started).toFixed(1);
    if (!this.#initializedView && this.#layout.positions.size > 0) this.home(false);
    if (visualChange) {
      if (this.#selectedNodeID) this.#nodesDirty = true;
      this.#requestStaticDraw();
    }
  }

  setRouteWindow(window: NetgraphWindow): void {
    const started = performance.now();
    this.#routeWindow = window;
    this.stage.dataset.routeWindow = window;
    this.refreshRouteWindow();
    this.stage.dataset.routeWindowApplyMs = (performance.now() - started).toFixed(1);
  }

  refreshRouteWindow(now = Date.now()): boolean {
    const nextRoutes = routesInWindow([...this.#routesByID.values()], now, this.#routeWindow);
    const nextIDs = new Set(nextRoutes.map((route) => route.id));
    const changed = nextIDs.size !== this.#visibleRouteIDs.size
      || [...nextIDs].some((routeID) => !this.#visibleRouteIDs.has(routeID));
    this.#visibleRoutes = nextRoutes;
    this.#visibleRouteIDs = nextIDs;
    this.stage.dataset.visibleRoutes = String(nextRoutes.length);
    if (changed || nextRoutes.length > 0) {
      if (this.#selectedNodeID) this.#nodesDirty = true;
      this.#requestStaticDraw();
    }
    return changed;
  }

  getRouteWindowMS(): number {
    return netgraphWindowMS(this.#routeWindow);
  }

  getNodes(): ReadonlyMap<string, NodeV2> {
    return this.#nodesByID;
  }

  getRoute(id: string): RouteV2 | undefined { return this.#visibleRouteIDs.has(id) ? this.#routesByID.get(id) : undefined; }

  regionForNode(id: string): string {
    const code = this.#layout.positions.get(id)?.areaCode;
    const area = this.#layout.areas.find(area => area.code === code);
    return area ? `${area.code} · ${area.name}` : 'Unassigned';
  }

  setSelectedRoute(id: string | null): void {
    const next = id && this.getRoute(id) ? id : null;
    if (this.#selectedRouteID === next) return;
    this.#selectedRouteID = next;
    this.stage.dataset.selectedRouteId = this.#selectedRouteID ?? '';
    this.#nodesDirty = true; this.#requestStaticDraw();
  }

  connectedNodes(): NodeV2[] {
    return [...this.#layout.connectedNodeIDs]
      .map((nodeID) => this.#nodesByID.get(nodeID))
      .filter((node): node is NodeV2 => Boolean(node));
  }

  adjacentRoutes(nodeID: string): RouteV2[] {
    return [...(this.#adjacentRouteIDs.get(nodeID) ?? [])]
      .map((routeID) => this.#routesByID.get(routeID))
      .filter((route): route is RouteV2 => Boolean(route));
  }

  setSelectedNode(nodeID: string | null): void {
    this.#selectedNodeID = nodeID && this.#nodesByID.has(nodeID) ? nodeID : null;
    this.#nodesDirty = true;
    this.stage.dataset.selectedNodeId = this.#selectedNodeID ?? '';
    this.stage.dataset.focusedPacketEmphasis = '1';
    this.#requestStaticDraw();
  }

  followPacket(packet: PacketView): void {
    const ids = packet.mode === 'observer' ? [packet.observer.id] : packet.segments.flatMap(hop => [hop.from.id,hop.to.id]);
    const points = ids.map(id => this.#layout.positions.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
    if (!points.length) return;
    if (this.#focusIDs && points.some(point => !this.#focusIDs!.has(point.id))) this.setFocus('all');
    const view=this.#availableViewport();
    if (points.every(p => { const q=this.#screenPoint(p.id); return q.x>=view.left&&q.x<=view.right&&q.y>=view.top&&q.y<=view.bottom; })) return;
    const targets = points.map(p => this.#nodePoint(p.id)!);
    if (packet.mode === 'route') for (const hop of packet.segments) {
      const a = this.#nodePoint(hop.from.id), b = this.#nodePoint(hop.to.id);
      if (a && b) targets.push(graphArcPoint(a, b, 0.5, this.#crossArea(hop.from.id, hop.to.id)));
    }
    this.#framePoints(targets, this.#scale);
  }

  captureFollowArea(): (id: string) => boolean {
    const projection = this.#projection, width = this.#width, height = this.#height;
    return id => { const point = this.#nodePoint(id); if (!point) return false;
      const p = projection.project(point); return p.visible && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height; };
  }

  holdView(): void { this.#cancelViewAnimation(); }

  selectedNode(): string | null { return this.#selectedNodeID; }

  setFocus(mode: 'all' | 'area' | 'component'): boolean {
    const anchor = this.#selectedNodeID ? this.#layout.positions.get(this.#selectedNodeID) : undefined;
    if (mode !== 'all' && !anchor) return false;
    this.#focusMode = mode; this.#focusAnchorID = this.#selectedNodeID;
    this.#refreshFocus();
    this.#screenPoints.clear(); this.#screenPaths.clear(); this.#nodesDirty = true; this.#residueProjectionDirty = true;
    this.#requestStaticDraw(); this.#requestMotionFrame();
    return true;
  }

  #refreshFocus(): void {
    this.#focusIDs = focusedNodeIDs(this.#layout, this.#focusMode, this.#focusAnchorID);
    if (!this.#focusIDs) this.#focusMode = 'all';
    this.stage.dataset.focusMode = this.#focusMode;
    this.callbacks.onViewChange?.();
  }

  focusNode(nodeID: string): void {
    const anchor = this.#nodePoint(nodeID);
    if (!anchor) return;
    if (this.#focusIDs && !this.#focusIDs.has(nodeID)) this.setFocus('all');
    const points = [anchor];
    for (const route of this.adjacentRoutes(nodeID)) {
      if (!this.#visibleRouteIDs.has(route.id)) continue;
      const a = this.#nodePoint(route.fromId), b = this.#nodePoint(route.toId);
      if (!a || !b) continue;
      if (this.#focusIDs && (!this.#focusIDs.has(route.fromId) || !this.#focusIDs.has(route.toId))) this.setFocus('all');
      points.push(a, b, graphArcPoint(a, b, 0.5, this.#isInterAreaRoute(route)));
    }
    this.#framePoints(points, 2.5);
  }

  focusRoute(id: string): void {
    const route = this.getRoute(id);
    const a = route && this.#nodePoint(route.fromId), b = route && this.#nodePoint(route.toId);
    if (route && a && b) {
      if (this.#focusIDs && (!this.#focusIDs.has(route.fromId) || !this.#focusIDs.has(route.toId))) this.setFocus('all');
      this.#framePoints([a, b, graphArcPoint(a, b, 0.5, this.#isInterAreaRoute(route))], 2.5);
    }
  }

  is3D(): boolean { return this.#mode3D; }
  tiltDegrees(): number { return Math.round(this.#tilt * 180 / Math.PI); }

  set3D(enabled: boolean): void {
    this.#clearPointers(); this.#cancelViewAnimation(); this.#mode3D = enabled;
    this.#animateView(this.#centerX, this.#centerY, this.#scale, enabled ? this.#yaw : 0, enabled ? GRAPH_TILT : 0);
    this.stage.dataset.viewMode = enabled ? '3d' : 'top-down';
    this.callbacks.onViewChange?.();
  }

  rotateBy(radians: number, tiltDelta = 0): void {
    if (!this.#mode3D) return;
    this.#cancelViewAnimation(); this.#yaw += radians;
    this.#tilt = clamp(this.#tilt + tiltDelta, 0.12, MAX_GRAPH_TILT); this.#viewChanged();
  }

  setTilt(degrees: number): void {
    if (!this.#mode3D || !Number.isFinite(degrees)) return;
    this.#cancelViewAnimation(); this.#tilt = clamp(degrees * Math.PI / 180, 0.12, MAX_GRAPH_TILT); this.#viewChanged();
  }

  home(animate = true): void {
    const bounds = this.#layout.bounds;
    const points = [{ x: bounds.minX, y: bounds.minY }, { x: bounds.minX, y: bounds.maxY },
      { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY },
      { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, z: 650 }];
    const next = fitGraphCamera(this.#camera(), points, this.#width, this.#height, this.#availableViewport());
    this.#initializedView = true;
    if (animate && !prefersReducedMotion()) this.#animateView(next.x, next.y, next.zoom);
    else {
      this.#cancelViewAnimation();
      this.#centerX = next.x;
      this.#centerY = next.y;
      this.#scale = next.zoom;
      this.#viewChanged();
    }
  }

  addPacket(packet: PacketView): void {
    if (this.#paused) return;
    const now = performance.now();
    const color = payloadColor(packet.payloadType);
    const signature = packetSignature(packet.payloadType);
    const regionTraffic = planRegionTraffic(packet, this.#assignedAreas, now);
    if (regionTraffic) this.#addRegionTrafficPlan(regionTraffic);
    if (packet.mode === 'observer') {
      if (this.#layout.positions.has(packet.observer.id)) {
        this.#observerWakes.push({ endpoint: packet.observer, color, signature, started: now });
      }
    } else if (packet.segments.length > 0) {
      const active: ActiveRoute = {
        packet,
        color,
        signature,
        started: now,
        duration: routeDuration(packet.segments),
        weights: segmentTravelWeights(packet.segments),
        completedSegments: 0,
        crossRegion: regionTraffic?.crossRegion ?? false,
        longHaul: regionTraffic?.longHaul ?? false,
      };
      if (prefersReducedMotion()) {
        for (const segment of packet.segments) this.#addResidue(segment.routeId, segment.from.id, segment.to.id, color, signature, now);
      } else {
        this.#activeRoutes.push(active);
      }
      this.stage.dataset.lastPacketKind = normalizePacketKind(packet.payloadType);
      this.stage.dataset.lastPacketHops = String(packet.segments.length);
      this.stage.dataset.lastPacketRange = regionTraffic?.longHaul
        ? 'long-haul'
        : regionTraffic?.crossRegion ? 'cross-region' : 'local';
    }
    this.#requestMotionFrame();
    this.#scheduleReducedMotionCleanup();
  }

  preparePacket(packet: PacketView): void {
    if (packet.mode !== 'route' || packet.segments.every((segment) => (
      this.#layout.positions.has(segment.from.id) && this.#layout.positions.has(segment.to.id)
    ))) return;
    const routes = new Map(this.#routesByID);
    for (const segment of packet.segments) {
      if (routes.has(segment.routeId)) continue;
      routes.set(segment.routeId, {
        id: segment.routeId,
        fromId: segment.from.id,
        toId: segment.to.id,
        packetCount: 1,
        lastHeard: packet.at,
        intensity: 0,
        lastKind: normalizePacketKind(packet.payloadType),
        traffic: 1,
      });
    }
    this.#layout = extendNetgraphLayout(
      this.#layout,
      [...this.#nodesByID.values()],
      [...routes.values()],
      this.#assignedAreas,
    );
    this.#refreshFocus();
    this.#resetProjection();
    this.#residueProjectionDirty = true;
    this.#residueDirty = true;
    this.#nodesDirty = true;
    this.stage.dataset.connectedNodes = String(this.#layout.connectedNodeIDs.size);
    this.stage.dataset.components = String(this.#layout.componentCount);
    this.stage.dataset.areas = String(this.#layout.areas.length);
    this.#requestStaticDraw();
  }

  setPaused(paused: boolean): void {
    this.#paused = paused;
    if (paused) {
      this.#gpu.batch.clear(); this.#gpu.flush(this.#width,this.#height,this.#dpr);
      this.#lastMotionAt = 0;
      this.#quality.resetSamples();
      this.#clearPointers();
      this.#cancelViewAnimation();
      this.#activeRoutes = [];
      this.#observerWakes = [];
      this.#residue = [];
      this.#residueDirty = true;
      this.#regionActivityCues = [];
      this.stage.dataset.activeRegionLabels = '0';
      this.#clearResidueCleanup();
      if (this.#motionFrame) cancelAnimationFrame(this.#motionFrame);
      this.#motionFrame = 0;
      this.#packetContext.clearRect(0, 0, this.#width, this.#height);
      this.#residueContext.clearRect(0, 0, this.#width, this.#height);
    }
  }

  project(coordinates: [number, number]): ScreenPoint {
    const nodeID = this.#coordinateNodeIDs.get(coordinateKey(coordinates[0], coordinates[1]));
    return nodeID ? this.#screenPoint(nodeID) : { x: -1_000_000, y: -1_000_000 };
  }

  projectEndpoint(endpoint: EndpointV2): ScreenPoint {
    return this.#screenPoint(endpoint.id);
  }

  projectSegment(segment: { from: EndpointV2; to: EndpointV2; routeId: string }): readonly SurfacePoint[] {
    return this.#routePath(segment.from.id, segment.to.id);
  }

  destroy(): void {
    this.#gpu.destroy();
    window.removeEventListener(DISPLAY_EVENT, this.#refreshAppearance);
    this.#clearPointers();
    this.stage.removeEventListener('pointerdown', this.#handlePointerDown);
    this.stage.removeEventListener('pointermove', this.#handlePointerMove);
    this.stage.removeEventListener('pointerup', this.#handlePointerUp);
    this.stage.removeEventListener('pointercancel', this.#handlePointerCancel);
    this.stage.removeEventListener('lostpointercapture', this.#handlePointerCancel);
    this.stage.removeEventListener('wheel', this.#handleWheel);
    this.stage.removeEventListener('dblclick', this.#handleDoubleClick);
    this.stage.removeEventListener('contextmenu', this.#handleContextMenu);
    this.#reducedMotionQuery.removeEventListener('change', this.#handleMotionPreference);
    this.#resizeObserver?.disconnect();
    if (!this.#resizeObserver) window.removeEventListener('resize', this.handleResize);
    if (this.#staticFrame) cancelAnimationFrame(this.#staticFrame);
    if (this.#motionFrame) cancelAnimationFrame(this.#motionFrame);
    this.#clearResidueCleanup();
    this.#cancelViewAnimation();
    this.#residueCanvas.remove();
  }

  private handleResize(): void {
    const rect = this.stage.getBoundingClientRect();
    this.#width = Math.max(1, Math.round(rect.width));
    this.#height = Math.max(1, Math.round(rect.height));
    this.#paintedView = undefined;
    this.graphCanvas.style.transform = '';
    // Match the map's mobile animation budget instead of painting four pixels
    // per CSS pixel on every frame in an Android WebView.
    this.#dpr = Math.min(this.#lowPowerQuery.matches ? 1.25 : 1.5, Math.max(1, devicePixelRatio || 1));
    this.#regionLabelSprites.clear();
    this.#sizeCanvas(this.graphCanvas, this.#graphContext);
    this.#sizeCanvas(this.packetCanvas, this.#packetContext, this.#quality.mode === 'low' ? 1 : this.#dpr);
    this.#sizeCanvas(this.#residueCanvas, this.#residueContext, this.#quality.mode === 'low' ? 1 : this.#dpr);
    this.#residueProjectionDirty = true;
    this.#sizeCanvas(this.#nodesCanvas, this.#nodesContext);
    if (!this.#initializedView && this.#layout.positions.size > 0) this.home(false);
    this.#rebaseGesture();
    this.#viewChanged();
  }

  #sizeCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, dpr = this.#dpr): void {
    const width = Math.round(this.#width * dpr);
    const height = Math.round(this.#height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    canvas.style.width = `${this.#width}px`;
    canvas.style.height = `${this.#height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  #requestStaticDraw(): void {
    if (this.#tilt === 0 && this.#quality.mode === 'low' && this.#pointers.size && this.#paintedView) {
      this.stage.dataset.renderState = 'composited';
      return;
    }
    if (this.#staticFrame) return;
    this.stage.dataset.renderState = 'scheduled';
    this.#staticFrame = requestAnimationFrame(() => {
      this.#staticFrame = 0;
      if (this.#tilt === 0 && this.#quality.mode === 'low' && this.#pointers.size && this.#paintedView) return;
      this.#drawStatic();
    });
  }

  #drawStatic(): void {
    const started = performance.now();
    const context = this.#graphContext;
    context.clearRect(0, 0, this.#width, this.#height);
    this.#drawGrid(context);
    this.#drawAreaHalos(context);
    this.#drawRoutes(context);
    if (this.#nodesDirty) {
      this.#nodesContext.clearRect(0, 0, this.#width, this.#height);
      this.#drawNodes(this.#nodesContext);
      this.#nodesDirty = false;
    }
    context.drawImage(this.#nodesCanvas, 0, 0, this.#width, this.#height);
    this.#drawAreaLabels(context);
    this.#paintedView = { x: this.#centerX, y: this.#centerY, scale: this.#scale };
    this.graphCanvas.style.transform = '';
    this.stage.dataset.staticDrawMs = (performance.now() - started).toFixed(1);
    this.stage.dataset.renderState = 'idle';
  }

  #drawGrid(context: CanvasRenderingContext2D): void {
    if (this.#tilt > 0) {
      const step = 10 ** Math.ceil(Math.log10(60 / this.#scale));
      const cx = Math.round(this.#centerX / step) * step, cy = Math.round(this.#centerY / step) * step;
      context.save(); context.beginPath();
      for (let i = -12; i <= 12; i++) {
        for (const [a, b] of [[{ x: cx + i * step, y: cy - 12 * step }, { x: cx + i * step, y: cy + 12 * step }],
          [{ x: cx - 12 * step, y: cy + i * step }, { x: cx + 12 * step, y: cy + i * step }]]) {
          const from = this.#projection.project(a!), to = this.#projection.project(b!);
          if (from.visible && to.visible) { context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); }
        }
      }
      context.strokeStyle = lightScene() ? 'rgba(35,82,88,0.08)' : 'rgba(93,176,183,0.07)';
      context.lineWidth = 0.7; context.stroke(); context.restore(); return;
    }
    const spacing = Math.max(42, Math.min(96, 64 * this.#scale));
    const offsetX = modulo(this.#width / 2 - this.#centerX * this.#scale, spacing);
    const offsetY = modulo(this.#height / 2 - this.#centerY * this.#scale, spacing);
    context.save();
    context.strokeStyle = lightScene() ? 'rgba(35, 82, 88, 0.1)' : 'rgba(93, 176, 183, 0.075)';
    context.lineWidth = 1;
    context.beginPath();
    for (let x = offsetX; x <= this.#width; x += spacing) {
      context.moveTo(Math.round(x) + 0.5, 0);
      context.lineTo(Math.round(x) + 0.5, this.#height);
    }
    for (let y = offsetY; y <= this.#height; y += spacing) {
      context.moveTo(0, Math.round(y) + 0.5);
      context.lineTo(this.#width, Math.round(y) + 0.5);
    }
    context.stroke();
    context.restore();
  }

  #visibleAreas(): Array<{ area: NetgraphLayout['areas'][number]; point: ScreenPoint; radius: number }> {
    return this.#layout.areas
      .map((area) => { const point = this.#worldToScreen(area.x, area.y); return { area, point, radius: area.radius * this.#scale * (point.scale ?? 1) }; })
      .filter(({ point, radius }) => (
        point.x + radius >= -80 && point.x - radius <= this.#width + 80
        && point.y + radius >= -80 && point.y - radius <= this.#height + 80
      ));
  }

  #drawAreaHalos(context: CanvasRenderingContext2D): void {
    context.save();
    context.setLineDash([4, 7]);
    for (const { area, point, radius } of this.#visibleAreas()) {
      if (radius < 5) continue;
      if (this.#tilt > 0) {
        context.setLineDash([]); context.beginPath();
        for (let index = 0; index <= 32; index++) {
          const angle = index * Math.PI / 16;
          const p = this.#worldToScreen(area.x + Math.cos(angle) * area.radius, area.y + Math.sin(angle) * area.radius, -8);
          if (index === 0) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y);
        }
        context.closePath(); context.fillStyle = lightScene() ? 'rgba(212,226,216,0.48)' : 'rgba(15,48,56,0.48)'; context.fill();
        context.strokeStyle = lightScene() ? 'rgba(40,91,94,0.38)' : 'rgba(108,219,212,0.33)';
        context.lineWidth = 1; context.stroke(); continue;
      }
      const edge = Math.max(8, radius);
      const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, edge);
      glow.addColorStop(0, lightScene() ? 'rgba(0, 105, 87, 0.055)' : 'rgba(69, 220, 202, 0.055)');
      glow.addColorStop(0.72, lightScene() ? 'rgba(0, 105, 87, 0.022)' : 'rgba(39, 139, 150, 0.022)');
      glow.addColorStop(1, 'rgba(39, 139, 150, 0)');
      context.beginPath();
      context.arc(point.x, point.y, edge, 0, Math.PI * 2);
      context.fillStyle = glow;
      context.fill();
      context.strokeStyle = lightScene() ? 'rgba(35, 85, 90, 0.36)' : 'rgba(110, 220, 217, 0.25)';
      context.lineWidth = 0.8;
      context.stroke();
    }

    context.restore();
  }

  #drawAreaLabels(context: CanvasRenderingContext2D): void {
    context.save();
    const occupied: LabelRect[] = [];
    const labels = this.#visibleAreas().sort((left, right) => right.area.nodeCount - left.area.nodeCount || left.area.code.localeCompare(right.area.code));
    for (const { area, point, radius } of labels) {
      if (area.nodeCount < 2 && this.#scale < 0.16) continue;
      const title = `${area.code} · ${area.name}`;
      const detail = `${area.nodeCount.toLocaleString()} nodes`;
      context.font = '750 11px Inter, ui-sans-serif, system-ui, sans-serif';
      const titleWidth = this.#textWidth(context, title);
      context.font = '600 8px Inter, ui-sans-serif, system-ui, sans-serif';
      const detailWidth = this.#textWidth(context, detail);
      const width = Math.max(titleWidth, detailWidth) + 16;
      const height = 31;
      const x = clamp(point.x - width / 2, 6, Math.max(6, this.#width - width - 6));
      const verticalRadius = radius * Math.cos(this.#tilt);
      let y = point.y - Math.max(22, verticalRadius) - height - 9;
      if (y < 64) y = point.y + Math.max(22, verticalRadius) + 9;
      const labelCenterX = x + width / 2;
      const rect = { x, y, width, height };
      if (x + width < 5 || x > this.#width - 5 || y + height < 5 || y > this.#height - 5) continue;
      if (occupied.some((other) => rectanglesOverlap(rect, other, 5))) continue;
      occupied.push(rect);

      const connectorY = y < point.y ? y + height : y;
      context.beginPath();
      context.moveTo(labelCenterX, connectorY);
      context.lineTo(point.x, y < point.y ? point.y - Math.max(8, verticalRadius) : point.y + Math.max(8, verticalRadius));
      context.strokeStyle = lightScene() ? 'rgba(35,85,90,0.3)' : 'rgba(111,219,215,0.18)';
      context.lineWidth = 0.8;
      context.stroke();
      roundRect(context, x, y, width, height, 7);
      context.fillStyle = lightScene() ? 'rgba(247, 249, 241, 0.95)' : 'rgba(4, 17, 22, 0.88)';
      context.fill();
      context.strokeStyle = 'rgba(119, 225, 219, 0.2)';
      context.stroke();
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = '750 11px Inter, ui-sans-serif, system-ui, sans-serif';
      context.fillStyle = lightScene() ? '#24474d' : 'rgba(220, 250, 247, 0.92)';
      context.fillText(title, labelCenterX, y + 11);
      context.font = '600 8px Inter, ui-sans-serif, system-ui, sans-serif';
      context.fillStyle = lightScene() ? '#3e5c61' : 'rgba(116, 158, 166, 0.92)';
      context.fillText(detail, labelCenterX, y + 23);
    }
    context.restore();
  }

  #drawRoutes(context: CanvasRenderingContext2D): void {
    const now = Date.now();
    const detail = displayPreferences().detail === 'complete' || this.#visibleRoutes.length < 2000;
    const selected = this.#selectedNodeID;
    const selectedRoutes = new Set(selected ? this.#adjacentRouteIDs.get(selected) : []);
    if (this.#selectedRouteID) selectedRoutes.add(this.#selectedRouteID);
    const inspecting = Boolean(selected || this.#selectedRouteID);
    const groups = new Map<string, { kind: PacketKind; interArea: boolean; routes: RouteV2[] }>();
    const recentGroups = new Map<string, { kind: PacketKind; ageBucket: number; intensity: number; interArea: boolean; routes: RouteV2[] }>();
    for (const route of this.#visibleRoutes) {
      if (selectedRoutes.has(route.id)) continue;
      const kind = normalizePacketKind(route.lastKind);
      const interArea = this.#isInterAreaRoute(route);
      const scope = interArea ? 'inter' : 'local';
      const groupKey = `${kind}:${scope}`;
      const group = groups.get(groupKey) ?? { kind, interArea, routes: [] };
      group.routes.push(route);
      groups.set(groupKey, group);
      const age = Math.max(0, now - route.lastHeard);
      if (detail && age <= 60 * 60_000) {
        const ageBucket = Math.min(3, Math.floor(age / (15 * 60_000)));
        const intensity = clamp(Math.round(route.intensity), 0, 4);
        const key = `${kind}:${ageBucket}:${intensity}:${scope}`;
        const recent = recentGroups.get(key) ?? { kind, ageBucket, intensity, interArea, routes: [] };
        recent.routes.push(route);
        recentGroups.set(key, recent);
      }
    }

    context.save();
    context.lineCap = 'round';
    for (const group of groups.values()) {
      context.setLineDash(lineDash());
      context.beginPath();
      for (const route of group.routes) this.#appendRoute(context, route);
      context.strokeStyle = lightScene() ? 'rgba(249, 252, 245, 0.85)' : 'rgba(3, 14, 19, 0.8)';
      context.lineWidth = displayPreferences().width + 1.5;
      context.globalAlpha = inspecting ? 0.1 : displayPreferences().opacity;
      context.stroke();
      context.globalAlpha = 1;
      context.strokeStyle = colorWithAlpha(PACKET_KIND_COLORS[group.kind], (inspecting ? 0.1 : lightScene() ? 0.95 : 0.5) * displayPreferences().opacity);
      context.lineWidth = displayPreferences().width;
      context.stroke();
    }

    for (const group of this.#quality.mode === 'low' ? [] : recentGroups.values()) {
      context.setLineDash(lineDash());
      context.beginPath();
      for (const route of group.routes) this.#appendRoute(context, route);
      const ageStrength = 1 - (group.ageBucket + 0.5) / 4;
      context.strokeStyle = colorWithAlpha(PACKET_KIND_COLORS[group.kind], ageStrength * (inspecting ? 0.08 : group.interArea ? 0.19 : 0.3));
      context.lineWidth = displayPreferences().width + group.intensity * 0.12;
      context.stroke();
    }

    if (inspecting) {
      context.setLineDash([]);
      for (const routeID of selectedRoutes) {
        const route = this.#routesByID.get(routeID);
        if (!route || !this.#visibleRouteIDs.has(route.id)) continue;
        const color = PACKET_KIND_COLORS[normalizePacketKind(route.lastKind)];
        context.beginPath();
        this.#appendRoute(context, route);
        context.strokeStyle = colorWithAlpha(color, 0.18 * displayPreferences().glow);
        context.lineWidth = 7;
        context.stroke();
        context.beginPath();
        this.#appendRoute(context, route);
        context.strokeStyle = colorWithAlpha(color, 0.86);
        context.lineWidth = displayPreferences().width + 0.5;
        context.stroke();
      }
    }
    context.restore();
  }

  #isInterAreaRoute(route: RouteV2): boolean {
    const from = this.#layout.positions.get(route.fromId);
    const to = this.#layout.positions.get(route.toId);
    return Boolean(from && to && from.areaCode !== to.areaCode);
  }

  #appendRoute(context: CanvasRenderingContext2D, route: RouteV2): void {
    const path = this.#routePath(route.fromId, route.toId);
    if (this.#pathVisible(path, 8)) this.#appendPath(context, path);
  }

  #drawNodes(context: CanvasRenderingContext2D): void {
    const selectedRoutes = new Set(this.#selectedNodeID ? this.#adjacentRouteIDs.get(this.#selectedNodeID) : []);
    if (this.#selectedRouteID) selectedRoutes.add(this.#selectedRouteID);
    const selectedNeighbors = new Set<string>();
    for (const routeID of selectedRoutes) {
      const route = this.#routesByID.get(routeID);
      if (!route || !this.#visibleRouteIDs.has(route.id)) continue;
      selectedNeighbors.add(route.fromId); selectedNeighbors.add(route.toId);
    }
    const nodeRecords: ScreenNode[] = [];
    for (const position of this.#layout.positions.values()) {
      const node = this.#nodesByID.get(position.id);
      if (!node) continue;
      const point = this.#screenPoint(position.id);
      if (point.x < -24 || point.x > this.#width + 24 || point.y < -24 || point.y > this.#height + 24) continue;
      // At overview zoom, oversized discs overlap hundreds of neighbours and
      // overwhelm both the picture and the rasterizer. Keep every node, with
      // smaller marks until detail zoom (touch hit targets stay unchanged).
      const detail = Math.min(1, Math.sqrt(this.#scale / 0.7));
      const perspective = this.#tilt > 0 ? Math.sqrt(clamp((point as SurfacePoint).scale ?? 1, 0.5, 1.8)) : 1;
      const radius = clamp(((2.5 + Math.log2(1 + position.degree) * 0.7) * detail + Math.sqrt(this.#scale) * 0.55) * perspective, node.id === this.#selectedNodeID ? 3.5 : 0.9, 8);
      nodeRecords.push({ node, point, radius, degree: position.degree });
    }
    this.#screenNodes = nodeRecords;

    context.save();
    if (this.#tilt > 0 && this.#scale > 0.15) {
      context.beginPath();
      for (const { node, point } of nodeRecords) {
        const position = this.#layout.positions.get(node.id)!;
        const ground = this.#worldToScreen(position.x, position.y);
        context.moveTo(ground.x, ground.y); context.lineTo(point.x, point.y);
      }
      context.strokeStyle = lightScene() ? 'rgba(34,86,91,0.25)' : 'rgba(111,220,213,0.2)'; context.lineWidth = 0.7; context.stroke();
    }
    const groups = new Map<string, { records: ScreenNode[]; selected: boolean; neighbor: boolean; muted: boolean }>();
    for (const record of nodeRecords) {
      const { node } = record;
      const selected = node.id === this.#selectedNodeID;
      const neighbor = selectedNeighbors.has(node.id);
      const muted = Boolean(this.#selectedNodeID || this.#selectedRouteID) && !selected && !neighbor;
      const key = `${node.role}:${selected}:${neighbor}:${muted}`;
      const group = groups.get(key) ?? { records: [], selected, neighbor, muted };
      group.records.push(record);
      groups.set(key, group);
    }
    for (const { records, selected, neighbor, muted } of [...groups.values()].sort((a, b) => Number(a.selected || a.neighbor) - Number(b.selected || b.neighbor))) {
      const color = ROLE_COLORS[records[0]!.node.role];
      // Small batches avoid both per-node draw overhead and giant overlapping
      // paths that are expensive to tessellate when fully zoomed out.
      for (let offset = 0; offset < records.length; offset += 64) {
        const batch = records.slice(offset, offset + 64);
        if (selected || neighbor) {
          context.beginPath();
          for (const { point, radius } of batch) {
            const glowRadius = radius + (selected ? 11 : 6);
            context.moveTo(point.x + glowRadius, point.y);
            context.arc(point.x, point.y, glowRadius, 0, Math.PI * 2);
          }
          context.fillStyle = colorWithAlpha(color, selected ? 0.16 : 0.09);
          context.fill();
        }
        context.beginPath();
        for (const { node, point, radius } of batch) this.#nodeShape(context, node.role, point, radius);
        context.fillStyle = colorWithAlpha(color, muted ? 0.24 : selected ? 1 : neighbor ? 0.9 : 0.68);
        context.fill();
        context.strokeStyle = colorWithAlpha('#eaffff', muted ? 0.08 : selected ? 0.92 : 0.36);
        context.lineWidth = selected ? 1.8 : 0.8;
        context.stroke();
        if (this.#tilt > 0 && this.#quality.mode !== 'low') {
          context.beginPath();
          for (const { point, radius } of batch) {
            context.moveTo(point.x - radius * 0.1, point.y - radius * 0.35);
            context.arc(point.x - radius * 0.35, point.y - radius * 0.35, radius * 0.25, 0, Math.PI * 2);
          }
          context.fillStyle = lightScene() ? 'rgba(255,255,255,0.6)' : 'rgba(229,255,250,0.55)'; context.fill();
        }
        context.beginPath();
        for (const { node, point, radius } of batch) {
          if (!node.observer) continue;
          context.moveTo(point.x + radius + 3.3, point.y);
          context.arc(point.x, point.y, radius + 3.3, 0, Math.PI * 2);
        }
        context.strokeStyle = colorWithAlpha(color, muted ? 0.12 : 0.55);
        context.lineWidth = 0.8;
        context.stroke();
      }
    }

    const labelCandidates = nodeRecords
      .filter(({ node, degree }) => (
        node.id === this.#selectedNodeID
        || this.#selectedRouteID !== null && selectedNeighbors.has(node.id)
        || node.id === this.#hoveredNodeID
        || displayPreferences().detail === 'complete'
        || this.#scale >= 0.42 && degree >= (this.#scale < 0.7 ? 18 : this.#scale < 1.3 ? 8 : 3)
      ))
      .sort((left, right) => Number(right.node.id === this.#selectedNodeID) - Number(left.node.id === this.#selectedNodeID) || right.degree - left.degree)
      .slice(0, displayPreferences().detail === 'complete' ? 500 : this.#scale < 0.7 ? 22 : this.#scale < 1.3 ? 54 : 120);
    const labelBoxes: LabelRect[] = [];
    context.font = `600 ${displayPreferences().textSize === 'large' ? 13 : 11}px Inter, ui-sans-serif, system-ui, sans-serif`;
    context.textBaseline = 'middle';
    for (const { node, point, radius } of labelCandidates) {
      const label = truncateLabel(node.label, 28);
      const width = context.measureText(label).width;
      const x = point.x + radius + 6;
      const y = point.y;
      const box = {x:x-3,y:y-9,width:width+6,height:18};
      if (node.id !== this.#selectedNodeID && labelBoxes.some(other => rectanglesOverlap(box,other,3))) continue;
      labelBoxes.push(box);
      context.fillStyle = lightScene() ? 'rgba(247, 249, 241, 0.9)' : 'rgba(4, 14, 19, 0.78)';
      roundRect(context, x - 3, y - 8, width + 6, 16, 5);
      context.fill();
      context.fillStyle = lightScene() ? '#24474d' : node.id === this.#selectedNodeID ? '#f2ffff' : 'rgba(205, 229, 234, 0.9)';
      context.fillText(label, x, y + 0.5);
    }
    context.restore();
  }

  #nodeShape(context: CanvasRenderingContext2D, role: NodeRole, point: ScreenPoint, radius: number): void {
    if (role === 'room_server') {
      context.moveTo(point.x, point.y - radius * 1.2);
      context.lineTo(point.x + radius * 1.2, point.y);
      context.lineTo(point.x, point.y + radius * 1.2);
      context.lineTo(point.x - radius * 1.2, point.y);
      context.closePath();
    } else if (role === 'sensor') {
      context.rect(point.x - radius, point.y - radius, radius * 2, radius * 2);
    } else if (role === 'companion') {
      const angle = -Math.PI / 2;
      for (let index = 0; index < 3; index += 1) {
        const current = angle + index * Math.PI * 2 / 3;
        const x = point.x + Math.cos(current) * radius * 1.2;
        const y = point.y + Math.sin(current) * radius * 1.2;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
    } else {
      context.moveTo(point.x + radius, point.y);
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    }
  }

  #requestMotionFrame(): void {
    if (this.#paused || this.#motionFrame) return;
    this.#motionFrame = requestAnimationFrame(this.drawMotion);
  }

  private drawMotion(now: number): void {
    const started = performance.now();
    this.#motionFrame = 0;
    const context = this.#packetContext;
    const ratio = this.#quality.mode === 'low' ? 1 : this.#dpr;
    if (this.packetCanvas.width !== Math.round(this.#width * ratio)) {
      this.#sizeCanvas(this.packetCanvas, context, ratio);
      this.#sizeCanvas(this.#residueCanvas, this.#residueContext, ratio);
      this.#residueProjectionDirty = true;
    }
    context.clearRect(0, 0, this.#width, this.#height);
    this.#gpu.batch.begin(this.#width, this.#height);
    this.stage.dataset.effectsRenderer = this.#gpu.batch.ready ? 'webgl2' : 'canvas2d';
    this.#activeRoutes = this.#activeRoutes.filter((route) => now - route.started <= route.duration + DESTINATION_BLOOM_MS);
    this.#observerWakes = this.#observerWakes.filter((wake) => now - wake.started <= 6_000);
    const residueCount = this.#residue.length;
    this.#residue = this.#residue.filter((item) => now - item.addedAt < residueLifetime());
    if (residueCount !== this.#residue.length) this.#residueProjectionDirty = true;
    this.#regionActivityCues = this.#regionActivityCues.filter((cue) => now < cue.startedAt + cue.duration);
    this.#drawResidue(context, now);
    this.stage.dataset.focusedPacketEmphasis = '1';
    for (const route of this.#activeRoutes) this.#drawActiveRoute(context, route, now);
    for (const wake of this.#observerWakes) this.#drawObserverWake(context, wake, now);
    this.#gpu.flush(this.#width, this.#height, ratio);
    const regionFrames = activeRegionFrames(this.#regionActivityCues, now, prefersReducedMotion());
    const drawnRegionRoles = this.#drawRegionActivity(context, regionFrames);
    this.stage.dataset.activePackets = String(this.#activeRoutes.length + this.#observerWakes.length);
    this.stage.dataset.residueCount = String(this.#residue.length);
    this.stage.dataset.activeRegionLabels = String(drawnRegionRoles.length);
    this.stage.dataset.activeRegionRoles = drawnRegionRoles.join(',');
    const visibleMotion = drawnRegionRoles.length > 0
      || this.#activeRoutes.some(({ packet }) => packet.segments.some((segment) => this.#pathVisible(this.#routePath(segment.from.id, segment.to.id), 28)))
      || this.#observerWakes.some((wake) => this.#pointVisible(this.#screenPoint(wake.endpoint.id), 48));
    if (!prefersReducedMotion() && visibleMotion) {
      if (this.#lastMotionAt && this.#quality.sample(now - this.#lastMotionAt, performance.now() - started)) {
        this.stage.dataset.qualityMode = this.#quality.mode;
      }
      this.#lastMotionAt = now;
      this.#requestMotionFrame();
    } else {
      this.#lastMotionAt = 0;
      this.#quality.resetSamples();
      this.#scheduleReducedMotionCleanup(now);
    }
  }

  #addRegionTrafficPlan(plan: RegionTrafficPlan): void {
    this.#regionActivityCues = capRegionActivity([...this.#regionActivityCues, ...plan.cues]);
    this.#regionAreasByTag.set(plan.source.code.toLowerCase(), plan.source);
    this.#regionAreasByTag.set(plan.destination.code.toLowerCase(), plan.destination);
    this.stage.dataset.lastRegionFrom = plan.source.code;
    this.stage.dataset.lastRegionTo = plan.destination.code;
    this.stage.dataset.lastRegionTraffic = plan.longHaul ? 'long-haul' : plan.crossRegion ? 'cross-region' : 'local';
    this.stage.dataset.lastRegionDistanceKm = plan.distanceKm.toFixed(1);
  }

  #drawRegionActivity(
    context: CanvasRenderingContext2D,
    frames: ReadonlyMap<string, RegionPulseFrame>,
  ): string[] {
    if (frames.size === 0) return [];
    const drawnRoles: string[] = [];
    context.save();
    context.textBaseline = 'middle';
    for (const [regionTag, frame] of frames) {
      const area = this.#layout.areas.find((candidate) => candidate.code.toLowerCase() === regionTag);
      const identity = this.#regionAreasByTag.get(regionTag);
      if (!area || !identity) continue;
      const point = this.#projection.endpoint({ x: area.x, y: area.y });
      const radius = Math.max(18, area.radius * this.#scale);
      if (
        point.x + radius < -120 || point.x - radius > this.#width + 120
        || point.y + radius < -120 || point.y - radius > this.#height + 120
      ) continue;

      const color = PACKET_KIND_COLORS[frame.kind];
      if (displayPreferences().detail === 'auto') {
        const direction = frame.role === 'send' ? 'OUT' : frame.role === 'receive' ? 'IN' : 'LOCAL';
        context.beginPath(); context.arc(point.x,point.y-radius*Math.cos(this.#tilt)-7,3.5,0,Math.PI*2);
        context.fillStyle = colorWithAlpha(color, .55 + frame.intensity*.4); context.fill();
        drawnRoles.push(`${regionTag.toUpperCase()}:${direction}`);
        continue;
      }
      const intensity = clamp(frame.intensity, 0, 1);
      const ringRadius = radius + 8 + frame.spread * (frame.longHaul ? 28 : 18);
      context.beginPath();
      surfaceArc(context, point, ringRadius);
      if (this.#quality.mode !== 'low') {
        context.strokeStyle = colorWithAlpha(color, intensity * 0.09);
        context.lineWidth = frame.longHaul ? 7 : 4;
        context.stroke();
      }
      context.strokeStyle = colorWithAlpha(color, intensity * (frame.longHaul ? 0.92 : 0.68));
      context.lineWidth = frame.longHaul ? 2.2 : 1.5;
      context.stroke();

      const direction = frame.role === 'send' ? 'OUT' : frame.role === 'receive' ? 'IN' : 'LOCAL';
      const title = `${frame.longHaul ? 'DX · ' : ''}${identity.code} · ${truncateLabel(identity.name, 30)}`;
      const label = this.#regionLabelSprite(title, direction, color);
      const labelWidth = label.width;
      const labelHeight = 30;
      const x = clamp(point.x - labelWidth / 2, 6, Math.max(6, this.#width - labelWidth - 6));
      let y = point.y - radius - labelHeight - 12;
      if (y < 60) y = point.y + radius + 12;
      y = clamp(y, 6, Math.max(6, this.#height - labelHeight - 6));

      context.beginPath();
      context.moveTo(point.x, y < point.y ? y + labelHeight : y);
      context.lineTo(point.x, y < point.y ? point.y - radius : point.y + radius);
      context.strokeStyle = colorWithAlpha(color, intensity * 0.72);
      context.lineWidth = 1;
      context.stroke();

      context.globalAlpha = 0.7 + intensity * 0.3;
      context.drawImage(label.canvas, x, y, labelWidth, labelHeight);
      context.globalAlpha = 1;
      drawnRoles.push(`${regionTag.toUpperCase()}:${direction}`);
    }
    context.restore();
    return drawnRoles;
  }

  #drawResidue(_context: CanvasRenderingContext2D, now: number): void {
    const interval = this.#quality.mode === 'low' ? 500 : this.#quality.mode === 'balanced' ? 250 : 125;
    if (shouldRefreshResidueCache(this.#residueCacheAt, now, this.#residueProjectionDirty, prefersReducedMotion() && this.#residueDirty, interval)) {
      this.#residueContext.clearRect(0, 0, this.#width, this.#height);
      this.#drawResidueLines(this.#residueContext, now);
      this.#residueCacheAt = now;
      this.#residueDirty = false;
      this.#residueProjectionDirty = false;
    }
    // The compositor retains this separate layer; do not copy a full-screen
    // canvas into the moving packet layer on every frame in Android WebView.
    if (prefersReducedMotion()) return;
    // Residue fades in place; only new packets travel along links.
  }

  #drawResidueLines(context: CanvasRenderingContext2D, now: number): void {
    context.save();
    context.lineCap = 'round';
    for (const residue of this.#residue) {
      const path = this.#routePath(residue.fromId, residue.toId);
      if (!this.#pathVisible(path, 12)) continue;
      const age = now - residue.addedAt;
      const style = residueStyle(displayResidueAge(age));
      context.beginPath();
      this.#appendPath(context, path);
      context.strokeStyle = colorWithAlpha(residue.color, style.bloomOpacity * displayPreferences().glow);
      context.lineWidth = style.bloomWidth;
      context.stroke();
      context.beginPath();
      this.#appendPath(context, path);
      context.strokeStyle = colorWithAlpha(residue.color, style.coreOpacity);
      context.lineWidth = style.coreWidth;
      context.stroke();
    }
    context.restore();
  }

  #drawActiveRoute(context: CanvasRenderingContext2D, active: ActiveRoute, now: number): void {
    const age = now - active.started;
    const motion = routeMotion(active.weights, age, active.duration);
    while (active.completedSegments < motion.completedSegments) {
      const segment = active.packet.segments[active.completedSegments];
      if (segment) this.#addResidue(segment.routeId, segment.from.id, segment.to.id, active.color, active.signature, now);
      active.completedSegments += 1;
    }

    for (let index = 0, boundary = 0; index < active.weights.length; index += 1) {
      boundary += active.weights[index] ?? 0;
      const handoffAge = age - boundary * active.duration;
      const endpoint = active.packet.segments[index]?.to;
      if (endpoint && handoffAge >= 0 && handoffAge <= RELAY_SPARK_MS) {
        this.#drawHandoff(context, this.#screenPoint(endpoint.id), active.color, handoffAge / RELAY_SPARK_MS);
      }
    }

    const source = active.packet.segments[0]?.from;
    if (source && age <= SOURCE_IGNITION_MS) this.#drawHandoff(context, this.#screenPoint(source.id), active.color, age / SOURCE_IGNITION_MS);
    if (age >= active.duration) {
      const destination = active.packet.segments.at(-1)?.to;
      if (destination) this.#drawDestination(context, this.#screenPoint(destination.id), active.color, (age - active.duration) / DESTINATION_BLOOM_MS);
      return;
    }

    const segment = active.packet.segments[motion.segmentIndex];
    if (!segment) return;
    const path = this.#routePath(segment.from.id, segment.to.id);
    if (!this.#pathVisible(path, 24)) return;
    const progress = easeInOut(motion.localProgress);
    const head = graphPathPoint(path, progress);
    if (!this.#pointVisible(head, 100)) return;
    const emphasis = active.packet.segments.some((hop) => hop.from.id === this.#selectedNodeID || hop.to.id === this.#selectedNodeID || hop.routeId === this.#selectedRouteID) ? 1.3 : 1;
    if (emphasis > 1) this.stage.dataset.focusedPacketEmphasis = String(emphasis);
    const trail = surfaceTrail(path, progress, 68 * displayPreferences().trailLength);
    if (this.#gpu.batch.packet(trail, head, active.color, active.signature, emphasis)) return;
    if (this.#quality.mode === 'low' || displayPreferences().quality === 'economy' || effectStrength() === 0) {
      traceSurfacePath(context, trail);
      context.strokeStyle = colorWithAlpha(active.color, 0.65);
      context.lineWidth = (active.longHaul ? 3.2 : 2.2) * emphasis;
      context.stroke();
      context.beginPath();
      context.arc(head.x, head.y, 3.25 * emphasis * displayPreferences().packetSize, 0, Math.PI * 2);
      context.fillStyle = displayColor(active.color);
      context.fill();
      return;
    }
    const tail = trail[0] ?? head;
    const gradient = context.createLinearGradient(tail.x, tail.y, head.x, head.y);
    gradient.addColorStop(0, colorWithAlpha(active.color, 0));
    gradient.addColorStop(0.46, colorWithAlpha(active.color, 0.32));
    gradient.addColorStop(1, colorWithAlpha(active.color, 0.96));
    context.save();
    context.lineCap = 'round';
    // Short, tapered strokes follow the same sampled curve as the packet core.
    for (let index = 1; index < trail.length; index++) {
      const a = trail[index - 1]!, b = trail[index]!;
      if (b.breakBefore) continue;
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
      context.strokeStyle = gradient;
      context.lineWidth = (1 + 2.7 * index / Math.max(1, trail.length - 1)) * emphasis;
      context.stroke();
    }
    const sparkCount = this.#quality.mode === 'balanced' || this.#activeRoutes.length > 40 ? 1 : this.#lowPowerQuery.matches ? 2 : 3;
    for (let index = 1; index <= sparkCount; index += 1) {
      const amount = Math.max(0, 1 - index * 0.2);
      const spark = graphPathPoint(path, Math.max(0, progress - (1 - amount) * 0.035));
      context.beginPath();
      context.arc(spark.x, spark.y, 1.5 - index * 0.18, 0, Math.PI * 2);
      context.fillStyle = colorWithAlpha(active.color, 0.68 - index * 0.13);
      context.fill();
    }
    const glowRadius = (active.longHaul ? 15 : active.crossRegion ? 12 : 10) * emphasis;
    context.globalAlpha = displayPreferences().glow * effectStrength();
    context.drawImage(this.#glowSprite(active.color), head.x - glowRadius, head.y - glowRadius, glowRadius * 2, glowRadius * 2);
    context.globalAlpha = 1;
    context.beginPath();
    context.arc(head.x, head.y, 3.25 * emphasis * displayPreferences().packetSize, 0, Math.PI * 2);
    context.fillStyle = displayColor(active.color);
    context.fill();
    if (this.#quality.mode === 'full') {
      const previous = trail.at(-2) ?? tail;
      drawPacketSignature(context, head, { x: head.x - previous.x, y: head.y - previous.y }, active.color, active.signature, age);
    }
    context.restore();
  }


  #drawHandoff(context: CanvasRenderingContext2D, point: SurfacePoint, color: string, progress: number): void {
    if (!this.#pointVisible(point, 28)) return;
    if (this.#tilt === 0 && this.#gpu.batch.disc(point, 5 + progress * 10, color, (1-progress)*.8, 2)) return;
    context.beginPath();
    surfaceArc(context, point, 5 + progress * 10);
    context.strokeStyle = colorWithAlpha(color, (1 - progress) * 0.8);
    context.lineWidth = 1.6;
    context.stroke();
  }

  #drawDestination(context: CanvasRenderingContext2D, point: SurfacePoint, color: string, progress: number): void {
    if (!this.#pointVisible(point, 28)) return;
    const opacity = Math.sin(Math.PI * clamp(progress, 0, 1));
    if (this.#tilt === 0 && this.#gpu.batch.disc(point, 7 + progress * 14, color, opacity*.8, 2)) return;
    context.beginPath();
    surfaceArc(context, point, 7 + progress * 14);
    context.fillStyle = colorWithAlpha(color, opacity * 0.18);
    context.fill();
    context.beginPath();
    context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
    context.fillStyle = colorWithAlpha(color, opacity * 0.92);
    context.fill();
  }

  #drawObserverWake(context: CanvasRenderingContext2D, wake: ObserverWake, now: number): void {
    const age = now - wake.started;
    const point = this.#screenPoint(wake.endpoint.id);
    if (!this.#pointVisible(point, 48)) return;
    const radius = nodeWakeRadius(age, wake.signature, prefersReducedMotion());
    const life = Math.pow(1 - clamp(age / 6_000, 0, 1), 2);
    context.beginPath();
    surfaceArc(context, point, radius);
    context.strokeStyle = colorWithAlpha(wake.color, life * 0.72);
    context.lineWidth = 1.4;
    context.stroke();
  }

  #addResidue(routeId: string, fromId: string, toId: string, color: string, signature: PacketSignature, addedAt: number): void {
    // Refresh an existing decorative trail without stacking it to white.
    // Active packet heads and their audio articulations are never coalesced.
    const previous = this.#residue.findIndex((item) => item.routeId === routeId && item.fromId === fromId && item.toId === toId && item.color === color);
    if (previous >= 0) this.#residue.splice(previous, 1);
    this.#residue.push({ routeId, fromId, toId, color, signature, addedAt });
    this.#trimResidue();
    this.#residueDirty = true;
  }

  #trimResidue(): void {
    this.#residue = capNewest(this.#residue, this.#lowPowerQuery.matches ? LOW_POWER_MAX_RESIDUE : MAX_RESIDUE);
  }

  #rebuildAdjacency(routes: readonly RouteV2[]): void {
    this.#adjacentRouteIDs.clear();
    for (const route of routes) {
      this.#addAdjacentRoute(route.fromId, route.id);
      this.#addAdjacentRoute(route.toId, route.id);
    }
  }

  #addAdjacentRoute(nodeID: string, routeID: string): void {
    const routes = this.#adjacentRouteIDs.get(nodeID) ?? new Set<string>();
    routes.add(routeID);
    this.#adjacentRouteIDs.set(nodeID, routes);
  }

  #scheduleReducedMotionCleanup(now = performance.now()): void {
    if (this.#residueCleanupTimer) return;
    const expiries = [
      ...this.#activeRoutes.map((route) => route.started + route.duration + DESTINATION_BLOOM_MS),
      ...this.#residue.map((item) => item.addedAt + residueLifetime()),
      ...this.#observerWakes.map((wake) => wake.started + 6_000),
      ...this.#regionActivityCues.map((cue) => cue.startedAt + cue.duration),
      ...this.#regionActivityCues.filter((cue) => cue.startedAt > now).map((cue) => cue.startedAt),
    ];
    if (expiries.length === 0) return;
    const nextExpiry = Math.min(...expiries, this.#residue.length ? now + 250 : Infinity);
    this.#residueCleanupTimer = window.setTimeout(() => {
      this.#residueCleanupTimer = 0;
      this.#requestMotionFrame();
    }, Math.max(0, nextExpiry - now) + 20);
  }

  #clearResidueCleanup(): void {
    if (!this.#residueCleanupTimer) return;
    window.clearTimeout(this.#residueCleanupTimer);
    this.#residueCleanupTimer = 0;
  }

  #screenPoint(nodeID: string): ScreenPoint {
    if (this.#focusIDs && !this.#focusIDs.has(nodeID)) return {x:-1_000_000,y:-1_000_000};
    const cached = this.#screenPoints.get(nodeID);
    if (cached) return cached;
    const position = this.#nodePoint(nodeID);
    const point = position ? this.#projection.endpoint(position) : { x: -1_000_000, y: -1_000_000 };
    this.#screenPoints.set(nodeID, point);
    return point;
  }

  #pointVisible(point: ScreenPoint, margin: number): boolean {
    return point.x >= -margin && point.y >= -margin && point.x <= this.#width + margin && point.y <= this.#height + margin;
  }

  #textWidth(context: CanvasRenderingContext2D, text: string): number {
    const key = `${context.font}:${text}`;
    let width = this.#textWidths.get(key);
    if (width === undefined) {
      width = context.measureText(text).width;
      this.#textWidths.set(key, width);
    }
    return width;
  }

  #glowSprite(color: string): HTMLCanvasElement {
    let sprite = this.#glowSprites.get(color);
    if (!sprite) {
      sprite = document.createElement('canvas');
      sprite.width = sprite.height = 64;
      const context = sprite.getContext('2d')!;
      const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      glow.addColorStop(0, colorWithAlpha(color, 0.65));
      glow.addColorStop(0.25, colorWithAlpha(color, 0.3));
      glow.addColorStop(1, colorWithAlpha(color, 0));
      context.fillStyle = glow;
      context.fillRect(0, 0, 64, 64);
      this.#glowSprites.set(color, sprite);
    }
    return sprite;
  }

  #regionLabelSprite(title: string, direction: string, color: string): { canvas: HTMLCanvasElement; width: number } {
    const key = `${title}:${direction}:${color}`;
    const cached = this.#regionLabelSprites.get(key);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    context.font = '800 11px Inter, ui-sans-serif, system-ui, sans-serif';
    const titleWidth = context.measureText(title).width;
    context.font = '850 9px Inter, ui-sans-serif, system-ui, sans-serif';
    const directionWidth = context.measureText(direction).width + 12;
    const width = Math.min(Math.max(110, titleWidth + directionWidth + 24), Math.max(110, this.#width - 12));
    canvas.width = Math.ceil(width * this.#dpr);
    canvas.height = Math.ceil(30 * this.#dpr);
    context.scale(this.#dpr, this.#dpr);
    roundRect(context, 1, 1, width - 2, 28, 8);
    context.fillStyle = lightScene() ? 'rgba(247, 249, 241, 0.96)' : 'rgba(3, 13, 18, 0.96)';
    context.fill();
    context.strokeStyle = colorWithAlpha(color, 0.92);
    context.lineWidth = 1.5;
    context.stroke();
    const badgeX = width - directionWidth - 6;
    roundRect(context, badgeX, 6, directionWidth, 18, 6);
    context.fillStyle = colorWithAlpha(color, 0.34);
    context.fill();
    context.strokeStyle = colorWithAlpha(color, 0.8);
    context.stroke();
    context.textBaseline = 'middle';
    context.font = '800 11px Inter, ui-sans-serif, system-ui, sans-serif';
    context.fillStyle = displayColor(color);
    context.fillText(title, 9, 15);
    context.textAlign = 'center';
    context.font = '850 9px Inter, ui-sans-serif, system-ui, sans-serif';
    context.fillText(direction, badgeX + directionWidth / 2, 15.5);
    const sprite = { canvas, width };
    if (this.#regionLabelSprites.size >= 64) this.#regionLabelSprites.delete(this.#regionLabelSprites.keys().next().value!);
    this.#regionLabelSprites.set(key, sprite);
    return sprite;
  }

  #nodePoint(id: string): GraphPoint | undefined {
    const point = this.#layout.positions.get(id);
    return point && { x: point.x, y: point.y, z: this.#nodesByID.get(id)?.observer ? 28 : 18 };
  }

  #camera(): GraphCamera {
    const b = this.#layout.bounds;
    return { x: this.#centerX, y: this.#centerY, zoom: this.#scale, yaw: this.#yaw, tilt: this.#tilt,
      distance: Math.max(1200, Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * 2) };
  }

  #resetProjection(): void {
    this.#projection = new GraphProjection(this.#camera(), this.#width, this.#height);
    this.#screenPoints.clear(); this.#screenPaths.clear();
  }

  #worldToScreen(x: number, y: number, z = 0): SurfacePoint { return this.#projection.project({ x, y, z }); }

  #screenToWorld(x: number, y: number): ScreenPoint { return this.#projection.ground(x, y); }

  #crossArea(from: string, to: string): boolean {
    return this.#layout.positions.get(from)?.areaCode !== this.#layout.positions.get(to)?.areaCode;
  }

  #routePath(fromID: string, toID: string): readonly SurfacePoint[] {
    if (this.#focusIDs && (!this.#focusIDs.has(fromID) || !this.#focusIDs.has(toID))) return [];
    const key = `${fromID}>${toID}`;
    const cached = this.#screenPaths.get(key);
    if (cached) return cached;
    const a = this.#nodePoint(fromID), b = this.#nodePoint(toID);
    if (!a || !b) return [];
    const path = projectGraphPath(this.#projection, a, b, this.#crossArea(fromID, toID));
    if (this.#screenPaths.size >= 40_000) this.#screenPaths.delete(this.#screenPaths.keys().next().value!);
    this.#screenPaths.set(key, path);
    return path;
  }

  #pathVisible(path: readonly SurfacePoint[], margin = 8): boolean {
    return path.some((point, i) => i > 0 && !point.breakBefore && segmentNearViewport(path[i - 1]!, point, this.#width, this.#height, margin));
  }

  #appendPath(context: CanvasRenderingContext2D, path: readonly SurfacePoint[]): void {
    for (let i = 0; i < path.length; i++) {
      const p = path[i]!;
      if (i === 0 || p.breakBefore) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y);
    }
  }

  #availableViewport() {
    const view = followViewport(this.stage);
    const inspector = document.getElementById('node-inspector-sheet');
    if (inspector && !inspector.hidden) {
      const stage = this.stage.getBoundingClientRect(), box = inspector.getBoundingClientRect();
      if (box.width > this.#width * 0.65) view.bottom = Math.min(view.bottom, box.top - stage.top - 16);
      else view.right = Math.min(view.right, box.left - stage.left - 16);
    }
    view.right = Math.max(view.left + 48, view.right); view.bottom = Math.max(view.top + 48, view.bottom);
    return view;
  }

  #framePoints(points: readonly GraphPoint[], maximumZoom: number): void {
    const next = fitGraphCamera(this.#camera(), points, this.#width, this.#height, this.#availableViewport(), maximumZoom);
    this.#animateView(next.x, next.y, next.zoom);
  }

  #viewChanged(): void {
    this.#resetProjection();
    this.#residueDirty = true;
    this.#residueProjectionDirty = true;
    this.#nodesDirty = true;
    this.stage.dataset.viewScale = String(this.#scale);
    this.stage.dataset.viewCenter = `${this.#centerX},${this.#centerY}`;
    this.stage.dataset.viewMode = this.#mode3D ? '3d' : 'top-down';
    this.stage.dataset.viewYaw = this.#yaw.toFixed(4); this.stage.dataset.viewTilt = this.#tilt.toFixed(4);
    if (this.#selectedNodeID) {
      const p = this.#screenPoint(this.#selectedNodeID); this.stage.dataset.selectedNodeScreen = `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }
    if (this.#selectedRouteID) {
      const r = this.getRoute(this.#selectedRouteID);
      if (r) { const p = graphPathPoint(this.#routePath(r.fromId, r.toId), 0.5); this.stage.dataset.selectedRouteScreen = `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }
    }
    this.callbacks.onViewChange?.();
    if (this.#tilt === 0 && this.#quality.mode === 'low' && this.#pointers.size && this.#paintedView) {
      // Reuse the actual rendered topology while fingers move. Its affine
      // transform is the same projection used by live packets and hit testing.
      const scale = this.#scale / this.#paintedView.scale;
      const x = (this.#paintedView.x - this.#centerX) * this.#scale + this.#width / 2 * (1 - scale);
      const y = (this.#paintedView.y - this.#centerY) * this.#scale + this.#height / 2 * (1 - scale);
      this.graphCanvas.style.transform = `matrix(${scale}, 0, 0, ${scale}, ${x}, ${y})`;
    }
    this.#requestStaticDraw();
    if (this.#activeRoutes.length || this.#observerWakes.length || this.#residue.length || this.#regionActivityCues.length) {
      this.#requestMotionFrame();
    }
  }

  #animateView(centerX: number, centerY: number, scale: number, yaw = this.#yaw, tilt = this.#tilt): void {
    this.#cancelViewAnimation();
    if (prefersReducedMotion() || this.#quality.mode === 'low') {
      this.#centerX = centerX;
      this.#centerY = centerY;
      this.#scale = scale;
      this.#yaw = yaw; this.#tilt = tilt;
      this.#viewChanged();
      return;
    }
    const fromX = this.#centerX;
    const fromY = this.#centerY;
    const fromScale = this.#scale;
    const fromYaw = this.#yaw, fromTilt = this.#tilt;
    const started = performance.now();
    const tick = (now: number): void => {
      const progress = clamp((now - started) / VIEW_ANIMATION_MS, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.#centerX = fromX + (centerX - fromX) * eased;
      this.#centerY = fromY + (centerY - fromY) * eased;
      this.#scale = fromScale + (scale - fromScale) * eased;
      this.#yaw = fromYaw + (yaw - fromYaw) * eased;
      this.#tilt = fromTilt + (tilt - fromTilt) * eased;
      this.#viewChanged();
      if (progress < 1) this.#viewFrame = requestAnimationFrame(tick);
      else this.#viewFrame = 0;
    };
    this.#viewFrame = requestAnimationFrame(tick);
  }

  #cancelViewAnimation(): void {
    if (this.#viewFrame) {
      cancelAnimationFrame(this.#viewFrame);
      this.#mode3D = this.#tilt > 0.001;
      if (!this.#mode3D) { this.#tilt = 0; this.#yaw = 0; }
      this.stage.dataset.viewMode = this.#mode3D ? '3d' : 'top-down';
      this.callbacks.onViewChange?.();
    }
    this.#viewFrame = 0;
  }

  #nearestNode(x: number, y: number): ScreenNode | null {
    let closest: ScreenNode | null = null;
    let closestDistance = Infinity;
    for (const node of this.#screenNodes) {
      const point = this.#screenPoint(node.node.id);
      const distance = Math.hypot(point.x - x, point.y - y);
      const hitRadius = Math.max(12, node.radius + 6);
      if (distance <= hitRadius && distance < closestDistance) {
        closest = node;
        closestDistance = distance;
      }
    }
    return closest ? { ...closest, point: this.#screenPoint(closest.node.id), node: this.#nodesByID.get(closest.node.id) ?? closest.node } : null;
  }

  #nearestRoutes(x: number, y: number): string[] {
    const hits: Array<{ id: string; distance: number }> = [];
    for (const route of this.#visibleRoutes) {
      const path = this.#routePath(route.fromId, route.toId);
      const distance = distanceToGraphPath(path, x, y);
      if (distance <= Math.max(7, displayPreferences().width + 4)) hits.push({ id: route.id, distance });
    }
    return hits.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id)).slice(0, 12).map(hit => hit.id);
  }

  #handleContextMenu = (event: MouseEvent): void => { if (this.#mode3D) event.preventDefault(); };

  #handlePointerDown = (event: PointerEvent): void => {
    if ((event.button !== 0 && !(this.#mode3D && event.button === 2)) || this.#paused) return;
    this.#cancelViewAnimation();
    this.#rotationGesture = this.#mode3D && (event.button === 2 || event.shiftKey);
    this.#dragMoved = this.#pointers.size > 0 || this.#rotationGesture;
    this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.#rebaseGesture();
    this.stage.setPointerCapture(event.pointerId);
    this.stage.classList.add('is-dragging');
  };

  #handlePointerMove = (event: PointerEvent): void => {
    if (this.#pointers.has(event.pointerId)) {
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const [first, second] = this.#pointers.values();
      if (first && second && this.#pinchStart) {
        const { distance, scale, anchor, offset, angle, yaw } = this.#pinchStart;
        this.#scale = clamp(scale * Math.hypot(second.x - first.x, second.y - first.y) / distance, 0.002, 8);
        if (this.#tilt > 0) { const turn = Math.atan2(second.y - first.y, second.x - first.x) - angle;
          this.#yaw = yaw + Math.atan2(Math.sin(turn), Math.cos(turn)); }
        this.#resetProjection();
        const point = this.#screenToWorld((first.x + second.x) / 2 - offset.x, (first.y + second.y) / 2 - offset.y);
        this.#centerX += anchor.x - point.x; this.#centerY += anchor.y - point.y;
        this.#dragMoved = true;
      } else {
        const deltaX = event.clientX - this.#pointerStart.x;
        const deltaY = event.clientY - this.#pointerStart.y;
        if (Math.hypot(deltaX, deltaY) > 4) this.#dragMoved = true;
        if (this.#rotationGesture) {
          this.#yaw = this.#gestureYaw + deltaX * 0.006;
          this.#tilt = clamp(this.#gestureTilt + deltaY * 0.006, 0.12, MAX_GRAPH_TILT);
        } else {
          const rect = this.stage.getBoundingClientRect();
          const current = this.#screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
          this.#centerX += this.#viewStart.x - current.x; this.#centerY += this.#viewStart.y - current.y;
        }
      }
      this.#viewChanged();
      return;
    }
    if (event.pointerType === 'touch') return;
    const rect = this.stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hovered = this.#nearestNode(x, y);
    const nextID = hovered?.node.id ?? null;
    if (nextID === this.#hoveredNodeID) return;
    this.#hoveredNodeID = nextID;
    this.#nodesDirty = true;
    this.stage.classList.toggle('node-hover', Boolean(hovered));
    this.callbacks.onNodeHover(hovered?.node ?? null, hovered?.point);
    this.#requestStaticDraw();
  };

  #handlePointerUp = (event: PointerEvent): void => {
    if (!this.#pointers.has(event.pointerId)) return;
    const select = this.#pointers.size === 1 && !this.#dragMoved;
    this.#finishPointer(event.pointerId);
    if (!select) return;
    const rect = this.stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const node = this.#nearestNode(x, y);
    // Keep the forgiving node target, but let a visible line outside the
    // marker itself be picked even when small-screen node targets overlap it.
    const routes = node && Math.hypot(x - node.point.x, y - node.point.y) <= node.radius + 3 ? [] : this.#nearestRoutes(x, y);
    if (routes.length) this.callbacks.onRouteSelect?.(routes);
    else this.callbacks.onNodeSelect(node?.node.id ?? null);
  };

  #handlePointerCancel = (event: PointerEvent): void => {
    if (!this.#pointers.has(event.pointerId)) return;
    this.#dragMoved = true;
    this.#finishPointer(event.pointerId);
  };

  #finishPointer(pointerID: number): void {
    this.#pointers.delete(pointerID);
    if (this.stage.hasPointerCapture(pointerID)) this.stage.releasePointerCapture(pointerID);
    // Re-anchor the remaining finger so a pinch can become a drag without a jump.
    this.#rebaseGesture();
    this.stage.classList.toggle('is-dragging', this.#pointers.size > 0);
    if (!this.#pointers.size && this.graphCanvas.style.transform) this.#requestStaticDraw();
  }

  #rebaseGesture(): void {
    this.#pinchStart = undefined;
    const [first, second] = this.#pointers.values();
    if (!first) return;
    this.#pointerStart = first;
    const rect = this.stage.getBoundingClientRect();
    this.#viewStart = this.#screenToWorld(first.x - rect.left, first.y - rect.top);
    this.#gestureYaw = this.#yaw; this.#gestureTilt = this.#tilt;
    if (!second) return;
    this.#pinchStart = {
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      scale: this.#scale,
      yaw: this.#yaw,
      angle: Math.atan2(second.y - first.y, second.x - first.x),
      anchor: this.#screenToWorld((first.x + second.x) / 2 - rect.left, (first.y + second.y) / 2 - rect.top),
      offset: { x: rect.left, y: rect.top },
    };
  }

  #clearPointers(): void {
    const ids = [...this.#pointers.keys()];
    this.#pointers.clear();
    this.#pinchStart = undefined;
    this.stage.classList.remove('is-dragging');
    if (this.graphCanvas.style.transform) this.#requestStaticDraw();
    for (const id of ids) if (this.stage.hasPointerCapture(id)) this.stage.releasePointerCapture(id);
  }

  panBy(x: number, y: number): void {
    this.#cancelViewAnimation();
    const point = this.#screenToWorld(this.#width / 2 + x, this.#height / 2 + y);
    this.#centerX = point.x; this.#centerY = point.y;
    this.#viewChanged();
  }

  zoomBy(factor: number): void {
    this.#animateView(this.#centerX, this.#centerY, clamp(this.#scale * factor, 0.002, 8));
  }

  #handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.#cancelViewAnimation();
    const rect = this.stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const anchor = this.#screenToWorld(x, y);
    const nextScale = clamp(this.#scale * Math.exp(-event.deltaY * 0.0012), 0.002, 8);
    this.#scale = nextScale;
    this.#resetProjection();
    const point = this.#screenToWorld(x, y);
    this.#centerX += anchor.x - point.x; this.#centerY += anchor.y - point.y;
    this.#viewChanged();
  };

  #handleDoubleClick = (event: MouseEvent): void => {
    const rect = this.stage.getBoundingClientRect();
    const anchor = this.#screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    this.#animateView(anchor.x, anchor.y, clamp(this.#scale * 1.65, 0.002, 8));
  };

  #handleMotionPreference = (): void => {
    this.stage.dataset.motionMode = prefersReducedMotion() ? 'static' : 'animated';
    if (prefersReducedMotion()) { this.#activeRoutes = []; this.#cancelViewAnimation(); }
    else this.#clearResidueCleanup();
    this.#requestMotionFrame();
  };
}

function coordinateKey(lng: number, lat: number): string {
  return `${lng.toFixed(6)},${lat.toFixed(6)}`;
}


function truncateLabel(label: string, length: number): string {
  return label.length <= length ? label : `${label.slice(0, Math.max(1, length - 1))}…`;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function rectanglesOverlap(left: LabelRect, right: LabelRect, gap: number): boolean {
  return left.x < right.x + right.width + gap
    && left.x + left.width + gap > right.x
    && left.y < right.y + right.height + gap
    && left.y + left.height + gap > right.y;
}

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function easeInOut(value: number): number {
  const amount = clamp(value, 0, 1);
  return amount < 0.5 ? 2 * amount * amount : 1 - Math.pow(-2 * amount + 2, 2) / 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
