import { expect, test } from '@playwright/test';
import { visualFixture } from './visualFixtures';
import { openViewMenu, openDisplay } from './dockControls';
import type { StateV2, PacketView } from '../src/types';

test('Chronoscope presents regional time depth in a reproducible showcase',async({page},info)=>{
  await visualFixture(page);const now=Date.now();
  const anchors=[[-80.35,43.45],[-79.38,43.65],[-75.69,45.42],[-73.57,45.5]];
  const names=['Waterloo','Toronto','Ottawa','Montreal'];
  const nodes=anchors.flatMap(([lng,lat],group)=>Array.from({length:8},(_,i)=>({id:`show-${group}-${i}`,label:`${names[group]} ${i+1}`,lng:lng!+i*.001,lat:lat!+i*.001,role:'repeater' as const,observer:false,lastSeen:now})));
  const links=nodes.map((node,i)=>({id:`local-${i}`,fromId:node.id,toId:nodes[Math.floor(i/8)*8+(i+1)%8]!.id,packetCount:4,lastHeard:now,intensity:2 as const,lastKind:'Text' as const,traffic:4}));
  const crosses=[0,1,2].map(i=>({id:`cross-${i}`,fromId:nodes[i*8]!.id,toId:nodes[(i+1)*8]!.id,packetCount:4,lastHeard:now,intensity:2 as const,lastKind:'Text' as const,traffic:4}));
  const state:StateV2={schemaVersion:2,bootId:'visual-fixture',seq:0,serverTime:now,status:{feed:'connected',activity:'active',dropped:0,version:'test',gitSha:'synthetic'},map:{center:[-78,44],zoom:8},nodes,routes:[...links,...crosses]};
  await page.route('**/api/state',route=>route.fulfill({json:state}));
  await page.addInitScript(()=>window.addEventListener('cartolite-chronoscope-ready',event=>{(window as any).__chrono=(event as CustomEvent).detail.scene;}));
  await page.goto('/chronoscope/');await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');
  await page.evaluate(({nodes,links,crosses})=>{
    const scene=(window as any).__chrono,at=performance.now();
    const segments=(routes:typeof links)=>routes.map(r=>({routeId:r.id,from:nodes.find(n=>n.id===r.fromId)!,to:nodes.find(n=>n.id===r.toId)!}));
    for(let i=1;i<=24;i++)scene.timeline.add({seq:i,id:`history-${i}`,at:Date.now(),payloadType:['Advert','Trace','Text','ACK'][i%4],mode:'route',segments:segments(i%4===0?crosses:[links[i%links.length]!])},at-55_000+i*1_500);
    scene.addPacket({seq:25,id:'current',at:Date.now(),payloadType:'Text',mode:'route',segments:segments(crosses)});
  },{nodes,links,crosses});
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-active-count','1');
  await expect(page.locator('#chrono-status')).toContainText('25 observed events');
  await page.screenshot({path:info.outputPath('chronoscope-sculpture.png')});
  await page.locator('#time-button').click();await page.locator('#freeze-button').click();await page.getByLabel('Chronoscope view').selectOption('slice');await page.getByLabel('Moment to inspect').fill('30');await page.keyboard.press('Escape');
  await page.screenshot({path:info.outputPath('chronoscope-slice.png')});
  await page.locator('#time-button').click();await page.getByLabel('Chronoscope view').selectOption('flat');await page.keyboard.press('Escape');
  await page.screenshot({path:info.outputPath('chronoscope-flat.png')});
});

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
  await page.addInitScript(()=>{Object.defineProperty(window,'AudioContext',{value:undefined});Object.defineProperty(window,'webkitAudioContext',{value:undefined});const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type:any,...args:any[]){if(type==='webgl2')return null;return (original as any).call(this,type,...args);} as typeof original;});
  await page.goto('/chronoscope/');await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('visual-packet',{detail:{seq:1,id:'heard',at:Date.now(),payloadType:'Advert',mode:'observer',observer:{id:'visual-a',label:'Visual Alpha',lat:43.45,lng:-80.35}}})));
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-renderer','canvas2d');
  await expect(page.locator('#sound-button')).toBeDisabled();
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-segment-count','1');
  await page.locator('#time-button').click();await page.locator('#recent-events button').first().click();
  await expect(page.locator('#node-inspector-sheet')).toContainText('Observer-only reception');
  await expect(page.locator('.chrono-hop')).toHaveCount(0);
  await page.keyboard.press('Escape');
  for(const theme of ['dark','light','streets']){
    await openDisplay(page);await page.getByLabel('Scene style',{exact:true}).selectOption(theme);await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-basemap',theme);
    await page.screenshot({path:info.outputPath(`chronoscope-${theme}.png`)});
    await openDisplay(page);await page.getByLabel('Interface theme',{exact:true}).selectOption(theme==='dark'?'light':'dark');await page.keyboard.press('Escape');
    const contrast=await page.evaluate(()=>{
      const ink=getComputedStyle(document.querySelector('.chrono-caption')!).color.match(/[\d.]+/g)!.slice(0,3).map(Number);
      const hex=getComputedStyle(document.documentElement).getPropertyValue('--scene-background').trim().slice(1),bg=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));
      const luminance=(rgb:number[])=>rgb.map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0);
      const a=luminance(ink),b=luminance(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({path:info.outputPath(`chronoscope-${theme}-mixed-interface.png`)});
    await openDisplay(page);await page.getByLabel('Interface theme',{exact:true}).selectOption('map');await page.keyboard.press('Escape');
  }
  await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-motion-mode','static');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Chronoscope phone controls fit one row and panels restore focus',async({page},info)=>{
  test.skip(info.project.name==='desktop');await visualFixture(page);await page.setViewportSize({width:320,height:720});
  await page.goto('/chronoscope/');await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-render-state','idle');
  const boxes=await page.locator('.controls > button,.controls > div > button').evaluateAll(elements=>elements.filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}));
  expect(boxes).toHaveLength(6);expect(Math.max(...boxes.map(r=>r.y))-Math.min(...boxes.map(r=>r.y))).toBeLessThan(2);
  for(const box of boxes){expect(box.w).toBeGreaterThanOrEqual(44);expect(box.h).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.w).toBeLessThanOrEqual(320);}
  await openDisplay(page);await expect(page.locator('#display-panel')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#view-button')).toBeFocused();
  await page.locator('#time-button').click();await expect(page.locator('#time-panel')).toBeVisible();
  const box=await page.locator('#time-panel').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(320);expect(box!.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Escape');await expect(page.locator('#time-button')).toBeFocused();
  await page.screenshot({path:info.outputPath('chronoscope-phone-320.png')});
});

