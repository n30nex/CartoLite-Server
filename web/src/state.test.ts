import { describe, expect, it, vi } from 'vitest';
import { activityLabel, assertStateV2, LiveStore, ROUTE_BATCH_MS, sequenceAction } from './state';
import type { NodeV2, RouteV2, StateV2 } from './types';

const nodes: NodeV2[] = [
  { id: 'a', label: 'A', lat: 43.4, lng: -80.3, role: 'repeater', observer: false, lastSeen: 1 },
  { id: 'b', label: 'B', lat: 43.5, lng: -80.2, role: 'repeater', observer: false, lastSeen: 1 }
];

const initial: StateV2 = {
  schemaVersion: 2,
  bootId: 'boot-a',
  seq: 7,
  serverTime: 1,
  status: { feed: 'connected', activity: 'active', dropped: 0, version: '0.4.0', gitSha: 'abc' },
  map: { center: [0, 20], zoom: 1.4 },
  nodes,
  routes: []
};

describe('sequenceAction', () => {
  it('classifies duplicates, contiguous events, and gaps', () => {
    expect(sequenceAction(7, 7)).toBe('duplicate');
    expect(sequenceAction(7, 6)).toBe('duplicate');
    expect(sequenceAction(7, 8)).toBe('next');
    expect(sequenceAction(7, 9)).toBe('gap');
  });
});

describe('LiveStore', () => {
  it('upserts nodes without duplicating IDs and marks their routes dirty', () => {
    const route = existingRoute();
    const store = new LiveStore({ ...initial, routes: [route] });
    const changes: unknown[] = [];
    store.subscribe((_state, change) => changes.push(change));
    store.upsertNode({ ...nodes[0]!, label: 'Relay 2', lat: 44 }, 8);
    expect(store.snapshot.nodes).toHaveLength(2);
    expect(store.snapshot.nodes[0]).toMatchObject({ label: 'Relay 2', lat: 44 });
    expect(store.snapshot.seq).toBe(8);
    expect(changes[1]).toEqual({
      nodes: [expect.objectContaining({ id: 'a', label: 'Relay 2', lat: 44 })],
      routeGeometry: ['r1']
    });
  });

  it('marks status-only notifications as map-stable', () => {
    const store = new LiveStore(initial);
    const changes: unknown[] = [];
    store.subscribe((_state, change) => changes.push(change));
    store.updateStatus({ ...initial.status, activity: 'quiet' }, 8);
    expect(changes).toEqual([{ reset: true }, null]);
    store.destroy();
  });

  it('batches compact route events for one second and resolves animation endpoints locally', () => {
    vi.useFakeTimers();
    const store = new LiveStore(initial);
    let emissions = 0;
    store.subscribe(() => { emissions += 1; });
    const packet = {
      seq: 8,
      id: 'p1',
      at: 100,
      payloadType: 'Trace' as const,
      mode: 'route' as const,
      segments: [{ routeId: 'r1', fromId: 'a', toId: 'b' }]
    };
    const view = store.applyPacket(packet);
    store.applyPacket({ ...packet, seq: 9, at: 200 });
    expect(view).toMatchObject({ mode: 'route', segments: [{ from: { id: 'a' }, to: { id: 'b' } }] });
    expect(store.snapshot.seq).toBe(9);
    expect(store.snapshot.routes).toHaveLength(0);
    expect(emissions).toBe(1);

    vi.advanceTimersByTime(ROUTE_BATCH_MS);
    expect(store.snapshot.routes).toEqual([expect.objectContaining({
      id: 'r1',
      fromId: 'a',
      toId: 'b',
      packetCount: 2,
      lastHeard: 200,
      intensity: 1,
      lastKind: 'Trace'
    })]);
    expect(store.snapshot.routes[0]?.traffic).toBeCloseTo(2, 3);
    expect(emissions).toBe(2);
    store.destroy();
    vi.useRealTimers();
  });

  it('coalesces count, freshness, intensity, and newest-kind updates', () => {
    vi.useFakeTimers();
    const store = new LiveStore({ ...initial, routes: [existingRoute()] });
    let emissions = 0;
    store.subscribe(() => { emissions += 1; });

    for (let seq = 8; seq <= 10; seq += 1) {
      store.applyPacket({
        seq,
        id: `p${seq}`,
        at: seq * 100,
        payloadType: seq === 10 ? 'Text' : 'Trace',
        mode: 'route',
        segments: [{ routeId: 'r1', fromId: 'a', toId: 'b' }]
      });
    }
    expect(store.snapshot.routes[0]).toMatchObject({ packetCount: 3, lastHeard: 1 });
    vi.advanceTimersByTime(ROUTE_BATCH_MS);
    expect(store.snapshot.routes[0]).toMatchObject({
      packetCount: 6,
      lastHeard: 1_000,
      intensity: 2,
      lastKind: 'Text'
    });
    expect(emissions).toBe(2);
    store.destroy();
    vi.useRealTimers();
  });

  it('emits one touched-route update per batch and never regresses freshness', () => {
    vi.useFakeTimers();
    const store = new LiveStore({ ...initial, routes: [{ ...existingRoute(), packetCount: 4, intensity: 2, lastHeard: 100, traffic: 64 }] });
    let emissions = 0;
    store.subscribe(() => { emissions += 1; });
    const packet = {
      seq: 8,
      id: 'p8',
      at: 200,
      payloadType: 'Trace' as const,
      mode: 'route' as const,
      segments: [{ routeId: 'r1', fromId: 'a', toId: 'b' }]
    };
    store.applyPacket(packet);
    store.applyPacket({ ...packet, seq: 9, id: 'p9', at: 50 });
    vi.advanceTimersByTime(ROUTE_BATCH_MS);
    expect(store.snapshot.routes[0]).toMatchObject({ packetCount: 6, lastHeard: 200, intensity: 2, traffic: 64 });
    expect(emissions).toBe(2);
    store.destroy();
    vi.useRealTimers();
  });
});

describe('public state guards and status', () => {
  it('accepts schema v2 and rejects old or dangling route schemas', () => {
    expect(() => assertStateV2(initial)).not.toThrow();
    expect(() => assertStateV2({ ...initial, schemaVersion: 1 })).toThrow('unsupported state schema');
    expect(() => assertStateV2({ ...initial, routes: [{ ...existingRoute(), toId: 'missing' }] })).toThrow('invalid route');
    expect(() => assertStateV2({ ...initial, nodes: [...nodes, nodes[0]!] })).toThrow('duplicate node IDs');
    expect(() => assertStateV2({ ...initial, routes: [existingRoute(), existingRoute()] })).toThrow('duplicate route IDs');
  });

  it('distinguishes reconnecting and normal RF quiet', () => {
    expect(activityLabel({ ...initial, status: { ...initial.status, activity: 'quiet' } }, true)).toEqual({
      state: 'quiet',
      text: 'Connected · quiet'
    });
    expect(activityLabel(initial, false).state).toBe('reconnecting');
  });
});

function existingRoute(): RouteV2 {
  return {
    id: 'r1',
    fromId: 'a',
    toId: 'b',
    packetCount: 3,
    lastHeard: 1,
    intensity: 1,
    lastKind: 'Trace',
    traffic: 1
  };
}
