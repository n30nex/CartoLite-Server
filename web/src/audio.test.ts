import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointV2, RoutePacketView } from './types';
import {
  DEFAULT_SOUND_SCENE,
  DEFAULT_SOUND_VOLUME,
  loadSoundPreference,
  RouteSonifier,
  routeSoundPlan,
  SOUND_STORAGE_KEY
} from './audio';

function endpoint(id: string, x: number, y: number): EndpointV2 {
  return { id, label: id, lng: x, lat: y };
}

function packet(points: EndpointV2[], payloadType: RoutePacketView['payloadType'] = 'Trace'): RoutePacketView {
  return {
    seq: 7,
    id: 'packet-7',
    at: 1_700_000_000_000,
    payloadType,
    mode: 'route',
    segments: points.slice(1).map((to, index) => ({
      routeId: `route-${index}`,
      from: points[index]!,
      to,
    })),
  };
}

const projector = { project: ([x, y]: [number, number]) => ({ x, y }) };

describe('route hop sonification', () => {
  it('plays one deterministic pentatonic note for every hop of a visible route', () => {
    const route = packet([
      endpoint('a', -20, 50),
      endpoint('b', 40, 50),
      endpoint('c', 80, 60),
      endpoint('d', 140, 60),
    ]);
    const first = routeSoundPlan(route, projector, 100, 100);
    const second = routeSoundPlan(route, projector, 100, 100);

    expect(first).toHaveLength(route.segments.length);
    expect(second).toEqual(first);
    expect(first.map((note) => note.startMS)).toEqual([...first.map((note) => note.startMS)].sort((a, b) => a - b));
    expect(first.every((note) => note.frequency >= 220 && note.frequency <= 1_100)).toBe(true);
    expect(first.every((note) => note.pan >= -0.75 && note.pan <= 0.75)).toBe(true);
  });

  it('stays silent when no part of the route is on screen', () => {
    const route = packet([
      endpoint('a', 180, 180),
      endpoint('b', 220, 220),
      endpoint('c', 260, 260),
    ]);
    expect(routeSoundPlan(route, projector, 100, 100)).toEqual([]);
  });

  it('does not sound a diagonal whose bounding box only grazes the viewport', () => {
    const route = packet([
      endpoint('a', -20, 90),
      endpoint('b', 10, 120),
    ]);
    expect(routeSoundPlan(route, projector, 100, 100)).toEqual([]);
  });

  it('sounds every visible hop but skips off-screen hops in a partially visible route', () => {
    const route = packet([
      endpoint('a', -140, 50),
      endpoint('b', -100, 50),
      endpoint('c', 20, 50),
      endpoint('d', 70, 50),
      endpoint('e', 160, 50),
      endpoint('f', 200, 50),
    ]);
    const notes = routeSoundPlan(route, projector, 100, 100);

    expect(notes).toHaveLength(3);
    expect(notes[0]!.startMS).toBeGreaterThan(0);
    expect(notes[1]!.startMS).toBeGreaterThan(notes[0]!.startMS);
    expect(notes[2]!.startMS).toBeGreaterThan(notes[1]!.startMS);
  });

  it('does not sonify observer-only activity because it has no public hops', () => {
    expect(routeSoundPlan({
      seq: 8,
      id: 'observer-8',
      at: 1_700_000_000_000,
      payloadType: 'Advert',
      mode: 'observer',
      observer: endpoint('observer', 50, 50),
    }, projector, 100, 100)).toEqual([]);
  });

  it('uses distinct but restrained voices for different packet families', () => {
    const points = [endpoint('a', 20, 50), endpoint('b', 80, 50)];
    const text = routeSoundPlan(packet(points, 'Text'), projector, 100, 100)[0]!;
    const acknowledgement = routeSoundPlan(packet(points, 'ACK'), projector, 100, 100)[0]!;

    expect(text.brightness).toBeLessThan(acknowledgement.brightness);
    expect(text.frequency).not.toBe(acknowledgement.frequency);
  });

  it('keeps every visible hop deterministic in all three scenes', () => {
    const route = packet([endpoint('a', 10, 50), endpoint('b', 50, 50), endpoint('c', 90, 50)]);
    for (const scene of ['aurora', 'wood', 'chimes'] as const) {
      const first = routeSoundPlan(route, projector, 100, 100, scene);
      expect(first).toHaveLength(route.segments.length);
      expect(routeSoundPlan(route, projector, 100, 100, scene)).toEqual(first);
      expect(first.every((note) => note.scene === scene)).toBe(true);
    }
  });

  it('adds deterministic Loom and village voicing without changing visible-hop counts', () => {
    const route = packet([endpoint('a', 10, 50), endpoint('b', 50, 50), endpoint('c', 90, 50)]);
    const standard = routeSoundPlan(route, projector, 100, 100, 'aurora', 'map');
    const loom = routeSoundPlan(route, projector, 100, 100, 'aurora', 'loom');
    const village = routeSoundPlan(route, projector, 100, 100, 'aurora', 'village');

    expect(loom).toHaveLength(standard.length);
    expect(village).toHaveLength(standard.length);
    expect(loom.every((note) => note.character === 'loom')).toBe(true);
    expect(village.every((note) => note.character === 'village')).toBe(true);
    expect(loom.map((note) => note.frequency)).not.toEqual(standard.map((note) => note.frequency));
    expect(routeSoundPlan(route, projector, 100, 100, 'aurora', 'loom')).toEqual(loom);
  });

  it('creates exactly one oscillator for each visible hop in every scene and experiment character', async () => {
    const original = window.AudioContext;
    FakeAudioContext.oscillators = 0;
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
    const viewport = document.createElement('div');
    Object.defineProperties(viewport, { clientWidth: { value: 100 }, clientHeight: { value: 100 } });
    const sonifier = new RouteSonifier(projector as never, viewport);
    const route = packet([endpoint('a', 10, 50), endpoint('b', 50, 50), endpoint('c', 90, 50)]);
    try {
      expect(await sonifier.setEnabled(true)).toBe(true);
      for (const scene of ['aurora', 'wood', 'chimes'] as const) {
        sonifier.setScene(scene);
        for (const character of ['map', 'loom', 'village'] as const) {
          const before = FakeAudioContext.oscillators;
          expect(sonifier.play(route, character)).toBe(route.segments.length);
          expect(FakeAudioContext.oscillators - before).toBe(route.segments.length);
        }
      }
    } finally {
      sonifier.destroy();
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: original });
    }
  });

  it('unlocks suspended Android audio during the enabling tap without adding a tone', async () => {
    const original = window.AudioContext;
    FakeAudioContext.initialState = 'suspended';
    FakeAudioContext.bufferStarts = 0;
    FakeAudioContext.oscillators = 0;
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
    const sonifier = new RouteSonifier(projector as never, document.createElement('div'));
    try {
      expect(await sonifier.setEnabled(true)).toBe(true);
      expect(FakeAudioContext.bufferStarts).toBe(1);
      expect(FakeAudioContext.oscillators).toBe(0);
      expect(sonifier.status()).toBe('on');
    } finally {
      sonifier.destroy();
      FakeAudioContext.initialState = 'running';
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: original });
    }
  });
});

