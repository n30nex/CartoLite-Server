/** Selection contains only the already-public node ID, never packet identifiers. */
export function requestedNode(): string | null {
  const value = new URL(location.href).searchParams.get('node');
  return value && value.length <= 128 && !/[\u0000-\u001f]/.test(value) ? value : null;
}
export function rememberNode(id: string | null): void {
  const url = new URL(location.href);
  if (id) url.searchParams.set('node', id); else url.searchParams.delete('node');
  history.replaceState(history.state, '', url);
  for (const link of document.querySelectorAll<HTMLAnchorElement>('.dock-views a')) {
    const target = new URL(link.href);
    if (target.pathname !== '/' && !target.pathname.startsWith('/netgraph')) continue;
    if (id) target.searchParams.set('node', id); else target.searchParams.delete('node');
    link.href = target.pathname + target.search;
  }
}
export function replaceInspector(host: HTMLElement, content: HTMLElement): void {
  const active = document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement : null;
  const id = active?.closest<HTMLButtonElement>('button')?.dataset.nodeId;
  const label = active?.getAttribute('aria-label');
  host.replaceChildren(content);
  if (!active) return;
  const target = id ? [...host.querySelectorAll<HTMLButtonElement>('button[data-node-id]')].find(button => button.dataset.nodeId === id)
    : [...host.querySelectorAll<HTMLElement>('[aria-label]')].find(element => element.getAttribute('aria-label') === label);
  (target ?? host.querySelector<HTMLElement>('button'))?.focus({preventScroll:true});
}
