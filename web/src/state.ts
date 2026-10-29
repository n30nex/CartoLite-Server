import type {
  EndpointV2,
  NodeV2,
  PacketEventV2,
  PacketView,
  RouteSegmentView,
  RouteV2,
  StateV2,
  StatusV2
} from './types';
import { PACKET_KINDS, normalizePacketKind, routeTrafficAfterPacket } from './trafficVisuals';

export const ROUTE_BATCH_MS = 1_000;

export type SequenceAction = 'duplicate' | 'next' | 'gap';

export interface MapChanges {
  reset?: boolean;
  nodes?: readonly NodeV2[];
  routes?: readonly RouteV2[];
  routeGeometry?: readonly string[];
}

export function sequenceAction(current: number, incoming: number): SequenceAction {
  if (incoming <= current) return 'duplicate';
  if (incoming === current + 1) return 'next';
  return 'gap';
}

export function assertStateV2(value: unknown): asserts value is StateV2 {
  if (!value || typeof value !== 'object') throw new Error('state response is not an object');
  const state = value as Partial<StateV2>;
  if (state.schemaVersion !== 2) throw new Error(`unsupported state schema: ${String(state.schemaVersion)}`);
  if (typeof state.bootId !== 'string' || !state.bootId) throw new Error('state is missing bootId');
  if (typeof state.seq !== 'number' || !Number.isSafeInteger(state.seq) || state.seq < 0) throw new Error('state has invalid sequence');
  if (!Number.isFinite(state.serverTime)) throw new Error('state has invalid server time');
  if (!state.status || !state.map || !Array.isArray(state.nodes) || !Array.isArray(state.routes)) {
    throw new Error('state response is incomplete');
  }
  if (!validStatus(state.status) || !validMap(state.map)) throw new Error('state metadata is invalid');
  if (state.nodes.some((node) => !validNode(node))) throw new Error('state contains an invalid node');
  const nodeIDs = new Set(state.nodes.map((node) => node.id));
  if (nodeIDs.size !== state.nodes.length) throw new Error('state contains duplicate node IDs');
  if (state.routes.some((route) => !validRoute(route) || !nodeIDs.has(route.fromId) || !nodeIDs.has(route.toId))) {
    throw new Error('state contains an invalid route');
  }
  if (new Set(state.routes.map((route) => route.id)).size !== state.routes.length) throw new Error('state contains duplicate route IDs');
}

type Listener = (state: Readonly<StateV2>, changes: MapChanges | null) => void;

export class LiveStore {
  #current: StateV2;
  #listeners = new Set<Listener>();
  #nodeIndexes = new Map<string, number>();
  #routeIndexes = new Map<string, number>();
  #nodeRoutes = new Map<string, Set<string>>();
  #pendingRoutes = new Map<string, RouteV2>();
  #routeTimer?: number;

  constructor(initial: StateV2) {
    this.#current = initial;
    this.#rebuildIndexes();
  }

  get snapshot(): Readonly<StateV2> {
    return this.#current;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#current, { reset: true });
    return () => this.#listeners.delete(listener);
  }

  replace(next: StateV2): void {
    this.#clearRouteBatch();
    this.#current = next;
    this.#rebuildIndexes();
    this.#emit({ reset: true });
  }

