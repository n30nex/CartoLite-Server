import { routeDuration, segmentNearViewport, segmentTravelWeights } from './packetAnimator';
import type { PacketView } from './types';
import type { PacketKind } from './trafficVisuals';

const MASTER_LEVEL = 0.9;
const VOICE_LEVEL = 0.17;
const MIN_VOICE_LEVEL = 0.035;
const MIN_GAIN = 0.0001;
const LOOKAHEAD_SECONDS = 0.025;
const LEGACY_SOUND_STORAGE_KEY = 'cartolite:sound:v1';
export const SOUND_STORAGE_KEY = 'cartolite:sound:v2';
export const DEFAULT_SOUND_VOLUME = 0.8;
export const DEFAULT_SOUND_SCENE: SoundScene = 'aurora';

export type SoundScene = 'aurora' | 'wood' | 'chimes';
export type SoundCharacter = 'map' | 'loom' | 'village';

export interface SoundPreferenceV2 {
  enabled: boolean;
  volume: number;
  scene: SoundScene;
}

export type SoundStatus = 'on' | 'off' | 'resume';

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

interface WebKitAudioWindow extends Window {
  webkitAudioContext?: AudioContextConstructor;
}

export function loadSoundPreference(storage: Storage): SoundPreferenceV2 {
  try {
    const value = JSON.parse(storage.getItem(SOUND_STORAGE_KEY) ?? 'null') as {
      enabled?: unknown;
      volume?: unknown;
      scene?: unknown;
    } | null;
    if (value && typeof value.enabled === 'boolean' && typeof value.volume === 'number' && isSoundScene(value.scene)) {
      return { enabled: value.enabled, volume: clamp(value.volume, 0, 1), scene: value.scene };
    }
    const legacy = JSON.parse(storage.getItem(LEGACY_SOUND_STORAGE_KEY) ?? 'null') as {
      enabled?: unknown;
      volume?: unknown;
    } | null;
    if (legacy && typeof legacy.enabled === 'boolean' && typeof legacy.volume === 'number') {
      const migrated = { enabled: legacy.enabled, volume: clamp(legacy.volume, 0, 1), scene: DEFAULT_SOUND_SCENE };
      saveSoundPreference(storage, migrated);
      return migrated;
    }
  } catch {
    // Malformed or unavailable storage falls through to safe defaults.
  }
  return { enabled: false, volume: DEFAULT_SOUND_VOLUME, scene: DEFAULT_SOUND_SCENE };
}

export function saveSoundPreference(storage: Storage, preference: SoundPreferenceV2): void {
  try {
    storage.setItem(SOUND_STORAGE_KEY, JSON.stringify({
      enabled: preference.enabled,
      volume: clamp(preference.volume, 0, 1),
      scene: isSoundScene(preference.scene) ? preference.scene : DEFAULT_SOUND_SCENE,
    }));
  } catch {
    // Local persistence is optional; private browsing may reject it.
  }
}

interface Voice {
  root: number;
  intervals: readonly number[];
  brightness: number;
  durationScale: number;
}

const VOICES: Readonly<Record<PacketKind, Voice>> = {
  Advert: { root: 60, intervals: [0, 2, 4, 7, 9], brightness: 4_400, durationScale: 1 },
  Trace: { root: 62, intervals: [0, 2, 5, 7, 9], brightness: 5_200, durationScale: 0.94 },
  Text: { root: 57, intervals: [0, 3, 5, 7, 10], brightness: 3_600, durationScale: 1.12 },
  ACK: { root: 67, intervals: [0, 2, 4, 7, 9], brightness: 5_800, durationScale: 0.72 },
  Control: { root: 64, intervals: [0, 3, 5, 7, 10], brightness: 3_200, durationScale: 1.04 },
  Other: { root: 60, intervals: [0, 2, 5, 7, 9], brightness: 4_600, durationScale: 0.9 },
};

