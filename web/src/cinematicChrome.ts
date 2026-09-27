/** A single dock, with existing control handlers and accessible names preserved. */
export function mountCinematicDock(): void {
  const controls = document.querySelector<HTMLElement>('.controls');
  const topbar = document.querySelector<HTMLElement>('#topbar');
  if (!controls || !topbar) return;
  document.documentElement.dataset.cinematic = 'true';
  const navigation = document.createElement('nav');
  navigation.className = 'dock-views'; navigation.setAttribute('aria-label', 'Views');
  const graph = location.pathname.startsWith('/netgraph');
  const mapLink = document.createElement('a');
  mapLink.href = '/'; mapLink.className = 'control-button'; mapLink.textContent = 'Map';
  mapLink.setAttribute('aria-label', 'Open CartoLite map');
  if (!graph) mapLink.setAttribute('aria-current', 'page');
  navigation.append(mapLink);
  const graphLink = topbar.querySelector<HTMLAnchorElement>('#netgraph-link') ?? document.createElement('a');
  graphLink.href = '/netgraph/'; graphLink.classList.add('control-button', 'netgraph-link'); graphLink.textContent = 'Netgraph';
  graphLink.setAttribute('aria-label', 'Open CartoLite Netgraph');
  if (graph) graphLink.setAttribute('aria-current', 'page');
  navigation.append(graphLink);
  const labs = topbar.querySelector<HTMLAnchorElement>('#labs-link');
  if (labs) { labs.classList.add('control-button'); navigation.append(labs); }
  controls.prepend(navigation);
  const zoomControls = document.querySelector<HTMLElement>('.zoom-controls');
  if (zoomControls) controls.append(zoomControls);
  const sizeDock=()=>document.documentElement.style.setProperty('--dock-height',`${controls.offsetHeight}px`);
  const dockResize=new ResizeObserver(sizeDock);dockResize.observe(controls);sizeDock();
  window.addEventListener('pagehide',()=>dockResize.disconnect());
  window.addEventListener('pageshow',()=>dockResize.observe(controls));
  if (!graph) {
    const display = document.createElement('button');
    display.type = 'button'; display.className = 'control-button'; display.textContent = '◐ Display';
    display.setAttribute('aria-label', 'Display settings');
    display.addEventListener('click', () => {
      const disclosure = document.querySelector<HTMLDetailsElement>('#map-appearance');
      const layers = document.querySelector<HTMLElement>('#layers-disclosure');
      if (!layers?.hasAttribute('open')) document.querySelector<HTMLButtonElement>('#layers-summary')?.click();
      if (disclosure) { disclosure.open = true; disclosure.scrollIntoView({ block: 'nearest' }); disclosure.querySelector<HTMLElement>('summary')?.focus(); }
    });
    controls.insertBefore(display, controls.querySelector('.sound-control'));
  }
  if (/CartoLiteAndroid\//.test(navigator.userAgent)) document.documentElement.dataset.nativeApp = 'true';
  const menuIDs = ['layers-panel', 'find-panel', 'sound-panel', 'display-panel', 'follow-card', 'node-inspector-sheet'];
  const openMenu = () => menuIDs.find(id => { const panel=document.getElementById(id); return panel && !panel.hidden; });
  let closingHistory = false;
  let closingURL = location.href;
  let pendingNavigation: string | undefined;
  const syncHistory = () => {
    if (closingHistory) { closingURL = location.href; return; }
    const open = openMenu();
    const current = history.state?.cartolitePanel;
    if (open && current !== open) {
      if (open === history.state?.cartoliteParent) { closingHistory = true; closingURL = location.href; history.back(); return; }
      const replacing = current && current !== 'node-inspector-sheet' && current !== 'follow-card';
      const state = { ...history.state, cartolitePanel: open, cartoliteParent: replacing ? history.state?.cartoliteParent : current };
      if(replacing) history.replaceState(state,''); else history.pushState(state,'');
    } else if(!open && current) { closingHistory = true; closingURL = location.href; history.back(); }
  };
  const observer = new MutationObserver(syncHistory);
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
  controls.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a') : null;
    if (event instanceof MouseEvent && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
    if (closingHistory && link) { event.preventDefault(); pendingNavigation = link.href; }
  });
  window.addEventListener('popstate', () => {
    if (closingHistory) {
      closingHistory = false;
      history.replaceState(history.state, '', closingURL);
      if (pendingNavigation) { location.assign(pendingNavigation); pendingNavigation = undefined; }
      else syncHistory();
      return;
    }
    const target = history.state?.cartolitePanel;
    for(const button of controls.querySelectorAll<HTMLButtonElement>('button[aria-expanded="true"][aria-controls]')) {
      if(button.getAttribute('aria-controls') !== target) button.click();
    }
    if(target !== 'follow-card') document.querySelector<HTMLButtonElement>('#follow-card:not([hidden]) #follow-close')?.click();
    if(!target) document.querySelector<HTMLButtonElement>('#node-inspector-sheet:not([hidden]) .node-inspector-close')?.click();
  });
  window.addEventListener('pagehide',()=>observer.disconnect());
  window.addEventListener('pageshow',()=>observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']}));
  // One menu at a time, including the independently mounted display control.
  let closing = false;
  controls.addEventListener('click', event => {
    if (closing || !(event.target instanceof Element)) return;
    const owner = event.target.closest<HTMLButtonElement>('button[aria-controls]');
    if (!owner || owner.getAttribute('aria-expanded') !== 'true') return;
    closing = true;
    for (const button of controls.querySelectorAll<HTMLButtonElement>('button[aria-expanded="true"][aria-controls]')) {
      if (button !== owner) button.click();
    }
    closing = false;
  });
}

export function mountLayerCombinations(): void {
  const header = document.querySelector('#layers-panel .map-options-header');
  if (!header) return;
  const bar = document.createElement('section'); bar.className = 'layer-combinations'; bar.setAttribute('aria-label', 'Layer combinations');
  bar.innerHTML = '<span>Quick views</span><div><button type="button" data-combination="network">Network</button><button type="button" data-combination="activity">Activity</button><button type="button" data-combination="landscape">Landscape</button><button type="button" data-undo hidden>Undo</button></div><p>Changes layers only. Your camera and sound stay as they are.</p>';
  (document.querySelector('#layers-panel section.map-layer-group') ?? header).after(bar);
  const ids = ['routes-button', 'heatmap-button', 'node-labels-button', 'hillshade-button', 'buildings-button', 'live-packets-button'];
  let previous: boolean[] | undefined;
  const apply = (values: boolean[]) => ids.forEach((id, i) => {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (button && (button.getAttribute('aria-pressed') === 'true') !== values[i]) button.click();
  });
  bar.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (!button) return;
    if (button.hasAttribute('data-undo') && previous) { apply(previous); previous = undefined; button.hidden = true; return; }
    const choice = button.dataset.combination;
    if (!choice) return;
    previous = ids.map(id => document.getElementById(id)?.getAttribute('aria-pressed') === 'true');
    apply([choice !== 'activity', choice === 'activity', true, choice === 'landscape', choice === 'landscape', true]);
    bar.querySelector<HTMLButtonElement>('[data-undo]')!.hidden = false;
  });
}

/** The director frames activity in the space actually left by its card and dock. */
export function followViewport(container: HTMLElement) {
  const box=container.getBoundingClientRect(), width=container.clientWidth, height=container.clientHeight;
  let left=24, right=width-24, top=72, bottom=height-24;
  for(const selector of ['#topbar','.graph-focus']) {
    const chrome=document.querySelector<HTMLElement>(selector);
    if(chrome&&chrome.getClientRects().length)top=Math.max(top,chrome.getBoundingClientRect().bottom-box.top+16);
  }
  const dock=document.querySelector<HTMLElement>('.controls');
  if(dock)bottom=Math.min(bottom,dock.getBoundingClientRect().top-box.top-16);
  const card=document.getElementById('follow-card');
  if(card&&!card.hidden){
    const bounds=card.getBoundingClientRect();
    if(bounds.width>=width*.6)bottom=Math.min(bottom,bounds.top-box.top-20);
    else if(bounds.left+bounds.width/2<box.left+width/2)left=Math.max(left,bounds.right-box.left+24);
    else right=Math.min(right,bounds.left-box.left-24);
  }
  top=Math.min(top,height-48);bottom=Math.max(top+24,bottom);
  return {left,right:Math.max(left+48,right),top,bottom};
}