  upsertNode(node: NodeV2, seq: number): void {
    const index = this.#nodeIndexes.get(node.id);
    const previous = index === undefined ? undefined : this.#current.nodes[index];
    const moved = !previous || previous.lat !== node.lat || previous.lng !== node.lng;
    const nodes = [...this.#current.nodes];
    if (index !== undefined) nodes[index] = node;
    else {
      this.#nodeIndexes.set(node.id, nodes.length);
      nodes.push(node);
    }
    this.#current = { ...this.#current, seq, nodes };
    this.#emit({ nodes: [node], routeGeometry: moved ? [...(this.#nodeRoutes.get(node.id) ?? [])] : [] });
  }

  updateStatus(status: StatusV2, seq: number): void {
    this.#current = { ...this.#current, seq, status };
    this.#emit(null);
  }

  advance(seq: number): void {
    this.#current = { ...this.#current, seq };
  }

  applyPacket(packet: PacketEventV2): PacketView | null {
    this.advance(packet.seq);
    if (packet.mode === 'observer') return packet;

    // Resolve every endpoint before touching route counts or scheduling a batch.
    // An incomplete packet must not leave a partial or dangling connection.
    const resolved: RouteSegmentView[] = [];
    for (const segment of packet.segments) {
      const from = this.#nodeByID(segment.fromId);
      const to = this.#nodeByID(segment.toId);
      if (!from || !to) return null;
      resolved.push({ routeId: segment.routeId, from: endpoint(from), to: endpoint(to) });
    }
    for (const segment of packet.segments) {
      const existing = this.#pendingRoutes.get(segment.routeId) ?? this.#routeByID(segment.routeId);
      const packetCount = (existing?.packetCount ?? 0) + 1;
      const previousLastHeard = existing?.lastHeard ?? 0;
      const isNewest = packet.at >= previousLastHeard;
      this.#queueRoute({
        id: segment.routeId,
        fromId: segment.fromId,
        toId: segment.toId,
        packetCount,
        lastHeard: Math.max(previousLastHeard, packet.at),
        intensity: routeIntensity(packetCount),
        lastKind: isNewest ? normalizePacketKind(packet.payloadType) : existing?.lastKind ?? 'Other',
        traffic: routeTrafficAfterPacket(existing?.traffic ?? 0, previousLastHeard, packet.at)
      });
    }
    return { ...packet, segments: resolved };
  }

  destroy(): void {
    this.#clearRouteBatch();
    this.#listeners.clear();
  }

  #nodeByID(id: string): NodeV2 | undefined {
    const index = this.#nodeIndexes.get(id);
    return index === undefined ? undefined : this.#current.nodes[index];
  }

  #routeByID(id: string): RouteV2 | undefined {
    const index = this.#routeIndexes.get(id);
    return index === undefined ? undefined : this.#current.routes[index];
  }

  #queueRoute(route: RouteV2): void {
    const previous = this.#pendingRoutes.get(route.id) ?? this.#routeByID(route.id);
    if (previous && (previous.fromId !== route.fromId || previous.toId !== route.toId)) this.#unindexRoute(previous);
    this.#pendingRoutes.set(route.id, route);
    this.#indexRoute(route);
    if (this.#routeTimer === undefined) {
      this.#routeTimer = window.setTimeout(() => this.#flushRoutes(), ROUTE_BATCH_MS);
    }
  }

  #flushRoutes(): void {
    this.#routeTimer = undefined;
    if (this.#pendingRoutes.size === 0) return;
    const routes = [...this.#current.routes];
    const changed: RouteV2[] = [];
    for (const route of this.#pendingRoutes.values()) {
      const index = this.#routeIndexes.get(route.id);
      if (index === undefined) {
        this.#routeIndexes.set(route.id, routes.length);
        routes.push(route);
        changed.push(route);
      } else {
        changed.push(route);
        routes[index] = route;
      }
    }
    this.#pendingRoutes.clear();
    this.#current = { ...this.#current, routes };
    if (changed.length > 0) this.#emit({ routes: changed });
  }

  #rebuildIndexes(): void {
    this.#nodeIndexes.clear();
    this.#routeIndexes.clear();
    this.#nodeRoutes.clear();
    this.#current.nodes.forEach((node, index) => this.#nodeIndexes.set(node.id, index));
    this.#current.routes.forEach((route, index) => {
      this.#routeIndexes.set(route.id, index);
      this.#indexRoute(route);
    });
  }

  #indexRoute(route: RouteV2): void {
    for (const nodeID of new Set([route.fromId, route.toId])) {
      let routes = this.#nodeRoutes.get(nodeID);
      if (!routes) {
        routes = new Set<string>();
        this.#nodeRoutes.set(nodeID, routes);
      }
      routes.add(route.id);
    }
  }

  #unindexRoute(route: RouteV2): void {
    for (const nodeID of new Set([route.fromId, route.toId])) {
      const routes = this.#nodeRoutes.get(nodeID);
      routes?.delete(route.id);
      if (routes?.size === 0) this.#nodeRoutes.delete(nodeID);
    }
  }

  #clearRouteBatch(): void {
    if (this.#routeTimer !== undefined) window.clearTimeout(this.#routeTimer);
    this.#routeTimer = undefined;
    this.#pendingRoutes.clear();
  }

  #emit(changes: MapChanges | null): void {
    for (const listener of this.#listeners) listener(this.#current, changes);
  }
}

