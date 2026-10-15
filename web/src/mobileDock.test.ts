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
  compact = false; media.dispatchEvent(new Event('change'));
  expect([...controls.children].filter(element => element.className !== 'view-menu')).toEqual(original);
  reset.click(); expect(clicked).toHaveBeenCalledOnce();
});