interface SceneProfile {
  durationScale: number;
  brightnessScale: number;
  attackSeconds: number;
  sustainLevel: number;
  levelScale: number;
  pitchEndRatio: number;
  registerShifts: readonly number[];
  harmonics: readonly (readonly number[])[];
}

const SCENES: Readonly<Record<SoundScene, SceneProfile>> = {
  aurora: {
    durationScale: 1,
    brightnessScale: 1,
    attackSeconds: 0.016,
    sustainLevel: 0.32,
    levelScale: 1,
    pitchEndRatio: 1,
    registerShifts: [0, 0, 12],
    harmonics: [[1, 0.22, 0.08], [1, 0.16, 0.11, 0.03], [1, 0.28, 0.05]],
  },
  wood: {
    durationScale: 0.72,
    brightnessScale: 0.68,
    attackSeconds: 0.006,
    sustainLevel: 0.14,
    levelScale: 0.96,
    pitchEndRatio: 0.985,
    registerShifts: [-12, 0, 0],
    harmonics: [[1, 0.46, 0.2, 0.07], [1, 0.36, 0.24, 0.09], [1, 0.5, 0.14, 0.05]],
  },
  chimes: {
    durationScale: 1.12,
    brightnessScale: 1.18,
    attackSeconds: 0.009,
    sustainLevel: 0.24,
    levelScale: 0.82,
    pitchEndRatio: 1.004,
    registerShifts: [0, 12, 12],
    harmonics: [[1, 0.08, 0.31, 0.04, 0.15], [1, 0.12, 0.24, 0.03, 0.2], [1, 0.05, 0.36, 0.08, 0.12]],
  },
};

interface CharacterProfile {
  durationScale: number;
  brightnessScale: number;
  attackScale: number;
  sustainScale: number;
  levelScale: number;
  pitchEndRatio: number;
  registerShifts: readonly number[];
  harmonics?: readonly (readonly number[])[];
}

const CHARACTERS: Readonly<Record<SoundCharacter, CharacterProfile>> = {
  map: {
    durationScale: 1,
    brightnessScale: 1,
    attackScale: 1,
    sustainScale: 1,
    levelScale: 1,
    pitchEndRatio: 1,
    registerShifts: [0],
  },
  loom: {
    durationScale: 1.2,
    brightnessScale: 0.82,
    attackScale: 0.72,
    sustainScale: 0.76,
    levelScale: 0.86,
    pitchEndRatio: 0.997,
    registerShifts: [-12, 0, 7, 0],
    harmonics: [
      [1, 0.38, 0.11, 0.22, 0.06, 0.12],
      [1, 0.24, 0.26, 0.08, 0.15, 0.04],
      [1, 0.44, 0.08, 0.16, 0.1, 0.05],
    ],
  },
  village: {
    durationScale: 0.88,
    brightnessScale: 0.94,
    attackScale: 0.64,
    sustainScale: 0.68,
    levelScale: 0.82,
    pitchEndRatio: 1.002,
    registerShifts: [0, 12, 7, 12],
    harmonics: [
      [1, 0.12, 0.33, 0.08, 0.18],
      [1, 0.2, 0.18, 0.06, 0.24],
      [1, 0.08, 0.38, 0.04, 0.14],
    ],
  },
};

export interface HopNote {
  startMS: number;
  durationMS: number;
  frequency: number;
  pan: number;
  brightness: number;
  scene: SoundScene;
  character: SoundCharacter;
  variation: number;
}

export interface ViewportProjector {
  project(coordinates: [number, number]): { x: number; y: number };
}

