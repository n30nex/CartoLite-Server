import { expect, it } from 'vitest';
import { NetgraphQuality } from './quality';

it('keeps capable renderers at full detail and ignores idle/background gaps', () => {
  const quality = new NetgraphQuality();
  for (let i = 0; i < 200; i++) quality.sample(16.7, 3);
  quality.sample(20_000, 2);
  quality.sample(16, NaN);
  expect(quality.mode).toBe('full');
});

it('reduces decoration under sustained frame pressure and recovers with hysteresis', () => {
  const quality = new NetgraphQuality();
  quality.sample(100, 60);
  for (let i = 0; i < 20; i++) quality.sample(16, 3);
  expect(quality.mode).toBe('full');
  for (let i = 0; i < 15; i++) quality.sample(50, 20);
  expect(quality.mode).toBe('balanced');
  for (let i = 0; i < 15; i++) quality.sample(50, 20);
  expect(quality.mode).toBe('low');
  for (let i = 0; i < 300; i++) quality.sample(16, 2);
  expect(quality.mode).toBe('low');
  quality.resetSamples();
  for (let i = 0; i < 751; i++) quality.sample(16, 2);
  expect(quality.mode).toBe('balanced');
  for (let i = 0; i < 751; i++) quality.sample(16, 2);
  expect(quality.mode).toBe('full');
});
