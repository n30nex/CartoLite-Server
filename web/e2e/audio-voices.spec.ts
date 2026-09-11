import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { resolve } from 'node:path';

test('renders audible, distinct, finite output for every packet voice', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The native offline renderer is independent of viewport size.');
  test.setTimeout(90_000);
  // Actions-only source harness: no basemap, broker data or audible output.
  const server = await createServer({
    configFile: false, root: resolve(import.meta.dirname, '..'), appType: 'custom',
    logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
  });
  server.middlewares.use('/audio-check', (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><body><div id="viewport" style="width:100px;height:100px"></div></body></html>');
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Audio harness did not bind a local port');
    await page.goto('http://127.0.0.1:' + address.port + '/audio-check');
    const report = await page.evaluate(async () => {
      const audioPath = '/src/audio.ts';
      const catalogPath = '/src/soundScenes.ts';
      const { RouteSonifier } = await import(audioPath) as typeof import('../src/audio');
      const { SOUND_SCENE_IDS } = await import(catalogPath) as typeof import('../src/soundScenes');
      const original = window.AudioContext;
      let captured: OfflineAudioContext & { voices: number; ended: number };
      class RenderContext extends OfflineAudioContext {
        voices = 0;
        ended = 0;
        constructor() { super(2, 96_000, 48_000); captured = this; }
        // The sonifier schedules before offline rendering begins. Report usable
        // scheduling state while retaining the real native offline audio graph.
        get state(): AudioContextState { return super.state === 'closed' ? 'closed' : 'running'; }
        async resume(): Promise<void> {}
        async close(): Promise<void> {}
        createOscillator(): OscillatorNode {
          this.voices += 1;
          const oscillator = super.createOscillator();
          oscillator.addEventListener('ended', () => { this.ended += 1; });
          return oscillator;
        }
      }
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: RenderContext });
      const reports = [];
      try {
        for (const scene of SOUND_SCENE_IDS) {
          const storage = { getItem: () => null, setItem: () => {} } as unknown as Storage;
          const viewport = document.getElementById('viewport')!;
          const sonifier = new RouteSonifier({ project: ([x, y]) => ({ x, y }) }, viewport, storage);
          sonifier.setScene(scene);
          if (!await sonifier.setEnabled(true)) throw new Error('Offline scheduling failed for ' + scene);
          const count = sonifier.play({
            seq: 1, id: 'synthetic-voice-check', at: 1_700_000_000_000, mode: 'route', payloadType: 'Trace',
            segments: [{ routeId: 'synthetic-link', from: { id: 'a', label: 'A', lng: 20, lat: 50 }, to: { id: 'b', label: 'B', lng: 80, lat: 50 } }],
          });
          const context = captured!;
          const buffer = await context.startRendering();
          await new Promise((done) => setTimeout(done, 0));
          const samples = buffer.getChannelData(0);
          let peak = 0, energy = 0, tailPeak = 0, signature = 2166136261;
          let finite = true;
          for (let i = 0; i < samples.length; i += 1) {
            const value = samples[i]!;
            finite &&= Number.isFinite(value);
            peak = Math.max(peak, Math.abs(value));
            energy += value * value;
            if (i > samples.length - 4_800) tailPeak = Math.max(tailPeak, Math.abs(value));
            if (i % 16 === 0) signature = Math.imul(signature ^ Math.round(value * 32_767), 16777619);
          }
          reports.push({ scene, count, voices: context.voices, ended: context.ended, finite, peak, rms: Math.sqrt(energy / samples.length), tailPeak, signature: signature >>> 0 });
          sonifier.destroy();
        }
      } finally {
        Object.defineProperty(window, 'AudioContext', { configurable: true, value: original });
      }
      return reports;
    });
    await testInfo.attach('voice-measurements', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    expect(report).toHaveLength(30);
    expect(new Set(report.map((voice) => voice.signature)).size).toBe(30);
    for (const voice of report) {
      expect(voice.finite, voice.scene).toBe(true);
      expect(voice.count, voice.scene).toBe(1);
      expect(voice.voices, voice.scene).toBe(1);
      expect(voice.ended, voice.scene).toBe(1);
      expect(voice.peak, voice.scene).toBeLessThan(0.45);
      expect(voice.rms, voice.scene).toBeGreaterThan(0.0003);
      expect(voice.tailPeak, voice.scene).toBeLessThan(0.0001);
    }
  } finally {
    await server.close();
  }
});

test('shares the larger voice library and saved selection between map and Netgraph', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Responsive sound controls are covered by the full map and Netgraph journeys.');
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await page.locator('#sound-button').click();
  const picker = page.getByRole('combobox', { name: 'Sound voice', exact: true });
  await expect(picker.locator('option')).toHaveCount(30);
  await expect(picker.locator('optgroup')).toHaveCount(5);
  await picker.selectOption('electric-piano');
  await expect(page.locator('#sound-button')).toHaveAttribute('title', 'Sound off — Electric Piano · 80%');
  await expect(page.locator('#sound-description')).toContainText('metallic attack');
  await page.goto('/netgraph/');
  await expect(page.locator('#connected-count')).not.toHaveText('—');
  await page.locator('#sound-button').click();
  await expect(picker).toHaveValue('electric-piano');
  await expect(picker.locator('option')).toHaveCount(30);
  await picker.selectOption('sonar');
  await expect(page.locator('#sound-description')).toContainText('underwater');
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await page.locator('#sound-button').click();
  await expect(picker).toHaveValue('sonar');
  await expect(page.locator('#sound-toggle')).toHaveText('Turn sound on');
});
