import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { resolve } from 'node:path';
import { visualFixture } from './visualFixtures';

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
    const { report, dialupPCM } = await page.evaluate(async () => {
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
      let dialupPCM: number[] = [];
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
          if (scene === 'dial-up') {
            dialupPCM = Array.from(samples.subarray(0, 48_000), (value) => Math.round(Math.max(-1, Math.min(1, value)) * 32_767));
          }
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
      return { report: reports, dialupPCM };
    });
    // Retain the exact native-rendered synthetic hop for listening review.
    const wav = Buffer.alloc(44 + dialupPCM.length * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48_000, 24); wav.writeUInt32LE(96_000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(dialupPCM.length * 2, 40);
    dialupPCM.forEach((value, index) => wav.writeInt16LE(value, 44 + index * 2));
    await testInfo.attach('dial-up-hop', { body: wav, contentType: 'audio/wav' });
    await testInfo.attach('voice-measurements', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    expect(report).toHaveLength(31);
    expect(new Set(report.map((voice) => voice.signature)).size).toBe(31);
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

test('shares the larger voice library and saved selection between map and Netgraph', async ({ page }) => {
  await visualFixture(page);
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await page.locator('#sound-button').click();
  const picker = page.getByRole('combobox', { name: 'Sound voice', exact: true });
  await expect(picker.locator('option')).toHaveCount(31);
  await expect(picker.locator('optgroup')).toHaveCount(5);
  await picker.selectOption('dial-up');
  await expect(page.locator('#sound-button')).toHaveAttribute('title', 'Sound off — Dial-up · 80%');
  await expect(page.locator('#sound-description')).toContainText('handshake');
  await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
  await expect(page.locator('#sound-toggle')).toHaveText('Turn sound on');
  await page.goto('/netgraph/');
  await expect(page.locator('#connected-count')).not.toHaveText('—');
  await page.locator('#sound-button').click();
  await expect(picker).toHaveValue('dial-up');
  await expect(picker.locator('option')).toHaveCount(31);
  await picker.selectOption('sonar');
  await expect(page.locator('#sound-description')).toContainText('underwater');
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await page.locator('#sound-button').click();
  await expect(picker).toHaveValue('sonar');
  await expect(page.locator('#sound-toggle')).toHaveText('Turn sound on');
});
