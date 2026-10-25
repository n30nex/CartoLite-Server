import { expect,test,type Page } from '@playwright/test';
import { visualFixture } from './visualFixtures';
import { openDisplay,openViewMenu } from './dockControls';

async function packet(page:Page,count=1,long=false){await page.evaluate(({count,long})=>{
  for(let i=0;i<count;i++)window.dispatchEvent(new CustomEvent('visual-packet',{detail:{seq:i+1,id:`polish-${i}`,at:Date.now(),payloadType:['Text','Advert','Trace','ACK','Control'][i%5],mode:'route',segments:Array.from({length:long?24:1},()=>({routeId:'visual-hop',fromId:'visual-a',toId:'visual-b'}))}}));
},{count,long});}

for(const view of ['chronoscope','firehose','pachinko'])test(`Visual polish ${view} Home fits chrome and appearance preserves manual framing`,async({page},info)=>{
  test.setTimeout(60000);
  await page.setViewportSize(info.project.name==='desktop'?{width:1440,height:900}:info.project.name==='mobile-landscape'?{width:568,height:320}:{width:320,height:720});
  await visualFixture(page);
  await page.addInitScript(view=>window.addEventListener(`cartolite-${view}-ready`,event=>{(window as any).__polish=(event as CustomEvent).detail.scene;}),view);
  await page.goto(`/${view}/`);const stage=page.locator(`#${view}-stage`);
  await expect(stage).toHaveAttribute('data-graphics-ready','true',{timeout:20000});
  await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');
  // Inspect the actual static geometry and billboards, not the fitting helper's bounds.
  const fits=()=>page.evaluate(()=>{
    const s=(window as any).__polish;if(!s?.scene)return false;s.scene.updateMatrixWorld(true);s.camera.updateMatrixWorld();
    const width=innerWidth,height=innerHeight,stage=document.querySelector('[id$="-stage"]')!.getBoundingClientRect();
    let top=12,bottom=height-12,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,count=0;
    for(const selector of ['#topbar','.chrono-caption','.firehose-caption']){const n=document.querySelector<HTMLElement>(selector);if(n?.getClientRects().length)top=Math.max(top,n.getBoundingClientRect().bottom-stage.top+8);}
    for(const selector of ['.controls','.pachinko-buckets']){const n=document.querySelector<HTMLElement>(selector);if(n?.getClientRects().length)bottom=Math.min(bottom,n.getBoundingClientRect().top-stage.top-8);}
    const point=s.controls.target.clone();const add=()=>{point.project(s.camera);const x=(point.x+1)*width/2,y=(1-point.y)*height/2;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);count++;};
    s.scene.traverse((o:any)=>{
      if((o.isMesh||o.isLineSegments)&&!o.isInstancedMesh&&o.material?.type!=='ShaderMaterial'&&o.geometry?.attributes.position){const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++){point.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);add();}}
      if(o.isSprite){const position=o.getWorldPosition(point.clone()),scale=o.getWorldScale(point.clone());const right=point.clone().setFromMatrixColumn(s.camera.matrixWorld,0),up=point.clone().setFromMatrixColumn(s.camera.matrixWorld,1);for(const x of [-.5,.5])for(const y of [-.5,.5]){point.copy(position).addScaledVector(right,x*scale.x).addScaledVector(up,y*scale.y);add();}}
    });
    return count>20&&minX>=8&&maxX<=width-8&&minY>=top-2&&maxY<=bottom+2;
  });
  await expect.poll(fits,{timeout:10000}).toBe(true);
  await packet(page,12);await page.waitForTimeout(900);
  await page.screenshot({path:info.outputPath(`${view}-home-polished.png`)});
  if(view==='chronoscope'){
    const viewport=page.viewportSize()!;
    await page.locator('#time-button').click();await page.locator('#chrono-mode').selectOption('flat');await page.keyboard.press('Escape');
    await page.setViewportSize({width:viewport.height,height:viewport.width});
    await page.locator('#time-button').click();await page.locator('#chrono-mode').selectOption('sculpture');await page.keyboard.press('Escape');
    await expect.poll(fits).toBe(true);await page.setViewportSize(viewport);await expect.poll(fits).toBe(true);
  }
  await stage.focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('+');
  const pose=()=>page.evaluate(()=>{const s=(window as any).__polish;return[...s.camera.position.toArray(),...s.controls.target.toArray(),s.camera.zoom];});
  const before=await pose();await openDisplay(page);await page.locator('[data-display="basemap"]').selectOption('light');await page.keyboard.press('Escape');
  (await pose()).forEach((value:number,i:number)=>expect(value).toBeCloseTo(before[i],7));
  await expect.poll(async()=>Number(await stage.getAttribute(view==='chronoscope'?'data-event-count':'data-accepted'))).toBeGreaterThan(0);
  await page.screenshot({path:info.outputPath(`${view}-manual-daylight.png`)});
});

