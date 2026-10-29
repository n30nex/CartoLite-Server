import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { StateV2 } from './types';

let clock: typeof import('./clock');
const now = Date.UTC(2026, 9, 13, 12);
const snapshot: StateV2 = { schemaVersion: 2, bootId: 'clock-fixture', seq: 0,
  serverTime: now - 3_600_000, nodes: [], routes: [], map: { center: [-80, 43], zoom: 5 },
  status: { feed: 'connected', activity: 'quiet', dropped: 0, version: 'test', gitSha: 'synthetic' } };

beforeEach(async () => { vi.resetModules(); clock = await import('./clock'); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('ages data from fresh response time despite an old snapshot, clock skew and later clock changes', async () => {
  let elapsed = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  const wall = vi.spyOn(Date, 'now').mockReturnValue(now + 7 * 86_400_000);
  expect(clock.trafficNow()).toBe(Date.now());
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(snapshot), { headers: { Date: new Date(now).toUTCString() } })));
  const { fetchState } = await import('./api');
  expect((await fetchState()).serverTime).toBe(snapshot.serverTime);
  expect(clock.trafficNow()).toBe(now);
  wall.mockReturnValue(now - 7 * 86_400_000); elapsed += 120_000;
  expect(clock.trafficNow()).toBe(now + 120_000);
  const { routesInWindow } = await import('./netgraph/layout');
  const { relativeTime } = await import('./nodeInspector');
  const route = { id: 'r', fromId: 'a', toId: 'b', packetCount: 1, intensity: 0 as const,
    lastHeard: now - 14 * 60_000, lastKind: 'Advert' as const, traffic: 1 };
  expect(routesInWindow([route], clock.trafficNow(), '15m')).toHaveLength(0);
  expect(relativeTime(now)).toBe('2m ago');
});

it('includes body download time and prevents an older response completing late from replacing a newer reference', async () => {
  let elapsed = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  let complete!: (body: StateV2) => void;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true,
    headers: new Headers({ Date: new Date(now).toUTCString() }),
    json: () => new Promise<StateV2>(resolve => { complete = resolve; }),
  })));
  const { fetchState } = await import('./api');
  const pending = fetchState();
  await Promise.resolve();
  elapsed = 2100; complete(snapshot); await pending;
  expect(clock.trafficNow()).toBe(now + 2000);
  clock.syncTrafficClock(new Date(now + 30_000).toUTCString(), 2200);
  elapsed = 2400;
  clock.syncTrafficClock(new Date(now).toUTCString(), 100);
  expect(clock.trafficNow()).toBe(now + 30_200);
});

it('ignores missing or invalid dates and failed or invalid snapshots, retaining the last good reference', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(100);
  vi.spyOn(Date, 'now').mockReturnValue(now);
  for (const date of [null, '', 'invalid', 'Thu, 01 Jan 1970 00:00:00 GMT']) clock.syncTrafficClock(date, 100);
  expect(clock.trafficNow()).toBe(now);
  clock.syncTrafficClock(new Date(now).toUTCString(), 100);
  const later = { Date: new Date(now + 86_400_000).toUTCString() };
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503, headers: later }))
    .mockResolvedValueOnce(new Response('{}', { headers: later }))
    .mockResolvedValueOnce(new Response(JSON.stringify(snapshot)));
  vi.stubGlobal('fetch', fetch);
  const { fetchState } = await import('./api');
  await expect(fetchState()).rejects.toThrow('503');
  await expect(fetchState()).rejects.toThrow('schema');
  await fetchState();
  expect(clock.trafficNow()).toBe(now);
});


it('ignores a superseded request even when its headers arrive last', () => {
  vi.spyOn(performance, 'now').mockReturnValue(300);
  clock.syncTrafficClock(new Date(now + 30_000).toUTCString(), 200, 100);
  clock.syncTrafficClock(new Date(now).toUTCString(), 300, 50);
  expect(clock.trafficNow()).toBe(now + 30_100);
  clock.syncTrafficClock(new Date(now).toUTCString(), NaN, 400);
  expect(clock.trafficNow()).toBe(now + 30_100);
});
