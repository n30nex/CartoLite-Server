import { afterEach, describe, expect, it, vi } from 'vitest';
import type maplibregl from 'maplibre-gl';
import type { EndpointV2, RoutePacketView, RouteSegmentView } from './types';
import { PACKET_KIND_COLORS } from './trafficVisuals';
import {
  capNewest,
  DESTINATION_BLOOM_MS,
  geographicDistanceKm,
  interpolateScreenPoint,
  MAX_ACTIVE_EFFECTS,
  MAX_RESIDUE,
  MAX_ROUTE_MS,
  MIN_ROUTE_MS,
  NODE_WAKE_MS,
  nodeWakeLife,
  nodeWakeRadius,
  OBSERVER_PING_MS,
  observerRadius,
  PacketAnimator,
  packetTrail,
  packetDuration,
  payloadColor,
  pulseTiming,
  quadraticPoint,
  quadraticSlice,
  RESIDUE_HOT_MS,
  RESIDUE_MS,
  RESIDUE_REDRAW_MS,
  residueLife,
  residueSparkleProgress,
  residueStyle,
  routeCurve,
  routeDistanceKm,
  routeDuration,
  routeMotion,
  segmentNearViewport,
  segmentTravelWeights,
  shouldRefreshResidueCache,
  SINGLE_HOP_MS,
  SOURCE_IGNITION_MS,
  visualQuality,
} from './packetAnimator';

function endpoint(id: string, lat: number, lng: number): EndpointV2 {
  return { id, label: id, lat, lng };
}

function segment(id: string, from: EndpointV2, to: EndpointV2): RouteSegmentView {
  return { routeId: id, from, to };
}