function endpoint(node: NodeV2): EndpointV2 {
  return { id: node.id, label: node.label, lat: node.lat, lng: node.lng };
}

function routeIntensity(packetCount: number): RouteV2['intensity'] {
  if (packetCount >= 16) return 4;
  if (packetCount >= 8) return 3;
  if (packetCount >= 4) return 2;
  if (packetCount >= 2) return 1;
  return 0;
}

function validEndpoint(point: EndpointV2): boolean {
  return typeof point?.id === 'string' && point.id.length > 0
    && typeof point.label === 'string'
    && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
}

export function validNode(node: NodeV2): boolean {
  return validEndpoint(node)
    && ['repeater', 'companion', 'room_server', 'sensor', 'unknown'].includes(node.role)
    && typeof node.observer === 'boolean'
    && Number.isFinite(node.lastSeen);
}

export function validPacket(packet: PacketEventV2): boolean {
  if (typeof packet?.id !== 'string' || !packet.id || !Number.isFinite(packet.at)
    || !PACKET_KINDS.includes(packet.payloadType)) return false;
  if (packet.mode === 'observer') return validEndpoint(packet.observer);
  return packet.mode === 'route' && Array.isArray(packet.segments) && packet.segments.length > 0
    && packet.segments.every(segment => typeof segment?.routeId === 'string' && !!segment.routeId
      && typeof segment.fromId === 'string' && !!segment.fromId
      && typeof segment.toId === 'string' && !!segment.toId);
}

function validRoute(route: RouteV2): boolean {
  return typeof route?.id === 'string'
    && route.id.length > 0
    && typeof route.fromId === 'string'
    && route.fromId.length > 0
    && typeof route.toId === 'string'
    && route.toId.length > 0
    && Number.isSafeInteger(route.packetCount)
    && route.packetCount >= 1
    && Number.isFinite(route.lastHeard)
    && Number.isSafeInteger(route.intensity)
    && route.intensity >= 0
    && route.intensity <= 4
    && PACKET_KINDS.includes(route.lastKind)
    && Number.isFinite(route.traffic)
    && route.traffic >= 0
    && route.traffic <= 64;
}

export function validStatus(status: StatusV2): boolean {
  return (status?.feed === 'connected' || status?.feed === 'disconnected')
    && (status.activity === 'active' || status.activity === 'quiet')
    && (status.lastPacketAt === undefined || Number.isFinite(status.lastPacketAt))
    && Number.isSafeInteger(status.dropped)
    && status.dropped >= 0
    && typeof status.version === 'string'
    && typeof status.gitSha === 'string';
}

function validMap(map: StateV2['map']): boolean {
  return Array.isArray(map.center)
    && map.center.length === 2
    && Number.isFinite(map.center[0])
    && Number.isFinite(map.center[1])
    && Number.isFinite(map.zoom);
}

export function activityLabel(state: Readonly<StateV2>, streamConnected: boolean): {
  state: 'active' | 'quiet' | 'reconnecting' | 'offline';
  text: string;
} {
  if (!streamConnected && state.status.feed === 'connected') return { state: 'reconnecting', text: 'Reconnecting' };
  if (state.status.feed === 'disconnected') return { state: 'offline', text: 'Feed offline' };
  if (state.status.activity === 'quiet') return { state: 'quiet', text: 'Connected · quiet' };
  return { state: 'active', text: 'Live' };
}
