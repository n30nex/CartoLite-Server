import { canvasColorWithAlpha as colorWithAlpha, DISPLAY_EVENT, displayColor, displayPreferences, displayResidueAge, lightScene, lineDash, residueLifetime } from '../displayPreferences';
import type { ViewportProjector } from '../audio';
import {
  DESTINATION_BLOOM_MS,
  RELAY_SPARK_MS,
  SOURCE_IGNITION_MS,
  capNewest,
  interpolateScreenPoint,
  nodeWakeRadius,
  packetTrail,
  residueSparkleProgress,
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
}

export class NetgraphRenderer implements ViewportProjector {
  private readonly graphContext: CanvasRenderingContext2D;
  private readonly packetContext: CanvasRenderingContext2D;
  private readonly residueCanvas: HTMLCanvasElement;
  private readonly residueContext: CanvasRenderingContext2D;
  private readonly nodesCanvas: HTMLCanvasElement;
  private readonly nodesContext: CanvasRenderingContext2D;
  private nodesDirty = true;
  private residueCacheAt = -Infinity;
  private residueDirty = true;
  private residueProjectionDirty = true;
  private readonly quality = new NetgraphQuality();
  private lastMotionAt = 0;
  private readonly glowSprites = new Map<string, HTMLCanvasElement>();
  private readonly regionLabelSprites = new Map<string, { canvas: HTMLCanvasElement; width: number }>();
  private readonly screenPoints = new Map<string, ScreenPoint>();
  private readonly textWidths = new Map<string, number>();
  private readonly reducedMotionQuery: MediaQueryList;
  private readonly lowPowerQuery: MediaQueryList;
  private readonly resizeObserver?: ResizeObserver;
  private nodesByID = new Map<string, NodeV2>();
  private routesByID = new Map<string, RouteV2>();
  private adjacentRouteIDs = new Map<string, Set<string>>();
  private coordinateNodeIDs = new Map<string, string>();
  private assignedAreas = new Map<string, NetgraphAreaAnchor>();
  private regionAreasByTag = new Map<string, NetgraphAreaAnchor>();
  private regionActivityCues: RegionActivityCue[] = [];
  private topology = new Map<string, string>();
  private layout: NetgraphLayout = buildNetgraphLayout([], []);
  private visibleRoutes: RouteV2[] = [];
  private visibleRouteIDs = new Set<string>();
  private screenNodes: ScreenNode[] = [];
  private routeWindow: NetgraphWindow = '15m';
  private selectedNodeID: string | null = null;
  private hoveredNodeID: string | null = null;
  private activeRoutes: ActiveRoute[] = [];
  private observerWakes: ObserverWake[] = [];
  private residue: Residue[] = [];
  private staticFrame = 0;
  private motionFrame = 0;
  private viewFrame = 0;
  private residueCleanupTimer = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private centerX = 0;
  private centerY = 0;
  private scale = 1;
  private paintedView?: { x: number; y: number; scale: number };
  private initializedView = false;
  private paused = false;
  private dragMoved = false;
  private readonly pointers = new Map<number, ScreenPoint>();
  private pointerStart = { x: 0, y: 0 };
  private viewStart = { x: 0, y: 0 };
  private pinchStart?: { distance: number; scale: number; anchor: ScreenPoint; offset: ScreenPoint };

