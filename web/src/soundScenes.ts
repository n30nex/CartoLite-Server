/** Synthesized instrument-inspired voices. No samples or remote audio assets. */
export interface SoundSceneProfile {
  label: string;
  group: string;
  description: string;
  durationScale: number;
  maxDurationMS: number;
  brightnessScale: number;
  attackSeconds: number;
  sustainLevel: number;
  levelScale: number;
  pitchEndRatio: number;
  registerShifts: readonly number[];
  harmonics: readonly (readonly number[])[];
  filterType: BiquadFilterType;
  filterQ: number;
  filterEndRatio: number;
  minBrightness: number;
  ambience: boolean;
}

const profiles = {
  'aurora': {
    maxDurationMS: 640,
    label: "Aurora", group: "Originals",
    description: "Warm, rounded tones with a gentle glow.",
    durationScale: 1, brightnessScale: 1, attackSeconds: 0.016,
    sustainLevel: 0.32, levelScale: 1, pitchEndRatio: 1,
    registerShifts: [0,0,12],
    harmonics: [[1,0.22,0.08],[1,0.16,0.11,0.03],[1,0.28,0.05]],
    filterType: 'lowpass', filterQ: 0.45, filterEndRatio: 1,
    minBrightness: 1400, ambience: true,
  },
  'wood': {
    maxDurationMS: 640,
    label: "Wood", group: "Originals",
    description: "Short, rounded wooden knocks.",
    durationScale: 0.72, brightnessScale: 0.68, attackSeconds: 0.006,
    sustainLevel: 0.14, levelScale: 0.96, pitchEndRatio: 0.985,
    registerShifts: [-12,0,0],
    harmonics: [[1,0.46,0.2,0.07],[1,0.36,0.24,0.09],[1,0.5,0.14,0.05]],
    filterType: 'lowpass', filterQ: 0.45, filterEndRatio: 1,
    minBrightness: 1400, ambience: true,
  },
  'chimes': {
    maxDurationMS: 640,
    label: "Chimes", group: "Originals",
    description: "Bright, soft bells with a light shimmer.",
    durationScale: 1.12, brightnessScale: 1.18, attackSeconds: 0.009,
    sustainLevel: 0.24, levelScale: 0.82, pitchEndRatio: 1.004,
    registerShifts: [0,12,12],
    harmonics: [[1,0.08,0.31,0.04,0.15],[1,0.12,0.24,0.03,0.2],[1,0.05,0.36,0.08,0.12]],
    filterType: 'lowpass', filterQ: 0.45, filterEndRatio: 1,
    minBrightness: 1400, ambience: true,
  },
  'felt-piano': {
    maxDurationMS: 520,
    label: "Felt Piano", group: "Keys & mallets",
    description: "Soft piano-like notes with a mellow falling tone.",
    durationScale: 0.9, brightnessScale: 0.48, attackSeconds: 0.01,
    sustainLevel: 0.17, levelScale: 0.95, pitchEndRatio: 1,
    registerShifts: [-12,0,0],
    harmonics: [[1,0.34,0.13,0.05,0.018],[1,0.272,0.15,0.04,0.021],[1,0.381,0.101,0.056,0.014]],
    filterType: 'lowpass', filterQ: 0.45, filterEndRatio: 0.32,
    minBrightness: 180, ambience: true,
  },
  'electric-piano': {
    maxDurationMS: 560,
    label: "Electric Piano", group: "Keys & mallets",
    description: "Rounded keys with a bright, metallic attack.",
    durationScale: 1.05, brightnessScale: 0.9, attackSeconds: 0.008,
    sustainLevel: 0.2, levelScale: 0.8, pitchEndRatio: 1,
    registerShifts: [0,0,12],
    harmonics: [[1,0.1,0.48,0.07,0.22,0.025],[1,0.08,0.552,0.056,0.253,0.02],[1,0.112,0.374,0.078,0.172,0.028]],
    filterType: 'lowpass', filterQ: 0.6, filterEndRatio: 0.3,
    minBrightness: 180, ambience: true,
  },
  'marimba': {
    maxDurationMS: 300,
    label: "Marimba", group: "Keys & mallets",
    description: "Low wooden mallets with a hollow ring.",
    durationScale: 0.62, brightnessScale: 0.56, attackSeconds: 0.004,
    sustainLevel: 0.065, levelScale: 0.9, pitchEndRatio: 0.992,
    registerShifts: [-12,-12,0],
    harmonics: [[1,0.025,0.08,0.55,0.03,0.12],[1,0.02,0.092,0.44,0.034,0.096],[1,0.028,0.062,0.616,0.023,0.134]],
    filterType: 'lowpass', filterQ: 0.5, filterEndRatio: 0.55,
    minBrightness: 180, ambience: false,
  },
  'kalimba': {
    maxDurationMS: 380,
    label: "Kalimba", group: "Keys & mallets",
    description: "Small, crisp thumb-piano plucks.",
    durationScale: 0.74, brightnessScale: 0.82, attackSeconds: 0.003,
    sustainLevel: 0.11, levelScale: 0.8, pitchEndRatio: 1.006,
    registerShifts: [0,12,0],
    harmonics: [[1,0.13,0.3,0.08,0.19,0.025,0.08],[1,0.104,0.345,0.064,0.218,0.02,0.092],[1,0.146,0.234,0.09,0.148,0.028,0.062]],
    filterType: 'lowpass', filterQ: 0.65, filterEndRatio: 0.42,
    minBrightness: 180, ambience: true,
  },
  'vibraphone': {
    maxDurationMS: 640,
    label: "Vibraphone", group: "Keys & mallets",
    description: "Smooth metal mallets with a lingering tail.",
    durationScale: 1.34, brightnessScale: 0.72, attackSeconds: 0.011,
    sustainLevel: 0.34, levelScale: 0.77, pitchEndRatio: 1,
    registerShifts: [0,0,-12],
    harmonics: [[1,0.018,0.12,0.025,0.24,0.012,0.07],[1,0.014,0.138,0.02,0.276,0.01,0.081],[1,0.02,0.094,0.028,0.187,0.013,0.055]],
    filterType: 'lowpass', filterQ: 0.45, filterEndRatio: 0.7,
    minBrightness: 180, ambience: true,
  },
  'celesta': {
    maxDurationMS: 400,
    label: "Celesta", group: "Keys & mallets",
    description: "Delicate high keys with a silvery edge.",
    durationScale: 0.91, brightnessScale: 1.18, attackSeconds: 0.005,
    sustainLevel: 0.13, levelScale: 0.65, pitchEndRatio: 1,
    registerShifts: [12,12,0],
    harmonics: [[1,0.08,0.47,0.03,0.27,0.01,0.12],[1,0.064,0.541,0.024,0.311,0.008,0.138],[1,0.09,0.367,0.034,0.211,0.011,0.094]],
    filterType: 'lowpass', filterQ: 0.7, filterEndRatio: 0.52,
    minBrightness: 180, ambience: true,
  },
  'music-box': {
    maxDurationMS: 300,
    label: "Music Box", group: "Keys & mallets",
    description: "Tiny, bright music-box pins.",
    durationScale: 0.65, brightnessScale: 1.28, attackSeconds: 0.003,
    sustainLevel: 0.055, levelScale: 0.57, pitchEndRatio: 1.003,
    registerShifts: [12,24,12],
    harmonics: [[1,0.04,0.38,0.015,0.23,0.015,0.16],[1,0.032,0.437,0.012,0.265,0.012,0.184],[1,0.045,0.296,0.017,0.179,0.017,0.125]],
    filterType: 'lowpass', filterQ: 0.5, filterEndRatio: 0.6,
    minBrightness: 180, ambience: true,
  },
  'harp': {
    maxDurationMS: 600,
    label: "Harp", group: "Strings & bells",
    description: "Clear string plucks that soften as they fade.",
    durationScale: 1.22, brightnessScale: 0.85, attackSeconds: 0.004,
    sustainLevel: 0.19, levelScale: 0.82, pitchEndRatio: 1,
    registerShifts: [0,12,0],
    harmonics: [[1,0.48,0.26,0.14,0.075,0.035],[1,0.384,0.299,0.112,0.086,0.028],[1,0.538,0.203,0.157,0.059,0.039]],
    filterType: 'lowpass', filterQ: 0.4, filterEndRatio: 0.22,
    minBrightness: 180, ambience: true,
  },
  'koto': {
    maxDurationMS: 340,
    label: "Koto", group: "Strings & bells",
    description: "Bright, nasal plucks with a slight downward bend.",
    durationScale: 0.86, brightnessScale: 1.1, attackSeconds: 0.003,
    sustainLevel: 0.095, levelScale: 0.7, pitchEndRatio: 0.955,
    registerShifts: [-12,0,0],
    harmonics: [[1,0.62,0.42,0.26,0.18,0.12,0.075],[1,0.496,0.483,0.208,0.207,0.096,0.086],[1,0.694,0.328,0.291,0.14,0.134,0.059]],
    filterType: 'lowpass', filterQ: 1.15, filterEndRatio: 0.28,
    minBrightness: 180, ambience: false,
  },
  'dulcimer': {
    maxDurationMS: 440,
    label: "Dulcimer", group: "Strings & bells",
    description: "Bright hammered strings with a wiry ring.",
    durationScale: 0.97, brightnessScale: 0.32, attackSeconds: 0.004,
    sustainLevel: 0.15, levelScale: 0.65, pitchEndRatio: 1.002,
    registerShifts: [0,0,12],
    harmonics: [[1,0.54,0.39,0.22,0.21,0.09,0.13],[1,0.432,0.448,0.176,0.241,0.072,0.15],[1,0.605,0.304,0.246,0.164,0.101,0.101]],
    filterType: 'highpass', filterQ: 0.55, filterEndRatio: 0.55,
    minBrightness: 350, ambience: true,
  },
  'glass-bells': {
    maxDurationMS: 640,
    label: "Glass Bells", group: "Strings & bells",
    description: "Thin, crystalline bells with a long shimmer.",
    durationScale: 1.42, brightnessScale: 1.48, attackSeconds: 0.007,
    sustainLevel: 0.21, levelScale: 0.59, pitchEndRatio: 1.008,
    registerShifts: [12,0,12],
    harmonics: [[1,0.018,0.51,0.012,0.3,0.01,0.2,0.005,0.09],[1,0.014,0.586,0.01,0.345,0.008,0.23,0.004,0.104],[1,0.02,0.398,0.013,0.234,0.011,0.156,0.006,0.07]],
    filterType: 'lowpass', filterQ: 0.5, filterEndRatio: 0.82,
    minBrightness: 180, ambience: true,
  },
  'temple-bells': {
    maxDurationMS: 640,
    label: "Temple Bells", group: "Strings & bells",
    description: "Deep, rounded bells with a dark resonant tail.",
    durationScale: 1.5, brightnessScale: 0.56, attackSeconds: 0.012,
    sustainLevel: 0.31, levelScale: 0.8, pitchEndRatio: 0.996,
    registerShifts: [-12,-12,0],
    harmonics: [[1,0.07,0.72,0.04,0.33,0.02,0.12],[1,0.056,0.828,0.032,0.38,0.016,0.138],[1,0.078,0.562,0.045,0.257,0.022,0.094]],
    filterType: 'lowpass', filterQ: 0.8, filterEndRatio: 0.58,
    minBrightness: 180, ambience: true,
  },
  'steel-pan': {
    maxDurationMS: 420,
    label: "Steel Pan", group: "Strings & bells",
    description: "Sunny, rounded metal notes with a quick bend.",
    durationScale: 0.86, brightnessScale: 0.85, attackSeconds: 0.004,
    sustainLevel: 0.15, levelScale: 0.72, pitchEndRatio: 0.975,
    registerShifts: [0,0,-12],
    harmonics: [[1,0.16,0.67,0.08,0.28,0.06],[1,0.128,0.771,0.064,0.322,0.048],[1,0.179,0.523,0.09,0.218,0.067]],
    filterType: 'lowpass', filterQ: 0.65, filterEndRatio: 0.6,
    minBrightness: 180, ambience: true,
  },
  'soft-organ': {
    maxDurationMS: 640,
    label: "Soft Organ", group: "Synths & air",
    description: "Steady, warm organ tones with a rounded finish.",
    durationScale: 1.3, brightnessScale: 0.6, attackSeconds: 0.026,
    sustainLevel: 0.68, levelScale: 0.66, pitchEndRatio: 1,
    registerShifts: [-12,0,0],
    harmonics: [[1,0.58,0.17,0.33,0.06,0.08],[1,0.464,0.196,0.264,0.069,0.064],[1,0.65,0.133,0.37,0.047,0.09]],
    filterType: 'lowpass', filterQ: 0.4, filterEndRatio: 0.9,
    minBrightness: 180, ambience: true,
  },
  'reed': {
    maxDurationMS: 560,
    label: "Reed", group: "Synths & air",
    description: "Woody, reedy notes with a gently nasal edge.",
    durationScale: 1.04, brightnessScale: 0.72, attackSeconds: 0.02,
    sustainLevel: 0.44, levelScale: 0.73, pitchEndRatio: 0.999,
    registerShifts: [0,-12,0],
    harmonics: [[1,0,0.54,0,0.25,0,0.1,0,0.045],[1,0,0.621,0,0.288,0,0.115,0,0.052],[1,0,0.421,0,0.195,0,0.078,0,0.035]],
    filterType: 'lowpass', filterQ: 0.9, filterEndRatio: 0.66,
    minBrightness: 180, ambience: false,
  },
  'flute': {
    maxDurationMS: 600,
    label: "Flute", group: "Synths & air",
    description: "Light, breath-like tones with a soft entrance.",
    durationScale: 1.18, brightnessScale: 0.46, attackSeconds: 0.047,
    sustainLevel: 0.42, levelScale: 0.86, pitchEndRatio: 1.007,
    registerShifts: [12,0,12],
    harmonics: [[1,0.09,0.025,0.008],[1,0.072,0.029,0.006],[1,0.101,0.02,0.009]],
    filterType: 'lowpass', filterQ: 0.35, filterEndRatio: 0.82,
    minBrightness: 180, ambience: true,
  },
  'choir': {
    maxDurationMS: 640,
    label: "Choir", group: "Synths & air",
    description: "Vowel-like synth tones with a slow, airy entrance.",
    durationScale: 1.5, brightnessScale: 0.39, attackSeconds: 0.085,
    sustainLevel: 0.58, levelScale: 0.67, pitchEndRatio: 1.002,
    registerShifts: [0,0,-12],
    harmonics: [[0.5,0.14,0.65,1,0.58,0.2,0.12],[0.5,0.112,0.747,0.8,0.667,0.16,0.138],[0.5,0.157,0.507,1.12,0.452,0.224,0.094]],
    filterType: 'bandpass', filterQ: 1.2, filterEndRatio: 0.74,
    minBrightness: 180, ambience: true,
  },
  'velvet-pad': {
    maxDurationMS: 640,
    label: "Velvet Pad", group: "Synths & air",
    description: "Low, soft synth swells for a calmer soundscape.",
    durationScale: 1.55, brightnessScale: 0.3, attackSeconds: 0.095,
    sustainLevel: 0.6, levelScale: 0.85, pitchEndRatio: 1,
    registerShifts: [-12,-12,0],
    harmonics: [[1,0.24,0.13,0.065,0.035,0.018],[1,0.192,0.15,0.052,0.04,0.014],[1,0.269,0.101,0.073,0.027,0.02]],
    filterType: 'lowpass', filterQ: 0.35, filterEndRatio: 0.47,
    minBrightness: 180, ambience: true,
  },
  'analog-pluck': {
    maxDurationMS: 320,
    label: "Analog Pluck", group: "Synths & air",
    description: "A bright synth pluck with a closing filter.",
    durationScale: 0.78, brightnessScale: 1.55, attackSeconds: 0.003,
    sustainLevel: 0.1, levelScale: 0.66, pitchEndRatio: 0.988,
    registerShifts: [0,0,-12],
    harmonics: [[1,0.5,0.33,0.25,0.2,0.167,0.143,0.125,0.111],[1,0.4,0.38,0.2,0.23,0.134,0.164,0.1,0.128],[1,0.56,0.257,0.28,0.156,0.187,0.112,0.14,0.087]],
    filterType: 'lowpass', filterQ: 1.4, filterEndRatio: 0.1,
    minBrightness: 180, ambience: false,
  },
  'eight-bit': {
    maxDurationMS: 240,
    label: "8-bit", group: "Synths & air",
    description: "Crisp retro game tones with a square-wave edge.",
    durationScale: 0.58, brightnessScale: 1.35, attackSeconds: 0.003,
    sustainLevel: 0.4, levelScale: 0.48, pitchEndRatio: 1,
    registerShifts: [0,12,0],
    harmonics: [[1,0,0.333,0,0.2,0,0.143,0,0.111,0,0.091],[1,0,0.383,0,0.23,0,0.164,0,0.128,0,0.105],[1,0,0.26,0,0.156,0,0.112,0,0.087,0,0.071]],
    filterType: 'lowpass', filterQ: 0.4, filterEndRatio: 0.9,
    minBrightness: 180, ambience: false,
  },
  'sonar': {
    maxDurationMS: 480,
    label: "Sonar", group: "Signals & percussion",
    description: "Low, clean underwater-style pings.",
    durationScale: 1.36, brightnessScale: 0.4, attackSeconds: 0.014,
    sustainLevel: 0.21, levelScale: 0.91, pitchEndRatio: 0.995,
    registerShifts: [-12,0,-12],
    harmonics: [[1,0.014,0.005],[1,0.011,0.006],[1,0.016,0.004]],
    filterType: 'lowpass', filterQ: 0.4, filterEndRatio: 0.82,
    minBrightness: 180, ambience: true,
  },
  'radar': {
    maxDurationMS: 220,
    label: "Radar", group: "Signals & percussion",
    description: "Bright electronic pings that rise slightly.",
    durationScale: 0.5, brightnessScale: 1.2, attackSeconds: 0.005,
    sustainLevel: 0.12, levelScale: 0.58, pitchEndRatio: 1.16,
    registerShifts: [12,12,0],
    harmonics: [[1,0.38,0.17,0.07],[1,0.304,0.196,0.056],[1,0.426,0.133,0.078]],
    filterType: 'lowpass', filterQ: 0.6, filterEndRatio: 0.6,
    minBrightness: 180, ambience: false,
  },
  'bubble': {
    maxDurationMS: 260,
    label: "Bubble", group: "Signals & percussion",
    description: "Round liquid blips that tumble downward.",
    durationScale: 0.64, brightnessScale: 0.59, attackSeconds: 0.007,
    sustainLevel: 0.055, levelScale: 0.8, pitchEndRatio: 0.43,
    registerShifts: [12,0,12],
    harmonics: [[1,0.1,0.035],[1,0.08,0.04],[1,0.112,0.027]],
    filterType: 'lowpass', filterQ: 1.4, filterEndRatio: 0.48,
    minBrightness: 180, ambience: false,
  },
  'droplet': {
    maxDurationMS: 220,
    label: "Droplet", group: "Signals & percussion",
    description: "Small, bright water-drop tones that flick upward.",
    durationScale: 0.51, brightnessScale: 1.06, attackSeconds: 0.004,
    sustainLevel: 0.065, levelScale: 0.61, pitchEndRatio: 1.58,
    registerShifts: [0,12,0],
    harmonics: [[1,0.025,0.18,0.012],[1,0.02,0.207,0.01],[1,0.028,0.14,0.013]],
    filterType: 'lowpass', filterQ: 0.75, filterEndRatio: 0.33,
    minBrightness: 180, ambience: true,
  },
  'soft-kick': {
    maxDurationMS: 250,
    label: "Soft Kick", group: "Signals & percussion",
    description: "A low, soft electronic thump.",
    durationScale: 0.58, brightnessScale: 0.18, attackSeconds: 0.004,
    sustainLevel: 0.035, levelScale: 0.9, pitchEndRatio: 0.36,
    registerShifts: [-12,-12,-12],
    harmonics: [[1,0.35,0.16,0.055],[1,0.28,0.184,0.044],[1,0.392,0.125,0.062]],
    filterType: 'lowpass', filterQ: 0.65, filterEndRatio: 0.38,
    minBrightness: 180, ambience: false,
  },
  'tom': {
    maxDurationMS: 320,
    label: "Tom", group: "Signals & percussion",
    description: "Rounded, pitched drum hits with a falling tail.",
    durationScale: 0.76, brightnessScale: 0.42, attackSeconds: 0.004,
    sustainLevel: 0.09, levelScale: 0.88, pitchEndRatio: 0.66,
    registerShifts: [-12,0,-12],
    harmonics: [[1,0.18,0.46,0.11,0.12],[1,0.144,0.529,0.088,0.138],[1,0.202,0.359,0.123,0.094]],
    filterType: 'lowpass', filterQ: 0.7, filterEndRatio: 0.38,
    minBrightness: 180, ambience: false,
  },
  'rim-click': {
    maxDurationMS: 160,
    label: "Rim Click", group: "Signals & percussion",
    description: "Dry, high wooden clicks for a percussive pulse.",
    durationScale: 0.34, brightnessScale: 0.27, attackSeconds: 0.002,
    sustainLevel: 0.025, levelScale: 0.62, pitchEndRatio: 0.76,
    registerShifts: [12,24,12],
    harmonics: [[0.08,0.7,1,0.22,0.56,0.1],[0.08,0.56,1.15,0.176,0.644,0.08],[0.08,0.784,0.78,0.246,0.437,0.112]],
    filterType: 'highpass', filterQ: 0.55, filterEndRatio: 0.65,
    minBrightness: 350, ambience: false,
  },
} as const satisfies Record<string, SoundSceneProfile>;

