import { layoutBounds, type NetgraphLayout } from './layout';

export const REGION_LAYOUT_KEY = 'cartolite:netgraph-layout:v1';
export interface RegionLayoutPreferences {
  spacing: number;
  offsets: Record<string, { x: number; y: number }>;
  regions: string[] | null;
  routes: boolean;
}
const code = (value: unknown): value is string => typeof value === 'string' && /^[\w.-]{1,48}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
export function normalizeRegionLayout(value: unknown): RegionLayoutPreferences {
  const v = value && typeof value === 'object' ? value as Partial<RegionLayoutPreferences> : {};
  const offsets: RegionLayoutPreferences['offsets'] = Object.create(null);
  if (v.offsets && typeof v.offsets === 'object') for (const [key, point] of Object.entries(v.offsets).slice(0, 4096)) {
    if (code(key) && point && Number.isFinite(point.x) && Number.isFinite(point.y)
      && Math.abs(point.x) <= 1_000_000 && Math.abs(point.y) <= 1_000_000) offsets[key] = { x: point.x, y: point.y };
  }
  return { spacing: typeof v.spacing === 'number' && Number.isFinite(v.spacing) ? Math.max(1, Math.min(4, v.spacing)) : 1,
    offsets, regions: Array.isArray(v.regions) ? [...new Set(v.regions.filter(code))].slice(0, 4096) : null, routes: v.routes !== false };
}
export function loadRegionLayout(): RegionLayoutPreferences {
  try { return normalizeRegionLayout(JSON.parse(localStorage.getItem(REGION_LAYOUT_KEY) ?? 'null')); }
  catch { return normalizeRegionLayout(null); }
}
export function saveRegionLayout(value: RegionLayoutPreferences): boolean {
  try { localStorage.setItem(REGION_LAYOUT_KEY, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function regionOffsetLimit(layout: NetgraphLayout): number {
  const b = layout.bounds;
  return Math.max(100, Math.hypot(b.maxX - b.minX, b.maxY - b.minY));
}
/** Translate whole regions; never scale their internal nodes or modify topology. */
export function arrangeRegions(base: NetgraphLayout, preferences: RegionLayoutPreferences): NetgraphLayout {
  if (preferences.spacing === 1 && !Object.keys(preferences.offsets).length) return base;
  const limit = regionOffsetLimit(base);
  const shifts = new Map<string, { x: number; y: number }>();
  const areas = base.areas.map(area => {
    const offset = preferences.offsets[area.code];
    const x = (area.x + Math.max(-limit, Math.min(limit, offset?.x ?? 0))) * preferences.spacing;
    const y = (area.y + Math.max(-limit, Math.min(limit, offset?.y ?? 0))) * preferences.spacing;
    shifts.set(area.code, { x: x - area.x, y: y - area.y });
    return { ...area, x, y };
  });
  const positions = new Map([...base.positions].map(([id, p]) => {
    const shift = shifts.get(p.areaCode)!;
    return [id, { ...p, x: p.x + shift.x, y: p.y + shift.y }];
  }));
  return { ...base, positions, areas, bounds: layoutBounds(positions, areas) };
}
