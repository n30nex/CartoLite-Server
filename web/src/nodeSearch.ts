import { relativeTime, roleLabel, type NodeSearchResult } from './nodeInspector';

export function wireNodeSearch(options: {
  input: HTMLInputElement;
  results: HTMLElement;
  metrics: HTMLElement;
  search: (query: string) => NodeSearchResult[];
  select: (nodeID: string) => void;
  dismiss: () => void;
}): () => void {
  const { input, results } = options;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  results.setAttribute('aria-label', 'Matching nodes');

  const render = (): void => {
    const started = performance.now();
    const matches = options.search(input.value);
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', String(matches.length > 0));
    results.replaceChildren();
    if (input.value.trim() && matches.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No matching public labels';
      results.append(empty);
    }
    for (const [index, { node }] of matches.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'node-search-result';
      button.id = `${results.id}-${index}`;
      button.dataset.nodeId = node.id;
      button.tabIndex = -1;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', 'false');
      const label = document.createElement('strong');
      label.textContent = node.label;
      const context = document.createElement('span');
      context.textContent = `${roleLabel(node.role)} · ${relativeTime(node.lastSeen)}`;
      button.append(label, context);
      button.addEventListener('click', () => options.select(node.id));
      results.append(button);
    }
    options.metrics.dataset.nodeSearchApplyMs = (performance.now() - started).toFixed(1);
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      options.dismiss();
      return;
    }
    const buttons = [...results.querySelectorAll<HTMLButtonElement>('button[role="option"]')];
    if (!buttons.length) return;
    const current = buttons.findIndex((button) => button.id === input.getAttribute('aria-activedescendant'));
    if (event.key === 'Enter') {
      event.preventDefault();
      buttons[Math.max(0, current)]?.click();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = current < 0
        ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
        : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
      buttons.forEach((button, index) => button.setAttribute('aria-selected', String(index === next)));
      input.setAttribute('aria-activedescendant', buttons[next]!.id);
      buttons[next]!.scrollIntoView({ block: 'nearest' });
    }
  });
  return render;
}
