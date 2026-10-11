import type { NetgraphRenderer } from './renderer';

export function mountGraphCamera(graph: NetgraphRenderer): () => void {
  const controls = document.querySelector<HTMLElement>('.controls')!;
  const button = document.createElement('button');
  button.id = 'graph-3d-button'; button.type = 'button'; button.className = 'control-button';
  button.textContent = '3D'; button.setAttribute('aria-label', '3D Netgraph'); button.setAttribute('aria-pressed', 'false');
  button.title = 'Tilt and rotate the topology';
  controls.insertBefore(button, controls.querySelector('.display-disclosure'));
  const panel = document.createElement('div'); panel.className = 'graph-camera'; panel.hidden = true;
  panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', '3D camera controls');
  panel.innerHTML = '<strong>3D camera</strong><div><button type="button" data-left aria-label="Rotate topology left" title="Rotate left">↶</button><button type="button" data-right aria-label="Rotate topology right" title="Rotate right">↷</button><button type="button" data-flat>Top-down</button></div><label>Tilt<input type="range" min="8" max="65" step="1" value="45" aria-label="Topology tilt"><output>45°</output></label><small>Drag to pan. Shift-drag or right-drag to rotate. Pinch to zoom and twist to rotate. Height is schematic.</small>';
  document.getElementById('display-panel')!.append(panel);
  const tilt = panel.querySelector('input')!, output = panel.querySelector('output')!;
  const navigate = () => document.getElementById('netgraph-stage')!.dispatchEvent(new Event('graphnavigate'));
  button.addEventListener('click', () => { navigate(); graph.set3D(!graph.is3D()); });
  panel.querySelector('[data-left]')!.addEventListener('click', () => { navigate(); graph.rotateBy(-Math.PI / 12); });
  panel.querySelector('[data-right]')!.addEventListener('click', () => { navigate(); graph.rotateBy(Math.PI / 12); });
  panel.querySelector('[data-flat]')!.addEventListener('click', () => { navigate(); graph.set3D(false); button.focus(); });
  tilt.addEventListener('input', () => { navigate(); graph.setTilt(Number(tilt.value)); });
  const sync = () => {
    const enabled = graph.is3D();
    button.setAttribute('aria-pressed', String(enabled)); button.classList.toggle('selected', enabled);
    panel.hidden = !enabled;
    const degrees = graph.tiltDegrees();
    if (document.activeElement !== tilt) tilt.value = String(degrees);
    output.value = `${degrees}°`;
  };
  sync(); return sync;
}
