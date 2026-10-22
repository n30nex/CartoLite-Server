import { AttributionControl, type Map as MapLibreMap } from 'maplibre-gl';
import { expect, it } from 'vitest';

it('removes consecutive unsafe attribution attributes while keeping safe credit text and links', () => {
  // Exercise the dependency's public control API without requiring a GPU in the unit job.
  const map = {
    style: { tileManagers: {} },
    _getUIString: (key: string) => key,
    getCanvasContainer: () => document.createElement('div'),
    on() {},
    off() {},
  } as unknown as MapLibreMap;
  const control = new AttributionControl({
    compact: false,
    customAttribution: '<details open onload="void 0" ontoggle="void 0">Untrusted widget</details><span onload="void 0" onclick="void 0">Fixture attribution</span><a href="https://example.invalid">Credits</a>',
  });
  const element = control.onAdd(map);
  expect(element.textContent).toContain('Fixture attribution');
  expect(element.querySelector('[onload], [ontoggle], [onclick]')).toBeNull();
  expect(element.querySelector('.maplibregl-ctrl-attrib-inner details')).toBeNull();
  expect(element.querySelector('a')?.getAttribute('href')).toBe('https://example.invalid');
  control.onRemove();
});