export function routeSoundPlan(
  packet: PacketView,
  projector: ViewportProjector,
  width: number,
  height: number,
  scene: SoundScene = DEFAULT_SOUND_SCENE,
  character: SoundCharacter = 'map',
): HopNote[] {
  if (packet.mode !== 'route' || packet.segments.length === 0 || width <= 0 || height <= 0) return [];
  const projected = packet.segments.map((segment) => ({
    from: projector.project([segment.from.lng, segment.from.lat]),
    to: projector.project([segment.to.lng, segment.to.lat]),
  }));
  const weights = segmentTravelWeights(packet.segments);
  const totalDuration = routeDuration(packet.segments);
  const voice = VOICES[packet.payloadType] ?? VOICES.Other;
  const sceneProfile = SCENES[scene];
  const characterProfile = CHARACTERS[character];
  const phraseSeed = stableHash(`${packet.id}|${packet.payloadType}`);
  let elapsed = 0;

  return packet.segments.flatMap((segment, index) => {
    const weight = weights[index] ?? 1 / packet.segments.length;
    const screen = projected[index]!;
    const startMS = Math.round(elapsed);
    elapsed += totalDuration * weight;
    if (!segmentIntersectsViewport(screen.from, screen.to, width, height)) return [];
    const midpointX = (screen.from.x + screen.to.x) / 2;
    const step = (phraseSeed + stableHash(`${segment.from.id}|${segment.to.id}`) + index * 2) % voice.intervals.length;
    const variation = stableHash(`${packet.id}|${segment.routeId}|${index}|${scene}`) % sceneProfile.harmonics.length;
    const octave = index >= voice.intervals.length ? 12 : 0;
    const characterShift = characterProfile.registerShifts[index % characterProfile.registerShifts.length] ?? 0;
    const midi = voice.root + voice.intervals[step]! + octave + (sceneProfile.registerShifts[variation] ?? 0) + characterShift;
    const note: HopNote = {
      startMS,
      durationMS: Math.round(Math.max(150, Math.min(640, totalDuration * weight * 0.78 * voice.durationScale * sceneProfile.durationScale * characterProfile.durationScale))),
      frequency: midiToFrequency(midi),
      pan: clamp((midpointX / width) * 1.5 - 0.75, -0.75, 0.75),
      brightness: Math.max(1_400, (voice.brightness - index * 260) * sceneProfile.brightnessScale * characterProfile.brightnessScale),
      scene,
      character,
      variation,
    };
    return [note];
  });
}

export class RouteSonifier {
  private context?: AudioContext;
  private master?: GainNode;
  private ambience?: DelayNode;
  private enabled = false;
  private preferredEnabled: boolean;
  private volume: number;
  private scene: SoundScene;
  private paused = false;
  private readonly active = new Set<OscillatorNode>();
  private readonly waves = new Map<string, PeriodicWave>();
  private statusListener?: (status: SoundStatus) => void;

  constructor(
    private readonly map: ViewportProjector,
    private readonly viewport: HTMLElement,
    private readonly storage: Storage = window.localStorage,
  ) {
    const preference = loadSoundPreference(storage);
    this.preferredEnabled = preference.enabled;
    this.volume = preference.volume;
    this.scene = preference.scene;
  }

  supported(): boolean {
    return typeof audioContextConstructor() === 'function';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  status(): SoundStatus {
    if (this.enabled && !this.paused && this.context?.state === 'running') return 'on';
    return this.preferredEnabled ? 'resume' : 'off';
  }

  getVolume(): number {
    return this.volume;
  }

  getScene(): SoundScene {
    return this.scene;
  }

  setScene(scene: SoundScene): void {
    this.scene = isSoundScene(scene) ? scene : DEFAULT_SOUND_SCENE;
    this.persist();
    this.notify();
  }

  setStatusListener(listener: (status: SoundStatus) => void): void {
    this.statusListener = listener;
    listener(this.status());
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    this.persist();
    this.setMasterLevel(this.enabled && !this.paused ? MASTER_LEVEL * this.volume : MIN_GAIN);
    this.notify();
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      this.enabled = false;
      this.preferredEnabled = false;
      this.stopActive();
      this.setMasterLevel(MIN_GAIN);
      this.persist();
      this.notify();
      return false;
    }
    if (!this.supported()) return false;
    this.preferredEnabled = true;
    this.persist();
    let context: AudioContext;
    try {
      context = this.context?.state === 'closed' || !this.context ? this.createContext() : this.context;
      // Chrome on Android may expose a usable AudioContext but keep its output
      // locked until a source starts during the tap itself. Queue one silent
      // frame before the first await; it unlocks the output without a demo tone
      // and does not affect the one-oscillator-per-visible-hop contract.
      this.unlockMobileOutput(context);
      if (context.state !== 'running') await context.resume();
    } catch {
      this.enabled = false;
      this.notify();
      return false;
    }
    this.enabled = context.state === 'running';
    this.setMasterLevel(this.enabled && !this.paused ? MASTER_LEVEL * this.volume : MIN_GAIN);
    this.notify();
    return this.enabled;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.stopActive();
    this.setMasterLevel(this.enabled && !paused ? MASTER_LEVEL * this.volume : MIN_GAIN);
    this.notify();
  }

