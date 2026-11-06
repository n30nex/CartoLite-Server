import { expect, it, vi } from 'vitest';
import { GPUEffects } from './gpuEffects';

const palette = vi.hoisted(() => ({ override: '' }));
vi.mock('./displayPreferences', () => ({
  displayColor: (color: string) => palette.override || color,
  displayPreferences: () => ({ packetSize: 1, quality: 'auto' }),
  effectStrength: () => 1,
  scenePalette: () => ({ outline: '#102030', core: '#ffffff' }),
}));

function graphics() {
  let uploaded = new Float32Array(), drawn = 0;
  const gl: Record<string, unknown> = {
    isContextLost: () => false, createProgram: () => ({}), createShader: () => ({}),
    createBuffer: () => ({}), createVertexArray: () => ({}), getUniformLocation: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true,
    getParameter: () => null, isEnabled: () => false,
    bufferSubData: (_target: number, _offset: number, data: Float32Array) => { uploaded = new Float32Array(data); },
    drawArrays: (_mode: number, _first: number, count: number) => { drawn = count; },
  };
  for (const name of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'bindVertexArray', 'bindBuffer',
    'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'deleteShader', 'useProgram', 'uniform2f',
    'disable', 'enable', 'depthMask', 'blendFuncSeparate', 'deleteProgram', 'deleteBuffer', 'deleteVertexArray']) gl[name] = () => {};
  return { gl: gl as unknown as WebGL2RenderingContext, pixels: () => uploaded, count: () => drawn };
}

it('preserves grounded geometry, triangle order, UVs, colour and opacity across frames', () => {
  const capture = graphics(), batch = new GPUEffects(); batch.initialize(capture.gl);
  batch.begin(100, 100);
  batch.disc({ x: 10, y: 20, ground: [0, 1, -1, 0] }, 2, '#4080c0', .5, 2, true);
  batch.draw();
  const data = capture.pixels(), xy = [[12, 18], [12, 22], [8, 22], [12, 18], [8, 22], [8, 18]];
  const uv = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  expect(capture.count()).toBe(6);
  for (let i = 0; i < 6; i++) {
    expect(Array.from(data.slice(i * 9, i * 9 + 4))).toEqual([...xy[i]!, ...uv[i]!]);
    for (const [channel, value] of [64 / 255, 128 / 255, 192 / 255].entries()) expect(data[i * 9 + 4 + channel]).toBeCloseTo(value, 6);
    expect(Array.from(data.slice(i * 9 + 7, i * 9 + 9))).toEqual([.5, 2]);
  }
  try {
    palette.override = '#ffffff'; batch.begin(100, 100); batch.disc({ x: 1, y: 1 }, 1, '#4080c0', 2); batch.draw();
    expect(Array.from(capture.pixels().slice(4, 8))).toEqual([1, 1, 1, 1]);
  } finally { palette.override = ''; batch.dispose(); }
});

it('keeps date-line breaks and fades the trail without partially emitting an overflow packet', () => {
  const capture = graphics(), batch = new GPUEffects(); batch.initialize(capture.gl); batch.begin(100, 100);
  const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 80, y: 0, breakBefore: true }];
  expect(batch.packet(points, points[2]!, '#4080c0', 'tick')).toBe(true); batch.draw();
  // One trail quad, then glow, outline, core and highlight. No seam-spanning line.
  expect(capture.count()).toBe(30);
  expect(capture.pixels()[7]).toBeCloseTo(.95 * .06);
  expect(capture.pixels()[16]).toBeCloseTo(.95);
  expect(batch.packet(Array.from({ length: 4_001 }, () => points[0]!), points[0]!, '#4080c0', 'tick')).toBe(false);
  batch.draw(); expect(capture.count()).toBe(30);
  expect(batch.disc({ x: NaN, y: 0 }, 2, '#ffffff', 1)).toBe(false);
  batch.clear(); expect(batch.hasInk).toBe(false); batch.dispose();
});

it.skipIf(!import.meta.env.VITE_CARTOLITE_GPU_BASELINE)('reports baseline/candidate packet-batch construction on the same runner', async () => {
  // CI materializes the immutable release module and removes it before the build.
  // This measures CPU geometry preparation, not GPU throughput or whole-page FPS.
  const baselinePath = './gpuEffects.baseline.ts';
  const { GPUEffects: Baseline } = await import(/* @vite-ignore */ baselinePath) as { GPUEffects: typeof GPUEffects };
  const before = new Baseline(), after = new GPUEffects();
  before.initialize(graphics().gl); after.initialize(graphics().gl);
  const path = [{ x: 0, y: 0 }, { x: 90, y: 30 }, { x: 160, y: 20 }], head = path[2]!;
  const kinds = ['#4de7c4', '#ffd15a', '#ff75b5', '#78cfff'];
  const run = (batch: GPUEffects, frames: number) => {
    const started = performance.now();
    for (let frame = 0; frame < frames; frame++) {
      batch.begin(1280, 800);
      for (let packet = 0; packet < 64; packet++) batch.packet(path, head, kinds[packet % kinds.length]!, 'ripple');
    }
    return performance.now() - started;
  };
  run(before, 100); run(after, 100);
  const baseline: number[] = [], candidate: number[] = [];
  for (let i = 0; i < 7; i++) {
    if (i % 2) { candidate.push(run(after, 200)); baseline.push(run(before, 200)); }
    else { baseline.push(run(before, 200)); candidate.push(run(after, 200)); }
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[3]!;
  console.log('GPU_BATCH_CONSTRUCTION', JSON.stringify({ packetsPerSample: 12_800, samples: 7, baselineMedianMS: median(baseline), candidateMedianMS: median(candidate), baseline, candidate }));
  expect(before.hasInk && after.hasInk).toBe(true); before.dispose(); after.dispose();
});
