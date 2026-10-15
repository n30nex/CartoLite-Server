import { expect, test } from '@playwright/test';
import { visualFixture } from './visualFixtures';
import { openViewMenu, switchView, openDisplay, graphFilters } from './dockControls';

for (const path of ['/', '/netgraph/']) test(`phone dock is one labelled row and keeps a working view picker ${path}`, async ({ page }, info) => {
  test.skip(info.project.name === 'desktop');
  await page.setViewportSize(info.project.name.includes('landscape') ? { width:568, height:320 } : { width:320, height:640 });
  await visualFixture(page); await page.goto(path);
  await expect(page.locator(path === '/' ? '#map' : '#netgraph-stage')).toHaveAttribute('data-render-state','idle', {timeout:10_000});
  const controls = page.locator('.controls');
  const primary = controls.locator(':scope > button, :scope > div > button');
  await expect(primary).toHaveCount(6);
  const dock = (await controls.boundingBox())!;
  expect(dock.height).toBeLessThanOrEqual(64);
  for (const button of await primary.all()) {
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(box.y-dock.y-4)).toBeLessThanOrEqual(2);
    expect((await button.innerText()).trim()).not.toBe('');
  }
  if (path === '/') {
    await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toBeHidden();
    await page.locator('.maplibregl-ctrl-attrib-button').press('Enter');
    await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toBeVisible();
    await page.locator('.maplibregl-ctrl-attrib-button').press('Enter');
  }
  await page.screenshot({path:info.outputPath(path === '/' ? 'phone-map.png' : 'phone-netgraph.png')});
  await openViewMenu(page);
  await expect.poll(()=>page.evaluate(()=>history.state?.cartolitePanel)).toBe('view-panel');
  await page.locator('#view-panel .dock-views a').first().focus();
  await page.goBack(); await expect(page.locator('#view-panel')).toBeHidden();
  await expect(page.locator('#view-button')).toBeFocused();
  await page.evaluate(()=>{(window as unknown as {sameView:boolean}).sameView=true;});
  await switchView(page, path === '/' ? 'map' : 'Netgraph');
  await expect(page.locator('#view-panel')).toBeHidden();
  expect(await page.evaluate(()=>(window as unknown as {sameView:boolean}).sameView)).toBe(true);
  await switchView(page, path === '/' ? 'Netgraph' : 'map');
  await expect.poll(()=>new URL(page.url()).pathname).toBe(path === '/' ? '/netgraph/' : '/');
  await page.goBack(); await expect(page.locator('#view-panel')).toBeHidden();
  await expect.poll(()=>new URL(page.url()).pathname).toBe(path);
});

test('phone search and sound have explicit close actions and fit above a keyboard', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop');
  await page.setViewportSize({width:390,height:844});
  await visualFixture(page); await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle', {timeout:10_000});
  await page.locator('#find-button').click(); await page.locator('#node-search').fill('Visual');
  await expect(page.locator('.node-search-result')).toHaveCount(3);
  await page.evaluate(()=>{
    Object.defineProperty(window.visualViewport!, 'height', {configurable:true,value:340});
    Object.defineProperty(window.visualViewport!, 'offsetTop', {configurable:true,value:0});
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  const panel=(await page.locator('#find-panel').boundingBox())!, dock=(await page.locator('.controls').boundingBox())!;
  expect(panel.y).toBeGreaterThanOrEqual(0); expect(panel.y+panel.height).toBeLessThan(dock.y);
  expect(dock.y+dock.height).toBeLessThanOrEqual(340);
  expect(await page.locator('#node-search').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await page.screenshot({path:info.outputPath('phone-search-keyboard.png')});
  await page.getByRole('button',{name:'Close node search'}).click();
  await expect(page.locator('#find-button')).toBeFocused();
  await page.locator('#sound-button').click();
  await page.getByRole('button',{name:'Close sound settings'}).click();
  await expect(page.locator('#sound-button')).toBeFocused();
});

test('phone graph filters stay in their sheet and settings preserve the scene', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop');
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await visualFixture(page); await page.goto('/netgraph/');
  const stage=page.locator('#netgraph-stage'); await expect(stage).toHaveAttribute('data-render-state','idle', {timeout:10_000});
  await graphFilters(page);
  await page.locator('#region-filter > summary').click();
  await expect(page.locator('#display-panel')).toBeVisible();
  await page.locator('[data-none]').click(); await expect(stage).toHaveAttribute('data-visible-routes','0');
  await page.locator('[data-all]').click(); await expect(stage).toHaveAttribute('data-visible-routes','1');
  await page.keyboard.press('Escape');
  const center=await stage.getAttribute('data-view-center');
  await page.getByLabel('Text size').selectOption('large');
  await page.getByLabel('Scene style',{exact:true}).selectOption('light');
  await page.keyboard.press('Escape');
  await expect(stage).toHaveAttribute('data-view-center',center!);
  expect((await page.locator('.controls').boundingBox())!.height).toBeLessThanOrEqual(72);
  await page.screenshot({path:info.outputPath('phone-netgraph-large-text.png')});
  await page.setViewportSize({width:320,height:640});
  expect((await page.locator('.controls').boundingBox())!.height).toBeLessThanOrEqual(112);
  for (const label of await page.locator('.controls > button > span:not([aria-hidden]),.controls > div > button > span:not([aria-hidden])').all()) {
    expect(await label.evaluate(el=>el.getBoundingClientRect().width <= el.parentElement!.getBoundingClientRect().width)).toBe(true);
  }
  await page.screenshot({path:info.outputPath('phone-netgraph-large-text-320.png')});
  await openDisplay(page); await page.getByRole('button',{name:'Close display settings',exact:true}).click();
  await expect(page.locator('#display-button')).toBeFocused();
});
