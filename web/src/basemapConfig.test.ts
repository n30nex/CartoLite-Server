import { afterEach, expect, it, vi } from 'vitest';
import { basemapFontStack, basemapProvider, cartoVectorRequestURL, cartoVectorStyle, loadBasemapConfiguration } from './basemap';

afterEach(() => vi.unstubAllGlobals());
it('loads only supported public runtime map settings without a compiled key', async () => {
  const response = (basemap: unknown) => ({ ok: true, json: async () => ({ schemaVersion: 1, basemap }) });
  const request = vi.fn().mockResolvedValue(response({ provider: 'openfreemap' }));
  vi.stubGlobal('fetch', request);
  await loadBasemapConfiguration();
  expect(cartoVectorStyle().sources.carto).toMatchObject({ url: 'https://tiles.openfreemap.org/planet' });
  expect(basemapFontStack()).toEqual(['Noto Sans Regular']);
  request.mockResolvedValue(response({ provider: 'carto', cartoBrowserKey: 'synthetic-public-key' }));
  await loadBasemapConfiguration();
  expect(basemapProvider()).toBe('carto');
  expect(basemapFontStack()).toEqual(['Open Sans Regular']);
  expect(cartoVectorStyle().glyphs).toContain('key=synthetic-public-key');
  expect(cartoVectorRequestURL('https://tiles.openfreemap.org/planet')).toBe('https://tiles.openfreemap.org/planet');
  request.mockResolvedValue(response({ provider: 'https://untrusted.invalid/' }));
  await expect(loadBasemapConfiguration()).rejects.toThrow('invalid');
  request.mockResolvedValue(response({ provider: 'openfreemap' }));
  await loadBasemapConfiguration();
  expect(JSON.stringify(cartoVectorStyle())).not.toContain('key=');
});
