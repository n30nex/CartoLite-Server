import './viewNavigation.css';

export type CartoView = 'Map' | 'Netgraph' | 'Terminal' | 'Chronoscope' | 'Firehose' | 'Pachinko' | 'Labs';
const ICONS: Record<string, string> = {
  Map: 'M3 5 9 3l6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16',
  Netgraph: 'M5 5h4v4H5zm10 10h4v4h-4zM15 3h4v4h-4zM3 15h4v4H3zm6-8 6-2M7 9l-2 6m4-6 6 6m-8 2h8',
  Terminal: 'm4 6 5 6-5 6m8 0h8',
  Experimental: 'M9 3h6m-5 0v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M7 15h10',
  Chronoscope: 'm12 2 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5M3 17l9 5 9-5',
  Firehose: 'M3 3h9v5H8v4m0 3v1m-3 2v1m6-1v1m4-7 6-3v12H3v-9',
  Pachinko: 'M3 2h18v20H3V2Zm3 15h12M8 5h.01M16 5h.01M12 9h.01M8 13h.01M16 13h.01M9 17v5m6-5v5',
  Labs: 'm12 2 2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2Zm7 15v5m-2-2.5h4',
  'Packet Pond': 'M12 3c-2 3-3 4-3 6a3 3 0 0 0 6 0c0-2-1-3-3-6Zm-5 9c-6 2-5 7 5 7s11-5 5-7M3 18c3 4 15 4 18 0',
  'Firefly Meadow': 'M12 7v7m-4-4 8 0M9 4l3 3 3-3M4 21l2-6 2 6m8 0 2-6 2 6M10 10c-5-5-9 2-3 3l5-1m0 0 5 1c6-1 2-8-3-3',
  'Mesh Loom': 'M4 3v18m5-18v18m6-18v18m5-18v18M2 7h20M2 12h20M2 17h20',
  'Little Mesh Villages': 'm2 11 5-5 5 5M4 10v10h6V10m2-3 5-5 5 5m-8-1v8h6V6M13 21v-4h8v4M6 16h2',
};

export function viewIcon(name: string): string {
  return `<svg class="view-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${ICONS[name] ?? ICONS.Labs}"/></svg>`;
}

/** Native disclosures keep grouped navigation usable with keyboard and touch. */
export function createViewNavigation(view: CartoView, extras: ReadonlySet<string>, labs: boolean): HTMLElement {
  const nav = document.createElement('nav'); nav.className = 'dock-views'; nav.setAttribute('aria-label', 'Views');
  const link = (label: string, path: string, icon = label, active = view === label) => {
    const a = (label === 'Netgraph' ? document.querySelector<HTMLAnchorElement>('#netgraph-link') : null) ?? document.createElement('a');
    a.href = path; a.className = 'control-button view-link'; a.innerHTML = viewIcon(icon) + `<span>${label}</span>`;
    a.setAttribute('aria-label', `Open CartoLite ${label === 'Map' ? 'map' : label}`);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    return a;
  };
  nav.append(link('Map', '/'), link('Netgraph', '/netgraph/'));
  if (extras.has('terminal')) nav.append(link('Terminal', '/terminal/'));
  const group = (name: string, id: string, active: boolean) => {
    const details = document.createElement('details'); details.className = 'nav-group'; details.dataset.active = String(active);
    const summary = document.createElement('summary'); summary.className = 'control-button';
    summary.innerHTML = viewIcon(name) + `<span>${name}</span><span class="nav-chevron" aria-hidden="true">⌃</span>`;
    summary.setAttribute('aria-label', name === 'Labs' ? 'Labs experiences' : 'Experimental views');
    const list = document.createElement('div'); list.className = 'nav-popover glass'; list.id = `${id}-options`;
    list.setAttribute('aria-label', `${name} views`); details.append(summary, list); nav.append(details);
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      for (const other of nav.querySelectorAll<HTMLDetailsElement>('details[open]')) if (other !== details) other.open = false;
      for (const button of nav.closest('.controls,.labs-controls')?.querySelectorAll<HTMLButtonElement>('button[aria-expanded="true"][aria-controls]') ?? []) {
        if (button.id !== 'view-button') button.click();
      }
    });
    details.addEventListener('keydown', event => {
      if (event.key === 'Escape' && details.open) { event.preventDefault(); event.stopPropagation(); details.open = false; summary.focus(); }
    });
    return list;
  };
  const experiments = ['Chronoscope', 'Firehose', 'Pachinko'].filter(name => extras.has(name.toLowerCase()));
  if (experiments.length) {
    const list = group('Experimental', 'experimental', experiments.includes(view));
    for (const name of experiments) list.append(link(name, `/${name.toLowerCase()}/`));
  }
  document.getElementById('labs-link')?.remove();
  if (labs) {
    const list = group('Labs', 'labs', view === 'Labs');
    const picker = view === 'Labs' ? document.querySelector<HTMLSelectElement>('#experiment-select') : null;
    const selected = picker?.value || new URLSearchParams(location.search).get('experiment') || 'packet-pond';
    for (const [id, title] of [['packet-pond', 'Packet Pond'], ['firefly-meadow', 'Firefly Meadow'], ['mesh-loom', 'Mesh Loom'], ['little-mesh-villages', 'Little Mesh Villages']]) {
      const a = link(title!, `/labs/?experiment=${id}`, title!, view === 'Labs' && selected === id); a.dataset.lab = id;
      a.addEventListener('click', event => {
        const picker = document.querySelector<HTMLSelectElement>('#experiment-select');
        if (view !== 'Labs' || !picker || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault(); picker.value = id!; picker.dispatchEvent(new Event('change', { bubbles: true }));
        for (const item of list.querySelectorAll('a')) { if (item === a) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); }
      });
      list.append(a);
    }
    picker?.addEventListener('change', () => {
      for (const item of list.querySelectorAll<HTMLAnchorElement>('a[data-lab]')) {
        if (item.dataset.lab === picker.value) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
      }
    });
  }
  nav.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a') : null;
    if (!target || event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
    if (target.getAttribute('aria-current') === 'page') event.preventDefault();
    const details = target.closest<HTMLDetailsElement>('details');
    if (details) { details.open = false; if (event.defaultPrevented) details.querySelector('summary')?.focus(); }
  });
  const close = (event: PointerEvent) => { if (event.target instanceof Node && !nav.contains(event.target)) for (const details of nav.querySelectorAll<HTMLDetailsElement>('details[open]')) details.open = false; };
  document.addEventListener('pointerdown', close);
  window.addEventListener('pagehide', () => document.removeEventListener('pointerdown', close));
  window.addEventListener('pageshow', () => document.addEventListener('pointerdown', close));
  return nav;
}
