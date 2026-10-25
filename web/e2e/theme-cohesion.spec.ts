import { expect,test,type Page } from '@playwright/test';
import { visualFixture,visualPacket } from './visualFixtures';
import { openDisplay } from './dockControls';

// Check the rendered controls, including inherited colours, rather than only
// asserting the token table. A fixed colour in an older page must fail here.
async function unreadableControls(page:Page):Promise<string[]> {
  return page.evaluate(()=>{
    const rgb=(value:string)=>value.match(/[\d.]+/g)?.map(Number)??[];
    const lum=(v:number[])=>v.slice(0,3).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i]!,0);
    const failures:string[]=[];
    for(const el of document.querySelectorAll<HTMLElement>('.glass :is(button,a,label,select,summary,span,strong,small,p,dt,dd),dialog[open] :is(button,label,select,p,summary)')) {
      if(!el.getClientRects().length||getComputedStyle(el).visibility!=='visible'||el.closest('[hidden],[aria-hidden="true"]'))continue;
      let collapsed=false;for(let p:HTMLElement|null=el.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement&&!p.open&&!p.querySelector(':scope > summary')?.contains(el)){collapsed=true;break;}
      if(collapsed)continue;
      if(![...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent?.trim())&&!el.matches('select'))continue;
      const style=getComputedStyle(el),ink=rgb(style.color);let bg:number[]=[];
      for(let p:HTMLElement|null=el;p;p=p.parentElement){const c=rgb(getComputedStyle(p).backgroundColor);if(c.length>=3&&(c[3]??1)>=.98){bg=c;break;}}
      if(bg.length<3)continue;
      const a=ink[3]??1,fg=ink.slice(0,3).map((v,i)=>v*a+bg[i]!*(1-a));
      const l1=lum(fg),l2=lum(bg),contrast=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
      const minimum=el.closest(':disabled')?3:4.5; // Inactive copy stays legible; ordinary text keeps AA contrast.
      if(contrast<minimum)failures.push(`${el.tagName}.${el.className}: ${(el.textContent??'').trim().slice(0,35)} ${contrast.toFixed(2)}`);
    }
    return failures;
  });
}

