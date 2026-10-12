import type { NetgraphRenderer } from './renderer';

export function mountRegionControls(graph: NetgraphRenderer, host: HTMLElement, changed: () => void, closePanels: () => void) {
  const stage = document.getElementById('netgraph-stage')!;
  const navigate = () => stage.dispatchEvent(new Event('graphnavigate'));
  const menu = document.createElement('details'); menu.id = 'region-filter'; menu.className = 'region-filter';
  menu.innerHTML = '<summary aria-label="Filter regions">Regions · All</summary><div id="region-options" class="region-options" hidden><input type="search" aria-label="Search regions" placeholder="IATA / region"><div class="region-actions"><button type="button" data-all>All</button><button type="button" data-none>None</button></div><div class="region-checks" role="group" aria-label="Regions"></div></div>';
  const summary = menu.querySelector('summary')!, search = menu.querySelector('input')!, list = menu.querySelector<HTMLElement>('.region-checks')!;
  const routes = document.createElement('button'); routes.type = 'button'; routes.id = 'graph-routes-button'; routes.textContent = 'Routes';
  routes.setAttribute('aria-label', 'Show historical routes'); routes.title = 'Hide standing lines; live packets still light their routes briefly';
  host.append(menu, routes);
  const layout = document.createElement('details'); layout.className = 'graph-layout';
  layout.innerHTML = '<summary>Region layout</summary><label>Spacing<input type="range" min="1" max="4" step="0.1" aria-label="Region spacing"><output></output></label><label>Move region<select aria-label="Region to move"></select></label><div class="region-actions"><button type="button" aria-label="Move region left" data-move="-40,0">←</button><button type="button" aria-label="Move region up" data-move="0,-40">↑</button><button type="button" aria-label="Move region down" data-move="0,40">↓</button><button type="button" aria-label="Move region right" data-move="40,0">→</button></div><button type="button" data-reset>Reset region layout</button><small>Drag a region label to move its whole bubble. Saved on this device.</small>';
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
  const filterList = () => { const query = search.value.trim().toLocaleLowerCase();
    for (const label of list.children) (label as HTMLElement).hidden = !label.textContent!.toLocaleLowerCase().includes(query); };
  search.addEventListener('input', filterList);
  menu.addEventListener('toggle', () => { menu.querySelector<HTMLElement>('.region-options')!.hidden = !menu.open; if (menu.open) closePanels(); });
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
    spacing.value = String(prefs.spacing); output.value = `${Math.round(prefs.spacing * 100)}%`;
    routes.setAttribute('aria-pressed', String(prefs.routes)); routes.classList.toggle('selected', prefs.routes);
    summary.textContent = `Regions · ${prefs.regions === null ? 'All' : prefs.regions.length}`;
    layout.querySelector('small')!.textContent = stage.dataset.layoutSaved === 'false'
      ? 'Drag region labels to arrange. Storage unavailable; changes last for this visit.'
      : 'Drag a region label to move its whole bubble. Saved on this device.';
    if (areas !== lastAreas || prefs.regions !== lastRegions) {
      lastAreas = areas; lastRegions = prefs.regions;
      const entries = new Map(areas.map(a => [a.code, a.name]));
      for (const code of prefs.regions ?? []) if (!entries.has(code)) entries.set(code, 'No current activity');
      const next = JSON.stringify([...entries]);
      if (next !== signature) {
        signature = next;
        const focused = (document.activeElement as HTMLElement | null)?.dataset.region, scroll = list.scrollTop, moving = move.value;
        list.replaceChildren(); move.replaceChildren();
        for (const [code, name] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
          const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
          input.type = 'checkbox'; input.dataset.region = code; text.textContent = `${code} · ${name}`;
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
  return { sync, destroy() { document.removeEventListener('pointerdown', dismiss); menu.remove(); routes.remove(); layout.remove(); } };
}
