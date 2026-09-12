import { deflateSync } from 'node:zlib';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import type { Page } from '@playwright/test';
import type { StateV2 } from '../src/types';

export const visualCenter: [number, number] = [-80.35, 43.45];
const cors = { 'access-control-allow-origin': '*' };
const layers = ['landcover', 'landuse', 'water', 'waterway', 'boundary', 'transportation', 'water_name', 'place', 'building'];

export async function visualFixture(page: Page, zoom = 10.2): Promise<void> {
  const now = Date.now();
  const nodes = [
    { id: 'visual-a', label: 'Visual Alpha', lng: visualCenter[0], lat: visualCenter[1] },
    { id: 'visual-b', label: 'Visual Bravo', lng: -80.23, lat: 43.51 },
    { id: 'visual-c', label: 'Visual Charlie', lng: -80.40, lat: 43.58 },
  ].map((node) => ({ ...node, role: 'repeater' as const, observer: false, lastSeen: now }));
  const state: StateV2 = {
    schemaVersion: 2, bootId: 'visual-fixture', seq: 0, serverTime: now,
    status: { feed: 'connected', activity: 'active', dropped: 0, version: 'test', gitSha: 'synthetic' },
    map: { center: visualCenter, zoom }, nodes,
    routes: [{ id: 'visual-hop', fromId: 'visual-a', toId: 'visual-b', packetCount: 4, lastHeard: now, intensity: 2, lastKind: 'Text', traffic: 4 }],
  };
  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.route('**/api/config', (route) => route.fulfill({ json: { schemaVersion: 1, basemap: { provider: 'openfreemap' } } }));
  await page.addInitScript(({ center, zoom }) => {
    const ui = { routes: true, heatmap: false, clusters: false, hillshade: false, terrain3D: false, buildings: false, mapLabels: false, nodeLabels: false, livePackets: true, routeWindow: '24h' };
    for (const key of ['cartolite:ui:v1', 'cartolite-server:ui:v1']) if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(ui));
    for (const prefix of ['cartolite:view:v3', 'cartolite-server:view:v1']) for (const kind of ['desktop', 'mobile']) {
      if (!localStorage.getItem(`${prefix}:${kind}`)) localStorage.setItem(`${prefix}:${kind}`, JSON.stringify({ center, zoom }));
    }
    class FixtureStream extends EventTarget {
      static CLOSED = 2;
      readyState = 1;
      onopen: ((event: Event) => void) | null = null;
      private receive = (event: Event) => this.dispatchEvent(new MessageEvent('packet', { data: JSON.stringify((event as CustomEvent).detail) }));
      constructor() {
        super(); window.addEventListener('visual-packet', this.receive);
        setTimeout(() => { this.onopen?.(new Event('open')); document.documentElement.dataset.fixtureStream = 'ready'; }, 0);
      }
      close(): void { this.readyState = 2; window.removeEventListener('visual-packet', this.receive); }
    }
    Object.defineProperty(window, 'EventSource', { value: FixtureStream });
  }, { center: visualCenter, zoom });

  const tilejson = { tilejson: '3.0.0', minzoom: 0, maxzoom: 14, tiles: ['https://tiles.openfreemap.org/fixture/{z}/{x}/{y}.pbf'], vector_layers: layers.map((id) => ({ id, fields: {} })) };
  await page.route('https://tiles.openfreemap.org/planet', (route) => route.fulfill({ headers: cors, json: tilejson }));
  await page.route(/https:\/\/[^/]*basemaps\.cartocdn\.com\/vector\/carto\.streets\/v1\/tiles\.json/, (route) => route.fulfill({ headers: cors, json: tilejson }));
  await page.route(/https:\/\/tiles\.openfreemap\.org\/fixture\/\d+\/\d+\/\d+\.pbf/, (route) => {
    const parts = /fixture\/(\d+)\/(\d+)\/(\d+)/.exec(route.request().url())!;
    return route.fulfill({ headers: cors, contentType: 'application/x-protobuf', body: buildingTile(Number(parts[1]), Number(parts[2]), Number(parts[3])) });
  });
  await page.route('https://tiles.mapterhorn.com/tilejson.json', (route) => route.fulfill({ headers: cors, json: { tilejson: '3.0.0', tiles: ['https://tiles.mapterhorn.com/fixture/{z}/{x}/{y}.webp'], minzoom: 0, maxzoom: 14, encoding: 'terrarium' } }));
  const dem = flatTerrain();
  await page.route('https://tiles.mapterhorn.com/fixture/**', (route) => route.fulfill({ headers: cors, contentType: 'image/png', body: dem }));
}

export async function visualPacket(page: Page, seq: number, kind = 'Advert'): Promise<void> {
  await page.evaluate(({ seq, kind }) => window.dispatchEvent(new CustomEvent('visual-packet', { detail: {
    seq, id: `visual-${seq}`, at: Date.now(), payloadType: kind, mode: 'route',
    segments: [{ routeId: 'visual-hop', fromId: 'visual-a', toId: 'visual-b' }],
  } })), { seq, kind });
}

function buildingTile(z: number, x: number, y: number): Buffer {
  const scale = 2 ** z;
  const px = (visualCenter[0] + 180) / 360 * scale;
  const py = (1 - Math.log(Math.tan(Math.PI / 4 + visualCenter[1] * Math.PI / 360)) / Math.PI) / 2 * scale;
  const tx = Math.round((px - x) * 4096); const ty = Math.round((py - y) * 4096);
  const tile = Object.fromEntries(layers.map((name) => [name, { features: [] as Array<{ id: number; type: number; tags: Record<string, string | number | boolean>; geometry: number[][][] }> }]));
  tile.water!.features.push({ id: 2, type: 3, tags: { class: 'ocean' }, geometry: [[[0, 0], [2048, 0], [2048, 4096], [0, 4096], [0, 0]]] });
  if (Math.floor(px) === x && Math.floor(py) === y) {
    tile.building!.features.push({ id: 1, type: 3, tags: { render_height: 100, render_min_height: 0, hide_3d: false }, geometry: [[[tx - 80, ty - 80], [tx + 80, ty - 80], [tx + 80, ty + 80], [tx - 80, ty + 80], [tx - 80, ty - 80]]] });
  }
  return Buffer.from(fromGeojsonVt(tile, { version: 2 }));
}

function flatTerrain(): Buffer {
  const size = 128;
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) pixels.set([128, 0, 0, 255], y * (size * 4 + 1) + 1 + x * 4);
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}
function pngChunk(type: string, data: Buffer): Buffer {
  const content = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
  for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, content, checksum]);
}
