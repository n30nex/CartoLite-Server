import { expect, test, type Page } from '@playwright/test';
import { visualFixture, visualPacket } from './visualFixtures';
import { openMapOptions } from './mapControls';
import { openViewMenu } from './dockControls';
import type { LiveMap } from '../src/map';

test('Terminal gives live packets a bounded glow while keeping labels and quiet modes clear', async ({page},info) => {
  test.slow();
  await visualFixture(page);
  // Capture the presentation sink, not the packet clock. A known frame makes
  // glow comparisons reproducible while the normal live-feed tests stay intact.
  await page.addInitScript(() => {
    window.addEventListener('cartolite-map-ready', event => {
      const animator=(event as CustomEvent).detail.animator;
      const original=animator.setFrameSink.bind(animator);
      animator.setFrameSink=(sink: (source?:HTMLCanvasElement)=>void) => { Object.assign(window,{terminalFrame:sink}); original(sink); };
    },{once:true});
  });
  await page.goto('/terminal/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle',{timeout:10000});
  await expect(page.locator('#map')).toHaveAttribute('data-terminal-renderer','webgl2');
  const render=async () => page.evaluate(() => {
    const host=document.querySelector<HTMLElement>('#map')!, source=document.createElement('canvas');
    source.width=host.clientWidth; source.height=host.clientHeight;
    Object.assign(source.dataset,{qualityMode:'full',activeCount:'1',residueCount:'0'});
    const ctx=source.getContext('2d')!, x=source.width*.5, y=source.height*.5;
    ctx.strokeStyle='#ff75b5'; ctx.lineWidth=5; ctx.beginPath(); ctx.moveTo(x-60,y); ctx.lineTo(x,y); ctx.stroke();
    ctx.beginPath(); ctx.arc(x-60,y,16,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='#fff'; ctx.fillRect(x-4,y-4,9,9);
    (window as unknown as {terminalFrame:(source:HTMLCanvasElement)=>void}).terminalFrame(source);
    const canvas=document.querySelector<HTMLCanvasElement>('#terminal-packets')!;
    const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
    let halo=0,core=0;
    for(let i=0;i<pixels.length;i+=4) {
      if(pixels[i+3]!>=8 && pixels[i+3]!<96) halo++;
      if(pixels[i+3]!>192 && Math.max(pixels[i]!,pixels[i+1]!,pixels[i+2]!)>230) core++;
    }
    return {halo,core,glow:Number(canvas.dataset.glow)};
  });
  await page.waitForTimeout(60);
  const spectacle=await render();
  expect(spectacle.glow).toBeGreaterThan(0); expect(spectacle.core).toBeGreaterThan(10);
  await page.screenshot({path:info.outputPath('terminal-live-spectacle.png')});
  const z=await page.evaluate(() => ['terminal-map','terminal-packets'].map(id=>Number(getComputedStyle(document.getElementById(id)!).zIndex)));
  expect(z[0]).toBeGreaterThan(z[1]!);
  await openMapOptions(page); await page.getByLabel('Effects intensity').selectOption('minimal'); await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  const minimal=await render();
  expect(minimal.glow).toBe(0); expect(minimal.core).toBeGreaterThan(10);
  expect(spectacle.halo).toBeGreaterThan(minimal.halo*1.25);
  await page.screenshot({path:info.outputPath('terminal-live-minimal.png')});
  await openMapOptions(page); await page.getByLabel('Effects intensity').selectOption('spectacle'); await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'reduce'}); await page.waitForTimeout(60);
  const reduced=await render(); expect(reduced.glow).toBe(0); expect(reduced.core).toBeGreaterThan(10);
});