describe('packet animation limits', () => {
  it('keeps crossing effects and rejects offscreen-only effects', () => {
    expect(segmentNearViewport({ x: -50, y: 50 }, { x: 150, y: 50 }, 100, 100, 10)).toBe(true);
    expect(segmentNearViewport({ x: 200, y: 200 }, { x: 300, y: 300 }, 100, 100, 10)).toBe(false);
  });

  it('uses the intended single-hop duration and caps long routes', () => {
    expect(packetDuration(1)).toBe(SINGLE_HOP_MS);
    expect(packetDuration(100)).toBe(MAX_ROUTE_MS);
  });

  it('uses the shared packet palette for animated trails', () => {
    expect(payloadColor('Advert')).toBe(PACKET_KIND_COLORS.Advert);
    expect(payloadColor('Trace')).toBe(PACKET_KIND_COLORS.Trace);
    expect(payloadColor('TextMessage')).toBe(PACKET_KIND_COLORS.Text);
    expect(payloadColor('ACK')).toBe(PACKET_KIND_COLORS.ACK);
    expect(payloadColor('Control')).toBe(PACKET_KIND_COLORS.Control);
    expect(payloadColor('unknown')).toBe(PACKET_KIND_COLORS.Other);
  });

  it('uses geographic segment length to weight travel time', () => {
    const a = endpoint('a', 0, 0);
    const b = endpoint('b', 0, 1);
    const c = endpoint('c', 0, 3);
    const segments = [segment('ab', a, b), segment('bc', b, c)];
    const weights = segmentTravelWeights(segments);

    expect(geographicDistanceKm(a, b)).toBeCloseTo(111.2, 0);
    expect(weights).toHaveLength(2);
    expect(weights[0]).toBeCloseTo(1 / 3, 4);
    expect(weights[1]).toBeCloseTo(2 / 3, 4);
    expect(weights[0]! + weights[1]!).toBeCloseTo(1, 10);
  });

  it('keeps total travel bounded while making longer packets take longer', () => {
    const a = endpoint('a', 0, 0);
    const nearby = endpoint('nearby', 0, 0.01);
    const distant = endpoint('distant', 0, 2);
    const shortRoute = [segment('short', a, nearby)];
    const longRoute = [segment('long', a, distant)];

    expect(routeDistanceKm(longRoute)).toBeGreaterThan(routeDistanceKm(shortRoute));
    expect(routeDuration(longRoute)).toBeGreaterThan(routeDuration(shortRoute));
    expect(routeDuration(shortRoute)).toBeGreaterThanOrEqual(MIN_ROUTE_MS);
    expect(routeDuration(longRoute)).toBeLessThanOrEqual(MAX_ROUTE_MS);
    expect(packetDuration(3, 100_000)).toBe(MAX_ROUTE_MS);
  });

  it('reveals only segments whose weighted travel has completed', () => {
    expect(routeMotion([0.25, 0.75], 0, 1000)).toEqual({ segmentIndex: 0, localProgress: 0, completedSegments: 0 });
    expect(routeMotion([0.25, 0.75], 249, 1000)).toMatchObject({ segmentIndex: 0, completedSegments: 0 });
    expect(routeMotion([0.25, 0.75], 250, 1000)).toEqual({ segmentIndex: 1, localProgress: 0, completedSegments: 1 });
    expect(routeMotion([0.25, 0.75], 999, 1000)).toMatchObject({ segmentIndex: 1, completedSegments: 1 });
    expect(routeMotion([0.25, 0.75], 1000, 1000)).toEqual({ segmentIndex: 1, localProgress: 1, completedSegments: 2 });
  });

  it('grows the current segment trail continuously to the comet head', () => {
    const from = { x: 10, y: 20 };
    const to = { x: 110, y: 60 };

    expect(interpolateScreenPoint(from, to, 0)).toEqual(from);
    expect(interpolateScreenPoint(from, to, 0.25)).toEqual({ x: 35, y: 30 });
    expect(interpolateScreenPoint(from, to, 1)).toEqual(to);
  });

  it('uses a deterministic curved ribbon while preserving exact endpoints', () => {
    const from = { x: 10, y: 20 };
    const to = { x: 210, y: 20 };
    const curve = routeCurve(from, to, 'route-a|echo');

    expect(curve).toEqual(routeCurve(from, to, 'route-a|echo'));
    expect(curve.control.y).not.toBe(20);
    expect(quadraticPoint(curve, 0)).toEqual(from);
    expect(quadraticPoint(curve, 1)).toEqual(to);
    const halfway = quadraticSlice(curve, 0.5);
    expect(halfway.head).toEqual(quadraticPoint(curve, 0.5));
    expect(Math.hypot(halfway.tangent.x, halfway.tangent.y)).toBeGreaterThan(0);
  });

  it('can lock live travel to the straight geographic route layer', () => {
    const from = { x: 10, y: 20 };
    const to = { x: 210, y: 60 };
    const route = routeCurve(from, to, 'route-a|echo', 0);

    expect(route.control).toEqual({ x: 110, y: 40 });
    expect(quadraticPoint(route, 0.5)).toEqual({ x: 110, y: 40 });
  });

  it('keeps a short tapered trail on the exact straight route segment', () => {
    const trail = packetTrail({ x: 0, y: 0 }, { x: 100, y: 0 }, 42);
    expect(trail).toEqual({ tail: { x: 58, y: 0 }, head: { x: 100, y: 0 }, length: 42 });
    const short = packetTrail({ x: 0, y: 0 }, { x: 10, y: 10 }, 42);
    expect(short.tail.x).toBeCloseTo(0);
    expect(short.tail.y).toBeCloseTo(0);
    expect(short.length).toBeCloseTo(Math.sqrt(200));
  });

  it('adapts secondary detail without discarding directional route travel', () => {
    expect(visualQuality(false, 1)).toBe('full');
    expect(visualQuality(false, 11)).toBe('balanced');
    expect(visualQuality(false, 25)).toBe('low');
    expect(visualQuality(true, 1)).toBe('low');
  });

  it('refreshes the cached route glow on content, projection, or fade ticks', () => {
    expect(RESIDUE_REDRAW_MS).toBe(250);
    expect(shouldRefreshResidueCache(1000, 1100, false, false)).toBe(false);
    expect(shouldRefreshResidueCache(1000, 1250, false, false)).toBe(true);
    expect(shouldRefreshResidueCache(1000, 1001, true, false)).toBe(true);
    expect(shouldRefreshResidueCache(1000, 1001, false, true)).toBe(true);
  });

  it('keeps ignition and destination bloom inside their short timing windows', () => {
    expect(SOURCE_IGNITION_MS).toBeGreaterThanOrEqual(120);
    expect(SOURCE_IGNITION_MS).toBeLessThanOrEqual(180);
    expect(DESTINATION_BLOOM_MS).toBeGreaterThanOrEqual(350);
    expect(DESTINATION_BLOOM_MS).toBeLessThanOrEqual(500);
    expect(pulseTiming(-1, SOURCE_IGNITION_MS).opacity).toBe(0);
    expect(pulseTiming(SOURCE_IGNITION_MS / 2, SOURCE_IGNITION_MS).opacity).toBeCloseTo(1);
    expect(pulseTiming(SOURCE_IGNITION_MS + 1, SOURCE_IGNITION_MS).opacity).toBe(0);
    expect(pulseTiming(DESTINATION_BLOOM_MS / 2, DESTINATION_BLOOM_MS).opacity).toBeCloseTo(1);
  });

  it('uses one bounded, crisp observer ping', () => {
    expect(observerRadius(-10_000)).toBe(8);
    expect(observerRadius(0)).toBe(8);
    expect(observerRadius(OBSERVER_PING_MS)).toBe(32);
    expect(observerRadius(OBSERVER_PING_MS * 4)).toBe(32);
  });

  it('keeps recent routes glowing and sparkling for 45 seconds', () => {
    expect(RESIDUE_MS).toBe(45_000);
    expect(RESIDUE_HOT_MS).toBe(4_500);
    expect(residueLife(-100)).toBe(1);
    expect(residueLife(0)).toBe(1);
    expect(residueLife(22_500)).toBeLessThan(0.5);
    expect(residueLife(45_000)).toBe(0);
    expect(residueLife(60_000)).toBe(0);

    const ages = [0, 4_500, 22_500, 42_000, 45_000];
    const styles = ages.map(residueStyle);
    for (let index = 1; index < styles.length; index += 1) {
      const current = styles[index]!;
      const previous = styles[index - 1]!;
      expect(current.life).toBeLessThanOrEqual(previous.life);
      expect(current.bloomOpacity).toBeLessThanOrEqual(previous.bloomOpacity);
      expect(current.coreOpacity).toBeLessThanOrEqual(previous.coreOpacity);
      expect(current.bloomWidth).toBeLessThanOrEqual(previous.bloomWidth);
      expect(current.coreWidth).toBeLessThanOrEqual(previous.coreWidth);
    }
    expect(styles[0]!.hot).toBe(1);
    expect(styles[1]!.hot).toBe(0);
    expect(residueSparkleProgress('route-a', 12_000, 1)).toBe(
      residueSparkleProgress('route-a', 12_000, 1),
    );
    expect(residueSparkleProgress('route-a', 13_000, 1)).not.toBe(
      residueSparkleProgress('route-a', 12_000, 1),
    );
  });

  it('lets active nodes breathe briefly after a hop', () => {
    expect(NODE_WAKE_MS).toBe(6_000);
    expect(nodeWakeLife(0)).toBe(1);
    expect(nodeWakeLife(NODE_WAKE_MS / 2)).toBeGreaterThan(0);
    expect(nodeWakeLife(NODE_WAKE_MS)).toBe(0);
    expect(nodeWakeRadius(0, 'ripple', true)).toBe(nodeWakeRadius(NODE_WAKE_MS / 2, 'ripple', true));
    expect(nodeWakeRadius(NODE_WAKE_MS / 2, 'ripple')).toBeGreaterThan(nodeWakeRadius(0, 'ripple'));
  });

  it('caps only lingering decoration to its bounded budget', () => {
    const values = Array.from({ length: 600 }, (_, index) => index);
    expect(MAX_RESIDUE).toBe(480);
    expect(capNewest(values, MAX_RESIDUE)).toEqual(values.slice(120));
    expect(capNewest(values, 0)).toEqual([]);
    expect(MAX_ACTIVE_EFFECTS).toBe(32);
  });
});

