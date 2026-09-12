export interface SavedView {
  center: [number, number];
  zoom: number;
}

export type ViewClass = 'desktop' | 'mobile';
export type SavedRouteWindow = 'auto' | '15m' | '1h' | '6h' | '24h';
export type BasemapStyle = 'dark' | 'light' | 'streets';
export type InterfaceTheme = 'map' | 'dark' | 'light';

export interface UiPreferences {
  routes: boolean;
  heatmap: boolean;
  clusters: boolean;
  hillshade: boolean;
  terrain3D: boolean;
  buildings: boolean;
  terrainExaggeration: number;
  terrainPitch: number;
  terrainBearing: number;
  routeWindow: SavedRouteWindow;
  legendExpanded: boolean;
  basemap: BasemapStyle;
  theme: InterfaceTheme;
  mapLabels: boolean;
  nodeLabels: boolean;
  roads: boolean;
  livePackets: boolean;
  routeOpacity: number;
  relief: number;
}

const VIEW_STORAGE_PREFIX = 'cartolite-server:view:v1';
export const UI_STORAGE_KEY = 'cartolite-server:ui:v1';
export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  routes: false,
  heatmap: true,
  clusters: true,
  hillshade: false,
  terrain3D: false,
  buildings: false,
  terrainExaggeration: 1,
  terrainPitch: 50,
  terrainBearing: 0,
  routeWindow: 'auto',
  legendExpanded: false,
  basemap: 'dark',
  theme: 'map',
  mapLabels: true,
  nodeLabels: true,
  roads: true,
  livePackets: true,
  routeOpacity: 0.8,
  relief: 0.75
};

export function viewClass(
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
): ViewClass {
  return viewportWidth <= 900 || viewportHeight <= 520 ? 'mobile' : 'desktop';
}

export function viewStorageKey(kind: ViewClass): string {
  return `${VIEW_STORAGE_PREFIX}:${kind}`;
}

export function loadSavedView(storage: Storage, kind: ViewClass): SavedView | null {
  try {
    const value = JSON.parse(storage.getItem(viewStorageKey(kind)) ?? 'null') as {
      center?: unknown;
      zoom?: unknown;
    } | null;
    if (!value || !Array.isArray(value.center) || value.center.length !== 2 || typeof value.zoom !== 'number') return null;
    const lng = Number(value.center[0]);
    const lat = Number(value.center[1]);
    const zoom = Number(value.zoom);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)
      || lng < -180 || lng > 180 || lat < -85.051129 || lat > 85.051129 || zoom < 1 || zoom > 18) return null;
    return { center: [lng, lat], zoom };
  } catch {
    return null;
  }
}

export function saveView(storage: Storage, kind: ViewClass, view: SavedView): void {
  try {
    storage.setItem(viewStorageKey(kind), JSON.stringify(view));
  } catch {
    // Local persistence is optional; private browsing may reject it.
  }
}

export function loadUiPreferences(storage: Storage): UiPreferences {
  try {
    const value = JSON.parse(storage.getItem(UI_STORAGE_KEY) ?? 'null') as Partial<UiPreferences> | null;
    if (!value) return { ...DEFAULT_UI_PREFERENCES };
    const routeWindow = isSavedRouteWindow(value.routeWindow) ? value.routeWindow : DEFAULT_UI_PREFERENCES.routeWindow;
    return {
      routes: typeof value.routes === 'boolean' ? value.routes : DEFAULT_UI_PREFERENCES.routes,
      heatmap: typeof value.heatmap === 'boolean' ? value.heatmap : DEFAULT_UI_PREFERENCES.heatmap,
      clusters: typeof value.clusters === 'boolean' ? value.clusters : DEFAULT_UI_PREFERENCES.clusters,
      hillshade: typeof value.hillshade === 'boolean' ? value.hillshade : DEFAULT_UI_PREFERENCES.hillshade,
      terrain3D: typeof value.terrain3D === 'boolean' ? value.terrain3D : DEFAULT_UI_PREFERENCES.terrain3D,
      buildings: typeof value.buildings === 'boolean' ? value.buildings : Boolean(value.terrain3D),
      terrainExaggeration: savedRange(value.terrainExaggeration, 1, 0.5, 2),
      terrainPitch: savedRange(value.terrainPitch, 50, 0, 65),
      terrainBearing: savedRange(value.terrainBearing, 0, -180, 180),
      routeWindow,
      legendExpanded: typeof value.legendExpanded === 'boolean'
        ? value.legendExpanded
        : DEFAULT_UI_PREFERENCES.legendExpanded,
      basemap: value.basemap === 'light' || value.basemap === 'streets' ? value.basemap : 'dark',
      theme: value.theme === 'dark' || value.theme === 'light' ? value.theme : 'map',
      mapLabels: typeof value.mapLabels === 'boolean' ? value.mapLabels : true,
      nodeLabels: typeof value.nodeLabels === 'boolean' ? value.nodeLabels : true,
      roads: typeof value.roads === 'boolean' ? value.roads : true,
      livePackets: typeof value.livePackets === 'boolean' ? value.livePackets : true,
      routeOpacity: savedAmount(value.routeOpacity, 0.8, 0.2),
      relief: savedAmount(value.relief, 0.75, 0)
    };
  } catch {
    return { ...DEFAULT_UI_PREFERENCES };
  }
}

export function saveUiPreferences(storage: Storage, preferences: UiPreferences): void {
  try {
    storage.setItem(UI_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Local persistence is optional; private browsing may reject it.
  }
}

function isSavedRouteWindow(value: unknown): value is SavedRouteWindow {
  return value === 'auto' || value === '15m' || value === '1h' || value === '6h' || value === '24h';
}

function savedAmount(value: unknown, fallback: number, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, Math.min(1, value)) : fallback;
}

function savedRange(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
