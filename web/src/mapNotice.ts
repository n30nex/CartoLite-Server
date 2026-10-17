import type { Map as MapLibreMap } from 'maplibre-gl';

export function attachMapNotice(map: MapLibreMap, container: HTMLElement): (message: string) => void {
  const notice = document.createElement('aside');
  notice.id = 'map-notice';
  notice.className = 'map-notice glass';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  const dismissed = new Set<string>();
  let currentProblem = '';
  const text = document.createElement('span');
  const actions = document.createElement('div'); actions.className = 'map-notice-actions';
  const graph = document.createElement('a'); graph.href = '/netgraph/'; graph.textContent = 'Open Netgraph';
  const retry = document.createElement('button');
  retry.type = 'button'; retry.textContent = 'Retry';
  retry.addEventListener('click', () => location.reload());
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss map notice');
  close.addEventListener('click', () => { dismissed.add(currentProblem); notice.hidden = true; });
  actions.append(graph, retry, close); notice.append(text, actions);
  container.parentElement?.append(notice);
  const show = (message: string, problem = message): void => {
    if (dismissed.has(problem) || (!notice.hidden && currentProblem === problem)) return;
    currentProblem = problem; text.textContent = message; notice.hidden = false;
  };
  // Never forward provider error text: tile URLs can include browser credentials.
  const onError = (event: { error?: { message?: string } }): void => {
    const detail = safeMapError(event.error?.message);
    if (container.dataset.mapErrorDetail !== detail) console.warn('Map detail could not load:', detail);
    container.dataset.mapErrorDetail = detail;
    show(`Some map details could not load. ${detail}`, detail);
  };
  map.on('error', onError);
  map.once('remove', () => { map.off('error', onError); notice.remove(); });
  return show;
}

/** Only fixed categories may leave this function; provider text is uncontrolled. */
export function safeMapError(message: unknown): string {
  const text = typeof message === 'string' ? message : '';
  if (/\b(?:401|403)\b|unauthori[sz]ed|forbidden/i.test(text)) return 'Map resource access was denied.';
  if (/\b429\b|rate.limit/i.test(text)) return 'The map provider is temporarily limiting requests.';
  if (/glyph|fontstack|font/i.test(text)) return 'Map labels could not be loaded.';
  if (/webgl|shader|context.lost|buffer/i.test(text)) return 'The map renderer reported an error.';
  if (/terrain|elevation/i.test(text)) return 'Terrain data could not be rendered.';
  if (/geojson|promote.?id|update.?data|feature/i.test(text)) return 'Map overlay data could not be updated.';
  if (/layer|paint|layout|expression|style/i.test(text)) return 'Map style or layer setup failed.';
  if (/image|bitmap|decod/i.test(text)) return 'Map imagery could not be decoded.';
  if (/tile|fetch|network|request|ajax|http/i.test(text)) return 'Map tiles or resources could not be loaded.';
  return 'Map details could not be rendered.';
}
