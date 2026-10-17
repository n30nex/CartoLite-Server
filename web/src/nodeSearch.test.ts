// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { wireNodeSearch } from './nodeSearch';
import { searchNodes } from './nodeInspector';
import type { NodeV2 } from './types';

afterEach(() => document.body.replaceChildren());
it('refreshes arriving matches without losing the keyboard subject or replacing unchanged rows', () => {
  document.body.innerHTML = '<input id="query"><div id="results"></div><div id="metrics"></div>';
  const input = document.querySelector<HTMLInputElement>('#query')!, results = document.getElementById('results')!;
  let nodes: NodeV2[] = [];
  const select = vi.fn();
  const render = wireNodeSearch({ input, results, metrics: document.getElementById('metrics')!, search: query => searchNodes(nodes, query), select, dismiss: vi.fn() });
  input.value = 'Visual'; input.dispatchEvent(new Event('input'));
  expect(results.textContent).toContain('No matching');
  nodes = ['Alpha', 'Bravo'].map((label, i) => ({ id: String(i), label: `Visual ${label}`, role: 'repeater' as const, observer: false, lat: 43, lng: -80, lastSeen: 1000 }));
  render(); const original = results.firstElementChild; render();
  expect(results.firstElementChild).toBe(original);
  input.focus();
  for (const button of results.querySelectorAll('button')) button.scrollIntoView = vi.fn();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
  nodes[1] = { ...nodes[1]!, lastSeen: 2000 }; render();
  expect(document.activeElement).toBe(input);
  expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.dataset.nodeId).toBe('1');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); expect(select).toHaveBeenCalledWith('1');
  input.value = 'Alpha'; input.dispatchEvent(new Event('input'));
  expect(input.hasAttribute('aria-activedescendant')).toBe(false);
});
