import './display.css';
import { DEFAULT_DISPLAY, DISPLAY_EVENT, ROUTE_PRESETS, displayPreferences, initializeDisplay, updateDisplay, type DisplayPreferences } from './displayPreferences';

export function mountDisplayControls(parent: HTMLElement, sceneControls = false): void {
  initializeDisplay();
  const section = document.createElement('section');
  section.className = 'display-settings';
  section.setAttribute('aria-label', 'Shared display settings');
  section.innerHTML = `${sceneControls ? `<label>Scene<select data-display="basemap" aria-label="Scene style"><option value="dark">Night</option><option value="light">Daylight</option><option value="streets">Paper</option></select></label><label>Interface<select data-display="theme" aria-label="Interface theme"><option value="map">Match scene</option><option value="dark">Dark</option><option value="light">Light</option></select></label>` : ''}
    <label>Route style<select data-display="preset" aria-label="Route style">${Object.keys(ROUTE_PRESETS).map((id) => `<option value="${id}">${id[0]!.toUpperCase()}${id.slice(1)}</option>`).join('')}<option value="custom">Custom</option></select></label>
    <div class="route-preview" aria-label="Silent route style preview"><i></i><b></b><span>Preview · silent</span></div>
    <details class="display-advanced"><summary>Advanced route styling</summary>
      <label>Line pattern<select data-display="pattern" aria-label="Line pattern"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
      ${([
        ['width', 'Line width', 1, 5, 0.1, 'px'], ['opacity', 'Line opacity', 0.2, 1, 0.05, '%'],
        ['glow', 'Glow', 0, 1, 0.05, '%'], ['packetSize', 'Packet size', 0.75, 2, 0.05, '%'],
        ['trailLength', 'Trail length', 0.5, 2, 0.05, '%'], ['residueSeconds', 'After-trails', 0, 45, 1, 's'],
      ] as const).map(([key, label, min, max, step, unit]) => `<label class="display-slider">${label}<output data-output="${key}" data-unit="${unit}"></output><input data-display="${key}" aria-label="${label}" type="range" min="${min}" max="${max}" step="${step}"></label>`).join('')}
      <button class="display-reset" type="button">Reset route styling</button>
    </details><p class="display-note">Shared with Map and Netgraph in this browser.</p>`;
  const oldOpacity = parent.querySelector<HTMLInputElement>('#route-opacity');
  const oldOpacityLabel = oldOpacity?.closest('label');
  const duplicateOpacity = section.querySelector('[data-display="opacity"]')?.closest('label');
  if (oldOpacityLabel && duplicateOpacity) {
    oldOpacityLabel.querySelector('span')!.textContent = 'Line opacity';
    duplicateOpacity.replaceWith(oldOpacityLabel);
  }
  const layersHeading = parent.querySelector('.map-options-label');
  if (layersHeading?.parentElement === parent) parent.insertBefore(section, layersHeading);
  else parent.append(section);
  const sync = (): void => {
    const settings = displayPreferences();
    for (const input of section.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-display]')) input.value = String(settings[input.dataset.display as keyof DisplayPreferences]);
    for (const output of section.querySelectorAll<HTMLOutputElement>('[data-output]')) {
      const value = Number(settings[output.dataset.output as keyof DisplayPreferences]);
      output.value = `${output.dataset.unit === '%' ? Math.round(value * 100) : Number(value.toFixed(1))}${output.dataset.unit}`;
    }
    section.style.setProperty('--preview-width', `${settings.width}px`);
    section.style.setProperty('--preview-glow', `${settings.glow * 10}px`);
    section.style.setProperty('--preview-opacity', String(settings.opacity));
    section.style.setProperty('--preview-head', `${5 * settings.packetSize}px`);
    section.style.setProperty('--preview-tail', `${30 * settings.trailLength}px`);
    section.dataset.pattern = settings.pattern;
  };
  section.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.display) return;
    updateDisplay({ [input.dataset.display]: Number(input.value), preset: 'custom' });
  });
  section.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLSelectElement) || !input.dataset.display) return;
    const key = input.dataset.display;
    if (key === 'preset') {
      if (input.value !== 'custom') updateDisplay({ preset: input.value as DisplayPreferences['preset'], ...ROUTE_PRESETS[input.value as keyof typeof ROUTE_PRESETS] });
    } else updateDisplay({ [key]: input.value, ...(key === 'pattern' ? { preset: 'custom' as const } : {}) });
  });
  section.querySelector('.display-reset')!.addEventListener('click', () => updateDisplay({ preset: DEFAULT_DISPLAY.preset, ...ROUTE_PRESETS.crisp }));
  window.addEventListener(DISPLAY_EVENT, sync);
  sync();
}

export function mountNetgraphDisplay(): void {
  const controls = document.querySelector<HTMLElement>('.controls')!;
  const host = document.createElement('div');
  host.className = 'display-disclosure popover-control';
  host.innerHTML = '<button id="display-button" class="control-button" type="button" aria-expanded="false" aria-controls="display-panel">◐ <span>Display</span></button><section id="display-panel" class="display-panel glass" aria-label="Display settings" hidden><header><strong>Display</strong><button type="button" aria-label="Close display settings">×</button></header></section>';
  controls.prepend(host);
  const button = host.querySelector<HTMLButtonElement>('#display-button')!;
  const panel = host.querySelector<HTMLElement>('#display-panel')!;
  const close = (restore = false): void => { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); if (restore) button.focus(); };
  button.addEventListener('click', () => { panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); });
  panel.querySelector('button')!.addEventListener('click', () => close(true));
  document.addEventListener('pointerdown', (event) => { if (event.target instanceof Node && !host.contains(event.target)) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !panel.hidden) close(true); });
  mountDisplayControls(panel, true);
}
