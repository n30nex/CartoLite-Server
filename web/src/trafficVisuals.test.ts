import { describe, expect, it } from 'vitest';
import {
  decayedRouteTraffic,
  normalizePacketKind,
  PACKET_KIND_COLORS,
  PACKET_KIND_SIGNATURES,
  packetSignature,
  payloadColor,
  ROUTE_TRAFFIC_HALF_LIFE_MS,
  ROUTE_TRAFFIC_MAX,
  routeTrafficAfterPacket,
  trafficRenderBucket
} from './trafficVisuals';

describe('packet traffic palette', () => {
  it('keeps the stable route palette identical to live packet trails', () => {
    expect(PACKET_KIND_COLORS).toEqual({
      Advert: '#4de7c4',
      Trace: '#ffd15a',
      Text: '#ff75b5',
      ACK: '#78cfff',
      Control: '#a78bfa',
      Other: '#9caebd'
    });

    for (const [kind, color] of Object.entries(PACKET_KIND_COLORS)) {
      expect(payloadColor(kind)).toBe(color);
    }
  });

  it('normalizes known payload names and fails safely to Other', () => {
    expect(normalizePacketKind('advert')).toBe('Advert');
    expect(normalizePacketKind('TraceResponse')).toBe('Trace');
    expect(normalizePacketKind('TextMessage')).toBe('Text');
    expect(normalizePacketKind('ack')).toBe('ACK');
    expect(normalizePacketKind('Control')).toBe('Control');
    expect(normalizePacketKind('unknown')).toBe('Other');
    expect(normalizePacketKind(undefined)).toBe('Other');
    expect(payloadColor('unknown')).toBe(PACKET_KIND_COLORS.Other);
  });

  it('assigns a restrained visual signature to every public packet kind', () => {
    expect(PACKET_KIND_SIGNATURES).toEqual({
      Advert: 'ripple',
      Trace: 'echo',
      Text: 'orbit',
      ACK: 'double',
      Control: 'tick',
      Other: 'tick'
    });
    expect(packetSignature('Advert')).toBe('ripple');
    expect(packetSignature('TraceResponse')).toBe('echo');
    expect(packetSignature('TextMessage')).toBe('orbit');
    expect(packetSignature('ACK')).toBe('double');
    expect(packetSignature(undefined)).toBe('tick');
  });
});

describe('decaying route traffic', () => {
  it('halves every 15 minutes without amplifying future timestamps', () => {
    const heardAt = 1_900_000_000_000;
    expect(ROUTE_TRAFFIC_HALF_LIFE_MS).toBe(15 * 60_000);
    expect(decayedRouteTraffic(8, heardAt, heardAt)).toBe(8);
    expect(decayedRouteTraffic(8, heardAt, heardAt + ROUTE_TRAFFIC_HALF_LIFE_MS)).toBeCloseTo(4, 10);
    expect(decayedRouteTraffic(8, heardAt, heardAt + 2 * ROUTE_TRAFFIC_HALF_LIFE_MS)).toBeCloseTo(2, 10);
    expect(decayedRouteTraffic(8, heardAt + 1_000, heardAt)).toBe(8);
  });

  it('bounds invalid, negative, and excessive traffic', () => {
    const now = 1_900_000_000_000;
    expect(decayedRouteTraffic(Number.NaN, now, now)).toBe(0);
    expect(decayedRouteTraffic(Number.POSITIVE_INFINITY, now, now)).toBe(0);
    expect(decayedRouteTraffic(-5, now, now)).toBe(0);
    expect(decayedRouteTraffic(ROUTE_TRAFFIC_MAX * 2, now, now)).toBe(ROUTE_TRAFFIC_MAX);
    expect(routeTrafficAfterPacket(ROUTE_TRAFFIC_MAX, now, now)).toBe(ROUTE_TRAFFIC_MAX);
  });

  it('decays in-order traffic and discounts an out-of-order packet', () => {
    const heardAt = 1_900_000_000_000;
    expect(routeTrafficAfterPacket(4, heardAt, heardAt + ROUTE_TRAFFIC_HALF_LIFE_MS)).toBeCloseTo(3, 10);
    expect(routeTrafficAfterPacket(4, heardAt, heardAt - ROUTE_TRAFFIC_HALF_LIFE_MS)).toBeCloseTo(4.5, 10);
    expect(routeTrafficAfterPacket(4, heardAt, Number.NaN)).toBe(4);
  });

  it('uses monotonic bounded render buckets', () => {
    const values = [0, 0.25, 1, 2, 4, 8, 16, ROUTE_TRAFFIC_MAX];
    const buckets = values.map(trafficRenderBucket);
    expect(buckets).toEqual([...buckets].sort((left, right) => left - right));
    expect(trafficRenderBucket(-1)).toBe(trafficRenderBucket(0));
    expect(trafficRenderBucket(ROUTE_TRAFFIC_MAX * 2)).toBe(trafficRenderBucket(ROUTE_TRAFFIC_MAX));
  });
});
