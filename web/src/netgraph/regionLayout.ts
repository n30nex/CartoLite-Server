import type { RouteV2 } from '../types';
import { layoutBounds, type NetgraphLayout } from './layout';

export const REGION_LAYOUT_KEY = 'cartolite:netgraph-layout:v1';
export interface RegionLayoutPreferences {
  spacing: number;
  centres: Record<string, { x: number; y: number }>;
  regions: string[] | null;
  routes: boolean;
}
const code = (value: unknown): value is string => typeof value === 'string' && /^[\w.-]{1,48}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
export function normalizeRegionLayout(value: unknown): RegionLayoutPreferences {
  const v = value && typeof value === 'object' ? value as Partial<RegionLayoutPreferences> : {};
  const centres: RegionLayoutPreferences['centres'] = Object.create(null);
  if (v.centres && typeof v.centres === 'object') for (const [key, point] of Object.entries(v.centres).slice(0, 4096)) {
    if (code(key) && point && Number.isFinite(point.x) && Number.isFinite(point.y)
      && Math.abs(point.x) <= 1_000_000 && Math.abs(point.y) <= 1_000_000) centres[key] = { x: point.x, y: point.y };
  }
  return { spacing: typeof v.spacing === 'number' && Number.isFinite(v.spacing) ? Math.max(1, Math.min(4, v.spacing)) : 1,
    centres, regions: Array.isArray(v.regions) ? [...new Set(v.regions.filter(code))].slice(0, 4096) : null, routes: v.routes !== false };
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
  if (preferences.spacing === 1 && !Object.keys(preferences.centres).length) return base;
  const limit = regionOffsetLimit(base);
  const shifts = new Map<string, { x: number; y: number }>();
  const areas = base.areas.map(area => {
    const centre = preferences.centres[area.code] ?? area;
    const x = Math.max(area.x - limit, Math.min(area.x + limit, centre.x)) * preferences.spacing;
    const y = Math.max(area.y - limit, Math.min(area.y + limit, centre.y)) * preferences.spacing;
    shifts.set(area.code, { x: x - area.x, y: y - area.y });
    return { ...area, x, y };
  });
  const positions = new Map([...base.positions].map(([id, p]) => {
    const shift = shifts.get(p.areaCode)!;
    return [id, { ...p, x: p.x + shift.x, y: p.y + shift.y }];
  }));
  return { ...base, positions, areas, bounds: layoutBounds(positions, areas) };
}

/** Connectivity of the visible regions; hidden regions cannot bridge components. */
export function regionComponents(layout: NetgraphLayout, routes: Iterable<RouteV2>, regions: ReadonlySet<string>): Map<string, string> {
  const parents = new Map([...layout.positions.values()].filter(p => regions.has(p.areaCode)).map(p => [p.id, p.id]));
  const root = (id: string): string => {
    let current = id;
    while (parents.get(current)! !== current) { parents.set(current, parents.get(parents.get(current)!)!); current = parents.get(current)!; }
    return current;
  };
  for (const route of routes) if (parents.has(route.fromId) && parents.has(route.toId)) parents.set(root(route.fromId), root(route.toId));
  for (const id of parents.keys()) parents.set(id, root(id));
  return parents;
}
