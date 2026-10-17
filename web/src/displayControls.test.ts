import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountDisplayControls } from './displayControls';
import { displayPreferences, updateDisplay } from './displayPreferences';

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() })));
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('shows only settings that affect Labs while preserving saved network styling', () => {
  const host = document.createElement('section'); document.body.append(host);
  mountDisplayControls(host, 'labs');
  updateDisplay({ basemap: 'streets', preset: 'dashed', width: 2.7, detail: 'complete' });
  expect(host.querySelector('[data-display="basemap"]')).toBeNull();
  expect(host.querySelector('[data-display="preset"]')).toBeNull();
  expect(host.querySelector('[data-display="detail"]')).toBeNull();
  const quality = host.querySelector<HTMLSelectElement>('[data-display="quality"]')!;
  quality.value = 'high'; quality.dispatchEvent(new Event('change', { bubbles: true }));
  expect(displayPreferences()).toMatchObject({ quality: 'high', basemap: 'streets', preset: 'dashed', width: 2.7, detail: 'complete' });
});

it('retains scene themes, all six route presets and advanced controls in Netgraph', () => {
  const host = document.createElement('section'); document.body.append(host); mountDisplayControls(host, 'netgraph');
  expect(host.querySelector('[data-display="basemap"]')).not.toBeNull();
  expect(host.querySelectorAll('[data-display="preset"] option')).toHaveLength(7);
  expect(host.querySelector('[data-display="packetSize"]')).not.toBeNull();
  expect(host.querySelector('details')!.open).toBe(false);
});
