import { expect, test } from '@playwright/test';
import { visualCenter, visualFixture } from './visualFixtures';
import { openMapOptions } from './mapControls';
import type { NodeV2, RouteV2, StateV2 } from '../src/types';

test.use({ trace: 'off', screenshot: 'off' });

test('keeps close 3D inspection responsive with 7000 retained routes', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop terrain scale gate');
  await visualFixture(page, 15);
  const now = Date.now();
  const nodes: NodeV2[] = Array.from({ length: 4000 }, (_, i) => ({
    id: `far-${i}`, label: `Remote ${i}`, role: 'repeater', observer: false,
    lng: -123 + (i % 40) / 1000, lat: 49 + Math.floor(i / 40) / 1000, lastSeen: now,
  }));
  nodes.push(
    { id: 'local-a', label: 'Local Alpha', role: 'repeater', observer: false, lng: visualCenter[0], lat: visualCenter[1], lastSeen: now },
    { id: 'local-b', label: 'Local Bravo', role: 'repeater', observer: false, lng: visualCenter[0] + 0.003, lat: visualCenter[1] + 0.003, lastSeen: now },
  );
  const routes: RouteV2[] = Array.from({ length: 6999 }, (_, i) => ({
    id: `far-route-${i}`, fromId: `far-${i % 4000}`, toId: `far-${(i + 1 + Math.floor(i / 4000)) % 4000}`,
    packetCount: 1, lastHeard: now, intensity: 1, lastKind: 'Advert', traffic: 1,
  }));
  routes.push({ id: 'local-route', fromId: 'local-a', toId: 'local-b', packetCount: 1, lastHeard: now, intensity: 1, lastKind: 'Text', traffic: 1 });
  const state: StateV2 = { schemaVersion: 2, bootId: 'terrain-scale', seq: 0, serverTime: now,
    status: { feed: 'connected', activity: 'active', dropped: 0, version: 'test', gitSha: 'synthetic' },
    map: { center: visualCenter, zoom: 15 }, nodes, routes };
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.goto('/');
  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-exact-routes-ready', 'true', { timeout: 10000 });
  await openMapOptions(page);
  await page.locator('#terrain-button').click();
  await expect(map).toHaveAttribute('data-camera-moving', 'false');
  await expect(map).toHaveAttribute('data-buildings-loaded', 'true', { timeout: 10000 });
  await expect.poll(() => map.getAttribute('data-route-terrain-samples').then(Number)).toBeGreaterThan(0);
  expect(Number(await map.getAttribute('data-route-terrain-samples')), 'distant routes must not request terrain projection').toBeLessThan(100);
  expect(Number(await map.getAttribute('data-route-mesh-upload-ms')), 'close terrain mesh work must stay within 100 ms').toBeLessThan(100);
  expect(Number(await map.getAttribute('data-route-mesh-duration-ms')), 'the sparse close-view mesh must arrive within one second').toBeLessThan(1000);
  await expect(map).toHaveAttribute('data-eligible-routes', '7000');
  await expect(page.locator('#map-notice')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: info.outputPath('terrain-scale-close.png') });
});

