import { expect, test } from '@playwright/test';
import { visualFixture, visualPacket } from './visualFixtures';
import { openMapOptions } from './mapControls';
import type { ScopeSnapshot } from '../src/types';

for (const viewport of [{width:1280,height:800},{width:390,height:844}]) test(`scope layer keeps workers, focus, live traffic and compact controls at ${viewport.width}px`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);
  const state=await visualFixture(page,10.2,true);
  const errors: string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  const now=Date.now();
  const snapshot: ScopeSnapshot={schemaVersion:1,serverTime:now,since:now-600000,sessionStart:now-600000,lastGap:now-600000,connected:true,nodes:[
    {id:'visual-a',scopes:[{name:'$constructor',repeats:[2,8,20],heard:[0,0,0],first:now-600000,last:now}],reports:[{source:'mqtt-self',at:now,list:true,entries:[{name:'#__proto__',at:now}]}]},
    {id:'visual-b',scopes:[{name:'#YKF',repeats:[1,4,10],heard:[0,0,0]}],reports:[]},
    {id:'visual-c',scopes:[{name:'?',repeats:[3,3,3],heard:[0,0,0]}],reports:[{source:'mqtt-neighbor',list:true,entries:[]}]},
  ]};
  await page.route('**/api/scopes',route=>route.fulfill({json:snapshot}));
  await page.addInitScript(()=>window.addEventListener('cartolite-map-ready',event=>{
    (window as unknown as {scopeTestView:unknown}).scopeTestView=(event as CustomEvent).detail.view;
  }));
  await page.goto('/?repeater_scopes=on&scope_hours=6');
  const map=page.locator('#map');
  await expect(map).toHaveAttribute('data-scope-render-state','ready');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');
  const featureCount=()=>page.evaluate(()=>{
    const view=(window as unknown as {scopeTestView:{map:{querySourceFeatures:(id:string)=>{id:string}[]}}}).scopeTestView;
    return new Set(view.map.querySourceFeatures('nodes').map(f=>f.id)).size;
  });
  await expect.poll(featureCount).toBe(state.nodes.length);
  await page.locator('#scope-legend > summary').click();
  await expect(page.locator('#scope-legend button[data-scope="$constructor"]')).toBeVisible();
  await page.locator('#scope-legend button[data-scope="$constructor"]').click();
  await openMapOptions(page);
  await page.getByLabel('Scope focus mode',{exact:true}).selectOption('isolate');
  await page.getByLabel('Scope evidence window',{exact:true}).selectOption('1');
  await page.locator('#layers-close').click();
  await expect.poll(featureCount).toBe(1);
  await visualPacket(page,1,'Text');
  await expect(page.locator('#packet-canvas')).toBeVisible();
  await page.reload();
  await expect(map).toHaveAttribute('data-scope-focus','$constructor');
  await expect.poll(featureCount).toBe(1);
  await openMapOptions(page);
  await page.getByRole('button',{name:'Show all',exact:true}).click();
  await page.locator('#basemap-style').selectOption('light');
  await expect.poll(featureCount).toBe(3);
  const bounds=await page.locator('#layers-panel').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height);
  await page.locator('#layers-close').click();
  await page.screenshot({path:testInfo.outputPath(`scope-map-${viewport.width}.png`)});
  expect(errors).toEqual([]);
});
