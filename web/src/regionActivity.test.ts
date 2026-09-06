import { describe, expect, it } from 'vitest';
import type { EndpointV2, RoutePacketView } from './types';
import {
  activeRegionFrames,
  capRegionActivity,
  MAX_REGION_ACTIVITY_CUES,
  planRegionTraffic,
  REGION_DX_PULSE_MS,
  regionPulseFrame,
  type RegionActivityCue,
} from './regionActivity';
import {
  LONG_HAUL_MIN_KM,
  packetEndpointDistanceKm,
  potentialLongHaulPacket,
} from './packetAnimator';

function endpoint(id: string, lat: number, lng: number): EndpointV2 {
  return { id, label: id, lat, lng };
}

function packet(
  from: EndpointV2,
  to: EndpointV2,
  payloadType: RoutePacketView['payloadType'] = 'Trace',
): RoutePacketView {
  return {
    seq: 1,
    id: 'packet-1',
    at: 1,
    payloadType,
    mode: 'route',
    segments: [{ routeId: `${from.id}-${to.id}`, from, to }],
  };
}

const regions = new Map([
  ['ham-node', { code: 'HAM', name: 'Hamilton', lat: 43.25, lng: -79.87 }],
  ['ham-far-node', { code: 'HAM', name: 'Hamilton', lat: 43.25, lng: -79.87 }],
  ['wat-node', { code: 'WAT', name: 'Waterloo', lat: 43.46, lng: -80.52 }],
  ['far-node', { code: 'PEC', name: 'Prince Edward County', lat: 44.0, lng: -77.25 }],
]);

describe('live region traffic planning', () => {
  it('pulses a local region only once', () => {
    const view = packet(endpoint('ham-node', 43.24, -79.95), endpoint('ham-node', 43.24, -79.95));
    const plan = planRegionTraffic(view, regions, 1_000);

    expect(plan).toMatchObject({ crossRegion: false, longHaul: false });
    expect(plan?.cues).toEqual([
      expect.objectContaining({ regionTag: 'ham', role: 'local', kind: 'Trace', startedAt: 1_000 }),
    ]);
  });

  it('times a sending pulse at departure and receiving pulse at arrival', () => {
    const view = packet(endpoint('ham-node', 43.24, -79.95), endpoint('wat-node', 43.46, -80.52), 'Text');
    const plan = planRegionTraffic(view, regions, 2_000);

    expect(plan).toMatchObject({ crossRegion: true, longHaul: false });
    expect(plan).not.toBeNull();
    expect(plan!.cues[0]).toMatchObject({ regionTag: 'ham', role: 'send', kind: 'Text', startedAt: 2_000 });
    expect(plan!.cues[1]).toMatchObject({ regionTag: 'wat', role: 'receive', kind: 'Text' });
    expect(plan!.cues[1]!.startedAt).toBeGreaterThan(plan!.cues[0]!.startedAt);
    expect(plan!.cues[0]!.startedAt + plan!.cues[0]!.duration)
      .toBe(plan!.cues[1]!.startedAt + plan!.cues[1]!.duration);
  });

  it('marks only cross-region packets over the observable distance threshold as long haul', () => {
    const view = packet(endpoint('ham-node', 43.24, -79.95), endpoint('far-node', 44.0, -77.25), 'Advert');
    const plan = planRegionTraffic(view, regions, 500);

    expect(LONG_HAUL_MIN_KM).toBe(75);
    expect(packetEndpointDistanceKm(view)).toBeGreaterThan(LONG_HAUL_MIN_KM);
    expect(potentialLongHaulPacket(view)).toBe(true);
    expect(plan).toMatchObject({ crossRegion: true, longHaul: true });
    expect(plan?.cues).toHaveLength(2);
    expect(plan?.cues[0]!.duration).toBeGreaterThan(REGION_DX_PULSE_MS);
    expect(plan?.cues[1]!.duration).toBe(REGION_DX_PULSE_MS);
    expect(plan?.cues.every((cue) => cue.longHaul)).toBe(true);

    const sameRegion = packet(endpoint('ham-node', 43.24, -79.95), endpoint('ham-far-node', 44.1, -78.7));
    expect(packetEndpointDistanceKm(sameRegion)).toBeGreaterThan(LONG_HAUL_MIN_KM);
    expect(planRegionTraffic(sameRegion, regions, 500)).toMatchObject({ crossRegion: false, longHaul: false });
  });

  it('uses opposite spatial motion for departure and arrival while reduced motion stays static', () => {
    const base = { regionTag: 'ham', kind: 'ACK', startedAt: 0, duration: 1_000, longHaul: false } as const;
    const send = regionPulseFrame({ ...base, role: 'send' }, 500);
    const receive = regionPulseFrame({ ...base, role: 'receive' }, 500);
    const reducedA = regionPulseFrame({ ...base, role: 'send' }, 100, true);
    const reducedB = regionPulseFrame({ ...base, role: 'send' }, 800, true);

    expect(send?.spread).toBeGreaterThan(0.5);
    expect(receive?.spread).toBeLessThan(0.5);
    expect(reducedA?.spread).toBe(0.5);
    expect(reducedB?.spread).toBe(0.5);
    expect(reducedA?.intensity).toBe(reducedB?.intensity);
  });

  it('aggregates bursts without allowing cue growth to become unbounded', () => {
    const cues: RegionActivityCue[] = Array.from({ length: 140 }, (_, index) => ({
      regionTag: index % 2 === 0 ? 'ham' : 'wat',
      kind: index % 2 === 0 ? 'Advert' : 'Control',
      role: 'send',
      startedAt: index,
      duration: 1_000,
      longHaul: false,
    }));
    const kept = capRegionActivity(cues);
    const frames = activeRegionFrames(kept, 500);

    expect(kept).toHaveLength(MAX_REGION_ACTIVITY_CUES);
    expect(frames.size).toBe(2);
    expect([...frames.values()].every(({ intensity }) => intensity > 0 && intensity <= 1)).toBe(true);
  });
});
