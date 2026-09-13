import type { Map as MapLibreMap } from 'maplibre-gl';

export function attachMapNotice(map: MapLibreMap, container: HTMLElement): (message: string) => void {
  const notice = document.createElement('aside');
  notice.id = 'map-notice';
  notice.className = 'map-notice glass';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  const text = document.createElement('span');
  const retry = document.createElement('button');
  retry.type = 'button'; retry.textContent = 'Retry';
  retry.addEventListener('click', () => location.reload());
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss map notice');
  close.addEventListener('click', () => { notice.hidden = true; });
  notice.append(text, retry, close);
  container.parentElement?.append(notice);
  const show = (message: string): void => { text.textContent = message; notice.hidden = false; };
  // Never forward provider error text: tile URLs can include browser credentials.
  map.on('error', (event) => {
    const detail = safeMapError(event.error?.message);
    if (container.dataset.mapErrorDetail !== detail) console.warn('Map detail could not load:', detail);
    container.dataset.mapErrorDetail = detail;
    show('Some map details could not load. Refresh to retry.');
  });
  return show;
}

/** Provider diagnostics must never include browser credentials or resource URLs. */
export function safeMapError(message: unknown): string {
  return String(message ?? 'Unknown map detail error')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[map resource]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, '[authorization redacted]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|key|token|secret|password|authorization)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[credential redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}(?:\.[A-Za-z0-9_-]+){0,2}\b/g, '[identifier redacted]')
    .slice(0, 240);
}