test('Terminal preserves roads, landscape detail and measured label spacing', async ({page}, info) => {
  test.slow();
  await visualFixture(page,10.2,true);
  await page.addInitScript(() => {
    const canvas = CanvasRenderingContext2D.prototype, original = canvas.fillText, clear = canvas.clearRect;
    const labels: {text:string;x:number;y:number;width:number;height:number}[] = [];
    Object.assign(window,{terminalLabels:labels});
    canvas.clearRect = function(...args:Parameters<typeof clear>) { if(this.canvas.id==='terminal-map') labels.length=0; return clear.apply(this,args); };
    canvas.fillText = function(text,x,y,...rest) {
      if(this.canvas.id==='terminal-map') labels.push({text,x,y,width:this.measureText(text).width,height:parseFloat(this.font.match(/[\d.]+px/)![0])*1.25});
      return original.call(this,text,x,y,...rest);
    };
  });
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle',{timeout:10000});
  await page.screenshot({path:info.outputPath('detail-map-reference.png')});
  await page.goto('/terminal/');
  await expect(page.locator('#map')).toHaveAttribute('data-terminal-renderer','webgl2');
  // Read screenshot pixels; these muted, distinct colours must actually survive
  // the character conversion. Roads cannot disappear into either land texture.
  await expect.poll(async () => {
    const png = await page.screenshot();
    return page.evaluate(async base64 => {
      const image=new Image(); image.src='data:image/png;base64,'+base64; await image.decode();
      const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
      const ctx=canvas.getContext('2d')!; ctx.drawImage(image,0,0);
      const pixels=ctx.getImageData(0,Math.floor(image.height*.2),image.width,Math.floor(image.height*.6)).data;
      const colors=[[37,62,49],[40,50,63],[83,107,128]], count=[0,0,0];
      for(let i=0;i<pixels.length;i+=4) for(let k=0;k<3;k++) if(colors[k]!.every((v,c)=>Math.abs(pixels[i+c]!-v)<3)) count[k]!++;
      return Math.min(...count);
    },png.toString('base64'));
  }).toBeGreaterThan(40);
  expect(Number(await page.locator('#map').getAttribute('data-terminal-grid-cells'))).toBeLessThanOrEqual(16000);
  await expect.poll(() => page.evaluate(() => (window as unknown as {terminalLabels:{text:string}[]}).terminalLabels.some(label=>label.text==='Visual Alpha 🌲 Wide name'))).toBe(true);
  const labels=await page.evaluate(() => (window as unknown as {terminalLabels:{text:string;x:number;y:number;width:number;height:number}[]}).terminalLabels);
  expect(labels.length).toBeGreaterThan(0);
  for(let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++) {
    const a=labels[i]!,b=labels[j]!;
    expect(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y,`${a.text} overlaps ${b.text}`).toBe(false);
  }
  await page.screenshot({path:info.outputPath('detail-terminal.png')});
});

test('Terminal keeps geographic controls, live packets and device display choices', async ({ page }, info) => {
  test.slow();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await visualFixture(page); await page.goto('/terminal/');
  const map = page.locator('#map'), grid = page.locator('#terminal-map');
  await expect(map).toHaveAttribute('data-render-state', 'idle', { timeout: 10000 });
  await expect(map).toHaveAttribute('data-terminal-renderer','webgl2');
  await expect.poll(() => blueGlyphPixels(page)).toBeGreaterThan(100);
  await expect.poll(async () => Number(await grid.getAttribute('data-labels'))).toBeGreaterThan(0);
  await expect(page.locator('.dock-views [aria-current="page"]')).toHaveText('Terminal');
  await expect(page.locator('#fatal')).toBeHidden();
  await page.screenshot({ path: info.outputPath('terminal-ansi.png') });
  if (info.project.name === 'desktop') {
    await page.locator('#terrain-shortcut').click();
    await expect(map).toHaveAttribute('data-terrain3d','true');
    await expect(map).toHaveAttribute('data-camera-moving','false');
    await page.screenshot({path:info.outputPath('terminal-terrain.png')});
    await page.locator('#terrain-shortcut').click();
    await expect(map).toHaveAttribute('data-terrain3d','false');
  }
  const saved = await page.evaluate(() => [localStorage.getItem('cartolite:ui:v1'), localStorage.getItem('cartolite-server:ui:v1')]);
  await openMapOptions(page);
  await page.getByLabel('Terminal palette').selectOption('amber');
  await page.getByLabel('Terminal characters').selectOption('ascii');
  await page.getByLabel('Terminal cell size').selectOption('16');
  expect(await page.evaluate(() => [localStorage.getItem('cartolite:ui:v1'), localStorage.getItem('cartolite-server:ui:v1')])).toEqual(saved);
  await page.keyboard.press('Escape');
  await expect(grid).toHaveAttribute('data-glyphs', 'ascii');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-terminal-palette', 'amber');
  await expect(grid).toHaveAttribute('data-glyphs', 'ascii');
  await openMapOptions(page); await page.locator('#routes-button').click(); await page.keyboard.press('Escape');
  await expect(map).toHaveAttribute('data-routes-visible', 'false');
  await page.locator('#follow-button').click();
  await visualPacket(page, 1, 'Text');
  await expect(page.locator('#follow-card')).toBeVisible();
  await expect(page.locator('#packet-canvas')).toHaveAttribute('data-active-count', '1');
  await expect.poll(async () => Number(await page.locator('#terminal-packets').getAttribute('data-cells'))).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('terminal-amber-packet.png') });
  await page.locator('#follow-close').click();
  await page.locator('#find-button').click(); await page.locator('#node-search').fill('Visual Alpha');
  await page.getByRole('option', { name: /Visual Alpha/ }).click();
  await expect(map).toHaveAttribute('data-selected-node-id', 'visual-a');
  await expect(page.locator('#node-inspector-sheet')).toContainText('Visual Alpha');
  await page.keyboard.press('Escape');
  await openMapOptions(page); await page.getByLabel('Terminal palette').selectOption('green'); await page.keyboard.press('Escape');
  await page.screenshot({ path: info.outputPath('terminal-green.png') });
  expect(errors).toEqual([]);
});

