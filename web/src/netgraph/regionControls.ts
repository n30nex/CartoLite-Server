import { graphTemplate } from './cameraControls';
import type { NetgraphRenderer } from './renderer';

export function mountRegionControls(graph: NetgraphRenderer, host: HTMLElement, changed: () => void, closePanels: () => void) {
  const stage = document.getElementById('netgraph-stage')!;
  const navigate = () => stage.dispatchEvent(new Event('graphnavigate'));
  const measure = () => document.documentElement.style.setProperty('--graph-controls-bottom', `${Math.ceil((host.closest('#display-panel') ? document.getElementById('graph-summary')! : host).getBoundingClientRect().bottom)}px`);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined; resize?.observe(host);
  resize?.observe(document.getElementById('graph-summary')!);
  window.addEventListener('resize', measure); measure();
  const menu = graphTemplate<HTMLDetailsElement>('graph-regions-ui');
  const summary = menu.querySelector('summary')!, search = menu.querySelector('input')!, list = menu.querySelector<HTMLElement>('.region-checks')!;
  const routes = document.createElement('button'); routes.type = 'button'; routes.id = 'graph-routes-button'; routes.textContent = 'Routes';
  routes.setAttribute('aria-label', 'Show historical routes'); routes.title = 'Hide standing lines; live packets still light their routes briefly';
  host.append(menu, routes);
  const scope = document.createElement('p'); scope.id = 'graph-scope'; scope.className = 'graph-scope'; scope.hidden = true;
  scope.setAttribute('role', 'status'); scope.setAttribute('aria-label', 'Active view filters');
  document.getElementById('graph-summary')!.append(scope);
  const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear filters'; clear.dataset.clearView = '';
  clear.title = 'Show all regions and components; keep route visibility and saved layout';
  menu.querySelector('.region-actions')!.append(clear);
  clear.addEventListener('click', () => {
    navigate(); graph.setRegions(null); graph.setFocus('all');
    host.querySelector<HTMLSelectElement>('[aria-label="Topology focus"]')!.value = 'all';
    sync(); changed();
  });
  const layout = graphTemplate<HTMLDetailsElement>('graph-layout-ui');
  document.getElementById('display-panel')!.append(layout);
  const spacing = layout.querySelector('input')!, output = layout.querySelector('output')!, move = layout.querySelector('select')!;
  let lastAreas: ReturnType<NetgraphRenderer['regions']> | undefined, lastRegions: string[] | null | undefined, signature = '';
  const applyFilter = (values: string[] | null) => { navigate(); graph.setRegions(values); sync(); changed(); };
  menu.querySelector('[data-all]')!.addEventListener('click', () => applyFilter(null));
  menu.querySelector('[data-none]')!.addEventListener('click', () => applyFilter([]));
  list.addEventListener('change', event => {
    const input = event.target as HTMLInputElement, code = input.dataset.region!;
    const selected = new Set(graph.regionLayout().regions ?? graph.regions().map(a => a.code));
    if (input.checked) selected.add(code); else selected.delete(code);
    applyFilter([...selected]);
  });
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const filterList = () => { const query = fold(search.value.trim());
    for (const label of list.children) (label as HTMLElement).hidden = !fold((label as HTMLElement).dataset.search ?? '').includes(query); };
  search.addEventListener('input', filterList);
  menu.addEventListener('toggle', () => { menu.querySelector<HTMLElement>('.region-options')!.hidden = !menu.open; if (menu.open) { navigate(); closePanels(); } });
  menu.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.open) { event.preventDefault(); event.stopPropagation(); menu.open = false; summary.focus(); } });
  const dismiss = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) menu.open = false; };
  document.addEventListener('pointerdown', dismiss);
  routes.addEventListener('click', () => { graph.setRoutesVisible(!graph.regionLayout().routes); sync(); });
  spacing.addEventListener('input', () => { navigate(); graph.setRegionSpacing(Number(spacing.value)); sync(); });
  layout.querySelector('[data-reset]')!.addEventListener('click', () => { navigate(); graph.resetRegionLayout(); sync(); });
  for (const button of layout.querySelectorAll<HTMLButtonElement>('[data-move]')) button.addEventListener('click', () => {
    const [x, y] = button.dataset.move!.split(',').map(Number); navigate(); graph.moveRegion(move.value, x!, y!);
  });
  function sync(): void {
    const prefs = graph.regionLayout(), areas = graph.regions();
    document.getElementById('display-button')?.toggleAttribute('data-filtered', prefs.regions !== null || !prefs.routes || (stage.dataset.focusMode ?? 'all') !== 'all');
    spacing.value = String(prefs.spacing); output.value = `${Math.round(prefs.spacing * 100)}%`;
    routes.setAttribute('aria-pressed', String(prefs.routes)); routes.classList.toggle('selected', prefs.routes);
    summary.textContent = `Regions · ${prefs.regions === null ? 'All' : prefs.regions.length}`;
    const focused = stage.dataset.focusMode ?? 'all';
    const description = [prefs.regions === null ? '' : `${prefs.regions.length} regions`, focused === 'all' ? '' : `${focused === 'area' ? 'Area' : 'Component'} focus`, prefs.routes ? '' : 'Routes hidden'].filter(Boolean).join(' · ');
    if (scope.hidden !== !description) scope.hidden = !description;
    if (scope.textContent !== description) {
      scope.textContent = description;
    }
    clear.disabled = prefs.regions === null && focused === 'all';
    layout.querySelector('[data-save-state]')!.textContent = stage.dataset.layoutSaved === 'false'
      ? 'Kept for this visit; storage unavailable.' : 'Saved on this device.';
    if (areas !== lastAreas || prefs.regions !== lastRegions) {
      lastAreas = areas; lastRegions = prefs.regions;
      const entries = new Map(areas.map(a => [a.code, [a.name, ...(a.aliases ?? [])]]));
      for (const code of prefs.regions ?? []) if (!entries.has(code)) entries.set(code, ['No current activity']);
      const next = JSON.stringify([...entries]);
      if (next !== signature) {
        signature = next;
        const focused = (document.activeElement as HTMLElement | null)?.dataset.region, scroll = list.scrollTop, moving = move.value;
        list.replaceChildren(); move.replaceChildren();
        for (const [code, names] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
          const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
          input.type = 'checkbox'; input.dataset.region = code; text.textContent = `${code} · ${names[0]}`;
          label.dataset.search = [code, ...names].join(' ');
          label.append(input, text); list.append(label);
          if (areas.some(a => a.code === code)) move.add(new Option(text.textContent!, code));
          if (focused === code) input.focus({ preventScroll: true });
        }
        if ([...move.options].some(o => o.value === moving)) move.value = moving;
        list.scrollTop = scroll; filterList();
      }
      for (const input of list.querySelectorAll<HTMLInputElement>('input')) input.checked = prefs.regions === null || prefs.regions.includes(input.dataset.region!);
    }
  }
  sync();
  return { sync, destroy() { resize?.disconnect(); window.removeEventListener('resize', measure); document.removeEventListener('pointerdown', dismiss); menu.remove(); routes.remove(); scope.remove(); layout.remove(); } };
}
