import { UI_STORAGE_KEY, type BasemapStyle, type InterfaceTheme } from './preferences';
import { PACKET_KIND_COLORS as DARK_KINDS } from './trafficVisuals';

export type LinePattern = 'solid' | 'dashed' | 'dotted';
export type RoutePreset = 'crisp' | 'neon' | 'dashed' | 'dotted' | 'ribbon' | 'comet' | 'custom';
export interface DisplayPreferences {
  basemap: BasemapStyle;
  theme: InterfaceTheme;
  preset: RoutePreset;
  pattern: LinePattern;
  width: number;
  opacity: number;
  glow: number;
  packetSize: number;
  trailLength: number;
  residueSeconds: number;
}

export const DISPLAY_STORAGE_KEY = UI_STORAGE_KEY.replace(':ui:', ':display:');
export const DISPLAY_EVENT = 'cartolite:display-change';
export const ROUTE_PRESETS = {
  crisp: { pattern: 'solid', width: 1.6, opacity: 0.8, glow: 0.15, packetSize: 1, trailLength: 1, residueSeconds: 15 },
  neon: { pattern: 'solid', width: 2, opacity: 0.9, glow: 0.85, packetSize: 1.15, trailLength: 1.3, residueSeconds: 25 },
  dashed: { pattern: 'dashed', width: 1.8, opacity: 0.85, glow: 0.1, packetSize: 1, trailLength: 0.8, residueSeconds: 12 },
  dotted: { pattern: 'dotted', width: 2.4, opacity: 0.9, glow: 0.1, packetSize: 1.2, trailLength: 0.6, residueSeconds: 10 },
  ribbon: { pattern: 'solid', width: 3.5, opacity: 0.75, glow: 0.1, packetSize: 1.35, trailLength: 1, residueSeconds: 12 },
  comet: { pattern: 'solid', width: 1.4, opacity: 0.8, glow: 0.5, packetSize: 1.4, trailLength: 2, residueSeconds: 30 },
} as const;
export const DEFAULT_DISPLAY: DisplayPreferences = { basemap: 'dark', theme: 'map', preset: 'crisp', ...ROUTE_PRESETS.crisp };

const LIGHT_KINDS = { Advert: '#006957', Trace: '#855000', Text: '#a21b58', ACK: '#075b98', Control: '#6740a0', Other: '#445760' };
const LIGHT_COLORS: Record<string, string> = {
  ...Object.fromEntries(Object.keys(DARK_KINDS).map((kind) => [DARK_KINDS[kind as keyof typeof DARK_KINDS], LIGHT_KINDS[kind as keyof typeof LIGHT_KINDS]])),
  '#63d9cc': '#006957', '#69d1ca': '#006957', '#73d9cf': '#006957', '#8ec5c1': '#254f50',
  '#78d5a3': '#176342', '#68b4f6': '#075b98', '#c184f6': '#6740a0',
  '#67ead2': '#006957', '#d694ff': '#6740a0', '#ffd06c': '#855000', '#a6b4bf': '#445760',
  '#eaffff': '#25454b', '#f2ffff': '#17353c',
  '#45c27f': '#176342', '#53a7e8': '#075b98', '#ab76dc': '#6740a0', '#a2ad57': '#596500', '#8794a6': '#445760',
  '#32c8bb': '#117066', '#08272c': '#e2eee6', '#48d5c7': '#006957', '#dffffb': '#194950',
  '#f3b844': '#805000', '#f2bd55': '#805000', '#fff0b8': '#805000', '#f5cf76': '#805000', '#bce9e5': '#2a6362',
  '#e5fffc': '#183d40', '#edfffd': '#17464a', '#ffffff': '#172f38',
  '#d2e0ef': '#284651', '#f6d77f': '#735000', '#c8d9df': '#284651',
  '#02070b': '#f6f7f1', '#061216': '#f6f7f1', '#07121a': '#f6f7f1',
  '#031015': '#f6f7f1',
};