test('Visual polish Terminal recovery controls survive an unreadable custom palette',async({page},info)=>{
  await visualFixture(page,10.2,true);await page.goto('/terminal/');await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle');
  await openDisplay(page);await page.getByText('Element colours',{exact:true}).click();
  await page.getByLabel('Terminal colour element').selectOption('ink');await page.getByLabel('Terminal colour hex').fill('#050b10');
  await expect(page.locator('html')).toHaveAttribute('data-terminal-recovery','true');
  const close=page.locator('#layers-panel .panel-close,#layers-panel [aria-label="Close map options"]').first();
  await expect(close).toBeVisible();
  // Test readable contrast, not a particular browser's transition/interpolated shade.
  await expect.poll(()=>close.evaluate(el=>{
    const luminance=(colour:string)=>colour.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0);
    const ink=luminance(getComputedStyle(el).color),background=luminance(getComputedStyle(el.closest('header')!).backgroundColor);
    return(Math.max(ink,background)+.05)/(Math.min(ink,background)+.05);
  })).toBeGreaterThanOrEqual(4.5);
  await close.click();await openDisplay(page);
  await expect(page.getByRole('button',{name:'Reset Terminal display',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Reset Terminal display',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-terminal-recovery','false');
  await page.screenshot({path:info.outputPath('terminal-recovery-polished.png')});
});

test('Visual polish packet inspection keeps its close button visible through a long chain',async({page},info)=>{
  await visualFixture(page);if(info.project.name!=='desktop')await page.setViewportSize({width:320,height:640});
  await page.goto('/chronoscope/');await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');await packet(page,1,true);
  await page.locator('#time-button').click();await page.locator('#recent-events button').first().click();
  const sheet=page.locator('#node-inspector-sheet'),close=sheet.getByRole('button',{name:'Close activity details'});
  await expect(sheet).toBeVisible();await sheet.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  const panel=(await sheet.boundingBox())!,button=(await close.boundingBox())!;expect(button.y).toBeGreaterThanOrEqual(panel.y);expect(button.y+button.height).toBeLessThanOrEqual(panel.y+panel.height);
  await page.screenshot({path:info.outputPath('packet-inspector-polished.png')});await close.click();await expect(sheet).toBeHidden();await expect(page.locator('#chronoscope-stage')).toBeFocused();
});

test('Visual polish Netgraph uses the bottom dock without a phantom attribution gap',async({page},info)=>{
  test.skip(info.project.name!=='desktop');await visualFixture(page);await page.goto('/netgraph/');await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-total-nodes','3');await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-render-state','idle');await page.waitForTimeout(200);
  const dock=(await page.locator('.controls').boundingBox())!;expect(page.viewportSize()!.height-dock.y-dock.height).toBeLessThanOrEqual(20);
  await page.screenshot({path:info.outputPath('netgraph-dock-polished.png')});
});

test('Visual polish Labs navigation follows the picker and keeps every experience reachable',async({page},info)=>{
  await visualFixture(page);await page.goto('/');test.skip(await page.locator('#labs-options').count()===0,'Canada-only Labs');
  if(info.project.name!=='desktop')await page.setViewportSize(info.project.name==='mobile-landscape'?{width:568,height:320}:{width:320,height:720});
  await page.goto('/labs/?demo=1&experiment=packet-pond');
  for(const id of ['packet-pond','firefly-meadow','mesh-loom','little-mesh-villages']){
    await page.locator('#experiment-select').selectOption(id);await openViewMenu(page,'Labs');
    await expect(page.locator(`#labs-options [data-lab="${id}"]`)).toHaveAttribute('aria-current','page');
    await page.keyboard.press('Escape');if(await page.locator('#view-panel').isVisible())await page.keyboard.press('Escape');
    await page.waitForTimeout(300);await page.screenshot({path:info.outputPath(`${id}-polished.png`)});
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(info.project.name==='desktop'){
    const items=await page.locator('.dock-views > a,.dock-views > details > summary').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return{x:r.x,right:r.right};}));
    for(let i=1;i<items.length;i++)expect(items[i]!.x).toBeGreaterThanOrEqual(items[i-1]!.right);
  }
});
