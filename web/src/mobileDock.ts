import type { CartoView } from './viewNavigation';

/** Rehome existing controls on phones; their handlers and saved state stay intact. */
export function mountMobileDock(controls: HTMLElement, navigation: HTMLElement, view: CartoView): void {
  const compact = matchMedia('(max-width: 900px), (pointer: coarse)');
  const root = document.documentElement;
  const host = document.createElement('div'); host.className = 'view-menu';
  host.innerHTML = `<button id="view-button" class="control-button" type="button" aria-label="Switch view" aria-controls="view-panel" aria-expanded="false"><span aria-hidden="true">▾</span><span>${view === 'Netgraph' ? 'Graph' : view === 'Terminal' ? 'TTY' : view === 'Chronoscope' ? 'Chrono' : view === 'Firehose' ? 'Hose' : view === 'Pachinko' ? 'Pachi' : view}</span></button><section id="view-panel" class="glass" aria-label="Views and view tools" hidden><header><strong>View</strong><button type="button" aria-label="Close view menu">×</button></header><div class="view-actions"></div></section>`;
  controls.prepend(host);
  const button = host.querySelector<HTMLButtonElement>('#view-button')!;
  const panel = host.querySelector<HTMLElement>('#view-panel')!;
  const actions = host.querySelector<HTMLElement>('.view-actions')!;
  const setOpen = (open: boolean) => { panel.hidden = !open; button.setAttribute('aria-expanded', String(open)); };
  button.addEventListener('click', () => setOpen(panel.hidden));
  panel.querySelector('header button')!.addEventListener('click', () => { setOpen(false); button.focus(); });
  document.addEventListener('pointerdown', event => { if (!host.contains(event.target as Node)) setOpen(false); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); button.focus(); }
  });
  panel.addEventListener('click', event => {
    const action = event.target instanceof Element ? event.target.closest('a,button') : null;
    if (action?.getAttribute('aria-current') === 'page' && !(event instanceof MouseEvent && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0))) {
      event.preventDefault(); button.focus();
    }
    if (action && !action.closest('#labs-sound-options')) {
      if (panel.contains(document.activeElement)) button.focus();
      setOpen(false);
    }
  });
  if (view === 'Labs') for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => {
    if (compact.matches) button.focus();
  });
  const anchors = new Map<HTMLElement, Comment>();
  const move = (element: HTMLElement | null, target: HTMLElement) => {
    if (!element) return;
    if (!anchors.has(element)) {
      const anchor = document.createComment('dock control'); element.before(anchor); anchors.set(element, anchor);
    }
    const anchor = anchors.get(element)!;
    if (compact.matches) { if (element.parentElement !== target) target.append(element); }
    else if (anchor.parentNode && element.previousSibling !== anchor) anchor.after(element);
  };
  let traffic: HTMLElement | undefined;
  const sync = () => {
    root.dataset.mobileDock = String(compact.matches);
    move(navigation, panel);
    // Navigation precedes secondary actions, even when controls arrive after the feed.
    if (compact.matches && navigation.nextSibling !== actions) panel.insertBefore(navigation, actions);
    for (const item of controls.querySelectorAll<HTMLElement>(view === 'Labs'
      ? '#reset-button,#exhibit-button,#info-button,#labs-display-button,#labs-sound-options'
      : '#reset-button,#display-shortcut,#help-button')) move(item, actions);
    if (view === 'Chronoscope' || view === 'Firehose' || view === 'Pachinko') move(document.getElementById('display-button'), actions);
    if (view === 'Chronoscope') move(document.getElementById('follow-button'), actions);
    if (view === 'Firehose' || view === 'Pachinko' || view === 'Chronoscope') move(document.getElementById('legend'), panel);
    if (view === 'Netgraph') {
      const display = document.getElementById('display-panel')!;
      if (!traffic) { traffic = document.createElement('section'); traffic.className = 'mobile-network-controls'; traffic.setAttribute('aria-label', 'Traffic and regions'); display.querySelector('header')!.after(traffic); }
      traffic.hidden = !compact.matches;
      move(document.querySelector('.graph-focus'), traffic);
      move(controls.querySelector('.route-window'), traffic);
      move(document.querySelector('.zoom-controls'), traffic);
      move(document.getElementById('legend'), panel);
      const displayButton = document.getElementById('display-button')!;
      displayButton.querySelector('span:last-child')!.textContent = compact.matches ? 'Layers' : 'Display';
      displayButton.setAttribute('aria-label', compact.matches ? 'Layers and display settings' : 'Display settings');
    }
  };
  compact.addEventListener('change', () => { setOpen(false); sync(); });
  // Follow is appended with the asynchronous graph focus controls, triggering their rehome together.
  const observer = new MutationObserver(sync); observer.observe(controls, { childList: true });
  sync();
  const measure = () => {
    const viewport = window.visualViewport;
    root.style.setProperty('--available-height', `${viewport?.height ?? innerHeight}px`);
    root.style.setProperty('--keyboard-offset', `${Math.max(0, innerHeight - (viewport ? viewport.height + viewport.offsetTop : innerHeight))}px`);
    root.style.setProperty('--dock-height', `${controls.offsetHeight}px`);
    root.dataset.dockTight = String(innerWidth - controls.offsetWidth < 480);
  };
  const resize = new ResizeObserver(measure); resize.observe(controls);
  window.addEventListener('resize', measure);
  window.visualViewport?.addEventListener('resize', measure);
  window.visualViewport?.addEventListener('scroll', measure);
  window.addEventListener('pagehide', () => { observer.disconnect(); resize.disconnect(); });
  window.addEventListener('pageshow', () => { observer.observe(controls, { childList: true }); resize.observe(controls); sync(); measure(); });
  measure();
}
