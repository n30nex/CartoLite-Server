import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveFeed, type LiveFeedHandlers } from './api';
import type { PacketEventV2, StateV2 } from './types';

const initial: StateV2 = {
  schemaVersion: 2,
  bootId: 'boot-a',
  seq: 7,
  serverTime: 1,
  status: { feed: 'connected', activity: 'active', dropped: 0, version: '0.4.0', gitSha: 'abc' },
  map: { center: [0, 20], zoom: 1.4 },
  nodes: [],
  routes: []
};

class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = [];
  readonly url: string;
  readonly withCredentials: boolean;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL, init?: EventSourceInit) {
    super();
    this.url = String(url);
    this.withCredentials = init?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  send(type: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

describe('LiveFeed recovery', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('closes the stream during recovery, ignores stale events, and reconnects from the snapshot cursor', async () => {
    let resolveRecovery!: (state: StateV2) => void;
    const snapshot = { ...initial, bootId: 'boot-b', seq: 20 };
    const recovery = new Promise<StateV2>((resolve) => { resolveRecovery = resolve; });
    const onPacket = vi.fn();
    const recover = vi.fn(() => recovery);
    const feed = new LiveFeed(initial, handlers({ onPacket, recover }));
    feed.start();
    const first = MockEventSource.instances[0];
    expect(first).toBeDefined();
    expect(first?.url).toBe('/api/events?bootId=boot-a&after=7');

    first?.send('packet', observerPacket(9));
    expect(first?.closed).toBe(true);
    first?.send('packet', observerPacket(8));
    await settle();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(onPacket).not.toHaveBeenCalled();

    resolveRecovery(snapshot);
    await settle();
    expect(MockEventSource.instances).toHaveLength(2);
    const second = MockEventSource.instances[1];
    expect(second?.url).toBe('/api/events?bootId=boot-b&after=20');
    second?.send('hello', { bootId: 'boot-b', seq: 25 });
    for (let seq = 21; seq <= 26; seq += 1) second?.send('packet', observerPacket(seq));

    expect(recover).toHaveBeenCalledTimes(1);
    expect(onPacket).toHaveBeenCalledTimes(6);
    expect(onPacket).toHaveBeenCalledWith(expect.objectContaining({ seq: 26 }));
    feed.stop();
  });

  it('backs off a failed snapshot instead of reconnecting into a recovery loop', async () => {
    vi.useFakeTimers();
    const recover = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...initial, seq: 30 });
    const onError = vi.fn();
    const feed = new LiveFeed(initial, handlers({ recover, onError }));
    feed.start();
    MockEventSource.instances[0]?.send('packet', observerPacket(9));
    await settle();

    expect(recover).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(recover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(recover).toHaveBeenCalledTimes(2);
    expect(MockEventSource.instances).toHaveLength(2);
    feed.stop();
  });

  it('recovers when the stream hello cannot establish a trustworthy boot cursor', async () => {
    const recover = vi.fn(async () => ({ ...initial, seq: 8 }));
    const onError = vi.fn();
    const feed = new LiveFeed(initial, handlers({ recover, onError }));
    feed.start();
    const first = MockEventSource.instances[0];

    first?.dispatchEvent(new MessageEvent('hello', { data: '{' }));
    expect(first?.closed).toBe(true);
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances[1]?.url).toBe('/api/events?bootId=boot-a&after=8');
    feed.stop();
  });

  it('refreshes a suspended stream once and reconnects from the fresh cursor', async () => {
    let resolveRecovery!: (state: StateV2) => void;
    const recover = vi.fn(() => new Promise<StateV2>((resolve) => { resolveRecovery = resolve; }));
    const feed = new LiveFeed(initial, handlers({ recover }));
    feed.start();
    const first = MockEventSource.instances[0];

    const resumed = feed.resume();
    const duplicateResume = feed.resume();
    await settle();

    expect(first?.closed).toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);
    resolveRecovery({ ...initial, seq: 44 });
    await Promise.all([resumed, duplicateResume]);

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]?.url).toBe('/api/events?bootId=boot-a&after=44');
    feed.stop();
  });
});

function handlers(overrides: Partial<LiveFeedHandlers> = {}): LiveFeedHandlers {
  return {
    onConnection: vi.fn(),
    onNode: vi.fn(),
    onPacket: vi.fn(),
    onStatus: vi.fn(),
    recover: vi.fn(async () => initial),
    onError: vi.fn(),
    ...overrides
  };
}

function observerPacket(seq: number): PacketEventV2 {
  return {
    seq,
    id: `packet-${seq}`,
    at: seq,
    payloadType: 'Advert',
    mode: 'observer',
    observer: { id: 'observer', label: 'Observer', lat: 43.4, lng: -80.3 }
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}
