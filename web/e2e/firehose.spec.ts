import { expect, test, type Page } from '@playwright/test';
import { visualFixture } from './visualFixtures';
import { openDisplay, openViewMenu } from './dockControls';
import type { StateV2 } from '../src/types';

const diagnostics=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{
 const lines:string[]=[];diagnostics.set(page,lines);
 const add=(value:string)=>{if(lines.length<80)lines.push(value.slice(0,2500).replace(/([?&](?:key|api_key|token)=)[^&#\s]+/gi,'$1[redacted]'));};
 page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')add(m.text());});page.on('pageerror',e=>add(e.stack??e.message));
 page.on('response',r=>{if(r.status()>=400)add(`${r.status()} ${new URL(r.url()).pathname}`);});
});
test.afterEach(async({page},info)=>{
 if(info.status!==info.expectedStatus)await info.attach('firehose-diagnostics',{body:JSON.stringify({messages:diagnostics.get(page),state:await page.locator('#firehose-stage').evaluate(el=>({...((el as HTMLElement).dataset)})).catch(()=>null)},null,2),contentType:'application/json'});
});

async function setup(page:Page) {
  const state=await visualFixture(page);
  await page.addInitScript(()=>window.addEventListener('cartolite-firehose-ready',event=>{(window as any).__hose=(event as CustomEvent).detail.scene;}));
  return state;
}
async function open(page:Page){await page.goto('/firehose/');await expect(page.locator('#firehose-stage')).toHaveAttribute('data-render-state','ready',{timeout:20000});await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');}
async function sameCamera(page:Page,position:number[]){const current:number[]=await page.evaluate(()=>(window as any).__hose.camera.position.toArray());for(let i=0;i<3;i++)expect(current[i]).toBeCloseTo(position[i]!,10);}
async function packet(page:Page,seq:number,observer=false){await page.evaluate(({seq,observer})=>window.dispatchEvent(new CustomEvent('visual-packet',{detail:{seq,id:`firehose-${seq}`,at:Date.now(),payloadType:['Advert','Trace','Text','ACK','Control'][seq%5],...(observer?{mode:'observer',observer:{id:'visual-a',label:'Visual Alpha',lat:43.45,lng:-80.35}}:{mode:'route',segments:[{routeId:'visual-hop',fromId:'visual-a',toId:'visual-b'}]})}})),{seq,observer});}

test('Firehose camera views and keyboard Pause preserve the pile',async({page},info)=>{
 await setup(page);await open(page);await packet(page,1,true);
 const stage=page.locator('#firehose-stage');await expect(stage).toHaveAttribute('data-events','1');
 await stage.focus();await page.keyboard.press('Space');await expect(stage).toHaveAttribute('data-paused','true');
 await expect(page.locator('#pause-button')).toHaveAccessibleName('Resume physics and new packets');
 await page.locator('#box-button').click();
 for(const view of ['front','above','isometric']){
  await page.locator(`[data-camera-view="${view}"]`).click();
  await expect(stage).toHaveAttribute('data-events','1');await expect(stage).toHaveAttribute('data-paused','true');
  const point=await page.evaluate(()=>(window as any).__hose.projectWorld(0,0,0));
  const bounds=await stage.boundingBox();expect(point.x).toBeGreaterThan(0);expect(point.x).toBeLessThan(bounds!.width);expect(point.y).toBeGreaterThan(0);expect(point.y).toBeLessThan(bounds!.height);
 }
 await page.keyboard.press('Escape');await stage.focus();await page.keyboard.press('Space');await expect(stage).toHaveAttribute('data-paused','false');
 await page.screenshot({path:info.outputPath('firehose-camera-polished.png')});
});

test('Firehose starts empty, preserves links and never refills paused time',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await setup(page);await open(page);const stage=page.locator('#firehose-stage');
 await expect(stage).toHaveAttribute('data-beads','0');await expect(stage).toHaveAttribute('data-visual-profile','luminous');await expect(page.locator('.dock-views [aria-current=page]')).toHaveText('Firehose');
 await packet(page,1);await packet(page,2,true);await expect(stage).toHaveAttribute('data-beads','3');await expect(stage).toHaveAttribute('data-links','1');await expect(stage).toHaveAttribute('data-events','2');
 await page.locator('#pause-button').click();await expect(stage).toHaveAttribute('data-paused','true');await page.waitForTimeout(100);
 const steps=await stage.getAttribute('data-steps');await packet(page,3);await page.waitForTimeout(150);expect(await stage.getAttribute('data-steps')).toBe(steps);
 await page.locator('#pause-button').click();await page.waitForTimeout(180);await expect(stage).toHaveAttribute('data-events','2');
 await packet(page,4);await expect(stage).toHaveAttribute('data-events','3');
 await page.locator('#find-button').click();await page.locator('#node-search').fill('Alpha');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 await expect(page.locator('#node-inspector-sheet')).toContainText('Visual Alpha');await expect(page.locator('#node-inspector-sheet')).toContainText('particles from this node');
 await page.keyboard.press('Escape');await page.screenshot({path:info.outputPath('firehose-live.png')});expect(errors).toEqual([]);
});

test('Firehose settles a real pile, tilts and pours it into the pit',async({page},info)=>{
 await setup(page);await open(page);const stage=page.locator('#firehose-stage');
 for(let i=1;i<=20;i++){await packet(page,i,i%3===0);}
 await expect.poll(async()=>Number(await stage.getAttribute('data-beads'))).toBeGreaterThan(20);
 await page.waitForTimeout(1700);await page.screenshot({path:info.outputPath('firehose-settling.png')});
 const before=await page.evaluate(()=>(window as any).__hose.camera.position.toArray());
 await stage.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(180);
 await sameCamera(page,before);
 expect(await page.evaluate(()=>Math.abs((window as any).__hose.box.quaternion.y)+Math.abs((window as any).__hose.box.quaternion.z))).toBeGreaterThan(.01);
 await page.locator('#box-button').click();await page.locator('#orbit-mode').click();await page.keyboard.press('Escape');await stage.focus();await page.keyboard.press('ArrowRight');
 const orbited:number[]=await page.evaluate(()=>(window as any).__hose.camera.position.toArray());expect(Math.hypot(...orbited.map((v,i)=>v-before[i]))).toBeGreaterThan(.1);
 await page.locator('#pour-button').click();await expect.poll(async()=>Number(await stage.getAttribute('data-drained')),{timeout:12000}).toBeGreaterThan(0);
 await expect(stage).toHaveAttribute('data-beads','0',{timeout:12000});await page.screenshot({path:info.outputPath('firehose-poured.png')});
 await page.locator('#box-button').click();await page.locator('#upright-button').click();await page.keyboard.press('Escape');
 await expect.poll(()=>page.evaluate(()=>Math.abs((window as any).__hose.box.quaternion.w)),{timeout:5000}).toBeGreaterThan(.99);
});

test('Firehose scene themes preserve the pile and camera',async({page},info)=>{
 await setup(page);await open(page);await packet(page,1);await expect(page.locator('#firehose-stage')).toHaveAttribute('data-beads','2');
 await page.locator('#box-button').click();await page.locator('#orbit-mode').click();await page.keyboard.press('Escape');await page.locator('#firehose-stage').focus();await page.keyboard.press('ArrowRight');
 const camera=await page.evaluate(()=>(window as any).__hose.camera.position.toArray());
 for(const theme of ['dark','light','streets']){await openDisplay(page);await page.getByLabel('Scene style',{exact:true}).selectOption(theme);await page.keyboard.press('Escape');
   await expect(page.locator('html')).toHaveAttribute('data-basemap',theme);await expect(page.locator('#firehose-stage')).toHaveAttribute('data-events','1');
   await sameCamera(page,camera);
   const contrast=await page.evaluate(()=>{
     const luminance=(color:string)=>{const [r,g,b]=(color.match(/[\d.]+/g)??[]).slice(0,3).map(c=>{const n=Number(c)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return .2126*r!+.7152*g!+.0722*b!;};
     return ['#topbar','.controls'].map(selector=>{const panel=document.querySelector(selector)!;const ink=getComputedStyle(panel.querySelector('button,a')!),back=getComputedStyle(panel);const a=luminance(ink.color),b=luminance(back.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
   });for(const ratio of contrast)expect(ratio).toBeGreaterThanOrEqual(4.5);
   await page.screenshot({path:info.outputPath(`firehose-${theme}.png`)});
 }
 await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('#firehose-stage')).toHaveAttribute('data-paused','true');
 await page.locator('#pause-button').click();await expect(page.locator('#firehose-stage')).toHaveAttribute('data-paused','false');
});

test('Firehose phone dock and sheets fit 320px with keyboard focus',async({page},info)=>{
 test.skip(info.project.name==='desktop');await setup(page);await page.setViewportSize({width:320,height:720});await open(page);
 const framing=await page.evaluate(()=>[-1,1].flatMap(x=>[-1,1].map(z=>(window as any).__hose.projectWorld(x*2.6,0,z*1.8))));
 for(const p of framing){expect(p.x).toBeGreaterThanOrEqual(0);expect(p.x).toBeLessThanOrEqual(320);expect(p.y).toBeGreaterThan(120);expect(p.y).toBeLessThan(650);}
 const boxes=await page.locator('.controls > button,.controls > div > button').evaluateAll(elements=>elements.filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}));
 expect(boxes).toHaveLength(6);expect(Math.max(...boxes.map(r=>r.y))-Math.min(...boxes.map(r=>r.y))).toBeLessThan(2);
 for(const b of boxes){expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.w).toBeLessThanOrEqual(320);expect(b.w).toBeGreaterThanOrEqual(44);expect(b.h).toBeGreaterThanOrEqual(44);}
 await page.locator('#box-button').click();const panel=await page.locator('#box-panel').boundingBox();expect(panel!.x).toBeGreaterThanOrEqual(0);expect(panel!.x+panel!.width).toBeLessThanOrEqual(320);expect(panel!.y).toBeGreaterThanOrEqual(0);
 await page.keyboard.press('Escape');await expect(page.locator('#box-button')).toBeFocused();await openDisplay(page);await page.keyboard.press('Escape');await expect(page.locator('#view-button')).toBeFocused();
 await page.screenshot({path:info.outputPath('firehose-phone-320.png')});
});

test('Firehose restores GPU resources without replaying or resetting the pile',async({page},info)=>{
 test.skip(info.project.name!=='desktop');await setup(page);await open(page);await packet(page,1);const stage=page.locator('#firehose-stage');await expect(stage).toHaveAttribute('data-beads','2');
 const resources=await page.evaluate(()=>{const m=(window as any).__hose.metrics;return{geometries:m.geometries,textures:m.textures};});
 await page.evaluate(()=>{const gl=(document.querySelector('#firehose-canvas') as HTMLCanvasElement).getContext('webgl2')!;(window as any).__loss=gl.getExtension('WEBGL_lose_context');(window as any).__loss.loseContext();});
 await expect(page.locator('#graphics-notice')).toBeVisible();await packet(page,2);await page.evaluate(()=>(window as any).__loss.restoreContext());
 await expect(page.locator('#graphics-notice')).toBeHidden();await expect(stage).toHaveAttribute('data-events','1');await packet(page,3);await expect(stage).toHaveAttribute('data-events','2');
 const restored=await page.evaluate(()=>{const m=(window as any).__hose.metrics;return{geometries:m.geometries,textures:m.textures};});expect(restored).toEqual(resources);
});

test('Firehose gives an actionable graphics fallback and never starts physics without it',async({page},info)=>{
 test.skip(info.project.name!=='desktop');await setup(page);await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type:any,...args:any[]){if(type==='webgl2')return null;return(original as any).call(this,type,...args);} as typeof original;});
 await page.goto('/firehose/');await expect(page.locator('#fatal')).toBeVisible();await expect(page.locator('#fatal')).toContainText('WebGL2');await expect(page.getByRole('link',{name:'Open Netgraph',exact:true})).toBeVisible();
});

test('Firehose stays bounded under synthetic load and keeps its dependencies isolated',async({page},info)=>{
 test.skip(info.project.name!=='desktop');test.setTimeout(60000);await setup(page);const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
 const now=Date.now(),nodes=Array.from({length:16},(_,i)=>({id:`pile-${i}`,label:`Synthetic ${i}`,lat:43+i*.001,lng:-80+i*.001,role:'repeater' as const,observer:false,lastSeen:now}));
 const state:StateV2={schemaVersion:2,bootId:'visual-fixture',seq:0,serverTime:now,status:{feed:'connected',activity:'active',dropped:0,version:'test',gitSha:'synthetic'},map:{center:[-80,43],zoom:8},nodes,routes:[]};
 await page.route('**/api/state',r=>r.fulfill({json:state}));await open(page);
 const result=await page.evaluate(async()=>{
  const physics:number[]=[];const programsBefore=Number(document.getElementById('firehose-stage')!.dataset.programs);let peak:{at:number;particles:number;quality:string;drawMs:number;programs:number}|undefined;const began=performance.now();let seq=0,ticks=0,maxDelay=0,previous=performance.now();const timer=setInterval(()=>{const now=performance.now();const delay=now-previous-25;if(delay>maxDelay){const stage=document.getElementById('firehose-stage')!;maxDelay=delay;peak={at:now-began,particles:Number(stage.dataset.beads),quality:stage.dataset.quality??'',drawMs:Number(stage.dataset.drawMs),programs:Number(stage.dataset.programs)};}previous=now;ticks++;const s=document.querySelector<HTMLElement>('#firehose-stage');if(Number(s?.dataset.beads)>1000)physics.push(Number(s?.dataset.physicsMs));},25);
  const send=()=>{seq++;window.dispatchEvent(new CustomEvent('visual-packet',{detail:{seq,id:`pile-${seq}`,at:Date.now(),payloadType:['Advert','Trace','Text','ACK','Control'][seq%5],mode:'route',segments:Array.from({length:15},(_,i)=>({routeId:`chain-${i}`,fromId:`pile-${i}`,toId:`pile-${i+1}`}))}}));};
  for(let i=0;i<240;i++){send();await new Promise(r=>setTimeout(r,25));}
  clearInterval(timer);physics.sort((a,b)=>a-b);return{ticks,maxDelay,peak,programsBefore,programsAfter:Number(document.getElementById('firehose-stage')!.dataset.programs),physicsP95:physics[Math.floor(physics.length*.95)]??0,samples:physics.length};
 });
 await info.attach('firehose-timing',{body:JSON.stringify(result),contentType:'application/json'});
 const stage=page.locator('#firehose-stage');await expect(stage).toHaveAttribute('data-graphics-ready','true');expect(result.programsAfter).toBe(result.programsBefore);expect(Number(await stage.getAttribute('data-beads'))).toBeLessThanOrEqual(Number(await stage.getAttribute('data-capacity')));
 expect(Number(await stage.getAttribute('data-beads'))).toBeGreaterThan(500);expect(Number(await stage.getAttribute('data-queue'))).toBeLessThanOrEqual(48);
 expect(result.samples).toBeGreaterThan(10);expect(result.physicsP95).toBeLessThan(25);expect(result.ticks).toBeGreaterThan(100);expect(result.maxDelay).toBeLessThan(300);expect(Number(await stage.getAttribute('data-draw-calls'))).toBeLessThan(40);
 await page.screenshot({path:info.outputPath('firehose-dense-pile.png')});
 const resources=await page.evaluate(()=>{const m=(window as any).__hose.metrics;return{geometries:m.geometries,textures:m.textures};});
 await page.locator('#pause-button').click();await page.locator('#box-button').click();await page.locator('#box-panel summary').click();await page.locator('#clear-button').click();await expect(stage).toHaveAttribute('data-beads','0');
 expect(await page.evaluate(()=>{const m=(window as any).__hose.metrics;return{geometries:m.geometries,textures:m.textures};})).toEqual(resources);
 expect(requests.some(url=>/maplibre.*\.js|\.pbf|tiles\./i.test(url))).toBe(false);
 await info.attach('firehose-resources',{body:JSON.stringify({result,resources}),contentType:'application/json'});
 requests.length=0;await page.goto('/netgraph/');await expect(page.locator('#netgraph-stage')).toBeVisible();expect(requests.some(url=>/firehose|pachinko|arcade|scene3d|rapier|three.*\.js/i.test(url))).toBe(false);
});

test('Firehose navigation is available alongside the existing views',async({page},info)=>{
 test.skip(info.project.name!=='desktop');await setup(page);await page.goto('/chronoscope/');await openViewMenu(page);await page.getByRole('link',{name:'Open CartoLite Firehose',exact:true}).click();await expect(page.locator('#firehose-stage')).toHaveAttribute('data-render-state','ready');
});

test('Firehose luminous arrivals keep floor effects bounded and freeze with Pause',async({page},info)=>{
 await setup(page);await open(page);
 await page.evaluate(()=>{let seq=0;(window as any).__arrivalTimer=setInterval(()=>window.dispatchEvent(new CustomEvent('visual-packet',{detail:{seq:++seq,id:`arrival-${seq}`,at:Date.now(),payloadType:['Advert','Trace','Text','ACK','Control'][seq%5],mode:'route',segments:[{routeId:'visual-hop',fromId:'visual-a',toId:'visual-b'}]}})),100);});
 await expect.poll(()=>page.evaluate(()=>(window as any).__hose.metrics.impacts)).toBeGreaterThan(2);
 await page.screenshot({path:info.outputPath('firehose-active-flow.png')});
 await page.evaluate(()=>clearInterval((window as any).__arrivalTimer));
 await page.locator('#pause-button').click();await page.waitForTimeout(100);
 const before=await page.locator('#firehose-stage').getAttribute('data-render-frames');await page.waitForTimeout(160);
 expect(await page.locator('#firehose-stage').getAttribute('data-render-frames')).toBe(before);
});

test('Firehose suspends hidden physics and resumes only fresh packets',async({page},info)=>{
 test.skip(info.project.name!=='desktop');const state=await setup(page);let snapshots=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/state')snapshots++;});await open(page);
 await packet(page,1);const stage=page.locator('#firehose-stage');await expect(stage).toHaveAttribute('data-events','1');
 await page.evaluate(()=>{(window as any).__testHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>Boolean((window as any).__testHidden)});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>(window as any).__testHidden?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(200);const before={steps:await stage.getAttribute('data-steps'),frames:await stage.getAttribute('data-render-frames')};
 await packet(page,2);await page.waitForTimeout(250);expect(await stage.getAttribute('data-steps')).toBe(before.steps);expect(await stage.getAttribute('data-render-frames')).toBe(before.frames);
 // Recovery replaces the hidden interval with the server's current cursor.
 await page.route('**/api/state',r=>r.fulfill({json:{...state,seq:2}}));
 await page.evaluate(()=>{(window as any).__testHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await expect.poll(()=>snapshots).toBeGreaterThan(1);await page.waitForTimeout(150);
 await expect(stage).toHaveAttribute('data-events','1');await packet(page,3);await expect(stage).toHaveAttribute('data-events','2');
});
