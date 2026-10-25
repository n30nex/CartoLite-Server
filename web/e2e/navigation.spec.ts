import { expect, test } from '@playwright/test';
import { visualFixture } from './visualFixtures';
import { openViewMenu } from './dockControls';

test('grouped icon navigation keeps direct views, keyboard access and node context',async({page})=>{
  await visualFixture(page);await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');
  await page.locator('#find-button').click();await page.locator('#node-search').fill('Visual Alpha');await page.locator('.node-search-result').first().click();
  await openViewMenu(page);await expect(page.locator('.dock-views > a')).toHaveCount(3);
  await expect(page.locator('#experimental-options a')).toHaveCount(3);
  expect(await page.locator('.dock-views > a svg[aria-hidden="true"]').count()).toBe(3);
  await page.getByRole('link',{name:'Open CartoLite Pachinko',exact:true}).click();await expect(page.locator('#pachinko-stage')).toHaveAttribute('data-render-state','ready',{timeout:20000});
  await expect.poll(()=>new URL(page.url()).searchParams.get('node')).toBe('visual-a');await expect(page.locator('#node-inspector-sheet')).toContainText('Visual Alpha');
  await openViewMenu(page);const group=page.locator('#experimental-options').locator('..');await group.locator('summary').focus();await page.keyboard.press('Escape');await expect(group).not.toHaveAttribute('open','');await expect(group.locator('summary')).toBeFocused();
});

test('Labs list selects an experience without creating a second feed owner',async({page})=>{
  await visualFixture(page);await page.goto('/');test.skip(await page.locator('#labs-options').count()===0,'Labs is Canada-only');
  await openViewMenu(page,'Labs');await expect(page.locator('#labs-options a')).toHaveCount(4);
  await page.getByRole('link',{name:'Open CartoLite Firefly Meadow',exact:true}).click();
  await expect(page.locator('#experiment-select')).toHaveValue('firefly-meadow');await expect(page.locator('html')).toHaveAttribute('data-fixture-streams-active','1');const before=await page.evaluate(()=>({origin:performance.timeOrigin,opened:document.documentElement.dataset.fixtureStreamsOpened}));await openViewMenu(page,'Labs');
  await page.getByRole('link',{name:'Open CartoLite Mesh Loom',exact:true}).click();await expect(page.locator('#experiment-select')).toHaveValue('mesh-loom');
  expect(new URL(page.url()).pathname).toBe('/labs/');expect(await page.evaluate(()=>({origin:performance.timeOrigin,opened:document.documentElement.dataset.fixtureStreamsOpened}))).toEqual(before);await expect(page.locator('html')).toHaveAttribute('data-fixture-streams-active','1');
});