  play(packet: PacketView, character: SoundCharacter = 'map'): number {
    const context = this.context;
    if (!this.enabled || this.paused || !context || context.state !== 'running' || !this.master) return 0;
    const notes = routeSoundPlan(
      packet,
      this.map,
      this.viewport.clientWidth,
      this.viewport.clientHeight,
      this.scene,
      character,
    );
    if (notes.length === 0) return 0;
    const density = 1 / Math.sqrt(1 + this.active.size / 10);
    for (const note of notes) this.schedule(note, density);
    return notes.length;
  }

  destroy(): void {
    this.enabled = false;
    this.stopActive();
    void this.context?.close();
    this.context = undefined;
    this.master = undefined;
    this.ambience = undefined;
    this.waves.clear();
  }

  private createContext(): AudioContext {
    const Context = audioContextConstructor();
    if (!Context) throw new Error('Web Audio is unavailable');
    const context = new Context({ latencyHint: 'interactive' });
    const master = context.createGain();
    master.gain.value = MIN_GAIN;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;
    master.connect(compressor).connect(context.destination);
    const ambience = context.createDelay(0.25);
    ambience.delayTime.value = 0.105;
    const ambienceLevel = context.createGain();
    ambienceLevel.gain.value = 0.12;
    ambience.connect(ambienceLevel).connect(master);
    context.onstatechange = () => {
      if (context.state !== 'running') this.enabled = false;
      this.notify();
    };
    this.context = context;
    this.master = master;
    this.ambience = ambience;
    return context;
  }

  private unlockMobileOutput(context: AudioContext): void {
    const source = context.createBufferSource();
    const silence = context.createGain();
    silence.gain.value = 0;
    source.buffer = context.createBuffer(1, 1, Math.max(8_000, context.sampleRate || 44_100));
    source.connect(silence).connect(context.destination);
    source.onended = () => {
      source.disconnect();
      silence.disconnect();
    };
    source.start(0);
  }

  private schedule(note: HopNote, density: number): void {
    const context = this.context!;
    const master = this.master!;
    const starts = context.currentTime + LOOKAHEAD_SECONDS + note.startMS / 1_000;
    const audibleDuration = Math.max(0.14, note.durationMS / 1_000 * (0.55 + density * 0.45));
    const ends = starts + audibleDuration;
    const scene = SCENES[note.scene];
    const character = CHARACTERS[note.character];
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(note.brightness, starts);
    filter.Q.value = 0.45;
    const panner = context.createStereoPanner();
    panner.pan.setValueAtTime(note.pan, starts);
    const envelope = context.createGain();
    const peak = Math.max(MIN_VOICE_LEVEL, VOICE_LEVEL * density * scene.levelScale * character.levelScale);
    const attackEnds = starts + Math.min(scene.attackSeconds * character.attackScale, audibleDuration * 0.24);
    envelope.gain.setValueAtTime(MIN_GAIN, starts);
    envelope.gain.exponentialRampToValueAtTime(peak, attackEnds);
    envelope.gain.exponentialRampToValueAtTime(Math.max(MIN_GAIN, peak * scene.sustainLevel * character.sustainScale), starts + audibleDuration * 0.42);
    envelope.gain.exponentialRampToValueAtTime(MIN_GAIN, ends);
    filter.connect(panner).connect(envelope).connect(master);
    if (this.ambience) envelope.connect(this.ambience);

    const oscillator = this.oscillator(note, starts, ends, filter);
    oscillator.onended = () => {
      this.active.delete(oscillator);
      oscillator.disconnect();
      filter.disconnect();
      panner.disconnect();
      envelope.disconnect();
    };
  }

