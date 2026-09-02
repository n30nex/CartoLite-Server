import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_UI_PREFERENCES,
  loadSavedView,
  loadUiPreferences,
  saveUiPreferences,
  saveView,
  UI_STORAGE_KEY,
  viewClass,
  viewStorageKey
} from './preferences';

describe('viewport preferences', () => {
  beforeEach(() => localStorage.clear());

  it('uses separate versioned storage for desktop and mobile views', () => {
    const desktop = { center: [-0.13, 51.51] as [number, number], zoom: 9 };
    const mobile = { center: [151.21, -33.87] as [number, number], zoom: 7 };
    saveView(localStorage, 'desktop', desktop);
    saveView(localStorage, 'mobile', mobile);

    expect(viewStorageKey('desktop')).not.toBe(viewStorageKey('mobile'));
    expect(loadSavedView(localStorage, 'desktop')).toEqual(desktop);
    expect(loadSavedView(localStorage, 'mobile')).toEqual(mobile);
  });

  it('uses the compact layout for phones and portrait tablets without shrinking tablet landscape', () => {
    expect(viewClass(390, 844)).toBe('mobile');
    expect(viewClass(620, 900)).toBe('mobile');
    expect(viewClass(844, 390)).toBe('mobile');
    expect(viewClass(800, 1280)).toBe('mobile');
    expect(viewClass(1280, 800)).toBe('desktop');
    expect(viewClass(1280, 720)).toBe('desktop');
  });

  it('fails closed on malformed or out-of-bounds saved views', () => {
    localStorage.setItem(viewStorageKey('mobile'), JSON.stringify({ center: [0, 0], zoom: 20 }));
    expect(loadSavedView(localStorage, 'mobile')).toBeNull();
  });

  it('accepts saved views across the Web Mercator world', () => {
    const views = [
      { center: [-122.42, 37.77] as [number, number], zoom: 5 },
      { center: [18.42, -33.93] as [number, number], zoom: 5 },
      { center: [139.69, 35.68] as [number, number], zoom: 5 },
    ];
    for (const view of views) {
      localStorage.setItem(viewStorageKey('desktop'), JSON.stringify(view));
      expect(loadSavedView(localStorage, 'desktop')).toEqual(view);
    }
  });

  it('remembers privacy-safe layer, route-window, and legend settings', () => {
    const preferences = {
      routes: true,
      heatmap: false,
      clusters: false,
      hillshade: true,
      terrain3D: true,
      routeWindow: '24h' as const,
      legendExpanded: true
    };
    saveUiPreferences(localStorage, preferences);
    expect(loadUiPreferences(localStorage)).toEqual(preferences);
  });

  it('uses safe defaults for malformed UI preferences', () => {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ routes: 'yes', routeWindow: 'forever' }));
    expect(loadUiPreferences(localStorage)).toEqual(DEFAULT_UI_PREFERENCES);
  });
});