  constructor(
    private readonly stage: HTMLElement,
    private readonly graphCanvas: HTMLCanvasElement,
    private readonly packetCanvas: HTMLCanvasElement,
    private readonly callbacks: NetgraphRendererCallbacks,
  ) {
    const graphContext = graphCanvas.getContext('2d');
    const packetContext = packetCanvas.getContext('2d');
    if (!graphContext || !packetContext) throw new Error('Canvas2D is unavailable');
    this.graphContext = graphContext;
    this.packetContext = packetContext;
    this.residueCanvas = document.createElement('canvas');
    this.residueCanvas.id = 'netgraph-residue-canvas';
    this.residueCanvas.setAttribute('aria-hidden', 'true');
    this.residueContext = this.residueCanvas.getContext('2d')!;
    this.stage.insertBefore(this.residueCanvas, packetCanvas);
    this.nodesCanvas = document.createElement('canvas');
    this.nodesContext = this.nodesCanvas.getContext('2d')!;
    this.reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.lowPowerQuery = matchMedia('(max-width: 700px), (pointer: coarse)');
    this.stage.dataset.motionMode = this.reducedMotionQuery.matches ? 'static' : 'animated';
    this.stage.dataset.qualityMode = this.quality.mode;
    this.handleResize = this.handleResize.bind(this);
    this.drawMotion = this.drawMotion.bind(this);
    this.stage.addEventListener('pointerdown', this.handlePointerDown);
    this.stage.addEventListener('pointermove', this.handlePointerMove);
    this.stage.addEventListener('pointerup', this.handlePointerUp);
    this.stage.addEventListener('pointercancel', this.handlePointerCancel);
    this.stage.addEventListener('lostpointercapture', this.handlePointerCancel);
    this.stage.addEventListener('wheel', this.handleWheel, { passive: false });
    this.stage.addEventListener('dblclick', this.handleDoubleClick);
    this.reducedMotionQuery.addEventListener('change', this.handleMotionPreference);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(stage);
    } else {
      window.addEventListener('resize', this.handleResize);
    }
    this.handleResize();
    window.addEventListener(DISPLAY_EVENT, this.refreshAppearance);
  }

  private refreshAppearance = (): void => {
    this.glowSprites.clear();
    this.regionLabelSprites.clear();
    this.nodesDirty = true;
    this.residueDirty = true;
    this.residueProjectionDirty = true;
    this.stage.dataset.routePreset = displayPreferences().preset;
    this.requestStaticDraw();
    this.requestMotionFrame();
  };

  render(state: Readonly<StateV2>, changes: MapChanges | null): void {
    if (!changes) return;
    const started = performance.now();
    const firstLayout = this.layout.positions.size === 0;
    let visualChange = Boolean(changes.reset);
    let movedArea = false;
    if (changes.reset) this.assignedAreas.clear();
    for (const node of changes.reset ? state.nodes : changes.nodes ?? []) {
      const area = nearestNetgraphArea(node.lat, node.lng);
      const previous = this.assignedAreas.get(node.id);
      movedArea ||= Boolean(previous && previous.code !== area.code);
      this.assignedAreas.set(node.id, area);
    }
    this.stage.dataset.regionAssignments = String(this.assignedAreas.size);
    if (changes.reset) {
      this.nodesByID = new Map(state.nodes.map((node) => [node.id, node]));
      this.coordinateNodeIDs = new Map(state.nodes.map((node) => [coordinateKey(node.lng, node.lat), node.id]));
      this.routesByID = new Map(state.routes.map((route) => [route.id, route]));
    } else {
      // Last-heard updates do not change the fixed graph geometry or its ink.
      for (const node of changes.nodes ?? []) {
        const previous = this.nodesByID.get(node.id);
        const nodeInkChanged = !previous || previous.label !== node.label || previous.role !== node.role || previous.observer !== node.observer;
        visualChange ||= nodeInkChanged;
        this.nodesDirty ||= nodeInkChanged;
        if (previous && (previous.lng !== node.lng || previous.lat !== node.lat)) {
          const key = coordinateKey(previous.lng, previous.lat);
          if (this.coordinateNodeIDs.get(key) === node.id) this.coordinateNodeIDs.delete(key);
        }
        this.nodesByID.set(node.id, node);
        this.coordinateNodeIDs.set(coordinateKey(node.lng, node.lat), node.id);
      }
      const now = Date.now();
      const cutoff = now - netgraphWindowMS(this.routeWindow);
      for (const route of changes.routes ?? []) {
        const previous = this.routesByID.get(route.id);
        // Counts and precise last-heard times update inspection immediately,
        // but only a changed visible style needs thousands of links repainted.
        visualChange ||= !previous
          || previous.lastKind !== route.lastKind
          || previous.intensity !== route.intensity
          || Math.min(4, Math.floor((now - previous.lastHeard) / 900_000)) !== Math.min(4, Math.floor((now - route.lastHeard) / 900_000))
          || (previous.lastHeard >= cutoff) !== (route.lastHeard >= cutoff);
        this.routesByID.set(route.id, route);
      }
    }

    if (changes.reset || movedArea || graphTopologyChanged(this.topology, changes.routes ?? [], state.routes.length)) {
      if (changes.reset || movedArea || firstLayout) {
        this.layout = buildNetgraphLayout(state.nodes, state.routes, this.assignedAreas);
      } else {
        this.layout = extendNetgraphLayout(this.layout, state.nodes, state.routes, this.assignedAreas);
      }
      this.topology = routeTopology(state.routes);
      this.rebuildAdjacency(state.routes);
      this.screenPoints.clear();
      this.residueProjectionDirty = true;
      this.residueDirty = true;
      this.nodesDirty = true;
      visualChange = true;
    }

    if (changes.reset || changes.routes?.length) {
      this.visibleRoutes = routesInWindow(state.routes, Date.now(), this.routeWindow);
      this.visibleRouteIDs = new Set(this.visibleRoutes.map((route) => route.id));
    }
    this.stage.dataset.totalNodes = String(state.nodes.length);
    this.stage.dataset.connectedNodes = String(this.layout.connectedNodeIDs.size);
    this.stage.dataset.totalRoutes = String(state.routes.length);
    this.stage.dataset.visibleRoutes = String(this.visibleRoutes.length);
    this.stage.dataset.components = String(this.layout.componentCount);
    this.stage.dataset.areas = String(this.layout.areas.length);
    this.stage.dataset.renderApplyMs = (performance.now() - started).toFixed(1);
    if (!this.initializedView && this.layout.positions.size > 0) this.home(false);
    if (visualChange) {
      if (this.selectedNodeID) this.nodesDirty = true;
      this.requestStaticDraw();
    }
  }

  setRouteWindow(window: NetgraphWindow): void {
    const started = performance.now();
    this.routeWindow = window;
    this.stage.dataset.routeWindow = window;
    this.refreshRouteWindow();
    this.stage.dataset.routeWindowApplyMs = (performance.now() - started).toFixed(1);
  }

  refreshRouteWindow(now = Date.now()): boolean {
    const nextRoutes = routesInWindow([...this.routesByID.values()], now, this.routeWindow);
    const nextIDs = new Set(nextRoutes.map((route) => route.id));
    const changed = nextIDs.size !== this.visibleRouteIDs.size
      || [...nextIDs].some((routeID) => !this.visibleRouteIDs.has(routeID));
    this.visibleRoutes = nextRoutes;
    this.visibleRouteIDs = nextIDs;
    this.stage.dataset.visibleRoutes = String(nextRoutes.length);
    if (changed || nextRoutes.length > 0) {
      if (this.selectedNodeID) this.nodesDirty = true;
      this.requestStaticDraw();
    }
    return changed;
  }

  getRouteWindowMS(): number {
    return netgraphWindowMS(this.routeWindow);
  }

  getNodes(): ReadonlyMap<string, NodeV2> {
    return this.nodesByID;
  }

  connectedNodes(): NodeV2[] {
    return [...this.layout.connectedNodeIDs]
      .map((nodeID) => this.nodesByID.get(nodeID))
      .filter((node): node is NodeV2 => Boolean(node));
  }

  adjacentRoutes(nodeID: string): RouteV2[] {
    return [...(this.adjacentRouteIDs.get(nodeID) ?? [])]
      .map((routeID) => this.routesByID.get(routeID))
      .filter((route): route is RouteV2 => Boolean(route));
  }

  setSelectedNode(nodeID: string | null): void {
    this.selectedNodeID = nodeID && this.nodesByID.has(nodeID) ? nodeID : null;
    this.nodesDirty = true;
    this.stage.dataset.selectedNodeId = this.selectedNodeID ?? '';
    this.stage.dataset.focusedPacketEmphasis = '1';
    this.requestStaticDraw();
  }

  focusNode(nodeID: string): void {
    const position = this.layout.positions.get(nodeID);
    if (!position) return;
    this.animateView(position.x, position.y, Math.max(this.scale, 1.5));
  }

  home(animate = true): void {
    const bounds = this.layout.bounds;
    const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
    const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
    const nextScale = clamp(Math.min((this.width - 52) / boundsWidth, (this.height - 80) / boundsHeight), 0.005, 3);
    const nextX = (bounds.minX + bounds.maxX) / 2;
    const nextY = (bounds.minY + bounds.maxY) / 2;
    this.initializedView = true;
    if (animate && !this.reducedMotionQuery.matches) this.animateView(nextX, nextY, nextScale);
    else {
      this.cancelViewAnimation();
      this.centerX = nextX;
      this.centerY = nextY;
      this.scale = nextScale;
      this.viewChanged();
    }
  }

  addPacket(packet: PacketView): void {
    if (this.paused) return;
    const now = performance.now();
    const color = payloadColor(packet.payloadType);
    const signature = packetSignature(packet.payloadType);
    const regionTraffic = planRegionTraffic(packet, this.assignedAreas, now);
    if (regionTraffic) this.addRegionTrafficPlan(regionTraffic);
    if (packet.mode === 'observer') {
      if (this.layout.positions.has(packet.observer.id)) {
        this.observerWakes.push({ endpoint: packet.observer, color, signature, started: now });
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
      if (this.reducedMotionQuery.matches) {
        for (const segment of packet.segments) this.addResidue(segment.routeId, segment.from.id, segment.to.id, color, signature, now);
      } else {
        this.activeRoutes.push(active);
      }
      this.stage.dataset.lastPacketKind = normalizePacketKind(packet.payloadType);
      this.stage.dataset.lastPacketHops = String(packet.segments.length);
      this.stage.dataset.lastPacketRange = regionTraffic?.longHaul
        ? 'long-haul'
        : regionTraffic?.crossRegion ? 'cross-region' : 'local';
    }
    this.requestMotionFrame();
    this.scheduleReducedMotionCleanup();
  }

  preparePacket(packet: PacketView): void {
    if (packet.mode !== 'route' || packet.segments.every((segment) => (
      this.layout.positions.has(segment.from.id) && this.layout.positions.has(segment.to.id)
    ))) return;
    const routes = new Map(this.routesByID);
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
    this.layout = extendNetgraphLayout(
      this.layout,
      [...this.nodesByID.values()],
      [...routes.values()],
      this.assignedAreas,
    );
    this.screenPoints.clear();
    this.residueProjectionDirty = true;
    this.residueDirty = true;
    this.nodesDirty = true;
    this.stage.dataset.connectedNodes = String(this.layout.connectedNodeIDs.size);
    this.stage.dataset.components = String(this.layout.componentCount);
    this.stage.dataset.areas = String(this.layout.areas.length);
    this.requestStaticDraw();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.lastMotionAt = 0;
      this.quality.resetSamples();
      this.clearPointers();
      this.cancelViewAnimation();
      this.activeRoutes = [];
      this.observerWakes = [];
      this.residue = [];
      this.residueDirty = true;
      this.regionActivityCues = [];
      this.stage.dataset.activeRegionLabels = '0';
      this.clearResidueCleanup();
      if (this.motionFrame) cancelAnimationFrame(this.motionFrame);
      this.motionFrame = 0;
      this.packetContext.clearRect(0, 0, this.width, this.height);
      this.residueContext.clearRect(0, 0, this.width, this.height);
    }
  }

  project(coordinates: [number, number]): ScreenPoint {
    const nodeID = this.coordinateNodeIDs.get(coordinateKey(coordinates[0], coordinates[1]));
    return nodeID ? this.screenPoint(nodeID) : { x: -1_000_000, y: -1_000_000 };
  }

  projectEndpoint(endpoint: EndpointV2): ScreenPoint {
    return this.screenPoint(endpoint.id);
  }

  destroy(): void {
    window.removeEventListener(DISPLAY_EVENT, this.refreshAppearance);
    this.clearPointers();
    this.stage.removeEventListener('pointerdown', this.handlePointerDown);
    this.stage.removeEventListener('pointermove', this.handlePointerMove);
    this.stage.removeEventListener('pointerup', this.handlePointerUp);
    this.stage.removeEventListener('pointercancel', this.handlePointerCancel);
    this.stage.removeEventListener('lostpointercapture', this.handlePointerCancel);
    this.stage.removeEventListener('wheel', this.handleWheel);
    this.stage.removeEventListener('dblclick', this.handleDoubleClick);
    this.reducedMotionQuery.removeEventListener('change', this.handleMotionPreference);
    this.resizeObserver?.disconnect();
    if (!this.resizeObserver) window.removeEventListener('resize', this.handleResize);
    if (this.staticFrame) cancelAnimationFrame(this.staticFrame);
    if (this.motionFrame) cancelAnimationFrame(this.motionFrame);
    this.clearResidueCleanup();
    this.cancelViewAnimation();
    this.residueCanvas.remove();
  }

  private handleResize(): void {
    const rect = this.stage.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.paintedView = undefined;
    this.graphCanvas.style.transform = '';
    // Match the map's mobile animation budget instead of painting four pixels
    // per CSS pixel on every frame in an Android WebView.
    this.dpr = Math.min(this.lowPowerQuery.matches ? 1.25 : 1.5, Math.max(1, devicePixelRatio || 1));
    this.regionLabelSprites.clear();
    this.sizeCanvas(this.graphCanvas, this.graphContext);
    this.sizeCanvas(this.packetCanvas, this.packetContext, this.quality.mode === 'low' ? 1 : this.dpr);
    this.sizeCanvas(this.residueCanvas, this.residueContext, this.quality.mode === 'low' ? 1 : this.dpr);
    this.residueProjectionDirty = true;
    this.sizeCanvas(this.nodesCanvas, this.nodesContext);
    if (!this.initializedView && this.layout.positions.size > 0) this.home(false);
    this.rebaseGesture();
    this.viewChanged();
  }

  private sizeCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, dpr = this.dpr): void {
    const width = Math.round(this.width * dpr);
    const height = Math.round(this.height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    canvas.style.width = `${this.width}px`;
    canvas.style.height = `${this.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private requestStaticDraw(): void {
    if (this.quality.mode === 'low' && this.pointers.size && this.paintedView) {
      this.stage.dataset.renderState = 'composited';
      return;
    }
    if (this.staticFrame) return;
    this.stage.dataset.renderState = 'scheduled';
    this.staticFrame = requestAnimationFrame(() => {
      this.staticFrame = 0;
      if (this.quality.mode === 'low' && this.pointers.size && this.paintedView) return;
      this.drawStatic();
    });
  }

  private drawStatic(): void {
    const started = performance.now();
    const context = this.graphContext;
    context.clearRect(0, 0, this.width, this.height);
    this.drawGrid(context);
    this.drawAreaHalos(context);
    this.drawRoutes(context);
    if (this.nodesDirty) {
      this.nodesContext.clearRect(0, 0, this.width, this.height);
      this.drawNodes(this.nodesContext);
      this.nodesDirty = false;
    }
    context.drawImage(this.nodesCanvas, 0, 0, this.width, this.height);
    this.drawAreaLabels(context);
    this.paintedView = { x: this.centerX, y: this.centerY, scale: this.scale };
    this.graphCanvas.style.transform = '';
    this.stage.dataset.staticDrawMs = (performance.now() - started).toFixed(1);
    this.stage.dataset.renderState = 'idle';
  }

  private drawGrid(context: CanvasRenderingContext2D): void {
    const spacing = Math.max(42, Math.min(96, 64 * this.scale));
    const offsetX = modulo(this.width / 2 - this.centerX * this.scale, spacing);
    const offsetY = modulo(this.height / 2 - this.centerY * this.scale, spacing);
    context.save();
    context.strokeStyle = 'rgba(93, 176, 183, 0.055)';
    context.lineWidth = 1;
    context.beginPath();
    for (let x = offsetX; x <= this.width; x += spacing) {
      context.moveTo(Math.round(x) + 0.5, 0);
      context.lineTo(Math.round(x) + 0.5, this.height);
    }
    for (let y = offsetY; y <= this.height; y += spacing) {
      context.moveTo(0, Math.round(y) + 0.5);
      context.lineTo(this.width, Math.round(y) + 0.5);
    }
    context.stroke();
    context.restore();
  }

  private visibleAreas(): Array<{ area: NetgraphLayout['areas'][number]; point: ScreenPoint; radius: number }> {
    return this.layout.areas
      .map((area) => ({ area, point: this.worldToScreen(area.x, area.y), radius: area.radius * this.scale }))
      .filter(({ point, radius }) => (
        point.x + radius >= -80 && point.x - radius <= this.width + 80
        && point.y + radius >= -80 && point.y - radius <= this.height + 80
      ));
  }

  private drawAreaHalos(context: CanvasRenderingContext2D): void {
    context.save();
    context.setLineDash([4, 7]);
    for (const { point, radius } of this.visibleAreas()) {
      if (radius < 5) continue;
      const edge = Math.max(8, radius);
      const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, edge);
      glow.addColorStop(0, 'rgba(69, 220, 202, 0.055)');
      glow.addColorStop(0.72, 'rgba(39, 139, 150, 0.022)');
      glow.addColorStop(1, 'rgba(39, 139, 150, 0)');
      context.beginPath();
      context.arc(point.x, point.y, edge, 0, Math.PI * 2);
      context.fillStyle = glow;
      context.fill();
      context.strokeStyle = 'rgba(110, 220, 217, 0.12)';
      context.lineWidth = 0.8;
      context.stroke();
    }

    context.restore();
  }

  private drawAreaLabels(context: CanvasRenderingContext2D): void {
    context.save();
    const occupied: LabelRect[] = [];
    const labels = this.visibleAreas().sort((left, right) => right.area.nodeCount - left.area.nodeCount || left.area.code.localeCompare(right.area.code));
    for (const { area, point, radius } of labels) {
      if (area.nodeCount < 2 && this.scale < 0.16) continue;
      const title = `${area.code} · ${area.name}`;
      const detail = `${area.nodeCount.toLocaleString()} nodes`;
      context.font = '750 11px Inter, ui-sans-serif, system-ui, sans-serif';
      const titleWidth = this.textWidth(context, title);
      context.font = '600 8px Inter, ui-sans-serif, system-ui, sans-serif';
      const detailWidth = this.textWidth(context, detail);
      const width = Math.max(titleWidth, detailWidth) + 16;
      const height = 31;
      const x = clamp(point.x - width / 2, 6, Math.max(6, this.width - width - 6));
      let y = point.y - Math.max(22, radius) - height - 9;
      if (y < 64) y = point.y + Math.max(22, radius) + 9;
      const labelCenterX = x + width / 2;
      const rect = { x, y, width, height };
      if (x + width < 5 || x > this.width - 5 || y + height < 5 || y > this.height - 5) continue;
      if (occupied.some((other) => rectanglesOverlap(rect, other, 5))) continue;
      occupied.push(rect);

      const connectorY = y < point.y ? y + height : y;
      context.beginPath();
      context.moveTo(labelCenterX, connectorY);
      context.lineTo(point.x, y < point.y ? point.y - Math.max(8, radius) : point.y + Math.max(8, radius));
      context.strokeStyle = 'rgba(111, 219, 215, 0.18)';
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

  private drawRoutes(context: CanvasRenderingContext2D): void {
    const now = Date.now();
    const selected = this.selectedNodeID;
    const selectedRoutes = selected ? this.adjacentRouteIDs.get(selected) ?? new Set<string>() : new Set<string>();
    const groups = new Map<string, { kind: PacketKind; interArea: boolean; routes: RouteV2[] }>();
    const recentGroups = new Map<string, { kind: PacketKind; ageBucket: number; intensity: number; interArea: boolean; routes: RouteV2[] }>();
    for (const route of this.visibleRoutes) {
      if (selectedRoutes.has(route.id)) continue;
      const kind = normalizePacketKind(route.lastKind);
      const interArea = this.isInterAreaRoute(route);
      const scope = interArea ? 'inter' : 'local';
      const groupKey = `${kind}:${scope}`;
      const group = groups.get(groupKey) ?? { kind, interArea, routes: [] };
      group.routes.push(route);
      groups.set(groupKey, group);
      const age = Math.max(0, now - route.lastHeard);
      if (age <= 60 * 60_000) {
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
      for (const route of group.routes) this.appendRoute(context, route);
      context.strokeStyle = colorWithAlpha(PACKET_KIND_COLORS[group.kind], (selected ? 0.1 : lightScene() ? 0.95 : 0.5) * displayPreferences().opacity);
      context.lineWidth = displayPreferences().width;
      context.stroke();
    }

    for (const group of recentGroups.values()) {
      context.setLineDash(lineDash());
      context.beginPath();
      for (const route of group.routes) this.appendRoute(context, route);
      const ageStrength = 1 - (group.ageBucket + 0.5) / 4;
      context.strokeStyle = colorWithAlpha(PACKET_KIND_COLORS[group.kind], ageStrength * (selected ? 0.08 : group.interArea ? 0.19 : 0.3));
      context.lineWidth = displayPreferences().width + group.intensity * 0.12;
      context.stroke();
    }

    if (selected) {
      context.setLineDash([]);
      for (const routeID of selectedRoutes) {
        const route = this.routesByID.get(routeID);
        if (!route || !this.visibleRouteIDs.has(route.id)) continue;
        const color = PACKET_KIND_COLORS[normalizePacketKind(route.lastKind)];
        context.beginPath();
        this.appendRoute(context, route);
        context.strokeStyle = colorWithAlpha(color, 0.18 * displayPreferences().glow);
        context.lineWidth = 7;
        context.stroke();
        context.beginPath();
        this.appendRoute(context, route);
        context.strokeStyle = colorWithAlpha(color, 0.86);
        context.lineWidth = displayPreferences().width + 0.5;
        context.stroke();
      }
    }
    context.restore();
  }

  private isInterAreaRoute(route: RouteV2): boolean {
    const from = this.layout.positions.get(route.fromId);
    const to = this.layout.positions.get(route.toId);
    return Boolean(from && to && from.areaCode !== to.areaCode);
  }

  private appendRoute(context: CanvasRenderingContext2D, route: RouteV2): void {
    const from = this.screenPoint(route.fromId);
    const to = this.screenPoint(route.toId);
    if (!segmentNearViewport(from, to, this.width, this.height, 8)) return;
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
  }

  private drawNodes(context: CanvasRenderingContext2D): void {
    const selectedRoutes = this.selectedNodeID ? this.adjacentRouteIDs.get(this.selectedNodeID) ?? new Set<string>() : new Set<string>();
    const selectedNeighbors = new Set<string>();
    for (const routeID of selectedRoutes) {
      const route = this.routesByID.get(routeID);
      if (!route || !this.visibleRouteIDs.has(route.id)) continue;
      selectedNeighbors.add(route.fromId === this.selectedNodeID ? route.toId : route.fromId);
    }
    const nodeRecords: ScreenNode[] = [];
    for (const position of this.layout.positions.values()) {
      const node = this.nodesByID.get(position.id);
      if (!node) continue;
      const point = this.screenPoint(position.id);
      if (point.x < -24 || point.x > this.width + 24 || point.y < -24 || point.y > this.height + 24) continue;
      // At overview zoom, oversized discs overlap hundreds of neighbours and
      // overwhelm both the picture and the rasterizer. Keep every node, with
      // smaller marks until detail zoom (touch hit targets stay unchanged).
      const detail = Math.min(1, Math.sqrt(this.scale / 0.7));
      const radius = clamp((2.5 + Math.log2(1 + position.degree) * 0.7) * detail + Math.sqrt(this.scale) * 0.55, 0.9, 8);
      nodeRecords.push({ node, point, radius, degree: position.degree });
    }
    this.screenNodes = nodeRecords;

    context.save();
    const groups = new Map<string, { records: ScreenNode[]; selected: boolean; neighbor: boolean; muted: boolean }>();
    for (const record of nodeRecords) {
      const { node } = record;
      const selected = node.id === this.selectedNodeID;
      const neighbor = selectedNeighbors.has(node.id);
      const muted = Boolean(this.selectedNodeID) && !selected && !neighbor;
      const key = `${node.role}:${selected}:${neighbor}:${muted}`;
      const group = groups.get(key) ?? { records: [], selected, neighbor, muted };
      group.records.push(record);
      groups.set(key, group);
    }
    for (const { records, selected, neighbor, muted } of groups.values()) {
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
        for (const { node, point, radius } of batch) this.nodeShape(context, node.role, point, radius);
        context.fillStyle = colorWithAlpha(color, muted ? 0.24 : selected ? 1 : neighbor ? 0.9 : 0.68);
        context.fill();
        context.strokeStyle = colorWithAlpha('#eaffff', muted ? 0.08 : selected ? 0.92 : 0.36);
        context.lineWidth = selected ? 1.8 : 0.8;
        context.stroke();
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
        node.id === this.selectedNodeID
        || node.id === this.hoveredNodeID
        || this.scale >= 0.42 && degree >= (this.scale < 0.7 ? 18 : this.scale < 1.3 ? 8 : 3)
      ))
      .sort((left, right) => Number(right.node.id === this.selectedNodeID) - Number(left.node.id === this.selectedNodeID) || right.degree - left.degree)
      .slice(0, this.scale < 0.7 ? 22 : this.scale < 1.3 ? 54 : 120);
    context.font = '600 10px Inter, ui-sans-serif, system-ui, sans-serif';
    context.textBaseline = 'middle';
    for (const { node, point, radius } of labelCandidates) {
      const label = truncateLabel(node.label, 28);
      const width = context.measureText(label).width;
      const x = point.x + radius + 6;
      const y = point.y;
      context.fillStyle = lightScene() ? 'rgba(247, 249, 241, 0.9)' : 'rgba(4, 14, 19, 0.78)';
      roundRect(context, x - 3, y - 8, width + 6, 16, 5);
      context.fill();
      context.fillStyle = lightScene() ? '#24474d' : node.id === this.selectedNodeID ? '#f2ffff' : 'rgba(205, 229, 234, 0.9)';
      context.fillText(label, x, y + 0.5);
    }
    context.restore();
  }

  private nodeShape(context: CanvasRenderingContext2D, role: NodeRole, point: ScreenPoint, radius: number): void {
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

  private requestMotionFrame(): void {
    if (this.paused || this.motionFrame) return;
    this.motionFrame = requestAnimationFrame(this.drawMotion);
  }

  private drawMotion(now: number): void {
    const started = performance.now();
    this.motionFrame = 0;
    const context = this.packetContext;
    const ratio = this.quality.mode === 'low' ? 1 : this.dpr;
    if (this.packetCanvas.width !== Math.round(this.width * ratio)) {
      this.sizeCanvas(this.packetCanvas, context, ratio);
      this.sizeCanvas(this.residueCanvas, this.residueContext, ratio);
      this.residueProjectionDirty = true;
    }
    context.clearRect(0, 0, this.width, this.height);
    this.activeRoutes = this.activeRoutes.filter((route) => now - route.started <= route.duration + DESTINATION_BLOOM_MS);
    this.observerWakes = this.observerWakes.filter((wake) => now - wake.started <= 6_000);
    const residueCount = this.residue.length;
    this.residue = this.residue.filter((item) => now - item.addedAt < residueLifetime());
    if (residueCount !== this.residue.length) this.residueProjectionDirty = true;
    this.regionActivityCues = this.regionActivityCues.filter((cue) => now < cue.startedAt + cue.duration);
    this.drawResidue(context, now);
    this.stage.dataset.focusedPacketEmphasis = '1';
    for (const route of this.activeRoutes) this.drawActiveRoute(context, route, now);
    for (const wake of this.observerWakes) this.drawObserverWake(context, wake, now);
    const regionFrames = activeRegionFrames(this.regionActivityCues, now, this.reducedMotionQuery.matches);
    const drawnRegionRoles = this.drawRegionActivity(context, regionFrames);
    this.stage.dataset.activePackets = String(this.activeRoutes.length + this.observerWakes.length);
    this.stage.dataset.residueCount = String(this.residue.length);
    this.stage.dataset.activeRegionLabels = String(drawnRegionRoles.length);
    this.stage.dataset.activeRegionRoles = drawnRegionRoles.join(',');
    const visibleMotion = drawnRegionRoles.length > 0
      || this.activeRoutes.some(({ packet }) => packet.segments.some((segment) => segmentNearViewport(this.screenPoint(segment.from.id), this.screenPoint(segment.to.id), this.width, this.height, 28)))
      || this.observerWakes.some((wake) => this.pointVisible(this.screenPoint(wake.endpoint.id), 48))
      || this.residue.some((item) => segmentNearViewport(this.screenPoint(item.fromId), this.screenPoint(item.toId), this.width, this.height, 12));
    if (!this.reducedMotionQuery.matches && visibleMotion) {
      if (this.lastMotionAt && this.quality.sample(now - this.lastMotionAt, performance.now() - started)) {
        this.stage.dataset.qualityMode = this.quality.mode;
      }
      this.lastMotionAt = now;
      this.requestMotionFrame();
    } else {
      this.lastMotionAt = 0;
      this.quality.resetSamples();
      this.scheduleReducedMotionCleanup(now);
    }
  }

  private addRegionTrafficPlan(plan: RegionTrafficPlan): void {
    this.regionActivityCues = capRegionActivity([...this.regionActivityCues, ...plan.cues]);
    this.regionAreasByTag.set(plan.source.code.toLowerCase(), plan.source);
    this.regionAreasByTag.set(plan.destination.code.toLowerCase(), plan.destination);
    this.stage.dataset.lastRegionFrom = plan.source.code;
    this.stage.dataset.lastRegionTo = plan.destination.code;
    this.stage.dataset.lastRegionTraffic = plan.longHaul ? 'long-haul' : plan.crossRegion ? 'cross-region' : 'local';
    this.stage.dataset.lastRegionDistanceKm = plan.distanceKm.toFixed(1);
  }

  private drawRegionActivity(
    context: CanvasRenderingContext2D,
    frames: ReadonlyMap<string, RegionPulseFrame>,
  ): string[] {
    if (frames.size === 0) return [];
    const drawnRoles: string[] = [];
    context.save();
    context.textBaseline = 'middle';
    for (const [regionTag, frame] of frames) {
      const area = this.layout.areas.find((candidate) => candidate.code.toLowerCase() === regionTag);
      const identity = this.regionAreasByTag.get(regionTag);
      if (!area || !identity) continue;
      const point = this.worldToScreen(area.x, area.y);
      const radius = Math.max(18, area.radius * this.scale);
      if (
        point.x + radius < -120 || point.x - radius > this.width + 120
        || point.y + radius < -120 || point.y - radius > this.height + 120
      ) continue;

      const color = PACKET_KIND_COLORS[frame.kind];
      const intensity = clamp(frame.intensity, 0, 1);
      const ringRadius = radius + 8 + frame.spread * (frame.longHaul ? 28 : 18);
      context.beginPath();
      context.arc(point.x, point.y, ringRadius, 0, Math.PI * 2);
      if (this.quality.mode !== 'low') {
        context.strokeStyle = colorWithAlpha(color, intensity * 0.09);
        context.lineWidth = frame.longHaul ? 7 : 4;
        context.stroke();
      }
      context.strokeStyle = colorWithAlpha(color, intensity * (frame.longHaul ? 0.92 : 0.68));
      context.lineWidth = frame.longHaul ? 2.2 : 1.5;
      context.stroke();

      const direction = frame.role === 'send' ? 'OUT' : frame.role === 'receive' ? 'IN' : 'LOCAL';
      const title = `${frame.longHaul ? 'DX · ' : ''}${identity.code} · ${truncateLabel(identity.name, 30)}`;
      const label = this.regionLabelSprite(title, direction, color);
      const labelWidth = label.width;
      const labelHeight = 30;
      const x = clamp(point.x - labelWidth / 2, 6, Math.max(6, this.width - labelWidth - 6));
      let y = point.y - radius - labelHeight - 12;
      if (y < 60) y = point.y + radius + 12;
      y = clamp(y, 6, Math.max(6, this.height - labelHeight - 6));

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

  private drawResidue(context: CanvasRenderingContext2D, now: number): void {
    const interval = this.quality.mode === 'low' ? 500 : this.quality.mode === 'balanced' ? 250 : 125;
    if (shouldRefreshResidueCache(this.residueCacheAt, now, this.residueProjectionDirty, this.reducedMotionQuery.matches && this.residueDirty, interval)) {
      this.residueContext.clearRect(0, 0, this.width, this.height);
      this.drawResidueLines(this.residueContext, now);
      this.residueCacheAt = now;
      this.residueDirty = false;
      this.residueProjectionDirty = false;
    }
    // The compositor retains this separate layer; do not copy a full-screen
    // canvas into the moving packet layer on every frame in Android WebView.
    if (this.reducedMotionQuery.matches) return;
    // Slow fading ink is cached; travelling sparkles still move every frame.
    const sparkleCount = this.quality.mode === 'full' && !this.lowPowerQuery.matches ? 2 : 1;
    const limit = this.quality.mode === 'low' ? 16 : this.quality.mode === 'balanced' ? 40 : this.lowPowerQuery.matches ? 96 : 160;
    for (let itemIndex = Math.max(0, this.residue.length - limit); itemIndex < this.residue.length; itemIndex += 1) {
      const residue = this.residue[itemIndex]!;
      const from = this.screenPoint(residue.fromId);
      const to = this.screenPoint(residue.toId);
      if (!segmentNearViewport(from, to, this.width, this.height, 12)) continue;
      const age = now - residue.addedAt;
      const style = residueStyle(displayResidueAge(age));
      for (let index = 0; index < sparkleCount; index += 1) {
        const progress = residueSparkleProgress(residue.routeId, age, index);
        const spark = interpolateScreenPoint(from, to, progress);
        const twinkle = 0.5 + 0.5 * Math.sin(age / 350 + index * 2.1);
        context.beginPath();
        context.arc(spark.x, spark.y, 0.9 + style.hot * 0.8, 0, Math.PI * 2);
        context.fillStyle = colorWithAlpha(residue.color, style.life * (0.24 + style.hot * 0.42) * (0.55 + twinkle * 0.45));
        context.fill();
      }
    }
  }

  private drawResidueLines(context: CanvasRenderingContext2D, now: number): void {
    context.save();
    context.lineCap = 'round';
    for (const residue of this.residue) {
      const from = this.screenPoint(residue.fromId);
      const to = this.screenPoint(residue.toId);
      if (!segmentNearViewport(from, to, this.width, this.height, 12)) continue;
      const age = now - residue.addedAt;
      const style = residueStyle(displayResidueAge(age));
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.strokeStyle = colorWithAlpha(residue.color, style.bloomOpacity * displayPreferences().glow);
      context.lineWidth = style.bloomWidth;
      context.stroke();
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.strokeStyle = colorWithAlpha(residue.color, style.coreOpacity);
      context.lineWidth = style.coreWidth;
      context.stroke();
    }
    context.restore();
  }

  private drawActiveRoute(context: CanvasRenderingContext2D, active: ActiveRoute, now: number): void {
    const age = now - active.started;
    const motion = routeMotion(active.weights, age, active.duration);
    while (active.completedSegments < motion.completedSegments) {
      const segment = active.packet.segments[active.completedSegments];
      if (segment) this.addResidue(segment.routeId, segment.from.id, segment.to.id, active.color, active.signature, now);
      active.completedSegments += 1;
    }

    for (let index = 0, boundary = 0; index < active.weights.length; index += 1) {
      boundary += active.weights[index] ?? 0;
      const handoffAge = age - boundary * active.duration;
      const endpoint = active.packet.segments[index]?.to;
      if (endpoint && handoffAge >= 0 && handoffAge <= RELAY_SPARK_MS) {
        this.drawHandoff(context, this.screenPoint(endpoint.id), active.color, handoffAge / RELAY_SPARK_MS);
      }
    }

    const source = active.packet.segments[0]?.from;
    if (source && age <= SOURCE_IGNITION_MS) this.drawHandoff(context, this.screenPoint(source.id), active.color, age / SOURCE_IGNITION_MS);
    if (age >= active.duration) {
      const destination = active.packet.segments.at(-1)?.to;
      if (destination) this.drawDestination(context, this.screenPoint(destination.id), active.color, (age - active.duration) / DESTINATION_BLOOM_MS);
      return;
    }

    const segment = active.packet.segments[motion.segmentIndex];
    if (!segment) return;
    const from = this.screenPoint(segment.from.id);
    const to = this.screenPoint(segment.to.id);
    if (!segmentNearViewport(from, to, this.width, this.height, 24)) return;
    const head = interpolateScreenPoint(from, to, easeInOut(motion.localProgress));
    const emphasis = this.selectedNodeID && active.packet.segments.some((hop) => hop.from.id === this.selectedNodeID || hop.to.id === this.selectedNodeID) ? 1.3 : 1;
    if (emphasis > 1) this.stage.dataset.focusedPacketEmphasis = String(emphasis);
    const trail = packetTrail(from, head, clamp(Math.hypot(to.x - from.x, to.y - from.y) * 0.28, 18, 68) * displayPreferences().trailLength);
    if (this.quality.mode === 'low') {
      context.beginPath();
      context.moveTo(trail.tail.x, trail.tail.y);
      context.lineTo(head.x, head.y);
      context.strokeStyle = colorWithAlpha(active.color, 0.65);
      context.lineWidth = (active.longHaul ? 3.2 : 2.2) * emphasis;
      context.stroke();
      context.beginPath();
      context.arc(head.x, head.y, 3.25 * emphasis * displayPreferences().packetSize, 0, Math.PI * 2);
      context.fillStyle = displayColor(active.color);
      context.fill();
      return;
    }
    const gradient = context.createLinearGradient(trail.tail.x, trail.tail.y, head.x, head.y);
    gradient.addColorStop(0, colorWithAlpha(active.color, 0));
    gradient.addColorStop(0.46, colorWithAlpha(active.color, 0.32));
    gradient.addColorStop(1, colorWithAlpha(active.color, 0.96));
    context.save();
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(trail.tail.x, trail.tail.y);
    context.lineTo(head.x, head.y);
    // Taper to the tail rather than painting a broad, flat tube.
    const length = Math.max(1, Math.hypot(head.x - trail.tail.x, head.y - trail.tail.y));
    const halfWidth = (active.longHaul ? 6 : active.crossRegion ? 5 : 4) * emphasis;
    const px = -(head.y - trail.tail.y) / length * halfWidth;
    const py = (head.x - trail.tail.x) / length * halfWidth;
    context.lineTo(head.x + px, head.y + py);
    context.lineTo(trail.tail.x, trail.tail.y);
    context.lineTo(head.x - px, head.y - py);
    context.closePath();
    context.fillStyle = gradient;
    context.globalAlpha = 0.3 * displayPreferences().glow;
    context.fill();
    context.globalAlpha = 1;
    context.beginPath();
    context.moveTo(trail.tail.x, trail.tail.y);
    context.lineTo(head.x, head.y);
    context.strokeStyle = gradient;
    context.lineWidth = (active.longHaul ? 4.5 : active.crossRegion ? 3.7 : 3.1) * emphasis;
    context.stroke();
    const sparkCount = this.quality.mode === 'balanced' || this.activeRoutes.length > 40 ? 1 : this.lowPowerQuery.matches ? 2 : 3;
    for (let index = 1; index <= sparkCount; index += 1) {
      const amount = Math.max(0, 1 - index * 0.2);
      const spark = interpolateScreenPoint(trail.tail, head, amount);
      context.beginPath();
      context.arc(spark.x, spark.y, 1.5 - index * 0.18, 0, Math.PI * 2);
      context.fillStyle = colorWithAlpha(active.color, 0.68 - index * 0.13);
      context.fill();
    }
    const glowRadius = (active.longHaul ? 15 : active.crossRegion ? 12 : 10) * emphasis;
    context.globalAlpha = displayPreferences().glow;
    context.drawImage(this.glowSprite(active.color), head.x - glowRadius, head.y - glowRadius, glowRadius * 2, glowRadius * 2);
    context.globalAlpha = 1;
    context.beginPath();
    context.arc(head.x, head.y, 3.25 * emphasis * displayPreferences().packetSize, 0, Math.PI * 2);
    context.fillStyle = displayColor(active.color);
    context.fill();
    if (this.quality.mode === 'full') this.drawSignature(context, head, from, to, active.color, active.signature, age);
    context.restore();
  }

  private drawSignature(
    context: CanvasRenderingContext2D,
    point: ScreenPoint,
    from: ScreenPoint,
    to: ScreenPoint,
    color: string,
    signature: PacketSignature,
    age: number,
  ): void {
    if (signature === 'ripple') {
      context.beginPath();
      context.arc(point.x, point.y, 5 + (age % 420) / 105, 0, Math.PI * 2);
      context.strokeStyle = colorWithAlpha(color, 0.44);
      context.lineWidth = 1;
      context.stroke();
      return;
    }
    if (signature === 'echo') {
      const echo = interpolateScreenPoint(from, point, 0.82);
      context.beginPath();
      context.arc(echo.x, echo.y, 2.1, 0, Math.PI * 2);
      context.fillStyle = colorWithAlpha(color, 0.62);
      context.fill();
      return;
    }
    if (signature === 'orbit') {
      for (const phase of [0, Math.PI]) {
        const angle = age * 0.009 + phase;
        context.beginPath();
        context.arc(point.x + Math.cos(angle) * 6, point.y + Math.sin(angle) * 6, 1.25, 0, Math.PI * 2);
        context.fillStyle = colorWithAlpha(color, 0.74);
        context.fill();
      }
      return;
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const offset = signature === 'double' ? 3 : 0;
    for (const side of signature === 'double' ? [-1, 1] : [0]) {
      context.beginPath();
      context.moveTo(point.x + dx / length * offset * side - px * 3.5, point.y + dy / length * offset * side - py * 3.5);
      context.lineTo(point.x + dx / length * offset * side + px * 3.5, point.y + dy / length * offset * side + py * 3.5);
      context.strokeStyle = colorWithAlpha(color, 0.76);
      context.lineWidth = 1.2;
      context.stroke();
    }
  }

  private drawHandoff(context: CanvasRenderingContext2D, point: ScreenPoint, color: string, progress: number): void {
    if (!this.pointVisible(point, 28)) return;
    context.beginPath();
    context.arc(point.x, point.y, 5 + progress * 10, 0, Math.PI * 2);
    context.strokeStyle = colorWithAlpha(color, (1 - progress) * 0.8);
    context.lineWidth = 1.6;
    context.stroke();
  }

  private drawDestination(context: CanvasRenderingContext2D, point: ScreenPoint, color: string, progress: number): void {
    if (!this.pointVisible(point, 28)) return;
    const opacity = Math.sin(Math.PI * clamp(progress, 0, 1));
    context.beginPath();
    context.arc(point.x, point.y, 7 + progress * 14, 0, Math.PI * 2);
    context.fillStyle = colorWithAlpha(color, opacity * 0.18);
    context.fill();
    context.beginPath();
    context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
    context.fillStyle = colorWithAlpha(color, opacity * 0.92);
    context.fill();
  }

  private drawObserverWake(context: CanvasRenderingContext2D, wake: ObserverWake, now: number): void {
    const age = now - wake.started;
    const point = this.screenPoint(wake.endpoint.id);
    if (!this.pointVisible(point, 48)) return;
    const radius = nodeWakeRadius(age, wake.signature, this.reducedMotionQuery.matches);
    const life = Math.pow(1 - clamp(age / 6_000, 0, 1), 2);
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.strokeStyle = colorWithAlpha(wake.color, life * 0.72);
    context.lineWidth = 1.4;
    context.stroke();
  }

  private addResidue(routeId: string, fromId: string, toId: string, color: string, signature: PacketSignature, addedAt: number): void {
    // Refresh an existing decorative trail without stacking it to white.
    // Active packet heads and their audio articulations are never coalesced.
    const previous = this.residue.findIndex((item) => item.routeId === routeId && item.fromId === fromId && item.toId === toId && item.color === color);
    if (previous >= 0) this.residue.splice(previous, 1);
    this.residue.push({ routeId, fromId, toId, color, signature, addedAt });
    this.trimResidue();
    this.residueDirty = true;
  }

  private trimResidue(): void {
    this.residue = capNewest(this.residue, this.lowPowerQuery.matches ? LOW_POWER_MAX_RESIDUE : MAX_RESIDUE);
  }

  private rebuildAdjacency(routes: readonly RouteV2[]): void {
    this.adjacentRouteIDs.clear();
    for (const route of routes) {
      this.addAdjacentRoute(route.fromId, route.id);
      this.addAdjacentRoute(route.toId, route.id);
    }
  }

  private addAdjacentRoute(nodeID: string, routeID: string): void {
    const routes = this.adjacentRouteIDs.get(nodeID) ?? new Set<string>();
    routes.add(routeID);
    this.adjacentRouteIDs.set(nodeID, routes);
  }

  private scheduleReducedMotionCleanup(now = performance.now()): void {
    if (this.residueCleanupTimer) return;
    const expiries = [
      ...this.activeRoutes.map((route) => route.started + route.duration + DESTINATION_BLOOM_MS),
      ...this.residue.map((item) => item.addedAt + residueLifetime()),
      ...this.observerWakes.map((wake) => wake.started + 6_000),
      ...this.regionActivityCues.map((cue) => cue.startedAt + cue.duration),
      ...this.regionActivityCues.filter((cue) => cue.startedAt > now).map((cue) => cue.startedAt),
    ];
    if (expiries.length === 0) return;
    const nextExpiry = Math.min(...expiries);
    this.residueCleanupTimer = window.setTimeout(() => {
      this.residueCleanupTimer = 0;
      this.requestMotionFrame();
    }, Math.max(0, nextExpiry - now) + 20);
  }

  private clearResidueCleanup(): void {
    if (!this.residueCleanupTimer) return;
    window.clearTimeout(this.residueCleanupTimer);
    this.residueCleanupTimer = 0;
  }

  private screenPoint(nodeID: string): ScreenPoint {
    const cached = this.screenPoints.get(nodeID);
    if (cached) return cached;
    const position = this.layout.positions.get(nodeID);
    const point = position ? this.worldToScreen(position.x, position.y) : { x: -1_000_000, y: -1_000_000 };
    this.screenPoints.set(nodeID, point);
    return point;
  }

  private pointVisible(point: ScreenPoint, margin: number): boolean {
    return point.x >= -margin && point.y >= -margin && point.x <= this.width + margin && point.y <= this.height + margin;
  }

  private textWidth(context: CanvasRenderingContext2D, text: string): number {
    const key = `${context.font}:${text}`;
    let width = this.textWidths.get(key);
    if (width === undefined) {
      width = context.measureText(text).width;
      this.textWidths.set(key, width);
    }
    return width;
  }

  private glowSprite(color: string): HTMLCanvasElement {
    let sprite = this.glowSprites.get(color);
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
      this.glowSprites.set(color, sprite);
    }
    return sprite;
  }

  private regionLabelSprite(title: string, direction: string, color: string): { canvas: HTMLCanvasElement; width: number } {
    const key = `${title}:${direction}:${color}`;
    const cached = this.regionLabelSprites.get(key);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    context.font = '800 11px Inter, ui-sans-serif, system-ui, sans-serif';
    const titleWidth = context.measureText(title).width;
    context.font = '850 9px Inter, ui-sans-serif, system-ui, sans-serif';
    const directionWidth = context.measureText(direction).width + 12;
    const width = Math.min(Math.max(110, titleWidth + directionWidth + 24), Math.max(110, this.width - 12));
    canvas.width = Math.ceil(width * this.dpr);
    canvas.height = Math.ceil(30 * this.dpr);
    context.scale(this.dpr, this.dpr);
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
    if (this.regionLabelSprites.size >= 64) this.regionLabelSprites.delete(this.regionLabelSprites.keys().next().value!);
    this.regionLabelSprites.set(key, sprite);
    return sprite;
  }

  private worldToScreen(x: number, y: number): ScreenPoint {
    return {
      x: (x - this.centerX) * this.scale + this.width / 2,
      y: (y - this.centerY) * this.scale + this.height / 2,
    };
  }

  private screenToWorld(x: number, y: number): ScreenPoint {
    return {
      x: (x - this.width / 2) / this.scale + this.centerX,
      y: (y - this.height / 2) / this.scale + this.centerY,
    };
  }

  private viewChanged(): void {
    this.screenPoints.clear();
    this.residueDirty = true;
    this.residueProjectionDirty = true;
    this.nodesDirty = true;
    this.stage.dataset.viewScale = this.scale.toFixed(4);
    this.stage.dataset.viewCenter = `${this.centerX.toFixed(2)},${this.centerY.toFixed(2)}`;
    if (this.quality.mode === 'low' && this.pointers.size && this.paintedView) {
      // Reuse the actual rendered topology while fingers move. Its affine
      // transform is the same projection used by live packets and hit testing.
      const scale = this.scale / this.paintedView.scale;
      const x = (this.paintedView.x - this.centerX) * this.scale + this.width / 2 * (1 - scale);
      const y = (this.paintedView.y - this.centerY) * this.scale + this.height / 2 * (1 - scale);
      this.graphCanvas.style.transform = `matrix(${scale}, 0, 0, ${scale}, ${x}, ${y})`;
    }
    this.requestStaticDraw();
    if (this.activeRoutes.length || this.observerWakes.length || this.residue.length || this.regionActivityCues.length) {
      this.requestMotionFrame();
    }
  }

  private animateView(centerX: number, centerY: number, scale: number): void {
    this.cancelViewAnimation();
    if (this.reducedMotionQuery.matches || this.quality.mode === 'low') {
      this.centerX = centerX;
      this.centerY = centerY;
      this.scale = scale;
      this.viewChanged();
      return;
    }
    const fromX = this.centerX;
    const fromY = this.centerY;
    const fromScale = this.scale;
    const started = performance.now();
    const tick = (now: number): void => {
      const progress = clamp((now - started) / VIEW_ANIMATION_MS, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.centerX = fromX + (centerX - fromX) * eased;
      this.centerY = fromY + (centerY - fromY) * eased;
      this.scale = fromScale + (scale - fromScale) * eased;
      this.viewChanged();
      if (progress < 1) this.viewFrame = requestAnimationFrame(tick);
      else this.viewFrame = 0;
    };
    this.viewFrame = requestAnimationFrame(tick);
  }

  private cancelViewAnimation(): void {
    if (this.viewFrame) cancelAnimationFrame(this.viewFrame);
    this.viewFrame = 0;
  }

  private nearestNode(x: number, y: number): ScreenNode | null {
    let closest: ScreenNode | null = null;
    let closestDistance = Infinity;
    for (const node of this.screenNodes) {
      const point = this.screenPoint(node.node.id);
      const distance = Math.hypot(point.x - x, point.y - y);
      const hitRadius = Math.max(12, node.radius + 6);
      if (distance <= hitRadius && distance < closestDistance) {
        closest = node;
        closestDistance = distance;
      }
    }
    return closest ? { ...closest, point: this.screenPoint(closest.node.id), node: this.nodesByID.get(closest.node.id) ?? closest.node } : null;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.paused) return;
    this.cancelViewAnimation();
    this.dragMoved = this.pointers.size > 0;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.rebaseGesture();
    this.stage.setPointerCapture(event.pointerId);
    this.stage.classList.add('is-dragging');
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.pointers.has(event.pointerId)) {
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const [first, second] = this.pointers.values();
      if (first && second && this.pinchStart) {
        const { distance, scale, anchor, offset } = this.pinchStart;
        this.scale = clamp(scale * Math.hypot(second.x - first.x, second.y - first.y) / distance, 0.005, 8);
        this.centerX = anchor.x - ((first.x + second.x) / 2 - offset.x - this.width / 2) / this.scale;
        this.centerY = anchor.y - ((first.y + second.y) / 2 - offset.y - this.height / 2) / this.scale;
        this.dragMoved = true;
      } else {
        const deltaX = event.clientX - this.pointerStart.x;
        const deltaY = event.clientY - this.pointerStart.y;
        if (Math.hypot(deltaX, deltaY) > 4) this.dragMoved = true;
        this.centerX = this.viewStart.x - deltaX / this.scale;
        this.centerY = this.viewStart.y - deltaY / this.scale;
      }
      this.viewChanged();
      return;
    }
    if (event.pointerType === 'touch') return;
    const rect = this.stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hovered = this.nearestNode(x, y);
    const nextID = hovered?.node.id ?? null;
    if (nextID === this.hoveredNodeID) return;
    this.hoveredNodeID = nextID;
    this.nodesDirty = true;
    this.stage.classList.toggle('node-hover', Boolean(hovered));
    this.callbacks.onNodeHover(hovered?.node ?? null, hovered?.point);
    this.requestStaticDraw();
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    const select = this.pointers.size === 1 && !this.dragMoved;
    this.finishPointer(event.pointerId);
    if (!select) return;
    const rect = this.stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.callbacks.onNodeSelect(this.nearestNode(x, y)?.node.id ?? null);
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    this.dragMoved = true;
    this.finishPointer(event.pointerId);
  };

  private finishPointer(pointerID: number): void {
    this.pointers.delete(pointerID);
    if (this.stage.hasPointerCapture(pointerID)) this.stage.releasePointerCapture(pointerID);
    // Re-anchor the remaining finger so a pinch can become a drag without a jump.
    this.rebaseGesture();
    this.stage.classList.toggle('is-dragging', this.pointers.size > 0);
    if (!this.pointers.size && this.graphCanvas.style.transform) this.requestStaticDraw();
  }

  private rebaseGesture(): void {
    this.pinchStart = undefined;
    const [first, second] = this.pointers.values();
    if (!first) return;
    this.pointerStart = first;
    this.viewStart = { x: this.centerX, y: this.centerY };
    if (!second) return;
    const rect = this.stage.getBoundingClientRect();
    this.pinchStart = {
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      scale: this.scale,
      anchor: this.screenToWorld((first.x + second.x) / 2 - rect.left, (first.y + second.y) / 2 - rect.top),
      offset: { x: rect.left, y: rect.top },
    };
  }

  private clearPointers(): void {
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    this.pinchStart = undefined;
    this.stage.classList.remove('is-dragging');
    if (this.graphCanvas.style.transform) this.requestStaticDraw();
    for (const id of ids) if (this.stage.hasPointerCapture(id)) this.stage.releasePointerCapture(id);
  }

  zoomBy(factor: number): void {
    this.animateView(this.centerX, this.centerY, clamp(this.scale * factor, 0.005, 8));
  }

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.cancelViewAnimation();
    const rect = this.stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const anchor = this.screenToWorld(x, y);
    const nextScale = clamp(this.scale * Math.exp(-event.deltaY * 0.0012), 0.005, 8);
    this.scale = nextScale;
    this.centerX = anchor.x - (x - this.width / 2) / nextScale;
    this.centerY = anchor.y - (y - this.height / 2) / nextScale;
    this.viewChanged();
  };

  private handleDoubleClick = (event: MouseEvent): void => {
    const rect = this.stage.getBoundingClientRect();
    const anchor = this.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    this.animateView(anchor.x, anchor.y, clamp(this.scale * 1.65, 0.005, 8));
  };

  private handleMotionPreference = (): void => {
    this.stage.dataset.motionMode = this.reducedMotionQuery.matches ? 'static' : 'animated';
    if (this.reducedMotionQuery.matches) this.activeRoutes = [];
    else this.clearResidueCleanup();
    this.requestMotionFrame();
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
