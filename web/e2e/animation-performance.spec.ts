import { expect, test, type Page } from '@playwright/test';
import { visualFixture, visualPacket } from './visualFixtures';
import { openDisplay } from './dockControls';

test.describe.configure({ retries: 0 });

async function arcade(page: Page, machine: 'firehose' | 'pachinko') {
  await visualFixture(page);
  await page.addInitScript(machine => {
    window.addEventListener(`cartolite-${machine}-ready`, event => {
      (window as any).__perfScene = (event as CustomEvent).detail.scene;
    });
  }, machine);
  await page.goto(`/${machine}/`);
  await expect(page.locator(`#${machine}-stage`)).toHaveAttribute('data-render-state', 'ready', { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('data-fixture-stream', 'ready');
}

for (const machine of ['firehose', 'pachinko'] as const) {
  test(`@animation-perf ${machine} stops idle drawing and wakes on a fresh packet`, async ({ page }, info) => {
    test.skip(!['desktop', 'mobile-webkit'].includes(info.project.name));
    await arcade(page, machine);
    const stage = page.locator(`#${machine}-stage`);
    await expect(stage).toHaveAttribute('data-events', '0');
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => (window as any).__perfScene.metrics.frames);
    await page.waitForTimeout(1_100);
    expect(await page.evaluate(() => (window as any).__perfScene.metrics.frames), 'a resting machine must not redraw periodic identical snapshots').toBe(before);
    await visualPacket(page, 1, 'Text');
    await expect(stage).toHaveAttribute('data-events', '1');
    await expect.poll(() => page.evaluate(() => (window as any).__perfScene.metrics.frames)).toBeGreaterThan(before);
    await info.attach('idle-work', { body: JSON.stringify({ machine, idleFrameIncrease: 0 }), contentType: 'application/json' });
  });

  test(`@animation-perf ${machine} uploads one fresh position texture per snapshot`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await page.addInitScript(() => {
      (window as any).__positionUploads = 0;
      const prototype = WebGL2RenderingContext.prototype as any;
      for (const method of ['texImage2D', 'texSubImage2D']) {
        const original = prototype[method];
        prototype[method] = function (...args: unknown[]) {
          const capacity = (window as any).__perfScene?.capacity;
          if (capacity && args.some(value => value instanceof Float32Array && value.length === capacity * 4)) (window as any).__positionUploads++;
          return original.apply(this, args);
        };
      }
    });
    await arcade(page, machine);
    await page.locator('#pause-button').click();
    await expect(page.locator(`#${machine}-stage`)).toHaveAttribute('data-paused', 'true');
    await page.waitForTimeout(150);
    const counts = await page.evaluate(async () => {
      const scene = (window as any).__perfScene, counts: number[] = [];
      for (let sample = 0; sample < 4; sample++) {
        (window as any).__positionUploads = 0;
        const data = new Float32Array(24 + scene.capacity * 8);
        data[0] = data[3] = 1; data[11] = 1; data[24] = sample * .1; data[25] = 1; data[27] = (sample + 2) * 8 + 1;
        const retired = scene.accept(data.buffer);
        if (retired) structuredClone(retired, { transfer: [retired] });
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        counts.push((window as any).__positionUploads);
      }
      return counts;
    });
    expect(counts).toEqual([1, 1, 1, 1]);
    await info.attach('position-uploads', { body: JSON.stringify({ machine, uploadsPerSnapshot: counts }), contentType: 'application/json' });
  });
}

test('@animation-perf Netgraph applies explicit graphics quality to its animation surface', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await visualFixture(page);
  await page.addInitScript(() => Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 }));
  await page.goto('/netgraph/');
  const stage = page.locator('#netgraph-stage');
  await expect(stage).toHaveAttribute('data-render-state', 'idle');
  await openDisplay(page);
  for (const [preference, mode, ratio] of [['economy', 'low', 1], ['high', 'full', 2]] as const) {
    await page.getByLabel('Graphics quality', { exact: true }).selectOption(preference);
    await expect(stage).toHaveAttribute('data-quality-mode', mode);
    await expect.poll(() => page.locator('#packet-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width / canvas.getBoundingClientRect().width)).toBe(ratio);
  }
});