for(const view of ['map','netgraph','chronoscope','firehose','pachinko','labs'])test(`Theme cohesion ${view} palettes keep controls readable`,async({page},info)=>{
  test.setTimeout(90000);
  if(info.project.name!=='desktop')await page.setViewportSize(info.project.name==='mobile-landscape'?{width:568,height:320}:{width:320,height:720});
  await visualFixture(page);
  if(view==='labs'){await page.goto('/');test.skip(await page.locator('#labs-options').count()===0,'Canada-only Labs');}
  await page.goto(view==='map'?'/':view==='labs'?'/labs/?demo=1&experiment=packet-pond':`/${view}/`);
  if(view==='map')await expect(page.locator('#map')).toHaveAttribute('data-render-state','idle');
  else if(view!=='labs')await expect(page.locator('html')).toHaveAttribute('data-fixture-stream','ready');
  if(['chronoscope','firehose','pachinko'].includes(view))await expect(page.locator(`#${view}-stage`)).toHaveAttribute('data-graphics-ready','true',{timeout:20000});
  if(view!=='labs')await visualPacket(page,1,'Text');
  await openDisplay(page);
  if(view==='map')for(const selector of ['#map-detail-options > summary','#terrain-options > summary','.camera-settings > summary']){const summary=page.locator(selector);if(await summary.isVisible()&&!await summary.evaluate(el=>(el.parentElement as HTMLDetailsElement).open))await summary.click();}
  const palette=page.getByLabel('Interface palette',{exact:true});
  const theme=page.locator('[data-display="theme"],#interface-theme');
  const sceneBefore=await page.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--kind-text'));
  const streamsBefore=await page.locator('html').getAttribute('data-fixture-streams-opened');
  for(const brightness of ['dark','light']) {
    await theme.selectOption(brightness);
    for(const name of info.project.name==='desktop'?['aurora','glacier','ember','violet']:['aurora','glacier']) {
      await palette.selectOption(name);
      await expect(page.locator('html')).toHaveAttribute('data-palette',name);
      await expect.poll(()=>unreadableControls(page)).toEqual([]);
      await expect(page.locator('html')).toHaveAttribute('data-theme',brightness);
      expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe(await page.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--panel-solid').trim()));
      expect(await page.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--kind-text'))).toBe(sceneBefore);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(view==='map'&&info.project.name==='desktop'&&brightness==='dark')await page.screenshot({path:info.outputPath(`${name}-palette-desktop.png`)});
    }
    await palette.selectOption(brightness==='dark'?'aurora':'glacier');
    await palette.focus();await expect(palette).toHaveCSS('outline-style','solid');
    await page.screenshot({path:info.outputPath(`${view}-${brightness}-interface.png`)});
  }
  if(view==='map'&&info.project.name==='desktop'){
    await page.locator('#basemap-style').selectOption('light');await theme.selectOption('dark');await expect.poll(()=>unreadableControls(page)).toEqual([]);
    await page.locator('#basemap-style').selectOption('streets');await theme.selectOption('map');await palette.selectOption('aurora');await expect.poll(()=>unreadableControls(page)).toEqual([]);
    await page.screenshot({path:info.outputPath('map-paper-interface.png')});
  }
  if(streamsBefore!==null)expect(await page.locator('html').getAttribute('data-fixture-streams-opened')).toBe(streamsBefore);
  if(view==='labs'){
    await page.keyboard.press('Escape');
    for(const id of ['firefly-meadow','mesh-loom','little-mesh-villages']){
      await page.locator('#experiment-select').selectOption(id);
      await expect.poll(()=>unreadableControls(page)).toEqual([]);
      await page.screenshot({path:info.outputPath(`${id}-light-interface.png`)});
    }
  }
});

test('Theme cohesion shares palettes across tabs and preserves Terminal customization',async({page,context},info)=>{
  test.skip(info.project.name!=='desktop');
  await visualFixture(page);await page.goto('/netgraph/');await openDisplay(page);
  const other=await context.newPage();
  try {
    await visualFixture(other);await other.goto('/chronoscope/');await expect(other.locator('html')).toHaveAttribute('data-fixture-stream','ready');
    const count=await other.locator('html').getAttribute('data-fixture-streams-opened');
    await page.getByLabel('Interface palette',{exact:true}).selectOption('ember');
    await expect(other.locator('html')).toHaveAttribute('data-palette','ember');
    expect(await other.locator('html').getAttribute('data-fixture-streams-opened')).toBe(count);
    await other.goto('/terminal/');await expect(other.locator('#map')).toHaveAttribute('data-render-state','idle');
    expect(await other.locator('html').evaluate(el=>{const s=getComputedStyle(el);return s.getPropertyValue('--divider').trim()===s.getPropertyValue('--terminal-border').trim()&&s.getPropertyValue('--radius-control').trim()==='2px';})).toBe(true);
    const terminal=await other.locator('html').evaluate(el=>({ink:getComputedStyle(el).getPropertyValue('--ink'),font:getComputedStyle(el).fontFamily}));
    await page.getByLabel('Interface palette',{exact:true}).selectOption('violet');
    expect(await other.locator('html').evaluate(el=>({ink:getComputedStyle(el).getPropertyValue('--ink'),font:getComputedStyle(el).fontFamily}))).toEqual(terminal);
    await other.reload();await expect(other.locator('#map')).toHaveAttribute('data-render-state','idle');
    expect(await other.locator('html').evaluate(el=>({ink:getComputedStyle(el).getPropertyValue('--ink'),font:getComputedStyle(el).fontFamily}))).toEqual(terminal);
    await page.reload();await expect(page.locator('html')).toHaveAttribute('data-palette','violet');
  } finally { await other.close(); }
});
