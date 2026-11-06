import { afterEach, expect, it, vi } from 'vitest';
import { frameSize, type Input, type Output, type PhysicalPacket, type Rotation } from './model';

vi.mock('./physics', () => ({
  initializePhysics: async () => {},
  FirehosePhysics: class {
    count = 0; sleeping = 0; draining = false; radius = .1; steps = 0;
    rotation: Rotation = { x: 0, y: 0, z: 0, w: 1 }; target = { ...this.rotation };
    queue: PhysicalPacket[] = [];
    onAccepted?: (id: number, slots: number[]) => void;
    onRejected?: (id: number) => void;
    constructor(readonly capacity: number) {}
    enqueue(packet: PhysicalPacket) { this.queue.push(packet); }
    setRotation(rotation: Rotation) { this.target = rotation; }
    discardPending() { for (const packet of this.queue) this.onRejected?.(packet.id); this.queue = []; }
    step() {
      this.steps++; this.rotation = { ...this.target };
      for (const packet of this.queue) { this.count += packet.beads; this.onAccepted?.(packet.id, [0]); }
      this.queue = []; this.sleeping = this.steps >= 6 ? this.count : 0;
      if (this.draining) { this.clear(); this.draining = false; }
    }
    clear() { this.count = this.sleeping = 0; this.queue = []; }
    drain() { this.draining = true; }
    snapshot(buffer: ArrayBuffer) { const data = new Float32Array(buffer); data.fill(0); data[0] = this.count; data[3] = this.sleeping; data[13] = this.steps; }
    destroy() {}
  },
}));

let send: (value: Input) => void = () => {};
afterEach(() => { send({ type: 'dispose' }); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

async function open(recycle = true) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  await vi.advanceTimersByTimeAsync(100);
  const frames: Float32Array[] = [], messages: Output[] = [], held: ArrayBuffer[] = [];
  const port = { onmessage: null as ((event: MessageEvent<Input>) => void) | null,
    postMessage(value: Output) {
      messages.push(value);
      if (value.type === 'frame') {
        frames.push(new Float32Array(value.buffer).slice(0, 24)); held.push(value.buffer);
        if (recycle && held.length > 2) { const buffer = held.shift()!; queueMicrotask(() => send({ type: 'recycle', buffer })); }
      }
    },
  };
  vi.stubGlobal('self', port);
  await import('./firehose.worker');
  send = value => port.onmessage?.({ data: value } as MessageEvent<Input>);
  send({ type: 'init', capacity: 128 }); await Promise.resolve();
  for (let i = 0; i < 3; i++) send({ type: 'recycle', buffer: new ArrayBuffer(frameSize(128) * 4) });
  await vi.advanceTimersByTimeAsync(200);
  return { frames, messages, held };
}

it('sleeps without idle snapshots or timers and wakes for new activity and rotation', async () => {
  const { frames, messages } = await open(); const idleFrames = frames.length;
  await vi.advanceTimersByTimeAsync(5_000);
  expect(frames.length).toBe(idleFrames); expect(vi.getTimerCount()).toBe(0);
  send({ type: 'packet', packet: { id: 1, kind: 0, beads: 1, links: [] } });
  await vi.advanceTimersByTimeAsync(500);
  expect(messages.filter(m => m.type === 'accepted')).toHaveLength(1);
  expect(frames.at(-1)![0]).toBe(1); expect(frames.at(-1)![3]).toBe(1);
  const resting = frames.length; await vi.advanceTimersByTimeAsync(2_000);
  expect(frames.length).toBe(resting); expect(vi.getTimerCount()).toBe(0);
  send({ type: 'rotation', rotation: { x: 0, y: 0, z: 1, w: 0 } });
  await vi.advanceTimersByTimeAsync(200); expect(frames.length).toBeGreaterThan(resting);
  send({ type: 'drain' }); await vi.advanceTimersByTimeAsync(200);
  expect(frames.at(-1)![0]).toBe(0); expect(vi.getTimerCount()).toBe(0);
});

it('recognizes a sign-equivalent quaternion as the same resting pose', async () => {
  const { frames } = await open();
  send({ type: 'rotation', rotation: { x: 0, y: 0, z: 0, w: -1 } });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(frames.at(-1)![13]).toBe(0); expect(vi.getTimerCount()).toBe(0);
});

it('publishes a clear when a held buffer returns, even while paused', async () => {
  const { frames, held, messages } = await open(false);
  send({ type: 'packet', packet: { id: 1, kind: 0, beads: 1, links: [] } });
  await vi.advanceTimersByTimeAsync(500); expect(held).toHaveLength(3);
  send({ type: 'pause', paused: true }); send({ type: 'clear' });
  const before = frames.length;
  send({ type: 'recycle', buffer: held.shift()! });
  expect(frames.length).toBe(before + 1); expect(frames.at(-1)![0]).toBe(0);
  send({ type: 'packet', packet: { id: 2, kind: 0, beads: 1, links: [] } });
  await vi.advanceTimersByTimeAsync(500);
  expect(messages.filter(m => m.type === 'accepted')).toHaveLength(1);
  expect(messages.some(m => m.type === 'rejected' && m.id === 2)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
