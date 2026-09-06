import type { StyleSpecification } from 'maplibre-gl';
import type { BasemapStyle } from './preferences';

const CARTO_VECTOR_TILEJSON = 'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json';
const CARTO_GLYPHS = 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf';
const CARTO_BASEMAP_API_KEY = import.meta.env.VITE_CARTO_BASEMAP_API_KEY?.trim() ?? '';

export function cartoVectorStyle(apiKey = CARTO_BASEMAP_API_KEY, style: BasemapStyle = 'dark'): StyleSpecification {
  const color = (value: string): string => BASEMAP_COLORS[style][value] ?? value;
  return {
    version: 8,
    name: `CartoLite ${style}`,
    glyphs: withKey(CARTO_GLYPHS, apiKey),
    sources: {
      carto: {
        type: 'vector',
        url: withKey(CARTO_VECTOR_TILEJSON, apiKey),
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      }
    },
    layers: [
      {
        id: 'basemap-background',
        type: 'background',
        paint: { 'background-color': color('#0b151b') }
      },
      {
        id: 'basemap-landcover',
        type: 'fill',
        source: 'carto',
        'source-layer': 'landcover',
        paint: {
          'fill-color': [
            'match', ['get', 'class'],
            'wood', color('#142720'),
            'grass', color('#16271f'),
            color('#111d20')
          ],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.62, 10, 0.78]
        }
      },
      {
        id: 'basemap-landuse',
        type: 'fill',
        source: 'carto',
        'source-layer': 'landuse',
        minzoom: 6,
        paint: {
          'fill-color': [
            'match', ['get', 'class'],
            'residential', color('#18242a'),
            'cemetery', color('#172820'),
            'stadium', color('#1b2a22'),
            color('#142126')
          ],
          'fill-opacity': 0.62
        }
      },
      {
        id: 'basemap-water',
        type: 'fill',
        source: 'carto',
        'source-layer': 'water',
        paint: { 'fill-color': color('#071f2b'), 'fill-opacity': 0.98 }
      },
      {
        id: 'basemap-waterway',
        type: 'line',
        source: 'carto',
        'source-layer': 'waterway',
        minzoom: 7,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': color('#245061'),
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.35, 13, 1.15],
          'line-opacity': 0.72
        }
      },
      {
        id: 'basemap-country-boundary',
        type: 'line',
        source: 'carto',
        'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['==', ['get', 'maritime'], 0]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': color('#708792'),
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 9, 1.4],
          'line-opacity': 0.72
        }
      },
      {
        id: 'basemap-region-boundary',
        type: 'line',
        source: 'carto',
        'source-layer': 'boundary',
        minzoom: 3.5,
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['==', ['get', 'maritime'], 0]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': color('#4b626c'),
          'line-width': ['interpolate', ['linear'], ['zoom'], 3.5, 0.42, 10, 0.92],
          'line-opacity': 0.76,
          'line-dasharray': [2, 1.5]
        }
      },
      {
        id: 'basemap-major-roads',
        type: 'line',
        source: 'carto',
        'source-layer': 'transportation',
        minzoom: 4,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': color('#34444b'),
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            4, ['match', ['get', 'class'], ['motorway', 'trunk'], 0.52, 0.24],
            10, ['match', ['get', 'class'], ['motorway', 'trunk'], 1.45, 0.78],
            15, ['match', ['get', 'class'], ['motorway', 'trunk'], 3.5, 1.9]
          ],
          'line-opacity': 0.82
        }
      },
      {
        id: 'basemap-local-roads',
        type: 'line',
        source: 'carto',
        'source-layer': 'transportation',
        minzoom: 11,
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': color('#2a383e'),
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 16, 1.05],
          'line-opacity': 0.62
        }
      },
      {
        id: 'basemap-water-labels',
        type: 'symbol',
        source: 'carto',
        'source-layer': 'water_name',
        minzoom: 5.5,
        filter: ['has', 'name'],
        layout: {
          'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5.5, 9.5, 10, 11.5, 14, 13],
          'text-letter-spacing': 0.04,
          'text-max-width': 10,
          'text-padding': 14,
          'symbol-avoid-edges': true,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': color('#628b9b'),
          'text-halo-color': color('#08161d'),
          'text-halo-width': 1.2,
          'text-opacity': 0.84
        }
      },
      {
        id: 'basemap-country-labels',
        type: 'symbol',
        source: 'carto',
        'source-layer': 'place',
        minzoom: 2,
        maxzoom: 7,
        filter: ['==', ['get', 'class'], 'country'],
        layout: {
          'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 13.5],
          'text-letter-spacing': 0.1,
          'text-transform': 'uppercase',
          'text-padding': 12,
          'symbol-avoid-edges': true,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': color('#93a5ad'),
          'text-halo-color': color('#0b151b'),
          'text-halo-width': 1.4,
          'text-opacity': 0.78
        }
      },
      {
        id: 'basemap-region-labels',
        type: 'symbol',
        source: 'carto',
        'source-layer': 'place',
        minzoom: 3.5,
        maxzoom: 10,
        filter: ['==', ['get', 'class'], 'state'],
        layout: {
          'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3.5, 8.5, 9, 11],
          'text-letter-spacing': 0.05,
          'text-max-width': 9,
          'text-padding': 9,
          'symbol-avoid-edges': true,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': color('#899ca5'),
          'text-halo-color': color('#0b151b'),
          'text-halo-width': 1.25,
          'text-opacity': 0.76
        }
      },
      {
        id: 'basemap-city-labels',
        type: 'symbol',
        source: 'carto',
        'source-layer': 'place',
        minzoom: 3.25,
        filter: ['==', ['get', 'class'], 'city'],
        layout: {
          'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
          'text-font': ['Open Sans Regular'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            3.25, 9.5,
            10, 12.5,
            15, 14.5
          ],
          'text-max-width': 9,
          'text-padding': 10,
          'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
          'symbol-avoid-edges': true,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': color('#c1d0d6'),
          'text-halo-color': color('#0b151b'),
          'text-halo-width': 1.45,
          'text-halo-blur': 0.25,
          'text-opacity': 0.94
        }
      },
      {
        id: 'basemap-town-labels',
        type: 'symbol',
        source: 'carto',
        'source-layer': 'place',
        minzoom: 6,
        filter: ['in', ['get', 'class'], ['literal', ['town', 'village']]],
        layout: {
          'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, 8.5, 11, 10.5, 15, 12],
          'text-max-width': 9,
          'text-padding': 6,
          'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
          'symbol-avoid-edges': true,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': color('#a9bbc3'),
          'text-halo-color': color('#0b151b'),
          'text-halo-width': 1.3,
          'text-halo-blur': 0.2,
          'text-opacity': 0.9
        }
      }
    ]
  } as StyleSpecification;
}

