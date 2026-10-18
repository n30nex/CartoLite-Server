/** A fixed 2×4 dot cell. Sampling is bounded by the viewport, never by traffic. */
const DOTS = [1, 8, 2, 16, 4, 32, 64, 128];
export const TERMINAL_COLORS = ['#000000', '#213c78', '#f2fff1', '#536b80', '#72ffcf', '#ffdb72', '#ff85ce', '#89e5ff', '#c6a4ff', '#253e31', '#28323f', '#788a98'];
export type TerminalPalette = 'ansi' | 'amber' | 'green';
export interface TerminalPreferences { palette: TerminalPalette; glyphs: 'braille' | 'ascii'; size: number }
export const TERMINAL_DEFAULTS: TerminalPreferences = { palette: 'ansi', glyphs: 'braille', size: 12 };

export function terminalPreferences(raw: string | null): TerminalPreferences {
  try {
    const value = JSON.parse(raw ?? '{}');
    return {
      palette: ['ansi', 'amber', 'green'].includes(value?.palette) ? value.palette : 'ansi',
      glyphs: value?.glyphs === 'ascii' ? 'ascii' : 'braille',
      size: [10, 12, 16].includes(value?.size) ? value.size : 12,
    };
  } catch { return { ...TERMINAL_DEFAULTS }; }
}

export function terminalColor(index: number, palette: TerminalPalette): string {
  if (palette === 'ansi') return TERMINAL_COLORS[index] ?? TERMINAL_COLORS[2]!;
  const background = index === 1 || index === 3 || index > 8;
  return palette === 'amber' ? (background ? '#634522' : '#ffe5ac')
    : (background ? '#214631' : '#afffc7');
}

export function terminalInk(r: number, g: number, b: number, alpha = 255): number {
  // This is the live-only canvas, not geography. Keep dim packet hues instead
  // of classifying them as roads or water; opacity is carried separately.
  if (alpha < 16 || Math.max(r, g, b) < 16) return 0;
  if (Math.min(r,g,b) > Math.max(r,g,b) * .7) return 2;
  if (r > g * 1.25 && b > g * 1.12) return 6;
  if (r > b * 1.3 && g > b * 1.15) return 5;
  if (g > r * 1.2 && g > b * 0.9) return 4;
  if (b > r * 1.1 && r > g * 0.9) return 8;
  if (b > r * 1.1) return 7;
  return 2;
}

export function characterCells(image: Pick<ImageData, 'data' | 'width' | 'height'>, ascii: boolean, palette?: Record<number,string>) {
  const { data, width, height } = image;
  const columns = Math.floor(width / 2), rows = Math.floor(height / 4);
  const glyphs: string[] = new Array(columns * rows).fill(' '), hot = [...glyphs];
  const colors = new Uint8Array(glyphs.length), energy = new Uint8Array(glyphs.length);
  const strengths = new Float32Array(8), kinds = new Uint8Array(8);
  const inks=palette?Object.entries(palette).map(([id,hex])=>{
    const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));const peak=Math.max(1,...rgb);
    return {id:Number(id),rgb:rgb.map(channel=>channel/peak)};
  }):undefined;
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    let mask = 0, white = 0, color = 2, peak = 0, colourPeak = 0, count = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
      const p = ((y*4+dy)*width+x*2+dx)*4;
      let k = terminalInk(data[p]!, data[p+1]!, data[p+2]!, data[p+3]!);
      if(k && inks) {
        const peak=Math.max(1,data[p]!,data[p+1]!,data[p+2]!);
        let distance=Infinity;
        for(const ink of inks) {
          const d=ink.rgb.reduce((sum,v,i)=>sum+(data[p+i]!/peak-v)**2,0);
          if(d<distance){distance=d;k=ink.id;}
        }
      }
      const strength = k ? data[p+3]! * Math.max(data[p]!,data[p+1]!,data[p+2]!) / 255 : 0;
      const dot=dy*2+dx; strengths[dot]=strength; kinds[dot]=k;
      peak=Math.max(peak,strength);
      if(k!==2 && strength>colourPeak) { color=k; colourPeak=strength; }
    }
    for(let dot=0;dot<8;dot++) {
      if(strengths[dot]! < Math.max(16,peak*.28)) continue;
      mask |= DOTS[dot]!; count++;
      if(kinds[dot]===2 && strengths[dot]! >= peak*.7) white |= DOTS[dot]!;
    }
    const cell = y * columns + x;
    if(!mask) continue;
    colors[cell] = color; energy[cell]=Math.min(255,Math.ceil(peak/16)*16);
    glyphs[cell] = ascii ? (count<3 ? '*' : count<6 ? '+' : '#') : String.fromCharCode(0x2800+mask);
    if(white) hot[cell] = ascii ? '*' : String.fromCharCode(0x2800+white);
  }
  return { glyphs, hot, colors, energy, columns, rows };
}