test('Terminal stays compact and keeps selection when switching views', async ({ page }, info) => {
  if (info.project.name !== 'desktop') await page.setViewportSize(info.project.name.includes('landscape') ? { width:568,height:320 } : { width:320,height:640 });
  await visualFixture(page); await page.goto('/terminal/?node=visual-a');
  await expect(page.locator('#map')).toHaveAttribute('data-selected-node-id', 'visual-a', {timeout:10000});
  await page.keyboard.press('Escape');
  await openViewMenu(page);
  const links = page.locator('.dock-views a');
  expect((await links.allTextContents()).slice(0,3)).toEqual(['Map','Netgraph','Terminal']);
  const controls = (await page.locator('.controls').boundingBox())!;
  expect(controls.x).toBeGreaterThanOrEqual(0); expect(controls.x+controls.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({path:info.outputPath('terminal-navigation.png')});
  await page.getByRole('link', {name:'Open CartoLite Netgraph',exact:true}).click();
  await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-render-state','idle',{timeout:10000});
  await expect(page.locator('#terminal-map')).toHaveCount(0);
});

test('unavailable Terminal graphics falls back without stopping the feed', async ({page}) => {
  await visualFixture(page);
  await page.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.getShaderParameter;
    WebGL2RenderingContext.prototype.getShaderParameter = function (...args: Parameters<typeof original>) {
      if (args[1] === this.COMPILE_STATUS && this.getShaderSource(args[0])?.includes('terminal_scene') && !document.documentElement.dataset.shaderFailedOnce) {
        document.documentElement.dataset.shaderFailedOnce = 'true'; return false;
      }
      return original.apply(this,args);
    };
  });
  await page.goto('/terminal/');
  await expect(page.locator('.terminal-notice')).toBeVisible();
  await expect(page.locator('#fatal')).toBeHidden();
  expect(await page.locator('.maplibregl-canvas').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  await page.getByRole('button',{name:'Retry Terminal',exact:true}).click();
  await expect(page.locator('.terminal-notice')).toBeHidden();
  await expect.poll(() => blueGlyphPixels(page)).toBeGreaterThan(100);
});

