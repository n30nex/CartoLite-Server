import { expect, test } from '@playwright/test';
import { visualFixture, visualPacket } from './visualFixtures';
import { openMapOptions } from './mapControls';

test('compact map corners and dock keep a synchronized, keyboard-accessible 3D shortcut', async ({page},info) => {
  const desktop=info.project.name==='desktop';
  await page.setViewportSize(desktop ? {width:1304,height:902} : info.project.name==='mobile-landscape' ? {width:568,height:320} : {width:320,height:640});
  await page.emulateMedia({reducedMotion:'reduce'});
  await visualFixture(page); await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle');
  const shortcut=page.locator('#terrain-shortcut');
  await expect(shortcut).toBeVisible();
  if(await page.locator('#regions-button').count()) {
    await openMapOptions(page); await page.locator('#regions-button').click(); await page.keyboard.press('Escape');
    await expect(page.locator('#region-legend > summary')).toContainText('Regions in view');
  }
  const dock=await page.locator('.controls').boundingBox();
  const legend=await page.locator('#legend').boundingBox();
  const credits=await page.locator('.maplibregl-ctrl-attrib').boundingBox();
  const size=page.viewportSize()!;
  for(const box of [dock,legend,credits]) {
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x+box!.width).toBeLessThanOrEqual(size.width);
    expect(box!.y+box!.height).toBeLessThanOrEqual(size.height);
  }
  if(desktop) {
    expect(dock!.height).toBeLessThanOrEqual(42);
    expect(legend!.x).toBeLessThanOrEqual(12);
    expect(size.height-legend!.y-legend!.height).toBeLessThanOrEqual(16);
    expect(legend!.width).toBeLessThanOrEqual(220);
    expect(legend!.x+legend!.width).toBeLessThan(dock!.x);
    expect(credits!.width).toBeLessThanOrEqual(230);
    expect(credits!.x).toBeGreaterThan(dock!.x+dock!.width);
  } else {
    const target=await shortcut.boundingBox();
    expect(target!.width).toBeGreaterThanOrEqual(44); expect(target!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({path:info.outputPath('compact-map-dock.png')});
  const attribution=page.locator('.maplibregl-ctrl-attrib-button');
  if(await page.locator('.maplibregl-ctrl-attrib-inner').isVisible()) await attribution.click();
  await attribution.press('Enter'); await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toBeVisible();
  await attribution.press('Enter');
  await shortcut.press('Enter');
  await expect(shortcut).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#terrain-button')).toHaveAttribute('aria-pressed','true');
  for(const id of ['hillshade-button','buildings-button']) await expect(page.locator('#'+id)).toHaveAttribute('aria-pressed','true');
  await attribution.press('Enter');
  await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toContainText('Mapterhorn');
  if(desktop) await expect.poll(async()=>{
    const packet=await page.locator('#route-legend').boundingBox();
    const credit=await page.locator('.maplibregl-ctrl-attrib').boundingBox();
    return packet!.y+packet!.height < credit!.y;
  }).toBe(true);
  await page.screenshot({path:info.outputPath('compact-map-3d.png')});
  await page.reload(); await expect(shortcut).toHaveAttribute('aria-pressed','true');
  await openMapOptions(page); await page.locator('#terrain-button').click();
  await expect(shortcut).toHaveAttribute('aria-pressed','false');
  await page.keyboard.press('Escape'); await shortcut.click(); await openMapOptions(page);
  await page.locator('#reset-layers').click(); await expect(shortcut).toHaveAttribute('aria-pressed','false');
  await page.keyboard.press('Escape');
  await page.getByRole('link',{name:'Open CartoLite Netgraph',exact:true}).click();
  await expect(page.locator('#connected-count')).toHaveText('2');
  await expect(shortcut).toHaveCount(0);
  if(desktop) expect((await page.locator('.controls').boundingBox())!.height).toBeLessThanOrEqual(42);
  await page.screenshot({path:info.outputPath('compact-netgraph-dock.png')});
});

test('cinematic preferences migrate and layer combinations are reversible', async ({page},info) => {
  await visualFixture(page); await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle');
  await openMapOptions(page);
  await expect(page.getByLabel('Effects intensity')).toHaveValue('spectacle');
  const windowBefore=await page.getByLabel('Route age window').inputValue();
  const before=await page.locator('#routes-button').getAttribute('aria-pressed');
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  await expect(page.locator('#routes-button')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#live-packets-button')).toHaveAttribute('aria-pressed','true');
  await expect(page.getByLabel('Route age window')).toHaveValue(windowBefore);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('#routes-button')).toHaveAttribute('aria-pressed',before!);
  await page.getByLabel('Text size').selectOption('large');
  await page.getByLabel('Motion preference').selectOption('reduced');
  await page.getByLabel('Effects intensity').selectOption('calm');
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-motion','reduced');
  await page.reload(); await openMapOptions(page);
  await expect(page.getByLabel('Text size')).toHaveValue('large');
  await expect(page.getByLabel('Effects intensity')).toHaveValue('calm');
  const box=await page.locator('#layers-panel').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x+box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box!.y+box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({path:info.outputPath('cinematic-accessible-controls.png')});
  await page.keyboard.press('Escape');
  const credits=page.locator('.maplibregl-ctrl-attrib-button');
  if(await page.locator('.maplibregl-ctrl-attrib-inner').isVisible())await credits.click();
  await credits.click();
  await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toBeVisible();
  await credits.click();
});

test('GPU live effects survive context loss with Canvas fallback', async ({page},info) => {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await visualFixture(page);await page.goto('/netgraph/');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');
  await visualPacket(page,1,'Text');
  await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-effects-renderer','webgl2');
  await page.screenshot({path:info.outputPath('netgraph-gpu-packet.png')});
  await page.locator('.gpu-packet-canvas').evaluate(element => (element as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext());
  await visualPacket(page,2,'Advert');
  await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-effects-renderer','canvas2d');
  await expect.poll(()=>page.locator('#packet-canvas').evaluate(element=>{const c=element as HTMLCanvasElement;return c.getContext('2d')!.getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>30);})).toBe(true);
  await page.screenshot({path:info.outputPath('netgraph-canvas-fallback.png')});
  expect(errors).toEqual([]);
});

test('selected public node stays selected across views and browser Back closes menus', async ({page}) => {
  await visualFixture(page);await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle');
  await page.locator('#find-button').click(); await page.locator('#node-search').fill('Visual Alpha');
  await page.getByRole('option',{name:/Visual Alpha/}).click();
  await expect(page.locator('#map')).toHaveAttribute('data-selected-node-id','visual-a');
  await page.getByRole('link',{name:'Open CartoLite Netgraph',exact:true}).click();
  await expect(page.locator('.node-inspector')).toHaveAttribute('data-node-id','visual-a');
  await page.locator('#display-button').click();await expect(page.locator('#display-panel')).toBeVisible();
  await page.goBack();await expect(page.locator('#display-panel')).toBeHidden();
  await expect(page).toHaveURL(/netgraph/);
  await expect(page.locator('.node-inspector')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#node-inspector-sheet')).toBeHidden();
  await page.goBack();
  await expect(page.locator('#map .maplibregl-canvas')).toHaveCount(1);
  await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle');
});

test('rapidly reopening Finder after selection keeps its input available', async ({page}) => {
  await visualFixture(page);await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle');
  for (const name of ['Visual Alpha','Visual Bravo','Visual Alpha']) {
    await page.locator('#find-button').click(); await page.locator('#node-search').fill(name);
    await page.getByRole('option',{name:new RegExp(name)}).click();
  }
  await expect(page.locator('#map')).toHaveAttribute('data-selected-node-id','visual-a');
});

test('the Android shell owns keep-awake instead of a second browser lock', async ({page}) => {
  await visualFixture(page);
  await page.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{get:()=> 'Mozilla/5.0 CartoLiteAndroid/1.1.0'}));
  for(const path of ['/','/netgraph/']) { await page.goto(path); await expect(page.locator(path==='/'?'#app':'#netgraph-app')).toHaveAttribute('data-screen-awake','native'); }
});

