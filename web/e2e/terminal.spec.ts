import { expect, test, type Page } from '@playwright/test';
import { visualFixture, visualPacket } from './visualFixtures';
import { openMapOptions } from './mapControls';
import { openViewMenu } from './dockControls';

test('Terminal preserves roads, landscape detail and measured label spacing', async ({page}, info) => {
  test.slow();
  await visualFixture(page,10.2,true);
  await page.addInitScript(() => {
    const canvas = CanvasRenderingContext2D.prototype, original = canvas.fillText, clear = canvas.clearRect;
    const labels: {text:string;x:number;y:number;width:number;height:number}[] = [];
    Object.assign(window,{terminalLabels:labels});
    canvas.clearRect = function(...args:Parameters<typeof clear>) { if(this.canvas.id==='terminal-map') labels.length=0; return clear.apply(this,args); };
    canvas.fillText = function(text,x,y,...rest) {
      if(this.canvas.id==='terminal-map') labels.push({text,x,y,width:this.measureText(text).width,height:parseFloat(this.font)*1.25});
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
      const colors=[[53,95,73],[53,64,76],[114,147,170]], count=[0,0,0];
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
  page.on('request', request => { if (/\/terminal-[^/]+\.(?:js|css)(?:\?|$)/.test(request.url())) terminalAssets.push(request.url()); });
  await visualFixture(page);
  for (const path of ['/', '/netgraph/']) {
    await page.goto(path);
    await expect(page.locator(path === '/' ? '#map' : '#netgraph-stage')).toHaveAttribute('data-render-state','idle',{timeout:10000});
  }
  expect(terminalAssets).toEqual([]);
});

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
