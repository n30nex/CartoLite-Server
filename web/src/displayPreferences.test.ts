import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY, DISPLAY_STORAGE_KEY, ROUTE_PRESETS, displayColor, loadDisplayPreferences, normalizeDisplay, packetPalette } from './displayPreferences';

describe('shared display preferences', () => {
  it('migrates the map appearance without importing layers or audio settings', () => {
    const storage = { getItem: (key: string) => key === DISPLAY_STORAGE_KEY ? null : JSON.stringify({ basemap: 'streets', theme: 'dark', routeOpacity: 0.55, routes: true, scene: 'choir' }) };
    expect(loadDisplayPreferences(storage)).toEqual({ ...DEFAULT_DISPLAY, basemap: 'streets', theme: 'dark', opacity: 0.55 });
  });
  it('bounds custom effects and rejects corrupt settings', () => {
    expect(normalizeDisplay({ width: Infinity, glow: 9, packetSize: -4, residueSeconds: 500, pattern: 'unknown' })).toMatchObject({ width: 1.6, glow: 1, packetSize: 0.75, residueSeconds: 45, pattern: 'solid' });
    expect(loadDisplayPreferences({ getItem: () => '{bad json' })).toEqual(DEFAULT_DISPLAY);
    expect(new Set(Object.values(ROUTE_PRESETS).map((preset) => JSON.stringify(preset))).size).toBe(6);
  });
  it('uses distinct dark ink on light maps, preserving packet-kind identity', () => {
    const light = packetPalette(true);
    const dark = packetPalette(false);
    expect(new Set(Object.values(light)).size).toBe(6);
    for (const kind of Object.keys(dark) as Array<keyof typeof dark>) {
      expect(displayColor(dark[kind], true)).toBe(light[kind]);
      expect(contrast(light[kind], '#eef1ee')).toBeGreaterThan(4.5);
      expect(contrast(light[kind], '#a4cddd')).toBeGreaterThan(3);
      expect(contrast(dark[kind], '#071319')).toBeGreaterThan(4.5);
    }
  });
});

function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}