test('Netgraph Follow holds ten seconds, filters a selected node and waits honestly', async ({page},info) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await visualFixture(page);await page.goto('/netgraph/?node=visual-a');
  await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-selected-node-id','visual-a');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.getByRole('button',{name:/Follow$/,exact:false}).click();
  const card=page.locator('#follow-card');
  await expect(card).toBeVisible();
  await card.getByLabel('Follow scope').selectOption('node');
  await visualPacket(page,1,'Text');
  await expect(card.locator('[data-detail]')).toHaveText('Text · 1 confirmed hop');
  await expect(card.locator('output')).toHaveText('10s');
  await page.clock.fastForward(4000);await visualPacket(page,2,'Advert');
  await expect(card.locator('output')).toHaveText('6s');
  await expect(card.locator('[data-detail]')).toContainText('Text');
  await page.clock.fastForward(6000);
  await expect(card.locator('[data-detail]')).toContainText('Advert');
  await card.getByRole('button',{name:'Hold',exact:true}).click();
  await page.clock.fastForward(11000);
  await expect(card.locator('[data-state]')).toContainText('Held');
  await visualPacket(page,3,'Trace');
  await card.getByRole('button',{name:'Next',exact:true}).click();
  await expect(card.locator('[data-detail]')).toContainText('Trace');
  await page.screenshot({path:info.outputPath('netgraph-follow.png')});
  await card.getByRole('button',{name:'Inspect',exact:true}).click();
  await expect(page.locator('.node-inspector')).toBeVisible();
  await page.getByRole('button',{name:'Close node details',exact:true}).click();
  await expect(card).toBeVisible();
  await card.getByRole('button',{name:'Next',exact:true}).click();
  await expect(card.locator('[data-title]')).toHaveText('Waiting for activity');
  await expect(card.getByRole('button',{name:'Inspect',exact:true})).toBeDisabled();
  // A confirmed link that does not touch the captured node must not be selected.
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('visual-packet',{detail:{seq:4,id:'unrelated',at:Date.now(),payloadType:'Text',mode:'route',segments:[{routeId:'other',fromId:'visual-b',toId:'visual-c'}]}})));
  await expect(card.locator('[data-title]')).toHaveText('Waiting for activity');
  await card.getByLabel('Follow scope').focus();await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
});