describe('sound preference and autoplay state', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to Aurora at 80 percent and stores only enabled, volume, and scene', () => {
    expect(loadSoundPreference(localStorage)).toEqual({
      enabled: false, volume: DEFAULT_SOUND_VOLUME, scene: DEFAULT_SOUND_SCENE,
    });
    const sonifier = new RouteSonifier({} as never, document.createElement('div'));
    sonifier.setVolume(0.55);

    expect(JSON.parse(localStorage.getItem(SOUND_STORAGE_KEY) ?? '{}')).toEqual({
      enabled: false, volume: 0.55, scene: 'aurora',
    });
  });

  it('migrates v1 preferences to Aurora without starting audio', () => {
    localStorage.setItem('cartolite:sound:v1', JSON.stringify({ enabled: true, volume: 0.62 }));
    const audioContext = vi.fn();
    const original = window.AudioContext;
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: audioContext });
    try {
      expect(loadSoundPreference(localStorage)).toEqual({ enabled: true, volume: 0.62, scene: 'aurora' });
      expect(JSON.parse(localStorage.getItem(SOUND_STORAGE_KEY) ?? '{}')).toEqual({
        enabled: true, volume: 0.62, scene: 'aurora',
      });
      expect(audioContext).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: original });
    }
  });

  it('shows Tap to Resume for remembered sound without constructing an AudioContext', () => {
    localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify({ enabled: true, volume: 0.8, scene: 'wood' }));
    const audioContext = vi.fn();
    const original = window.AudioContext;
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: audioContext });
    try {
      const sonifier = new RouteSonifier({} as never, document.createElement('div'));
      expect(sonifier.status()).toBe('resume');
      expect(sonifier.getVolume()).toBe(0.8);
      expect(sonifier.getScene()).toBe('wood');
      expect(audioContext).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: original });
    }
  });

  it('clamps malformed remembered volume while preserving the requested state', () => {
    localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify({ enabled: true, volume: 4, scene: 'chimes' }));
    expect(loadSoundPreference(localStorage)).toEqual({ enabled: true, volume: 1, scene: 'chimes' });
  });
});

const fakeParam = () => ({
  value: 0,
  cancelScheduledValues: vi.fn(),
  exponentialRampToValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
  setValueAtTime: vi.fn(),
});

const fakeNode = <T extends object>(extra = {} as T): T & {
  connect: (destination: unknown) => unknown;
  disconnect: () => void;
} => Object.assign(extra, {
  connect: (destination: unknown) => destination,
  disconnect: vi.fn(),
});

class FakeAudioContext {
  static oscillators = 0;
  static bufferStarts = 0;
  static initialState: AudioContextState = 'running';
  currentTime = 0;
  destination = fakeNode();
  sampleRate = 48_000;
  state: AudioContextState = FakeAudioContext.initialState;
  onstatechange: (() => void) | null = null;
  createGain = () => fakeNode({ gain: fakeParam() });
  createDelay = () => fakeNode({ delayTime: fakeParam() });
  createBiquadFilter = () => fakeNode({ type: 'lowpass', frequency: fakeParam(), Q: fakeParam() });
  createStereoPanner = () => fakeNode({ pan: fakeParam() });
  createDynamicsCompressor = () => fakeNode({
    threshold: fakeParam(), knee: fakeParam(), ratio: fakeParam(), attack: fakeParam(), release: fakeParam(),
  });
  createPeriodicWave = () => ({} as PeriodicWave);
  createBuffer = () => ({} as AudioBuffer);
  createBufferSource = () => fakeNode({
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
    start: () => { FakeAudioContext.bufferStarts += 1; },
  });
  createOscillator = () => {
    FakeAudioContext.oscillators += 1;
    return fakeNode({
      frequency: fakeParam(),
      onended: null as (() => void) | null,
      setPeriodicWave: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    });
  };
  resume = async () => {
    this.state = 'running';
    this.onstatechange?.();
  };
  close = async () => undefined;
}
