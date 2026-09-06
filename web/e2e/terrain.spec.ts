import { expect, test, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import type { StateV2 } from '../src/types';

// Continuous trace screencasts stall software-rendered terrain readback. Keep
// the explicit scene images below and the normal failure screenshot instead.
test.use({ trace: 'off' });
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'wait' }); });

test('3D enables Topo and projects live and reduced-motion traffic over synthetic relief', { tag: '@terrain' }, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'terrain camera and relief acceptance runs on desktop');
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const tiles = await installFixture(page);
  await page.goto('/');
  const map = page.locator('#map');
  const packets = page.locator('#packet-canvas');
  await expect(map).toHaveAttribute('data-render-state', 'idle', { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('data-fixture-stream', 'ready');
  await expect(page.locator('#hillshade-button')).toHaveAttribute('aria-pressed', 'false');
  await emitPacket(page);
  await expect(packets).toHaveAttribute('data-projection-mode', 'flat');
  await expect(packets).toHaveAttribute('data-projection-samples', '2');
  await page.locator('#hillshade-button').click();
  await expect.poll(() => tiles.count, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(map).toHaveAttribute('data-render-state', 'idle', { timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath('synthetic-relief-topo.png') });
  await page.locator('#hillshade-button').click();
  await page.locator('#terrain-button').click();
  await expect(page.locator('#hillshade-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(map).toHaveAttribute('data-terrain3d', 'true');
  await expect(map).toHaveAttribute('data-route-surface', 'terrain');
  await expect(map).toHaveAttribute('data-render-state', 'idle', { timeout: 15_000 });
  await emitPacket(page);
  await expect(packets).toHaveAttribute('data-projection-mode', 'terrain');
  await expect(packets).toHaveAttribute('data-projection-samples', '17');
  await expect.poll(() => packets.getAttribute('data-test-ground-rings').then(Number)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('synthetic-relief-3d.png') });

  // A native right-drag rotates and pitches the scene, then the next packet still follows it.
  await page.mouse.move(740, 450);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(780, 460, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await expect(map).toHaveAttribute('data-render-state', 'idle', { timeout: 15_000 });
  await emitPacket(page);
  await expect(packets).toHaveAttribute('data-projection-samples', '17');
  const wakesBeforeStatic = Number(await packets.getAttribute('data-wakes-scheduled'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await emitPacket(page);
  await expect(packets).toHaveAttribute('data-motion-mode', 'static');
  await expect.poll(() => packets.getAttribute('data-wakes-scheduled').then(Number)).toBeGreaterThan(wakesBeforeStatic);
  const beforeRead = await packets.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height, hidden: document.hidden, mode: { ...canvas.dataset }, context: canvas.getContext('2d')!.getContextAttributes() };
  });
  await testInfo.attach('static-before-read', { body: JSON.stringify(beforeRead), contentType: 'application/json' });
  const pixels = await packets.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const started = performance.now();
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index]! > 0) painted += 1;
    return { painted, elapsedMS: performance.now() - started };
  });
  await testInfo.attach('static-pixels', { body: JSON.stringify(pixels), contentType: 'application/json' });
  expect(pixels.painted, JSON.stringify(beforeRead)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('synthetic-relief-rotated-static.png') });
  await page.locator('#terrain-button').click();
  await expect(map).toHaveAttribute('data-terrain3d', 'false');
  await expect(map).toHaveAttribute('data-route-surface', 'flat');
  await expect(page.locator('#hillshade-button')).toHaveAttribute('aria-pressed', 'true');

  // Repair the older saved combination on startup as well as on a user click.
  await page.evaluate(() => localStorage.setItem('cartolite-server:ui:v1', JSON.stringify({
    routes: false, heatmap: false, clusters: false, terrain3D: true, hillshade: false,
  })));
  await page.reload();
  await expect(map).toHaveAttribute('data-terrain3d', 'true');
  await expect(page.locator('#hillshade-button')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cartolite-server:ui:v1')!).hillshade)).toBe(true);
  expect(errors).toEqual([]);
});

test('Netgraph emphasizes traffic through an inspected node without losing hops', { tag: '@terrain' }, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'selection emphasis is shared across viewports');
  await installFixture(page);
  await page.goto('/netgraph/');
  const stage = page.locator('#netgraph-stage');
  await expect(stage).toHaveAttribute('data-render-state', 'idle');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-stream', 'ready');
  await page.locator('#find-button').click();
  await page.locator('#node-search').fill('Summit');
  await page.locator('.node-search-result').first().click();
  await expect(stage).toHaveAttribute('data-selected-node-id', 'summit');
  await emitPacket(page);
  await expect(stage).toHaveAttribute('data-last-packet-hops', '2');
  await expect(stage).toHaveAttribute('data-focused-packet-emphasis', '1.3');
  await page.screenshot({ path: testInfo.outputPath('netgraph-inspected-traffic.png') });
  await page.keyboard.press('Escape');
  await expect(stage).toHaveAttribute('data-selected-node-id', '');
  await expect(stage).toHaveAttribute('data-focused-packet-emphasis', '1');
});