export type SoundScene = keyof typeof profiles;
export const SOUND_SCENES: Readonly<Record<SoundScene, SoundSceneProfile>> = profiles;
export const SOUND_SCENE_IDS = Object.keys(profiles) as readonly SoundScene[];

export function isSoundScene(value: unknown): value is SoundScene {
  return typeof value === 'string' && Object.hasOwn(SOUND_SCENES, value);
}

export function populateSoundScenes(select: HTMLSelectElement): void {
  const groups = new Map<string, HTMLOptGroupElement>();
  select.replaceChildren();
  for (const scene of SOUND_SCENE_IDS) {
    const profile = SOUND_SCENES[scene];
    let group = groups.get(profile.group);
    if (!group) {
      group = select.ownerDocument.createElement('optgroup');
      group.label = profile.group;
      groups.set(profile.group, group);
      select.append(group);
    }
    const option = select.ownerDocument.createElement('option');
    option.value = scene;
    option.textContent = profile.label;
    option.title = profile.description;
    group.append(option);
  }
}

export function syncSoundScene(select: HTMLSelectElement, scene: SoundScene): void {
  const profile = SOUND_SCENES[scene];
  select.value = scene;
  select.title = profile.description;
  select.setAttribute('aria-description', profile.description);
  const descriptionID = select.getAttribute('aria-describedby');
  const description = descriptionID ? select.ownerDocument.getElementById(descriptionID) : null;
  if (description) description.textContent = profile.description;
}
