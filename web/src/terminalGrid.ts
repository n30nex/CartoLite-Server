/** A fixed 2×4 dot cell. Sampling is bounded by the viewport, never by traffic. */
const DOTS = [1, 8, 2, 16, 4, 32, 64, 128];
export const TERMINAL_COLORS = ['#000000', '#3869df', '#e4d9ba', '#7293aa', '#71f5c7', '#ffcf63', '#ff83bd', '#78cfff', '#b39aff', '#355f49', '#35404c'];
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
  return palette === 'amber' ? (index === 1 || index > 8 ? '#765025' : '#ffd18a')
    : (index === 1 || index > 8 ? '#215d40' : '#8dffb0');
}

export function terminalInk(r: number, g: number, b: number, alpha = 255): number {
  if (alpha < 24 || Math.max(r, g, b) < 26) return 0;
  if (b > r * 1.8 && b > g * 1.6) return 1;
  if (Math.max(r, g, b) < 100) return 3;
  if (r > g * 1.25 && b > g * 1.12) return 6;
  if (r > b * 1.3 && g > b * 1.15) return 5;
  if (g > r * 1.2 && g > b * 0.9) return 4;
  if (b > r * 1.1 && r > g * 0.9) return 8;
  if (b > r * 1.1) return 7;
  return 2;
}

export function characterCells(image: Pick<ImageData, 'data' | 'width' | 'height'>, ascii: boolean, coast: boolean): { glyphs: string[]; colors: Uint8Array; columns: number; rows: number } {
  const { data, width, height } = image;
  const columns = Math.floor(width / 2), rows = Math.floor(height / 4);
  const glyphs: string[] = new Array(columns * rows).fill(' '), colors = new Uint8Array(glyphs.length);
  const ink = new Uint8Array(width * height);
  for (let p = 0; p < ink.length; p++) ink[p] = terminalInk(data[p * 4]!, data[p * 4 + 1]!, data[p * 4 + 2]!, data[p * 4 + 3]!);
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    let mask = 0, color = 0, priority = -1, count = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
      const px = x * 2 + dx, py = y * 4 + dy, p = py * width + px;
      let k = ink[p]!;
      // A pale coast on the land side of the provider's actual water geometry.
      if (coast && k === 0 && ((px > 0 && ink[p - 1] === 1) || (px + 1 < width && ink[p + 1] === 1) || (py > 0 && ink[p - width] === 1) || (py + 1 < height && ink[p + width] === 1))) k = 2;
      const rank = k === 1 ? 0 : k === 3 ? 1 : k === 2 ? 2 : 3;
      if (!k || rank < priority) continue;
      if (rank > priority) { mask = 0; count = 0; color = k; priority = rank; }
      mask |= DOTS[dy * 2 + dx]!; count++;
    }
    const cell = y * columns + x;
    colors[cell] = color;
    glyphs[cell] = mask ? (ascii ? (color === 1 ? ':' : count < 3 ? '.' : count < 6 ? '+' : '#') : String.fromCharCode(0x2800 + mask)) : ' ';
  }
  return { glyphs, colors, columns, rows };
}
