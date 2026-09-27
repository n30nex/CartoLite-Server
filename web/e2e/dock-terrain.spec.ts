import { expect, test } from '@playwright/test';
import { visualFixture } from './visualFixtures';
import { openMapOptions } from './mapControls';

// As in terrain.spec, continuous retry screencasts stall software terrain readback.
test.use({trace:'off'});
test('dock 3D shortcut shares layer state, persistence and reset', async ({page},info) => {
  const desktop=info.project.name==='desktop';
  await page.emulateMedia({reducedMotion:'reduce'});
  await visualFixture(page); await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle');
  const shortcut=page.locator('#terrain-shortcut');
  const attribution=page.locator('.maplibregl-ctrl-attrib-button');
  await shortcut.press('Enter');
  await expect(shortcut).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#terrain-button')).toHaveAttribute('aria-pressed','true');
  for(const id of ['hillshade-button','buildings-button']) await expect(page.locator('#'+id)).toHaveAttribute('aria-pressed','true');
  if(!await page.locator('.maplibregl-ctrl-attrib-inner').isVisible()) await attribution.press('Enter');
  await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toContainText('Mapterhorn');
  await expect(page.locator('#map')).toHaveAttribute('data-camera-moving','false');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle',{timeout:15_000});
  if(desktop) await expect.poll(()=>page.evaluate(()=>{
    const packet=document.getElementById('route-legend')!.getBoundingClientRect();
    const credit=document.querySelector('.maplibregl-ctrl-attrib')!.getBoundingClientRect();
    return packet.bottom < credit.top;
  })).toBe(true);
  await page.screenshot({path:info.outputPath('compact-map-3d.png')});
  await page.reload(); await expect(shortcut).toHaveAttribute('aria-pressed','true');
  await openMapOptions(page); await page.locator('#terrain-button').click();
  await expect(shortcut).toHaveAttribute('aria-pressed','false');
  await page.keyboard.press('Escape'); await shortcut.click(); await openMapOptions(page);
  await page.locator('#reset-layers').click(); await expect(shortcut).toHaveAttribute('aria-pressed','false');
});