describe('PacketAnimator motion preference lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('marks its canvas mode and switches without completing or restarting an active route', () => {
    const motionListener: { current?: (event: MediaQueryListEvent) => void } = {};
    const motionQuery = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
        motionListener.current = listener as (event: MediaQueryListEvent) => void;
      }),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const lowPowerQuery = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn((query: string) => query.includes('prefers-reduced-motion') ? motionQuery : lowPowerQuery));
    vi.spyOn(performance, 'now').mockReturnValue(900).mockReturnValueOnce(500);
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const context = {
      clearRect: vi.fn(),
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);

    const map = {
      on: vi.fn(),
      off: vi.fn(),
      project: vi.fn((coordinates: [number, number]) => ({ x: coordinates[0], y: coordinates[1] })),
    } as unknown as maplibregl.Map;
    const canvas = document.createElement('canvas');
    const a = endpoint('a', 43.6, -79.4);
    const b = endpoint('b', 43.7, -79.2);
    const packet: RoutePacketView = {
      seq: 1,
      id: 'packet-1',
      at: 1,
      payloadType: 'Trace',
      mode: 'route',
      segments: [segment('ab', a, b)],
    };

    const animator = new PacketAnimator(map, canvas);
    animator.add(packet);
    const state = animator as unknown as {
      activeRoutes: Array<{ started: number }>;
      residue: unknown[];
    };

    expect(canvas.dataset.motionMode).toBe('animated');
    expect(state.activeRoutes[0]?.started).toBe(500);
    expect(state.residue).toHaveLength(0);

    motionListener.current?.({ matches: true } as MediaQueryListEvent);

    expect(canvas.dataset.motionMode).toBe('static');
    expect(state.activeRoutes[0]?.started).toBe(500);
    expect(state.residue).toHaveLength(0);

    motionListener.current?.({ matches: false } as MediaQueryListEvent);
    expect(canvas.dataset.motionMode).toBe('animated');
    expect(state.activeRoutes[0]?.started).toBe(500);
    animator.setPaused(true);
    animator.add(packet);
    expect(state.activeRoutes).toHaveLength(0);
    expect(state.residue).toHaveLength(0);
    animator.destroy();
  });

  it('shows a newly received reduced-motion route as a static 15-second residue', () => {
    const motionQuery = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => motionQuery));
    vi.spyOn(performance, 'now').mockReturnValue(500);
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const context = {
      clearRect: vi.fn(),
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      project: vi.fn((coordinates: [number, number]) => ({ x: coordinates[0], y: coordinates[1] })),
    } as unknown as maplibregl.Map;
    const canvas = document.createElement('canvas');
    const a = endpoint('a', 43.6, -79.4);
    const b = endpoint('b', 43.7, -79.2);
    const animator = new PacketAnimator(map, canvas);

    animator.add({
      seq: 1,
      id: 'packet-static',
      at: 1,
      payloadType: 'Trace',
      mode: 'route',
      segments: [segment('ab', a, b)],
    });

    const state = animator as unknown as {
      activeRoutes: Array<{ completedSegments: number }>;
      residue: Array<{ addedAt: number }>;
    };
    expect(canvas.dataset.motionMode).toBe('static');
    expect(state.activeRoutes[0]?.completedSegments).toBe(1);
    expect(state.residue).toEqual([expect.objectContaining({ addedAt: 500 })]);
    animator.destroy();
  });

  it('keeps every visible route cue during a burst while lowering secondary quality', () => {
    const media = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    vi.stubGlobal('devicePixelRatio', 2);
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const context = {
      clearRect: vi.fn(),
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      project: vi.fn((coordinates: [number, number]) => ({ x: coordinates[0], y: coordinates[1] })),
    } as unknown as maplibregl.Map;
    const canvas = document.createElement('canvas');
    const animator = new PacketAnimator(map, canvas);
    const a = endpoint('a', 43.6, -79.4);
    const b = endpoint('b', 43.7, -79.2);

    for (let index = 0; index < 40; index += 1) {
      animator.add({
        seq: index + 1,
        id: `burst-${index}`,
        at: index,
        payloadType: 'Advert',
        mode: 'route',
        segments: [segment(`route-${index}`, a, b)],
      });
    }

    const state = animator as unknown as { activeRoutes: unknown[] };
    expect(state.activeRoutes).toHaveLength(40);
    expect(canvas.dataset.qualityMode).toBe('low');
    expect(canvas.dataset.pixelRatio).toBe('1.25');
    animator.destroy();
  });
});
