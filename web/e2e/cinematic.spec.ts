import { expect, test } from '@playwright/test';
import { visualFixture, visualPacket } from './visualFixtures';
import { openMapOptions } from './mapControls';

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
});
