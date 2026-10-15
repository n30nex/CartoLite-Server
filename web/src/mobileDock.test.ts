// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mountMobileDock } from './mobileDock';

afterEach(() => { window.dispatchEvent(new Event('pagehide')); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('moves the original controls without losing handlers and restores desktop order', () => {
  let compact = true;
  const media = new EventTarget(); Object.defineProperty(media, 'matches', { get: () => compact });
  vi.stubGlobal('matchMedia', () => media);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  document.body.innerHTML = '<main><section class="controls"><nav><a href="/" aria-current="page">Map</a></nav><button id="reset-button">Reset</button><button id="display-shortcut">Display</button></section></main>';
  const controls = document.querySelector<HTMLElement>('.controls')!, navigation = document.querySelector('nav')!;
  const original = [...controls.children], reset = document.getElementById('reset-button')!;
  const clicked = vi.fn(); reset.addEventListener('click', clicked);
  mountMobileDock(controls, navigation, 'Map');
  expect(navigation.parentElement?.id).toBe('view-panel');
  expect(reset.parentElement?.className).toBe('view-actions');
  document.getElementById('view-button')!.click();
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  navigation.querySelector('a')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(document.getElementById('view-panel')!.hidden).toBe(true);
  document.getElementById('view-button')!.click(); reset.focus(); reset.click();
  expect(document.activeElement?.id).toBe('view-button'); expect(clicked).toHaveBeenCalledOnce();
  compact = false; media.dispatchEvent(new Event('change'));
  expect([...controls.children].filter(element => element.className !== 'view-menu')).toEqual(original);
  reset.click(); expect(clicked).toHaveBeenCalledTimes(2);
});

it('rehomes late graph controls and restores the route selector on desktop', async () => {
  let compact = true;
  const media = new EventTarget(); Object.defineProperty(media, 'matches', { get: () => compact });
  vi.stubGlobal('matchMedia', () => media);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  document.body.innerHTML = '<main><section class="controls"><nav></nav><div><button id="display-button"><span>Display</span></button><section id="display-panel"><header></header></section></div><label class="route-window"><select id="route-window"></select></label><div class="zoom-controls"></div></section><section id="legend"></section></main>';
  const controls = document.querySelector<HTMLElement>('.controls')!, navigation = document.querySelector('nav')!;
  const windowControl = controls.querySelector<HTMLElement>('.route-window')!;
  mountMobileDock(controls, navigation, 'Netgraph');
  const focus = document.createElement('div'); focus.className = 'graph-focus'; document.querySelector('main')!.append(focus);
  controls.append(document.createElement('button')); // Follow arrives after the focus controls.
  await Promise.resolve();
  expect(focus.closest('.mobile-network-controls')).not.toBeNull();
  expect(windowControl.closest('#display-panel')).not.toBeNull();
  compact = false; media.dispatchEvent(new Event('change'));
  expect(windowControl.parentElement).toBe(controls);
  expect(focus.parentElement?.tagName).toBe('MAIN');
});