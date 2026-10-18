import { terminalPreferences as legacyPreferences } from './terminalGrid';

export const TERMINAL_KEY = 'cartolite-terminal-v2';
export const TERMINAL_LEGACY_KEY = 'cartolite-terminal-v1';
export const TERMINAL_FONTS = {
  mono: { label: 'System mono', family: 'ui-monospace, "Cascadia Mono", "DejaVu Sans Mono", monospace' },
  vt323: { label: 'VT323 console', family: '"VT323", monospace' },
  pixel: { label: 'Silkscreen pixel', family: '"Silkscreen", monospace' },
  typewriter: { label: 'Typewriter', family: '"Courier New", Courier, monospace' },
} as const;

// Semantic slots stay independent: a green river can never become an Advert.
export const TERMINAL_COLOURS = {
  background: ['Map', 'Background', '#000000'], water: ['Map', 'Water', '#213c78'],
  vegetation: ['Map', 'Vegetation', '#253e31'], urban: ['Map', 'Built-up land', '#28323f'],
  roads: ['Map', 'Roads', '#536b80'], boundary: ['Map', 'Borders', '#657d91'],
  shore: ['Map', 'Shorelines', '#788a98'], buildings: ['Map', 'Buildings', '#667b89'],
  terrain: ['Map', 'Terrain highlights', '#516455'], places: ['Labels', 'Place names', '#a5b8c8'],
  labels: ['Labels', 'Node names', '#f2fff1'], selection: ['Nodes', 'Selection / neighbours', '#ffffff'],
  repeater: ['Nodes', 'Repeaters', '#72ffcf'], companion: ['Nodes', 'Companions', '#89e5ff'],
  room: ['Nodes', 'Rooms', '#c6a4ff'], sensor: ['Nodes', 'Sensors / unknown', '#d7e393'],
  advert: ['Traffic', 'Advert', '#72ffcf'], trace: ['Traffic', 'Trace', '#ffdb72'],
  text: ['Traffic', 'Text', '#ff85ce'], ack: ['Traffic', 'ACK', '#89e5ff'],
  control: ['Traffic', 'Control', '#c6a4ff'], other: ['Traffic', 'Other', '#b7cbd9'],
  core: ['Traffic', 'Packet core', '#f2fff1'],
  panel: ['Interface', 'Panel background', '#050b10'], field: ['Interface', 'Input background', '#08121a'],
  border: ['Interface', 'Panel borders', '#527885'], ink: ['Interface', 'Text', '#d5e6df'],
  strong: ['Interface', 'Headings', '#e9e9bf'], muted: ['Interface', 'Secondary text', '#a5bdbb'],
  accent: ['Interface', 'Accent / focus', '#79f8c4'], active: ['Interface', 'Active controls', '#193c3e'],
  warning: ['Interface', 'Warnings', '#ffd18a'],
} as const;
export type TerminalColour = keyof typeof TERMINAL_COLOURS;
export type TerminalFont = keyof typeof TERMINAL_FONTS;
export type TerminalPreset = 'ansi' | 'amber' | 'green' | 'cga' | 'ega' | 'cell';
export interface TerminalProfile {
  palette: TerminalPreset; glyphs: 'braille' | 'ascii' | 'blocks' | 'cell'; size: number;
  font: TerminalFont; uiFont: TerminalFont; fontSize: number; weight: number; uiScale: number;
  mapBrightness: number; labelBrightness: number; liveGlow: number; traffic: 'characters' | 'smooth';
  colours: Record<TerminalColour, string>;
}
const baseColours = Object.fromEntries(Object.entries(TERMINAL_COLOURS).map(([key, value]) => [key, value[2]])) as TerminalProfile['colours'];
const BASE: Omit<TerminalProfile, 'palette' | 'colours'> = {
  glyphs: 'braille', size: 12, font: 'mono', uiFont: 'mono', fontSize: 12, weight: 600, uiScale: 1,
  mapBrightness: 1, labelBrightness: 1, liveGlow: 1, traffic: 'characters',
};
export const TERMINAL_PRESETS: Record<TerminalPreset, { label: string; colours: Partial<TerminalProfile['colours']>; options?: Partial<Omit<TerminalProfile, 'colours' | 'palette'>> }> = {
  ansi: { label: 'BBS', colours: {} },
  amber: { label: 'Amber', colours: {
    water: '#332414', vegetation: '#30271b', urban: '#382d1c', roads: '#78552a', boundary: '#876c3c', shore: '#a5814c', buildings: '#806947', terrain: '#655235', places: '#bf9e70',
    labels: '#ffe5ac', repeater: '#ffd18a', companion: '#ffe8ba', room: '#eaba6c', sensor: '#dac19a', advert: '#ffd18a', trace: '#ffffc7', text: '#eaba6c', ack: '#ffe8ba', control: '#d1a66b', other: '#c7ad83', core: '#fff5dc', selection: '#ffffff',
    panel: '#100b05', field: '#1c1308', border: '#806538', ink: '#f3d8a4', strong: '#fff0cc', muted: '#c5ab80', accent: '#ffd18a', active: '#40301b', warning: '#fff3ba',
  } },
  green: { label: 'Green', colours: {
    water: '#113b32', vegetation: '#122c1d', urban: '#203b29', roads: '#42684d', boundary: '#5d7e60', shore: '#72997f', buildings: '#446b51', terrain: '#345440', places: '#94bb9a',
    labels: '#afffc7', repeater: '#8dffb0', companion: '#ceffd9', room: '#61db86', sensor: '#b1d5ac', advert: '#8dffb0', trace: '#dfffab', text: '#6be79c', ack: '#ccffe4', control: '#51c98e', other: '#a3ceb1', core: '#effff2', selection: '#ffffff',
    panel: '#050e08', field: '#0a1b12', border: '#497b5b', ink: '#c3f2cd', strong: '#e5ffdf', muted: '#9dbea5', accent: '#8dffb0', active: '#173c26', warning: '#dfffab',
  } },
  cga: { label: 'CGA', options: { glyphs: 'blocks', font: 'pixel', fontSize: 11, weight: 400, mapBrightness: .7, traffic: 'smooth' }, colours: {
    water: '#005555', vegetation: '#002a2a', urban: '#2b152b', roads: '#aa55aa', boundary: '#ff55ff', shore: '#55ffff', buildings: '#aa55aa', places: '#55ffff', labels: '#ffffff',
    advert: '#55ffff', trace: '#ffffff', text: '#ff55ff', ack: '#55aaff', control: '#aa55ff', other: '#aaaaaa', repeater: '#55ffff', companion: '#ffffff', room: '#ff55ff',
    panel: '#080008', field: '#180b18', border: '#aa55aa', ink: '#ffffff', strong: '#55ffff', muted: '#bbaabb', accent: '#ff55ff', active: '#3f153f',
  } },
  ega: { label: 'EGA', options: { glyphs: 'ascii', font: 'vt323', fontSize: 16, weight: 400, mapBrightness: .65, traffic: 'smooth' }, colours: {
    water: '#0000aa', vegetation: '#005500', urban: '#555555', roads: '#aaaaaa', boundary: '#aa5500', shore: '#5555ff', buildings: '#aaaaaa', places: '#ffff55',
    advert: '#55ff55', trace: '#ffff55', text: '#ff55ff', ack: '#55ffff', control: '#5555ff', other: '#aaaaaa', repeater: '#55ff55', companion: '#55ffff', room: '#ff55ff',
    border: '#5555ff', accent: '#55ffff', active: '#000055',
  } },
  cell: { label: 'Cel-shaded', options: { glyphs: 'cell', font: 'mono', fontSize: 12, mapBrightness: .65, traffic: 'smooth' }, colours: {
    background: '#07141b', water: '#183d59', vegetation: '#1e3d32', urban: '#35434b', roads: '#657582', boundary: '#81949c', shore: '#7b9ba9', buildings: '#647c88', terrain: '#476b53', places: '#b9cdd4',
  } },
};
export function terminalPreset(palette: TerminalPreset): TerminalProfile {
  const preset = TERMINAL_PRESETS[palette];
  return { ...BASE, ...preset.options, palette, colours: { ...baseColours, ...preset.colours } };
}
export function normalizeTerminal(value: unknown): TerminalProfile {
  const v = value && typeof value === 'object' ? value as Partial<TerminalProfile> : {};
  const palette = typeof v.palette === 'string' && Object.hasOwn(TERMINAL_PRESETS, v.palette) ? v.palette : 'ansi';
  const defaults = terminalPreset(palette);
  const number = (key: keyof TerminalProfile, min: number, max: number, step: number) => typeof v[key] === 'number' && Number.isFinite(v[key])
    ? Number((Math.round(Math.max(min, Math.min(max, v[key] as number)) / step) * step).toFixed(3)) : defaults[key] as number;
  return {
    palette, glyphs: ['braille','ascii','blocks','cell'].includes(String(v.glyphs)) ? v.glyphs! : defaults.glyphs,
    size: [10,12,16].includes(v.size!) ? v.size! : defaults.size,
    font: typeof v.font === 'string' && Object.hasOwn(TERMINAL_FONTS,v.font) ? v.font : defaults.font,
    uiFont: typeof v.uiFont === 'string' && Object.hasOwn(TERMINAL_FONTS,v.uiFont) ? v.uiFont : defaults.uiFont,
    fontSize: number('fontSize',10,24,1), weight: number('weight',400,700,100), uiScale: number('uiScale',.9,1.35,.05),
    mapBrightness: number('mapBrightness',.15,1.3,.05), labelBrightness: number('labelBrightness',.4,1.3,.05), liveGlow: number('liveGlow',0,2,.1),
    traffic: v.traffic === 'smooth' || v.traffic === 'characters' ? v.traffic : defaults.traffic,
    colours: Object.fromEntries(Object.keys(baseColours).map(key => {
      const colour = v.colours?.[key as TerminalColour];
      return [key, typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour) ? colour.toLowerCase() : defaults.colours[key as TerminalColour]];
    })) as TerminalProfile['colours'],
  };
}
export function loadTerminal(storage: Pick<Storage,'getItem'>): TerminalProfile {
  try {
    const value = storage.getItem(TERMINAL_KEY);
    if (value) return normalizeTerminal(JSON.parse(value));
    const legacy=legacyPreferences(storage.getItem(TERMINAL_LEGACY_KEY));
    return normalizeTerminal({...legacy,fontSize:legacy.size});
  } catch { return terminalPreset('ansi'); }
}
export function shade(colour: string, amount: number): string {
  return '#' + [1,3,5].map(start => Math.min(255, Math.round(parseInt(colour.slice(start,start+2),16)*amount)).toString(16).padStart(2,'0')).join('');
}
export function colourHSL(hex: string): [number,number,number] {
  const [r=0,g=0,b=0] = [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const min=Math.min(r,g,b), max=Math.max(r,g,b), d=max-min, l=(max+min)/2;
  const h=d===0?0:(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)*60;
  return [Math.round(h),Math.round((d===0?0:d/(1-Math.abs(2*l-1)))*100),Math.round(l*100)];
}
export function hslColour(h: number,s: number,l: number): string {
  s/=100; l/=100;
  const a=s*Math.min(l,1-l);
  return '#'+[0,8,4].map(n=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');}).join('');
}