test('keeps controls responsive while preparing a dense 7000-route terrain mesh', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop dense terrain gate');
  await visualFixture(page, 13);
  const now = Date.now();
  const nodes: NodeV2[] = Array.from({ length: 400 }, (_, i) => ({
    id: `city-${i}`, label: `City ${i}`, role: 'repeater', observer: false,
    lng: visualCenter[0] + Math.cos(i * 2.399963) * 0.018,
    lat: visualCenter[1] + Math.sin(i * 2.399963) * 0.012, lastSeen: now,
  }));
  const routes: RouteV2[] = Array.from({ length: 7000 }, (_, i) => ({
    id: `city-route-${i}`, fromId: `city-${i % 400}`, toId: `city-${(i + 1 + Math.floor(i / 400)) % 400}`,
    packetCount: 1, lastHeard: now, intensity: 1, lastKind: 'Text', traffic: 1,
  }));
  const state: StateV2 = { schemaVersion: 2, bootId: 'dense-terrain', seq: 0, serverTime: now,
    status: { feed: 'connected', activity: 'active', dropped: 0, version: 'test', gitSha: 'synthetic' },
    map: { center: visualCenter, zoom: 13 }, nodes, routes };
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.goto('/');
  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-exact-routes-ready', 'true', { timeout: 10000 });
  await openMapOptions(page);
  await page.locator('#routes-button').click();
  const terrainStarted = Date.now();
  await page.locator('#terrain-button').click();
  await page.keyboard.press('Escape');
  await expect(map).toHaveAttribute('data-render-state', 'idle', { timeout: 10000 });
  await expect(map).toHaveAttribute('data-camera-moving', 'false');
  await expect(map).toHaveAttribute('data-buildings-loaded', 'true');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(Date.now() - terrainStarted, 'the cold terrain scene must meet the startup budget').toBeLessThan(10000);
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map .maplibregl-canvas')!;
    const gl = canvas.getContext('webgl2')!;
    const records: Array<{ call: string; kind: string; count: number; before: number; draw: number; viewport: number[]; screen: boolean }> = [];
    const restore: Array<() => void> = [];
    const kinds = new WeakMap<WebGLProgram, string>();
    const target = gl as unknown as Record<string, (...args: number[]) => unknown>;
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const original = target[name]!;
      target[name] = (...args: number[]): unknown => {
        if (records.length >= 3) return original.apply(gl, args);
        const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
        let kind = kinds.get(program);
        if (!kind) {
          const shader = (gl.getAttachedShaders(program) ?? []).map(s => gl.getShaderSource(s) ?? '').join('\n');
          kind = shader.includes('u_maximum_band') ? 'history' : /circle_radius|u_circle/.test(shader) ? 'circles'
            : /hillshade/.test(shader) ? 'hillshade' : /extrusion/.test(shader) ? 'buildings'
            : /u_dem|u_depth/.test(shader) ? 'terrain' : 'map';
          kinds.set(program, kind);
        }
        if (kind !== 'history') return original.apply(gl, args);
        const pixel = new Uint8Array(4);
        const start = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); const ready = performance.now();
        const result = original.apply(gl, args); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        records.push({ call: name, kind, count: name.includes('Elements') ? args[1]! : args[2]!,
          before: ready - start, draw: performance.now() - ready,
          viewport: Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array), screen: gl.getParameter(gl.FRAMEBUFFER_BINDING) === null });
        return result;
      };
      restore.push(() => { target[name] = original; });
    }
    (window as unknown as { denseGpuProbe: { records: typeof records; restore(): void } }).denseGpuProbe = { records, restore: () => restore.forEach(fn => fn()) };
  });
  await openMapOptions(page);
  await page.locator('#routes-button').click();
  await page.keyboard.press('Escape');
  const loopTiming = await page.evaluate(() => new Promise<{ duration: number; turns: number[]; longTasks: number[]; visible: boolean; focused: boolean }>(resolve => {
    const start = performance.now();
    const turns: number[] = []; const longTasks: number[] = [];
    let previous = start;
    const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
    observer.observe({ entryTypes: ['longtask'] });
    const tick = (): void => {
      const now = performance.now(); turns.push(now - previous); previous = now;
      if (turns.length === 50) {
        observer.disconnect();
        resolve({ duration: now - start, turns, longTasks, visible: !document.hidden, focused: document.hasFocus() });
      } else setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  }));
  const gpuDraws = await page.evaluate(() => {
    const probe = (window as unknown as { denseGpuProbe: { records: unknown[]; restore(): void } }).denseGpuProbe;
    probe.restore(); return probe.records;
  });
  await info.attach('dense-gpu-draws', { body: JSON.stringify(gpuDraws), contentType: 'application/json' });
  await info.attach('dense-terrain-timing', { body: JSON.stringify({ ...loopTiming, mesh: await map.evaluate(el => ({ ...el.dataset })) }), contentType: 'application/json' });
  expect(loopTiming.duration, 'terrain preparation must leave the event loop responsive').toBeLessThan(2000);
  await expect.poll(() => map.getAttribute('data-route-terrain-samples').then(Number), { timeout: 15000 }).toBeGreaterThan(100);
  await expect(map).toHaveAttribute('data-route-mesh-busy', 'false', { timeout: 15000 });
  expect(Number(await map.getAttribute('data-route-mesh-max-slice-ms')), 'each terrain work slice stays within 100 ms').toBeLessThan(100);
  expect(Number(await map.getAttribute('data-route-mesh-max-upload-bytes')), 'terrain transfers stay within one 1024-segment buffer').toBeLessThanOrEqual(13 * 6 * 1024 * 4);
  expect(Number(await map.getAttribute('data-route-mesh-max-allocation-bytes')), 'terrain buffer allocations remain bounded').toBeLessThanOrEqual(13 * 6 * 1024 * 4 * 8);
  await expect(map).toHaveAttribute('data-eligible-routes', '7000');
  await expect(page.locator('#map-notice')).toBeHidden();
  await page.screenshot({ path: info.outputPath('terrain-scale-dense.png') });
});