test('Map and Netgraph never download the optional Terminal renderer', async ({page}) => {
  const terminalAssets: string[] = [];
  page.on('request', request => { if (/\/terminal-[^/]+\.(?:js|css)(?:\?|$)|\/fonts\/terminal\//.test(request.url())) terminalAssets.push(request.url()); });
  await visualFixture(page);
  for (const path of ['/', '/netgraph/']) {
    await page.goto(path);
    await expect(page.locator(path === '/' ? '#map' : '#netgraph-stage')).toHaveAttribute('data-render-state','idle',{timeout:10000});
  }
  expect(terminalAssets).toEqual([]);
});

test('Terminal presets keep real routes above every drawing mode and load the selected fonts',async({page},info)=>{
  test.slow();await visualFixture(page,10.2,true);await page.goto('/terminal/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle');
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  let sequence=0;
  for(const [preset,mode,font] of [['ansi','0','mono'],['amber','0','mono'],['green','0','mono'],['cga','2','pixel'],['ega','1','vt323'],['cell','3','mono']]) {
    await openMapOptions(page);await page.getByLabel('Terminal palette').selectOption(preset!);
    await page.keyboard.press('Escape');
    await expect(page.locator('#map')).toHaveAttribute('data-terminal-drawing',mode!);
    await expect(page.locator('html')).toHaveAttribute('data-terminal-font',font!);
    await expect(page.locator('#map')).toHaveAttribute('data-eligible-routes','1');
    await expect(page.locator('.terminal-notice')).toBeHidden();
    await expect.poll(()=>page.evaluate(()=>document.fonts.status)).toBe('loaded');
    if(font==='pixel')expect(await page.evaluate(()=>document.fonts.check('16px Silkscreen'))).toBe(true);
    if(font==='vt323')expect(await page.evaluate(()=>document.fonts.check('16px VT323'))).toBe(true);
    await visualPacket(page,++sequence, 'Text');
    await page.screenshot({path:info.outputPath(`preset-${preset}.png`)});
  }
  expect(errors).toEqual([]);
});

test('Terminal starts with the requested layers and Neon appearance without overwriting Map defaults',async({page},info)=>{
  test.slow();await visualFixture(page,10.2,true);
  await page.addInitScript(()=>{
    if(sessionStorage.getItem('terminal-defaults-seeded'))return;
    sessionStorage.setItem('terminal-defaults-seeded','true');
    for(const prefix of ['cartolite','cartolite-server']) {
      localStorage.removeItem(`${prefix}:terminal-ui:v1`);
      localStorage.setItem(`${prefix}:display:v1`,JSON.stringify({preset:'dotted',quality:'economy'}));
    }
  });
  await page.goto('/terminal/');await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle');
  await openMapOptions(page);
  for(const id of ['routes','live-packets','heatmap','node-labels','map-labels','roads','buildings'])await expect(page.locator(`#${id}-button`)).toHaveAttribute('aria-pressed','true');
  for(const id of ['clusters','regions','hillshade','terrain'])if(await page.locator(`#${id}-button`).count())await expect(page.locator(`#${id}-button`)).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#route-window')).toHaveValue('15m');await expect(page.locator('#terrain-relief')).toHaveValue('15');
  for(const [label,value] of [['Terminal palette','ansi'],['Terminal characters','braille'],['Terminal cell size','10'],['Effects intensity','spectacle'],['Detail level','complete'],['Graphics quality','high'],['Motion preference','system'],['Text size','standard'],['Route style','neon']])await expect(page.getByLabel(label!,{exact:true})).toHaveValue(value!);
  await page.screenshot({path:info.outputPath('terminal-defaults.png')});
  await page.locator('#route-window').selectOption('1h');await page.getByLabel('Route style',{exact:true}).selectOption('dashed');
  await page.keyboard.press('Escape');await page.goto('/');await openMapOptions(page);
  await expect(page.locator('#route-window')).toHaveValue('24h');await expect(page.getByLabel('Graphics quality')).toHaveValue('economy');await expect(page.getByLabel('Route style',{exact:true})).toHaveValue('dotted');
  await page.goto('/terminal/');await openMapOptions(page);
  await expect(page.locator('#route-window')).toHaveValue('1h');await expect(page.getByLabel('Route style',{exact:true})).toHaveValue('dashed');
  await page.getByRole('button',{name:'Reset all display settings',exact:true}).click();
  await expect(page.locator('#route-window')).toHaveValue('15m');await expect(page.getByLabel('Route style',{exact:true})).toHaveValue('neon');
});

test('Terminal colour and typography editor preserves other views, survives refresh and synchronizes tabs',async({page,context},info)=>{
  test.slow();await visualFixture(page,10.2,true);
  await page.addInitScript(()=>{
    if(!localStorage.getItem('cartolite-terminal-v2'))localStorage.setItem('cartolite-terminal-v1',JSON.stringify({palette:'amber',glyphs:'ascii',size:16}));
  });
  await page.goto('/terminal/?node=visual-a');
  await expect(page.locator('#map')).toHaveAttribute('data-selected-node-id','visual-a');
  await expect(page.locator('html')).toHaveAttribute('data-terminal-palette','amber');
  await page.keyboard.press('Escape');
  const saved=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>!key.startsWith('cartolite-terminal')&&!key.includes(':view:'))));
  await openMapOptions(page);
  await page.getByText('Typography',{exact:true}).click();
  await expect(page.getByLabel('Terminal map font size')).toHaveValue('16');
  await page.getByLabel('Terminal map font',{exact:true}).selectOption('vt323');
  await page.getByLabel('Terminal interface font').selectOption('pixel');
  await page.getByLabel('Terminal map font size').fill('18');
  await page.getByLabel('Terminal interface scale').fill('1.35');
  await page.getByText('Element colours',{exact:true}).click();
  await page.getByLabel('Terminal colour element').selectOption('water');
  await page.getByLabel('Terminal hue',{exact:true}).focus();await page.keyboard.press('ArrowRight');
  await page.getByLabel('Terminal colour hex').fill('#403a77');
  await page.getByLabel('Terminal colour element').selectOption('ink');
  await page.getByLabel('Terminal colour hex').fill('#050b10');
  // Even a deliberately invisible custom UI must leave the recovery editor legible.
  expect(await page.locator('.terminal-settings').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(213, 230, 223)');
  await page.screenshot({path:info.outputPath('terminal-editor.png')});
  const panel=(await page.locator('#layers-panel').boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
  expect(await page.locator('.terminal-settings').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.keyboard.press('Escape');await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-terminal-font','vt323');
  await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--terminal-water').trim())).toBe('#403a77');
  expect(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>!key.startsWith('cartolite-terminal')&&!key.includes(':view:'))))).toEqual(saved);
  const other=await context.newPage();await visualFixture(other,10.2,true);await other.goto('/terminal/');
  await expect(other.locator('html')).toHaveAttribute('data-terminal-font','vt323');
  await openMapOptions(page);await page.getByRole('button',{name:'Reset Terminal display',exact:true}).click();
  await expect(other.locator('html')).toHaveAttribute('data-terminal-palette','ansi');
  await expect(other.locator('html')).toHaveAttribute('data-terminal-font','mono');
  await other.close();
});

