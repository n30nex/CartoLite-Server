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
  graphLink.href = '/netgraph/'; graphLink.className = 'control-button'; graphLink.textContent = 'Netgraph';
  graphLink.setAttribute('aria-label', 'Open CartoLite Netgraph');
  if (graph) graphLink.setAttribute('aria-current', 'page');
  navigation.append(graphLink);
  const labs = topbar.querySelector<HTMLAnchorElement>('#labs-link');
  if (labs) { labs.className = 'control-button'; navigation.append(labs); }
  controls.prepend(navigation);
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
  const menuIDs = ['layers-panel', 'find-panel', 'sound-panel', 'display-panel'];
  const openMenu = () => menuIDs.find(id => { const panel=document.getElementById(id); return panel && !panel.hidden; });
  const syncHistory = () => {
    const open = openMenu();
    const current = history.state?.cartolitePanel;
    if (open && current !== open) {
      const state = { ...history.state, cartolitePanel: open };
      if(current) history.replaceState(state,''); else history.pushState(state,'');
    } else if(!open && current) history.back();
  };
  const observer = new MutationObserver(syncHistory);
  for(const id of menuIDs) { const panel=document.getElementById(id); if(panel)observer.observe(panel,{attributes:true,attributeFilter:['hidden']}); }
  window.addEventListener('popstate', () => {
    for(const button of controls.querySelectorAll<HTMLButtonElement>('button[aria-expanded="true"][aria-controls]')) button.click();
  });
  window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
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
  header.after(bar);
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
