import { describe, expect, it } from 'vitest';
import { ChronoscopeTimeline, MAX_EVENTS, MAX_SEGMENTS, MAX_TIME_MS, normalizeChronoscope } from './timeline';
import type { PacketView } from '../types';

const endpoint = (id: string) => ({ id, label: id, lat: 43.4, lng: -80.3 });
const packet = (seq: number, count = 1): PacketView => ({ seq, id: `synthetic-${seq}`, at: 0, payloadType: 'Text', mode: 'route',
  segments: Array.from({ length: count }, (_, i) => ({ routeId: `route-${i}`, from: endpoint(`from-${i}`), to: endpoint(`to-${i}`) })) });

describe('Chronoscope session window', () => {
  it('starts empty and preserves discrete confirmed segments without joining gaps', () => {
    const time = new ChronoscopeTimeline();
    expect(time.visible(100, 60)).toEqual([]);
    const event = packet(1, 2); time.add(event, 100);
    expect(time.records[0]!.packet).toEqual(event);
    time.add(event, 101); expect(time.records).toHaveLength(1);
    time.add({ seq: 2, id: 'observer', at: 0, payloadType: 'Advert', mode: 'observer', observer: endpoint('heard') }, 200);
    expect(time.records[1]!.packet.mode).toBe('observer');
    expect(time.visible(60_101, 60)).toHaveLength(1);
  });
  it('bounds both event and geometry retention, including frozen inspection', () => {
    const time = new ChronoscopeTimeline();
    for (let seq = 0; seq < MAX_EVENTS * 2; seq++) time.add(packet(seq, 8), seq);
    expect(time.records.length).toBeLessThanOrEqual(MAX_EVENTS);
    expect(time.segmentCount).toBe(MAX_SEGMENTS);
    expect(time.trimmed).toBe(true);
    time.freeze(2_048); const frozen = [...time.visible(2_048, 60)];
    time.add(packet(9_000), MAX_TIME_MS + 3_000);
    expect(time.records).toHaveLength(1);
    expect(time.visible(MAX_TIME_MS + 3_001, 60)).toEqual(frozen);
    time.resume(); expect(time.visible(MAX_TIME_MS + 3_001, 60)).toEqual(time.records);
    time.prune(MAX_TIME_MS * 2 + 3_001); expect(time.segmentCount).toBe(0);
    time.clear(); expect(time.trimmed).toBe(false); expect(time.add(packet(1), 1)).toBeDefined();
  });
  it('retains whole events and safely normalizes optional local preferences', () => {
    const time = new ChronoscopeTimeline();
    expect(time.add(packet(1, MAX_SEGMENTS + 1), 1)).toBeUndefined();
    expect(time.segmentCount).toBe(0);
    expect(normalizeChronoscope({ mode: 'unknown', seconds: Infinity, regions: [null, 1, 'YKF', 'YKF'] })).toEqual({ mode: 'sculpture', seconds: 60, regions: ['YKF'] });
    expect(normalizeChronoscope(null).regions).toBeNull();
  });
  it('never promotes events received during frozen inspection into live motion', () => {
    const time = new ChronoscopeTimeline();
    expect(time.add(packet(1), 0)!.animate).toBe(true);
    time.freeze(10);
    expect(time.add(packet(2), 20)!.animate).toBe(false);
    time.resume();
    expect(time.records[1]!.animate).toBe(false);
    expect(time.add(packet(3), 30)!.animate).toBe(true);
  });
});