let current: DisplayPreferences = { ...DEFAULT_DISPLAY };
let initialized = false;
export function displayPreferences(): Readonly<DisplayPreferences> { return current; }
export function lightScene(): boolean { return current.basemap !== 'dark'; }
export function displayColor(color: string, light = lightScene()): string {
  if (!light) return color;
  const direct = LIGHT_COLORS[color.toLowerCase()];
  if (direct) return direct;
  const rgba = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/i.exec(color);
  if (!rgba) return color;
  const hex = '#' + rgba.slice(1, 4).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('');
  const mapped = LIGHT_COLORS[hex];
  if (!mapped) return color;
  const value = Number.parseInt(mapped.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${rgba[4] ?? 1})`;
}
export function recolorPaint(value: unknown, light: boolean): unknown {
  if (typeof value === 'string') return displayColor(value, light);
  if (!Array.isArray(value)) return value;
  if (light && value[0] === 'get' && typeof value[1] === 'string' && /^color(?:\d|$)/.test(value[1])) {
    return ['match', value, ...Object.entries(LIGHT_COLORS).flat(), value];
  }
  return value.map((item) => recolorPaint(item, light));
}
export function packetPalette(light = lightScene()): typeof DARK_KINDS { return light ? LIGHT_KINDS : DARK_KINDS; }
export function canvasColorWithAlpha(color: string, alpha: number): string {
  const resolved = displayColor(color);
  const value = Number.parseInt(resolved.startsWith('#') ? resolved.slice(1) : 'ffffff', 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${Math.max(0, Math.min(1, alpha))})`;
}
export function lineDash(width = current.width): number[] {
  return current.pattern === 'dashed' ? [width * 4, width * 3] : current.pattern === 'dotted' ? [0.01, width * 2.7] : [];
}
export function residueLifetime(): number { return current.residueSeconds * 1000; }
export function displayResidueAge(age: number): number { return age * 45_000 / Math.max(1, residueLifetime()); }

export function normalizeDisplay(value: unknown): DisplayPreferences {
  const v = value && typeof value === 'object' ? value as Partial<DisplayPreferences> : {};
  const amount = (key: keyof DisplayPreferences, min: number, max: number): number => {
    const raw = v[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : Number(DEFAULT_DISPLAY[key]);
  };
  return {
    basemap: v.basemap === 'light' || v.basemap === 'streets' ? v.basemap : 'dark',
    theme: v.theme === 'light' || v.theme === 'dark' ? v.theme : 'map',
    preset: v.preset === 'custom' || (typeof v.preset === 'string' && Object.hasOwn(ROUTE_PRESETS, v.preset)) ? v.preset as RoutePreset : 'crisp',
    pattern: v.pattern === 'dashed' || v.pattern === 'dotted' ? v.pattern : 'solid',
    width: amount('width', 1, 5), opacity: amount('opacity', 0.2, 1), glow: amount('glow', 0, 1),
    packetSize: amount('packetSize', 0.75, 2), trailLength: amount('trailLength', 0.5, 2), residueSeconds: amount('residueSeconds', 0, 45),
  };
}
export function loadDisplayPreferences(storage: Pick<Storage, 'getItem'>): DisplayPreferences {
  try {
    const saved = storage.getItem(DISPLAY_STORAGE_KEY);
    if (saved) return normalizeDisplay(JSON.parse(saved));
    const legacy = JSON.parse(storage.getItem(UI_STORAGE_KEY) ?? 'null');
    return normalizeDisplay({ ...DEFAULT_DISPLAY, ...legacy, opacity: legacy?.routeOpacity ?? DEFAULT_DISPLAY.opacity });
  } catch { return { ...DEFAULT_DISPLAY }; }
}
export function initializeDisplay(): void {
  if (initialized) return;
  initialized = true;
  try { current = loadDisplayPreferences(localStorage); } catch { /* Browser storage is optional. */ }
  applyDisplayChrome();
  window.addEventListener('storage', (event) => {
    if (event.key !== DISPLAY_STORAGE_KEY && event.key !== null) return;
    try { current = loadDisplayPreferences(localStorage); } catch { current = { ...DEFAULT_DISPLAY }; }
    applyDisplayChrome();
    window.dispatchEvent(new Event(DISPLAY_EVENT));
  });
}
export function updateDisplay(update: Partial<DisplayPreferences>): void {
  current = normalizeDisplay({ ...current, ...update });
  try { localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(current)); } catch { /* Browser storage is optional. */ }
  applyDisplayChrome();
  window.dispatchEvent(new Event(DISPLAY_EVENT));
}
export function applyDisplayChrome(): void {
  const root = document.documentElement;
  root.dataset.theme = current.theme === 'map' ? (lightScene() ? 'light' : 'dark') : current.theme;
  root.dataset.basemap = current.basemap;
  root.dataset.routePreset = current.preset;
  for (const [kind, color] of Object.entries(packetPalette())) root.style.setProperty(`--kind-${kind.toLowerCase()}`, color);
  for (const [kind, color] of Object.entries(packetPalette())) root.style.setProperty(`--ui-kind-${kind.toLowerCase()}`, color);
  root.style.setProperty('--scene-background', current.basemap === 'dark' ? '#071319' : current.basemap === 'streets' ? '#f0eadb' : '#eef1ee');
  for (const el of document.querySelectorAll<HTMLElement>('[data-kind]')) {
    const color = packetPalette()[el.dataset.kind as keyof typeof DARK_KINDS];
    if (color) el.style.setProperty('--route-color', color);
  }
}