  private oscillator(
    note: HopNote,
    starts: number,
    ends: number,
    destination: AudioNode,
  ): OscillatorNode {
    const oscillator = this.context!.createOscillator();
    oscillator.setPeriodicWave(this.periodicWave(note.scene, note.variation, note.character));
    oscillator.frequency.setValueAtTime(note.frequency, starts);
    oscillator.frequency.exponentialRampToValueAtTime(note.frequency * SCENES[note.scene].pitchEndRatio * CHARACTERS[note.character].pitchEndRatio, ends);
    oscillator.connect(destination);
    oscillator.start(starts);
    oscillator.stop(ends + 0.04);
    this.active.add(oscillator);
    return oscillator;
  }

  private periodicWave(scene: SoundScene, variation: number, character: SoundCharacter): PeriodicWave {
    const key = `${scene}:${variation}:${character}`;
    const cached = this.waves.get(key);
    if (cached) return cached;
    const sceneHarmonics = SCENES[scene].harmonics[variation] ?? SCENES[scene].harmonics[0]!;
    const characterHarmonics = CHARACTERS[character].harmonics?.[variation];
    const harmonics = characterHarmonics
      ? blendHarmonics(sceneHarmonics, characterHarmonics)
      : sceneHarmonics;
    const real = new Float32Array(harmonics.length + 1);
    const imaginary = new Float32Array(harmonics.length + 1);
    harmonics.forEach((amplitude, index) => { imaginary[index + 1] = amplitude; });
    const wave = this.context!.createPeriodicWave(real, imaginary, { disableNormalization: false });
    this.waves.set(key, wave);
    return wave;
  }

  private stopActive(): void {
    const now = this.context?.currentTime;
    for (const oscillator of this.active) {
      try {
        oscillator.stop(now === undefined ? undefined : now + 0.015);
      } catch {
        // It may already have ended between iteration and stop().
      }
    }
    this.active.clear();
  }

  private setMasterLevel(value: number): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(value, now, 0.018);
  }

  private persist(): void {
    saveSoundPreference(this.storage, { enabled: this.preferredEnabled, volume: this.volume, scene: this.scene });
  }

  private notify(): void {
    this.statusListener?.(this.status());
  }
}

export function isSoundScene(value: unknown): value is SoundScene {
  return value === 'aurora' || value === 'wood' || value === 'chimes';
}

function audioContextConstructor(): AudioContextConstructor | undefined {
  return window.AudioContext ?? (window as WebKitAudioWindow).webkitAudioContext;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function segmentIntersectsViewport(
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
  height: number,
): boolean {
  if (!segmentNearViewport(from, to, width, height, 0)) return false;
  let start = 0;
  let end = 1;
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  for (const [direction, distance] of [
    [-deltaX, from.x],
    [deltaX, width - from.x],
    [-deltaY, from.y],
    [deltaY, height - from.y],
  ] as const) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const boundary = distance / direction;
    if (direction < 0) start = Math.max(start, boundary);
    else end = Math.min(end, boundary);
    if (start > end) return false;
  }
  return true;
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function blendHarmonics(scene: readonly number[], character: readonly number[]): number[] {
  const length = Math.max(scene.length, character.length);
  return Array.from({ length }, (_, index) => (scene[index] ?? 0) * 0.35 + (character[index] ?? 0) * 0.78);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