test('Chronoscope shares preferences across tabs without losing frozen inspection',async({page,context},info)=>{
  test.skip(info.project.name!=='desktop');await visualFixture(page);
  await page.addInitScript(()=>window.addEventListener('cartolite-chronoscope-ready',event=>{(window as any).__chrono=(event as CustomEvent).detail.scene;}));
  await page.goto('/chronoscope/');await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('visual-packet',{detail:{seq:1,id:'shared',at:Date.now(),payloadType:'Text',mode:'route',segments:[{routeId:'visual-hop',fromId:'visual-a',toId:'visual-b'}]}})));
  await page.locator('#find-button').click();await page.locator('#node-search').fill('Alpha');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await page.locator('#time-button').click();await page.locator('#freeze-button').click();await page.keyboard.press('Escape');
  const before=await page.evaluate(()=>{const scene=(window as any).__chrono;return{time:scene.frameTime,point:scene.projectEndpoint(scene.nodes.get('visual-a')),selected:scene.selected};});
  const second=await context.newPage();await visualFixture(second);await second.goto('/chronoscope/');await expect(second.locator('#chronoscope-stage')).toHaveAttribute('data-render-state','idle');
  await openDisplay(second);await second.getByLabel('Scene style',{exact:true}).selectOption('light');await second.keyboard.press('Escape');
  await second.locator('#time-button').click();await second.getByLabel('Activity time window').selectOption('120');
  await expect(page.locator('html')).toHaveAttribute('data-basemap','light');await expect(page.locator('#chrono-window')).toHaveValue('120');
  expect(await page.evaluate(()=>{const scene=(window as any).__chrono;return{time:scene.frameTime,point:scene.projectEndpoint(scene.nodes.get('visual-a')),selected:scene.selected};})).toEqual(before);
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-event-count','1');await second.close();
  await page.locator('#time-button').click();await page.getByLabel('Chronoscope view').selectOption('flat');await page.getByLabel('Chronoscope view').selectOption('slice');
  await page.reload();await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-mode','flat');await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-frozen','false');await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-event-count','0');
  await page.locator('#regions-button').click();await page.locator('#regions-none').click();expect(new URL(page.url()).searchParams.has('node')).toBe(false);await expect(page.locator('#node-inspector-sheet')).toBeHidden();
});

test('Chronoscope keeps the camera still when a distant region appears',async({page},info)=>{
  test.skip(info.project.name!=='desktop');await visualFixture(page);
  await page.addInitScript(()=>window.addEventListener('cartolite-chronoscope-ready',event=>{(window as any).__chrono=(event as CustomEvent).detail.scene;}));
  await page.goto('/chronoscope/');await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');
  const before=await page.evaluate(()=>{const scene=(window as any).__chrono;return scene.projectEndpoint(scene.nodes.get('visual-a'));});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('visual-node',{detail:{seq:1,node:{id:'new-region',label:'New region radio',lat:-17.7,lng:179.8,role:'repeater',observer:false,lastSeen:Date.now()}}})));
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-total-nodes','4');
  expect(await page.evaluate(()=>{const scene=(window as any).__chrono;return scene.projectEndpoint(scene.nodes.get('visual-a'));})).toEqual(before);
  await expect(page.locator('#chronoscope-stage')).toHaveAttribute('data-event-count','0');
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
