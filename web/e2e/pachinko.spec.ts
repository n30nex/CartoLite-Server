import { expect, test, type Page } from '@playwright/test';
import { visualFixture } from './visualFixtures';
import { openDisplay, openViewMenu } from './dockControls';

async function open(page:Page){await visualFixture(page);await page.addInitScript(()=>window.addEventListener('cartolite-pachinko-ready',event=>{(window as any).__pachinko=(event as CustomEvent).detail.scene;}));await page.goto('/pachinko/');await expect(page.locator('#pachinko-stage')).toHaveAttribute('data-render-state','ready',{timeout:20000});await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');}
async function packets(page:Page,count=6){await page.evaluate(count=>{for(let i=0;i<count;i++)window.dispatchEvent(new CustomEvent('visual-packet',{detail:{seq:i+1,id:`pachinko-${i}`,at:Date.now(),payloadType:['Advert','Trace','Text','ACK','Control','Other'][i%6],mode:'route',segments:[{routeId:'one',fromId:'visual-a',toId:'visual-b'},{routeId:'two',fromId:'visual-b',toId:'visual-c'}]}}));},count);}

test('Pachinko shows one dot per packet, correct type buckets and a real drain',async({page},info)=>{
  test.skip(info.project.name==='mobile-landscape');test.setTimeout(60000);await open(page);const stage=page.locator('#pachinko-stage');
  await expect(stage).toHaveAttribute('data-beads','0');await expect(stage).toHaveAttribute('data-graphics-ready','true');
  await packets(page,12);await expect(stage).toHaveAttribute('data-events','12');await expect(stage).toHaveAttribute('data-beads','12');await expect(stage).toHaveAttribute('data-links','0');
  await expect(stage).toHaveAttribute('data-buckets','[2,2,2,2,2,2]',{timeout:25000});
  await page.screenshot({path:info.outputPath('pachinko-buckets.png')});
  await openDisplay(page);await page.locator('[data-display="basemap"]').selectOption('light');await page.keyboard.press('Escape');await expect(stage).toHaveAttribute('data-events','12');
  await page.screenshot({path:info.outputPath('pachinko-daylight.png')});
  await page.locator('#pause-button').click();await page.evaluate(()=>window.dispatchEvent(new CustomEvent('visual-packet',{detail:{seq:50,id:'paused',at:Date.now(),payloadType:'Text',mode:'route',segments:[{routeId:'one',fromId:'visual-a',toId:'visual-b'}]}})));await page.waitForTimeout(150);await expect(stage).toHaveAttribute('data-events','12');
  await page.locator('#pause-button').click();await page.getByRole('button',{name:'Drain all packet buckets',exact:true}).click();
  await expect(stage).toHaveAttribute('data-beads','0',{timeout:10000});await expect(stage).toHaveAttribute('data-drained','12');
  await page.reload();await expect(stage).toHaveAttribute('data-render-state','ready',{timeout:20000});await expect(stage).toHaveAttribute('data-beads','0');
});

test('Pachinko camera, picker and labels fit a 320px phone',async({page},info)=>{
  test.skip(!info.project.name.startsWith('mobile'));await page.setViewportSize({width:320,height:720});await open(page);
  const bounds=await page.locator('.controls').boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(321);
  await openViewMenu(page);await expect(page.locator('#experimental-options')).toBeVisible();await expect(page.getByRole('link',{name:'Open CartoLite Pachinko',exact:true})).toHaveAttribute('aria-current','page');
  const panel=await page.locator('#view-panel').boundingBox();expect(panel!.y).toBeGreaterThanOrEqual(0);expect(panel!.y+panel!.height).toBeLessThanOrEqual(720);
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await expect(page.locator('#view-panel')).toBeHidden();await expect(page.locator('#view-button')).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('pachinko-phone-320.png')});
});

test('Pachinko stays bounded, responsive and independent of basemap code',async({page},info)=>{
  test.skip(info.project.name!=='desktop');test.setTimeout(60000);const requests:string[]=[];page.on('request',request=>requests.push(request.url()));await open(page);
  const result=await page.evaluate(async()=>{
    let seq=0,ticks=0,maxDelay=0,previous=performance.now();const timer=setInterval(()=>{const at=performance.now();maxDelay=Math.max(maxDelay,at-previous-25);previous=at;ticks++;},25);
    for(let i=0;i<600;i++){seq++;window.dispatchEvent(new CustomEvent('visual-packet',{detail:{seq,id:`stress-${seq}`,at:Date.now(),payloadType:['Advert','Trace','Text','ACK','Control','Other'][seq%6],mode:'observer',observer:{id:'visual-a',label:'Visual Alpha',lat:43.45,lng:-80.35}}}));await new Promise(resolve=>setTimeout(resolve,10));}
    clearInterval(timer);return{ticks,maxDelay,metrics:(window as any).__pachinko.metrics};
  });
  await info.attach('pachinko-resources',{body:JSON.stringify(result),contentType:'application/json'});
  expect(result.ticks).toBeGreaterThan(100);expect(result.maxDelay).toBeLessThan(300);expect(result.metrics.drawCalls).toBeLessThan(40);
  const stage=page.locator('#pachinko-stage');expect(Number(await stage.getAttribute('data-beads'))).toBeLessThanOrEqual(Number(await stage.getAttribute('data-capacity')));expect(Number(await stage.getAttribute('data-queue'))).toBeLessThanOrEqual(48);await expect(stage).toHaveAttribute('data-links','0');
  expect(requests.some(url=>/maplibre.*\.js|\.pbf|tiles\./i.test(url))).toBe(false);
  await page.screenshot({path:info.outputPath('pachinko-live-flow.png')});
  await page.locator('#pause-button').click();await page.locator('#box-button').click();await page.locator('#box-panel summary').click();await page.locator('#clear-button').click();await expect(stage).toHaveAttribute('data-beads','0');
  expect(await page.evaluate(()=>{const m=(window as any).__pachinko.metrics;return{geometries:m.geometries,textures:m.textures};})).toEqual({geometries:result.metrics.geometries,textures:result.metrics.textures});
});
