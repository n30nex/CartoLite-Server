import { afterEach, expect, it } from 'vitest';
import { replaceInspector } from './selection';

afterEach(() => document.body.replaceChildren());

it('retains a focused connection when live updates reorder the chooser', () => {
  const host = document.createElement('aside'); document.body.append(host);
  const content = (ids: string[]) => {
    const root = document.createElement('section');
    root.innerHTML = '<button aria-label="Close">×</button>';
    for (const id of ids) {
      const button = document.createElement('button'); button.dataset.routeId = id;
      button.textContent = id; root.append(button);
    }
    return root;
  };
  replaceInspector(host, content(['a-b', 'b-c']));
  host.querySelector<HTMLButtonElement>('[data-route-id="b-c"]')!.focus();
  replaceInspector(host, content(['b-c', 'a-b']));
  expect((document.activeElement as HTMLElement).dataset.routeId).toBe('b-c');
  replaceInspector(host, content(['a-b']));
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
});