test('Terminal custom traffic ink stays visible over geography without restarting packets or camera',async({page},info)=>{
  test.slow();await visualFixture(page,10.2,true);
  await page.addInitScript(()=>window.addEventListener('cartolite-map-ready',event=>Object.assign(window,{terminalHarness:(event as CustomEvent).detail}),{once:true}));
  await page.goto('/terminal/');await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle');
  await openMapOptions(page);await page.getByText('Element colours',{exact:true}).click();
  await page.getByLabel('Terminal colour element').selectOption('text');await page.getByLabel('Terminal colour hex').fill('#67ff23');
  await page.getByLabel('Terminal colour element').selectOption('water');await page.getByLabel('Terminal colour hex').fill('#5b183a');
  await page.keyboard.press('Escape');
  await expect.poll(()=>greenRoutePixels(page)).toBeGreaterThan(20);
  const order=await page.evaluate(()=>{
    const {view}=(window as unknown as {terminalHarness:{view:LiveMap}}).terminalHarness;
    const ids=view.map.getLayersOrder();return [ids.indexOf('terminal-graphics'),ids.indexOf('route-exact-webgl')];
  });expect(order[0]).toBeLessThan(order[1]!);
  await page.screenshot({path:info.outputPath('terminal-custom-ink.png')});
  await openMapOptions(page);await page.locator('#routes-button').click();await page.keyboard.press('Escape');
  await expect(page.locator('#map')).toHaveAttribute('data-routes-visible','false');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle');
  try { await expect.poll(()=>greenRoutePixels(page)).toBeLessThan(10); }
  catch(error) {
    const diagnostic=await page.evaluate(async()=>{
      const {view}=(window as unknown as {terminalHarness:{view:LiveMap}}).terminalHarness;
      const map=view.map,gl=map.getCanvas().getContext('webgl2')!;
      const before={...map.getContainer().dataset};
      const layers=map.getLayersOrder().filter(id=>id.startsWith('route')).map(id=>({id,visibility:map.getLayoutProperty(id,'visibility')}));
      const gpuError=gl.getError();
      await new Promise<void>(resolve=>{map.once('render',()=>{map.once('render',()=>resolve());map.triggerRepaint();});map.triggerRepaint();});
      return {before,after:{...map.getContainer().dataset},layers,gpuError};
    });
    await info.attach('hidden-route-diagnostic',{body:JSON.stringify({...diagnostic,pixelsAfterTwoFrames:await greenRoutePixels(page)}),contentType:'application/json'});
    await page.screenshot({path:info.outputPath('hidden-route-after-two-frames.png')});
    throw error;
  }
  await visualPacket(page,1,'Text');
  const continuity=await page.evaluate(()=>{
    const {view,animator}=(window as unknown as {terminalHarness:{view:LiveMap;animator:{activeRoutes:{started:number;duration:number}[]}}}).terminalHarness;
    const before=animator.activeRoutes.map(route=>[route.started,route.duration]);const camera=[view.map.getCenter().toArray(),view.map.getZoom(),view.map.getPitch()];
    const input=document.querySelector<HTMLInputElement>('[data-terminal="mapBrightness"]')!;
    input.value='.3';input.dispatchEvent(new Event('input',{bubbles:true}));
    return {before,after:animator.activeRoutes.map(route=>[route.started,route.duration]),camera,afterCamera:[view.map.getCenter().toArray(),view.map.getZoom(),view.map.getPitch()]};
  });
  expect(continuity.before.length).toBe(1);expect(continuity.after).toEqual(continuity.before);expect(continuity.afterCamera).toEqual(continuity.camera);
  await expect.poll(async()=>Number(await page.locator('#terminal-packets').getAttribute('data-cells'))).toBeGreaterThan(0);
  await page.screenshot({path:info.outputPath('terminal-custom-live.png')});
});

