import type { LiveMap } from './map';
import type { PacketAnimator } from './packetAnimator';
import { browserStorage } from './browserStorage';
import { applyDisplayChrome } from './displayPreferences';
import { terminalCapture, type TerminalPixels } from './terminalCapture';
import { characterCells, terminalColor, terminalPreferences, TERMINAL_DEFAULTS } from './terminalGrid';
import './terminal.css';

const KEY = 'cartolite-terminal-v1';
const ROLES: Record<string, string> = { repeater: 'R', companion: 'C', room_server: 'H', sensor: 'S' };

// This entry precedes Map in the Terminal document only. No renderer or CSS is
// downloaded by the ordinary Map/Netgraph pages, and there is still one feed.
window.addEventListener('cartolite-map-ready', event => {
  if (!document.documentElement.hasAttribute('data-terminal')) return;
  const { view, animator } = (event as CustomEvent<{ view: LiveMap; animator: PacketAnimator }>).detail;
  const destroy = mountTerminal(view, animator);
  window.addEventListener('pagehide', event => { if (!event.persisted) destroy(); });
}, { once: true });

/** Presentation only: the existing Map and packet clock still own the scene. */
export function mountTerminal(view: LiveMap, animator: PacketAnimator): () => void {
  const map = view.map, host = map.getContainer(), root = document.documentElement;
  let preferences = { ...TERMINAL_DEFAULTS };
  try { preferences = terminalPreferences(browserStorage().getItem(KEY)); } catch { /* Storage may be disabled. */ }
  const originalPaint = new Map<string, { layer: string; property: string; value: Parameters<typeof map.setPaintProperty>[2] }>();
  let labelLayers: string[] = [];
  let disposed = false, failed = false, lastPacket = 0;
  const canvas = document.createElement('canvas'), effects = document.createElement('canvas');
  canvas.id = 'terminal-map'; effects.id = 'terminal-packets';
  for (const element of [canvas, effects]) { element.className = 'terminal-canvas'; element.setAttribute('aria-hidden', 'true'); host.after(element); }
  const context = canvas.getContext('2d')!, fx = effects.getContext('2d')!;
  const sample = document.createElement('canvas');
  const read = sample.getContext('2d', { willReadFrequently: true })!;
  const status = document.createElement('div'); status.id = 'terminal-status';
  status.innerHTML = '<strong>CARTOLITE BBS</strong><span class="terminal-coordinates"></span><span class="terminal-help">Drag to pan · Scroll to zoom · Find to inspect</span>';
  host.after(status);
  const notice = document.createElement('div'); notice.className = 'terminal-notice glass'; notice.hidden = true;
  notice.innerHTML = '<span>Terminal graphics paused. The map and live traffic are still available.</span><button type="button">Retry Terminal</button>';
  host.after(notice);
  const settings = document.createElement('fieldset'); settings.className = 'terminal-settings';
  settings.innerHTML = '<legend>Terminal display</legend><label>Phosphor<select aria-label="Terminal palette"><option value="ansi">ANSI colour</option><option value="amber">Amber</option><option value="green">Green</option></select></label><label>Characters<select aria-label="Terminal characters"><option value="braille">Braille dots</option><option value="ascii">ASCII</option></select></label><label>Cell size<select aria-label="Terminal cell size"><option value="10">Fine</option><option value="12">Standard</option><option value="16">Large</option></select></label><button type="button">Reset Terminal display</button><p>R repeater · C companion · H room · S sensor · @ selected. ANSI keeps packet colours; amber and green use one phosphor. Character shading follows the map and terrain. Live timing stays the same.</p>';
  document.querySelector('#map-appearance > summary')!.after(settings);
  const selects = settings.querySelectorAll('select');
  const sync = () => {
    selects[0]!.value = preferences.palette; selects[1]!.value = preferences.glyphs; selects[2]!.value = String(preferences.size);
    root.dataset.terminalPalette = preferences.palette;
    schedule();
  };
  const save = () => { try { browserStorage().setItem(KEY, JSON.stringify(preferences)); } catch { /* Session settings still work. */ } sync(); };
  settings.addEventListener('change', () => { preferences = terminalPreferences(JSON.stringify({ palette: selects[0]!.value, glyphs: selects[1]!.value, size: Number(selects[2]!.value) })); save(); });
  settings.querySelector('button')!.addEventListener('click', () => { preferences = { ...TERMINAL_DEFAULTS }; save(); });
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { preferences = terminalPreferences(event.newValue); sync(); } };
  window.addEventListener('storage', storage);

  function dimensions() {
    const width = host.clientWidth, height = host.clientHeight;
    // Bound raster work on very large screens without dropping any route data.
    const size = Math.max(preferences.size, Math.ceil(Math.sqrt(width * height / 16000) / 0.7));
    context.font = `${size}px ui-monospace, "DejaVu Sans Mono", "Cascadia Mono", monospace`;
    return { width, height, size, cw: context.measureText('M').width, ch: size * 1.15 };
  }

  function draw(source: HTMLCanvasElement | TerminalPixels, target: HTMLCanvasElement, ctx: CanvasRenderingContext2D, geography: boolean) {
    const { width, height, size, cw, ch } = dimensions(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (!width || !height || !source.width || !source.height) return;
    if (target.width !== Math.ceil(width * dpr) || target.height !== Math.ceil(height * dpr)) { target.width = Math.ceil(width * dpr); target.height = Math.ceil(height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (geography) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height); }
    let pixels: TerminalPixels;
    if (source instanceof HTMLCanvasElement) {
      sample.width = Math.ceil(width / cw) * 2; sample.height = Math.ceil(height / ch) * 4;
      read.imageSmoothingEnabled = false;
      read.drawImage(source, 0, 0, sample.width, sample.height);
      pixels = read.getImageData(0, 0, sample.width, sample.height);
    } else pixels = source;
    const cells = characterCells(pixels, preferences.glyphs === 'ascii', geography);
    ctx.font = `${size}px ui-monospace, "DejaVu Sans Mono", "Cascadia Mono", monospace`;
    ctx.textBaseline = 'top';
    // Batch same-colour runs. A full ocean is a few row draws, not 16,000 calls.
    let visible = 0;
    for (let y = 0; y < cells.rows; y++) for (let x = 0; x < cells.columns;) {
      const start = x, color = cells.colors[y * cells.columns + x]!;
      let text = '';
      do { text += cells.glyphs[y * cells.columns + x]!; x++; } while (x < cells.columns && cells.colors[y * cells.columns + x] === color);
      if (color) { ctx.fillStyle = terminalColor(color, preferences.palette); ctx.fillText(text, start * cw, y * ch); visible += x - start; }
    }
    target.dataset.cells = String(visible); target.dataset.columns = String(cells.columns);
    target.dataset.glyphs = preferences.glyphs;
  }

  function labels() {
    const { cw, ch, size, width, height } = dimensions();
    const occupied: { x: number; y: number; w: number }[] = [];
    const features = map.queryRenderedFeatures(undefined, { layers: labelLayers.filter(id => map.getLayer(id)) });
    const selected = view.getSelectedNodeID();
    features.sort((a, b) => Number(b.properties.id === selected) - Number(a.properties.id === selected) || Number(b.layer.id === 'nodes' || b.layer.id === 'clusters') - Number(a.layer.id === 'nodes' || a.layer.id === 'clusters'));
    const seen = new Set<string>();
    context.font = `${size}px ui-monospace, "DejaVu Sans Mono", "Cascadia Mono", monospace`;
    for (const feature of features) {
      if (feature.geometry.type !== 'Point') continue;
      const p = feature.properties, node = feature.layer.id === 'nodes', cluster = feature.layer.id === 'clusters';
      const text = cluster ? `[${p.point_count_abbreviated ?? p.point_count}]` : node ? (p.id === selected ? '@' : (ROLES[String(p.role)] ?? '?')) : String(p.label ?? p.name_en ?? p['name:en'] ?? p.name ?? '');
      if (!text) continue;
      const coordinate = feature.geometry.coordinates;
      const point = map.project([coordinate[0]!, coordinate[1]!]);
      const x = Math.round(point.x / cw) * cw, y = Math.round(point.y / ch) * ch, w = text.length * cw;
      const key = `${text}:${Math.round(x)}:${Math.round(y)}`;
      if (seen.has(key) || x < 0 || y < 48 || x + w > width || y + ch > height - 60) continue;
      seen.add(key);
      if (!node && occupied.some(other => Math.abs(y - other.y) < ch && x < other.x + other.w + cw && x + w + cw > other.x)) continue;
      occupied.push({ x, y, w });
      context.fillStyle = '#000'; context.fillRect(x - 1, y, w + 2, ch);
      context.fillStyle = terminalColor(node ? (p.id === selected ? 2 : p.role === 'companion' ? 7 : p.role === 'room_server' ? 8 : 4) : cluster ? 4 : 5, preferences.palette);
      context.fillText(text.slice(0, 60), x, y);
    }
    canvas.dataset.labels = String(seen.size);
  }

  function fail() {
    failed = true; root.dataset.terminalFallback = 'true'; notice.hidden = false;
    delete root.dataset.terminal;
    for (const item of originalPaint.values()) if (map.getLayer(item.layer)) map.setPaintProperty(item.layer, item.property as Parameters<typeof map.setPaintProperty>[1], item.value);
    originalPaint.clear();
    applyDisplayChrome(); view.setAppearance(undefined, true); animator.refreshAppearance();
    fx.clearRect(0, 0, effects.width, effects.height);
  }

  function paint(pixels: TerminalPixels) {
    if (disposed || failed || document.hidden) return;
    try {
      const started = performance.now();
      draw(pixels, canvas, context, true); labels();
      canvas.dataset.workMs = String(Math.round(performance.now() - started));
      const center = map.getCenter();
      status.querySelector('.terminal-coordinates')!.textContent = `${center.lat.toFixed(2)}, ${center.lng.toFixed(2)}  Z:${map.getZoom().toFixed(1)}`;
    } catch { fail(); }
  }
  function schedule() {
    capture.request();
  }
  // Deliberately restyle only basemap paint. Routes, terrain, regions and source
  // visibility continue to be owned by LiveMap and the user's layer controls.
  function style() {
    if (disposed || failed || !map.isStyleLoaded()) return;
    const paint = (layer: string, property: string, value: Parameters<typeof map.setPaintProperty>[2]) => {
      const current = map.getPaintProperty(layer, property as Parameters<typeof map.getPaintProperty>[1]);
      if (current === value) return;
      originalPaint.set(`${layer}:${property}`, { layer, property, value: current });
      map.setPaintProperty(layer, property as Parameters<typeof map.setPaintProperty>[1], value);
    };
    const layers = map.getStyle().layers;
    labelLayers = layers.filter(layer => layer.type === 'symbol' || layer.id === 'nodes' || layer.id === 'clusters').map(layer => layer.id);
    for (const layer of layers) {
      if (layer.type === 'symbol') {
        paint(layer.id, 'text-opacity', 0);
      } else if (layer.id.startsWith('basemap-')) {
        const property = layer.type === 'background' ? 'background-color' : layer.type === 'fill' ? 'fill-color' : layer.type === 'line' ? 'line-color' : undefined;
        const color = layer.id.includes('water') ? '#08145a' : layer.id.includes('boundary') ? '#e4d9ba' : layer.type === 'line' ? '#233343' : '#030609';
        if (property) paint(layer.id, property, color);
      }
    }
    capture.attach(layers[layers.length - 1]?.id);
  }
  const capture = terminalCapture(map, () => {
    const { width, height, cw, ch } = dimensions();
    return [Math.max(2, Math.ceil(width / cw) * 2), Math.max(4, Math.ceil(height / ch) * 4)];
  }, paint, fail, () => !disposed && !failed && !document.hidden);
  const visibility = () => { if (!document.hidden) { style(); schedule(); } };
  const restored = () => {
    failed = false; root.dataset.terminal = 'true'; delete root.dataset.terminalFallback; notice.hidden = true;
    applyDisplayChrome(); view.setAppearance(undefined, true); animator.refreshAppearance(); style(); schedule();
  };
  notice.querySelector('button')!.addEventListener('click', restored);
  map.on('load', style); map.on('idle', style);
  map.on('webglcontextrestored', restored);
  document.addEventListener('visibilitychange', visibility);
  animator.setFrameSink(source => {
    if (!source) { fx.clearRect(0, 0, effects.width, effects.height); return; }
    if (failed || document.hidden) return;
    const now = performance.now();
    if (now - lastPacket < 40 && (source.dataset.activeCount !== '0' || source.dataset.residueCount !== '0')) return;
    try { draw(source, effects, fx, false); lastPacket = now; } catch { fail(); }
  });
  sync(); style();
  const destroy = () => {
    if (disposed) return;
    disposed = true; capture.destroy(); animator.setFrameSink(undefined);
    map.off('load', style); map.off('idle', style);
    map.off('webglcontextrestored', restored);
    map.off('remove', destroy);
    document.removeEventListener('visibilitychange', visibility); window.removeEventListener('storage', storage);
    for (const element of [canvas, effects, status, notice, settings]) element.remove();
    delete root.dataset.terminal; delete root.dataset.terminalFallback; delete root.dataset.terminalPalette;
  };
  map.on('remove', destroy);
  return destroy;
}