export function cartoVectorRequestURL(url: string, apiKey = CARTO_BASEMAP_API_KEY): string {
  const key = apiKey.trim();
  if (!key) return url;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)basemaps\.cartocdn\.com$/i.test(parsed.hostname) || parsed.searchParams.has('key')) return url;
    parsed.searchParams.set('key', key);
    return parsed.toString();
  } catch {
    return url;
  }
}

function withKey(url: string, apiKey: string): string {
  const key = apiKey.trim();
  return key ? `${url}?key=${encodeURIComponent(key)}` : url;
}

// The same vector source and layer IDs stay alive through a style change.
// Colours are local; changing appearance never reloads the live map or feed.
const BASEMAP_COLORS: Record<BasemapStyle, Record<string, string>> = {
  dark: {},
  light: {
    '#0b151b': '#eef1ee', '#142720': '#d7e2d5', '#16271f': '#e0e8db', '#111d20': '#e6eae1',
    '#18242a': '#e0e2de', '#172820': '#d2dfd0', '#1b2a22': '#dae2d4', '#142126': '#e7e9e3',
    '#071f2b': '#b9d6df', '#245061': '#8cb8c6', '#708792': '#7a8e91', '#4b626c': '#97aaa9',
    '#34444b': '#a3b0ae', '#2a383e': '#bfc9c4', '#628b9b': '#477283', '#08161d': '#dbe9eb',
    '#93a5ad': '#405e66', '#899ca5': '#536a70', '#c1d0d6': '#263e48', '#a9bbc3': '#45606a',
  },
  streets: {
    '#0b151b': '#f0eadb', '#142720': '#c0d6aa', '#16271f': '#d3dfb7', '#111d20': '#e2e5c7',
    '#18242a': '#e6ddcc', '#172820': '#becfae', '#1b2a22': '#c7d2b1', '#142126': '#e7e0ce',
    '#071f2b': '#a4cddd', '#245061': '#7cb5cc', '#708792': '#9a8d76', '#4b626c': '#ad9c82',
    '#34444b': '#bf9d6a', '#2a383e': '#c9bca4', '#628b9b': '#3e7287', '#08161d': '#e8efe8',
    '#93a5ad': '#5b574c', '#899ca5': '#746853', '#c1d0d6': '#3d443c', '#a9bbc3': '#62644f',
  },
};
