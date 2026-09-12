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
  map.on('error', () => show('Some map details could not load. Refresh to retry.'));
  return show;
}