async function installFixture(page: Page): Promise<{ count: number }> {
  const now = Date.now();
  const nodes = [
    { id: 'valley', label: 'Valley Fixture', lng: -115.76, lat: 51.1 },
    { id: 'summit', label: 'Summit Fixture', lng: -115.5, lat: 51.16 },
    { id: 'ridge', label: 'Ridge Fixture', lng: -115.29, lat: 51.08 },
  ].map((node) => ({ ...node, role: 'repeater' as const, observer: false, lastSeen: now }));
  const state: StateV2 = {
    schemaVersion: 2, bootId: 'synthetic-terrain', seq: 0, serverTime: now,
    status: { feed: 'connected', activity: 'active', lastPacketAt: now, dropped: 0, version: 'test', gitSha: 'synthetic' },
    map: { center: [-115.52, 51.12], zoom: 10.4 }, nodes,
    routes: nodes.slice(1).map((node, index) => ({
      id: `hop-${index}`, fromId: nodes[index]!.id, toId: node.id,
      packetCount: 1, lastHeard: now, intensity: 1, lastKind: 'Text', traffic: 1,
    })),
  };
  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.addInitScript(({ center, zoom }) => {
    // Runs only on Actions. No elevation images or live data are stored in the repository.
    if (!localStorage.getItem('cartolite-server:ui:v1')) localStorage.setItem('cartolite-server:ui:v1', JSON.stringify({
      routes: true, heatmap: false, clusters: false, hillshade: false, terrain3D: false,
    }));
    localStorage.setItem('cartolite-server:view:v1:desktop', JSON.stringify({ center, zoom }));
    class FixtureStream extends EventTarget {
      static CLOSED = 2;
      readyState = 1;
      onopen: ((event: Event) => void) | null = null;
      private receive = (event: Event) => this.dispatchEvent(new MessageEvent('packet', { data: JSON.stringify((event as CustomEvent).detail) }));
      constructor() {
        super();
        window.addEventListener('fixture-packet', this.receive);
        setTimeout(() => { this.onopen?.(new Event('open')); document.documentElement.dataset.fixtureStream = 'ready'; }, 0);
      }
      close(): void { this.readyState = 2; window.removeEventListener('fixture-packet', this.receive); }
    }
    Object.defineProperty(window, 'EventSource', { value: FixtureStream });
    // Pixel assertions must not wait on a readback of the busy terrain GPU.
    // This fixture's 2D canvases use CPU backing stores; MapLibre WebGL and the
    // separate performance suite keep their normal graphics contexts.
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === '2d') args[0] = { ...args[0], willReadFrequently: true };
      return Reflect.apply(getContext, this, [type, ...args]);
    } as typeof getContext;
    const transform = CanvasRenderingContext2D.prototype.transform;
    CanvasRenderingContext2D.prototype.transform = function (...args): void {
      if (this.canvas.id === 'packet-canvas') this.canvas.dataset.testGroundRings = String(Number(this.canvas.dataset.testGroundRings ?? 0) + 1);
      transform.apply(this, args);
    };
  }, state.map);
  const tiles = { count: 0 };
  const images = new Map<string, Buffer>();
  await page.route('https://tiles.mapterhorn.com/tilejson.json', (route) => route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: {
    tilejson: '3.0.0', tiles: ['https://tiles.mapterhorn.com/synthetic/{z}/{x}/{y}.png'], minzoom: 0, maxzoom: 11, attribution: 'Synthetic relief fixture',
  } }));
  await page.route('https://tiles.mapterhorn.com/synthetic/**', async (route) => {
    const match = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(route.request().url())!;
    const key = match[0];
    const png = images.get(key) ?? terrainTile(Number(match[1]), Number(match[2]), Number(match[3]));
    images.set(key, png);
    tiles.count += 1;
    await route.fulfill({ headers: { 'access-control-allow-origin': '*' }, contentType: 'image/png', body: png });
  });
  return tiles;
}

// A dependency-free PNG fixture, generated in the Actions test process so tile
// creation never competes with the browser's terrain rendering or GPU readback.
function terrainTile(z: number, x: number, y: number): Buffer {
  const size = 512;
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let row = 0; row < size; row += 1) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (row + 0.5) / size) / 2 ** z))) * 180 / Math.PI;
    for (let column = 0; column < size; column += 1) {
      const lng = (x + (column + 0.5) / size) / 2 ** z * 360 - 180;
      const value = 32768 + 600 + 2100 * Math.exp(-(((lng + 115.5) / 0.08) ** 2 + ((lat - 51.16) / 0.055) ** 2))
        + 1400 * Math.exp(-(((lng + 115.33) / 0.06) ** 2 + ((lat - 51.08) / 0.035) ** 2));
      const offset = row * (size * 4 + 1) + 1 + column * 4;
      pixels.set([Math.floor(value / 256), Math.floor(value) % 256, Math.floor(value * 256) % 256, 255], offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const content = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, content, checksum]);
}

async function emitPacket(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seq = Number(document.documentElement.dataset.fixtureSeq ?? 0) + 1;
    document.documentElement.dataset.fixtureSeq = String(seq);
    window.dispatchEvent(new CustomEvent('fixture-packet', { detail: {
      seq, id: `terrain-${seq}`, at: Date.now(), payloadType: 'Text', mode: 'route',
      segments: [{ routeId: 'hop-0', fromId: 'valley', toId: 'summit' }, { routeId: 'hop-1', fromId: 'summit', toId: 'ridge' }],
    } }));
  });
}
