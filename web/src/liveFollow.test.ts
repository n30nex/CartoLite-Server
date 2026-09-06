import { describe, expect, it } from 'vitest';
import { FOLLOW_DWELL_MS, FollowQueue, followSummary } from './liveFollow';
import type { PacketView } from './types';

const packet = (id: string): PacketView => ({
  id, seq: 1, at: 1000, payloadType: 'Advert', mode: 'observer',
  observer: { id, label: `Node ${id}`, lng: -80, lat: 44 },
});

describe('Live Follow pacing', () => {
  it('holds a card for ten seconds even when the camera did not move', () => {
    const queue = new FollowQueue();
    queue.offer(packet('a'), 1, 1000);
    expect(queue.take(1000)?.id).toBe('a');
    queue.offer(packet('b'), 1, 2000);
    expect(queue.remaining(2000)).toBe(9);
    expect(queue.take(1000 + FOLLOW_DWELL_MS - 1)).toBeUndefined();
    expect(queue.take(1000 + FOLLOW_DWELL_MS)?.id).toBe('b');
  });

  it('prefers nearby activity and drops stale or paused queues', () => {
    const queue = new FollowQueue();
    queue.offer(packet('near'), 2, 1000);
    queue.offer(packet('far'), 0, 2000);
    expect(queue.take(2000)?.id).toBe('near');
    queue.offer(packet('stale'), 0, 3000);
    expect(queue.take(30_000)).toBeUndefined();
    queue.offer(packet('paused'), 0, 30_000);
    queue.clear();
    expect(queue.take(31_000)).toBeUndefined();
    expect(queue.remaining(31_000)).toBe(0);
  });

  it('describes an observer without inventing a radio route or exposing packet identifiers', () => {
    const summary = followSummary(packet('private-internal-id'));
    expect(summary.detail).toBe('Advert · heard here');
    expect(Object.keys(summary)).toEqual(['title', 'detail']);
  });

  it('does not describe disconnected confirmed segments as one continuous route', () => {
    const point = (id: string) => ({ id, label: id.toUpperCase(), lng: -80, lat: 44 });
    const summary = followSummary({ id: 'fragmented', seq: 1, at: 1000, payloadType: 'Text', mode: 'route', segments: [
      { routeId: 'ab', from: point('a'), to: point('b') },
      { routeId: 'cd', from: point('c'), to: point('d') },
    ] });
    expect(summary.title).toBe('A · 2 observed links');
    expect(summary.detail).toBe('Text · 2 confirmed hops');
  });
});