test('Terminal cel-shaded 3D retains its profile and routes through graphics-context recovery',async({page},info)=>{
  test.skip(info.project.name!=='desktop','Actual context-loss injection is exercised on desktop Chromium; fallback/retry runs on every browser.');
  test.slow();await visualFixture(page,14,true);
  await page.addInitScript(()=>window.addEventListener('cartolite-map-ready',event=>Object.assign(window,{terminalHarness:(event as CustomEvent).detail}),{once:true}));
  await page.goto('/terminal/');await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle');
  await openMapOptions(page);await page.getByLabel('Terminal palette').selectOption('cell');await page.keyboard.press('Escape');
  await page.locator('#terrain-shortcut').click();
  await expect(page.locator('#map')).toHaveAttribute('data-terrain3d','true');
  await expect(page.locator('#map')).toHaveAttribute('data-camera-moving','false');
  await page.evaluate(()=>{
    const {view}=(window as unknown as {terminalHarness:{view:LiveMap}}).terminalHarness;
    view.map.jumpTo({bearing:25});
    const gl=view.map.getCanvas().getContext('webgl2')!,extension=gl.getExtension('WEBGL_lose_context');
    if(!extension)throw Error('Context-loss fixture unavailable');
    extension.loseContext();setTimeout(()=>extension.restoreContext(),120);
  });
  await expect(page.locator('#map')).toHaveAttribute('data-route-context-restores','1');
  await expect(page.locator('#map')).toHaveAttribute('data-terminal-drawing','3');
  await expect(page.locator('html')).toHaveAttribute('data-terminal-palette','cell');
  await expect(page.locator('.terminal-notice')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>{
    const {view}=(window as unknown as {terminalHarness:{view:LiveMap}}).terminalHarness;
    const ids=view.map.getLayersOrder();return ids.indexOf('terminal-graphics')<ids.indexOf('route-exact-webgl');
  })).toBe(true);
  await visualPacket(page,1,'Trace');await expect(page.locator('#packet-canvas')).toHaveAttribute('data-active-count','1');
  await page.screenshot({path:info.outputPath('terminal-3d-restored.png')});
});

async function greenRoutePixels(page: Page):Promise<number> {
  const png=await page.screenshot();
  return page.evaluate(async base64=>{
    const {view}=(window as unknown as {terminalHarness:{view:LiveMap}}).terminalHarness;
    const a=view.map.project([-80.35,43.45]),b=view.map.project([-80.23,43.51]);
    const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
    const pixels=ctx.getImageData(0,0,image.width,image.height).data;
    const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,sx=image.width/innerWidth,sy=image.height/innerHeight;
    // Sample the middle of the actual route. Endpoint labels may contain green
    // emoji and must not be counted as retained network ink.
    let count=0;for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++) {
      const px=x/sx-a.x,py=y/sy-a.y,t=(px*dx+py*dy)/length;
      if(t<.25||t>.75||(px-t*dx)**2+(py-t*dy)**2>36)continue;
      const i=(y*image.width+x)*4;if(pixels[i]!<140&&pixels[i+1]!>140&&pixels[i+2]!<100)count++;
    }return count;
  },png.toString('base64'));
}

// Inspect actual pixels, not a renderer's own readiness flag. Only the ANSI
// character water has this bright blue in the synthetic scene's centre.
async function blueGlyphPixels(page: Page): Promise<number> {
  const png = await page.screenshot();
  return page.evaluate(async base64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + base64; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d', {willReadFrequently:true})!; ctx.drawImage(img,0,0);
    const data = ctx.getImageData(0,Math.floor(img.height*.2),img.width,Math.floor(img.height*.6)).data;
    let count=0;
    for(let i=0;i<data.length;i+=4) if(data[i+2]!>80 && data[i+2]!>data[i]!*1.8 && data[i+2]!>data[i+1]!*1.3) count++;
    return count;
  }, png.toString('base64'));
}
