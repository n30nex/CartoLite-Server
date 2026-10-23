import { expect, test } from '@playwright/test';
import { visualFixture } from './visualFixtures';
import { openViewMenu } from './dockControls';
import type { StateV2, PacketView } from '../src/types';

test('Chronoscope keeps live time, frozen slices, regions and selection separate', async ({page},info) => {
  await visualFixture(page);
  await page.addInitScript(()=>window.addEventListener('cartolite-chronoscope-ready',event=>{(window as any).__chrono=(event as CustomEvent).detail.scene;}));
  await page.goto('/chronoscope/');
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-render-state','idle');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-event-count','0');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('visual-packet',{detail:{seq:1,id:'chrono-live',at:Date.now(),payloadType:'Text',mode:'route',segments:[{routeId:'visual-hop',fromId:'visual-a',toId:'visual-b'}]}})));
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-active-count','1');
  await page.screenshot({path:info.outputPath('chronoscope-live.png')});
  await page.locator('#time-button').click();await page.locator('#freeze-button').click();
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-frozen','true');
  const before=await page.evaluate(()=>(window as any).__chrono.frameTime);await page.waitForTimeout(100);
  expect(await page.evaluate(()=>(window as any).__chrono.frameTime)).toBe(before);
  await page.getByLabel('Chronoscope view').selectOption('slice');
  await page.getByLabel('Moment to inspect').fill('40');
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-visible-events','0');
  await page.locator('#live-button').click();await page.keyboard.press('Escape');
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-frozen','false');
  await page.locator('#regions-button').click();await page.locator('#regions-none').click();await page.keyboard.press('Escape');
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-visible-events','0');
  await page.locator('#find-button').click();await page.locator('#node-search').fill('Alpha');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(page.locator('#node-inspector-sheet')).toContainText('Visual Alpha');
  await expect(page.locator('#node-inspector-sheet')).toBeVisible();
  await openViewMenu(page);
  await page.getByRole('link',{name:'Open CartoLite Netgraph',exact:true}).click();
  await expect.poll(()=>new URL(page.url()).searchParams.get('node')).toBe('visual-a');
});

test('Chronoscope exposes clear themes and a quiet observer-only fallback',async({page},info)=>{
  await visualFixture(page);
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type:any,...args:any[]){if(type==='webgl2')return null;return (original as any).call(this,type,...args);} as typeof original;});
  await page.goto('/chronoscope/');await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('visual-packet',{detail:{seq:1,id:'heard',at:Date.now(),payloadType:'Advert',mode:'observer',observer:{id:'visual-a',label:'Visual Alpha',lat:43.45,lng:-80.35}}})));
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-renderer','canvas2d');
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-segment-count','1');
  await page.locator('#time-button').click();await page.locator('#recent-events button').first().click();
  await expect(page.locator('#node-inspector-sheet')).toContainText('Observer-only reception');
  await expect(page.locator('.chrono-hop')).toHaveCount(0);
  await page.keyboard.press('Escape');
  for(const theme of ['dark','light','streets']){
    await page.locator('#display-button').click();await page.getByLabel('Scene style',{exact:true}).selectOption(theme);await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-basemap',theme);
    await page.screenshot({path:info.outputPath(`chronoscope-${theme}.png`)});
  }
  await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-motion-mode','static');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Chronoscope retains 7000 links and bounds live geometry without fetching a basemap',async({page},info)=>{
  test.skip(info.project.name!=='desktop');
  await visualFixture(page);const now=Date.now();
  const nodes=Array.from({length:4000},(_,i)=>({id:`n${i}`,label:`Node ${i}`,role:'repeater' as const,observer:false,lat:43+(i%50)*.04,lng:-81+Math.floor(i/50)*.04,lastSeen:now}));
  const state:StateV2={schemaVersion:2,bootId:'visual-fixture',seq:0,serverTime:now,status:{feed:'connected',activity:'active',dropped:0,version:'test',gitSha:'synthetic'},map:{center:[-80,43],zoom:8},nodes,routes:Array.from({length:7000},(_,i)=>({id:`r${i}`,fromId:`n${i%4000}`,toId:`n${(i+1)%4000}`,packetCount:1,lastHeard:now,intensity:1,lastKind:'Text',traffic:1}))};
  await page.route('**/api/state',route=>route.fulfill({json:state}));
  await page.addInitScript(()=>window.addEventListener('cartolite-chronoscope-ready',event=>{(window as any).__chrono=(event as CustomEvent).detail.scene;}));
  const mapRequests:string[]=[];page.on('request',r=>{if(/maplibre|tiles\.openfreemap|basemaps\.cartocdn|tiles\.mapterhorn/.test(r.url()))mapRequests.push(r.url());});
  await page.goto('/chronoscope/');await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-total-routes','7000');
  expect(Number(await page.locator('#chronoscope-stage').getAttribute('data-render-apply-ms'))).toBeLessThan(2000);
  expect(mapRequests).toEqual([]);
  await page.evaluate(nodes=>{
    const scene=(window as any).__chrono;
    for(let seq=1;seq<=1500;seq++){
      const packet:PacketView={seq,id:`synthetic-${seq}`,at:Date.now(),payloadType:'Text',mode:'route',segments:Array.from({length:8},(_,i)=>({routeId:`r${i}`,from:nodes[(seq+i)%nodes.length]!,to:nodes[(seq+i+1)%nodes.length]!}))};
      scene.timeline.add(packet,performance.now()-20_000+seq);
    }
    scene.setWindow(60);
  },nodes);
  await expect.poll(async()=>Number(await page.locator('#chronoscope-stage').getAttribute('data-segment-count'))).toBe(4096);
  expect(Number(await page.locator('#chronoscope-stage').getAttribute('data-event-count'))).toBeLessThanOrEqual(1024);
  await page.locator('#find-button').click();await page.locator('#node-search').fill('Node 42');await expect(page.locator('.node-search-result').first()).toBeVisible();await page.keyboard.press('Escape');
  await page.screenshot({path:info.outputPath('chronoscope-dense.png')});
});
