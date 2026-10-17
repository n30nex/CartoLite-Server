import type { LiveMap } from './map';
import type { PacketAnimator } from './packetAnimator';
import { browserStorage } from './browserStorage';
import { applyDisplayChrome } from './displayPreferences';
import { terminalGraphics } from './terminalGraphics';
import { characterCells, terminalColor, terminalPreferences, TERMINAL_DEFAULTS, TERMINAL_COLORS } from './terminalGrid';
import './terminal.css';

const KEY = 'cartolite-terminal-v1';
const ROLES: Record<string, string> = { repeater: 'R', companion: 'C', room_server: 'H', sensor: 'S' };

// This page samples the existing 2D packet canvas. Choose CPU backing before
// PacketAnimator obtains the same context, avoiding GPU readback for its glyphs.
document.querySelector<HTMLCanvasElement>('#packet-canvas')?.getContext('2d', { willReadFrequently: true });

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
    let size = Math.max(preferences.size, Math.floor(Math.sqrt(width*height/16000)/.83)), cw = 0, ch = 0;
    do {
      context.font = `${size}px ui-monospace, "DejaVu Sans Mono", "Cascadia Mono", monospace`;
      cw = context.measureText('M').width; ch = size * 1.15;
      if (Math.ceil(width/cw)*Math.ceil(height/ch) <= 16000) break;
      size++;
    } while (size < 128);
    return { width, height, size, cw, ch };
  }

  function draw(source: HTMLCanvasElement, target: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    const { width, height, size, cw, ch } = dimensions(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (!width || !height || !source.width || !source.height) return;
    if (target.width !== Math.ceil(width * dpr) || target.height !== Math.ceil(height * dpr)) { target.width = Math.ceil(width * dpr); target.height = Math.ceil(height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    sample.width = Math.ceil(width / cw) * 2; sample.height = Math.ceil(height / ch) * 4;
    read.imageSmoothingEnabled = false;
    read.drawImage(source, 0, 0, sample.width, sample.height);
    const cells = characterCells(read.getImageData(0, 0, sample.width, sample.height), preferences.glyphs === 'ascii', false);
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
    const { width, height } = dimensions(), size = preferences.size;
    context.font = `${size}px ui-monospace, "DejaVu Sans Mono", "Cascadia Mono", monospace`;
    const cw = context.measureText('M').width, ch = size * 1.25;
    const occupied = new Set<string>();
    const features = map.queryRenderedFeatures(undefined, { layers: labelLayers.filter(id => map.getLayer(id)) });
    const selected = view.getSelectedNodeID();
    const priority = (f: typeof features[number]) => (f.properties.id === selected ? 8 : 0) + (f.layer.id === 'nodes' || f.layer.id === 'clusters' ? 4 : f.layer.id === 'node-labels' ? 2 : 0);
    features.sort((a, b) => priority(b)-priority(a));
    const seen = new Set<string>();
    let drawn = 0;
    for (const feature of features) {
      if (feature.geometry.type !== 'Point') continue;
      const p = feature.properties, node = feature.layer.id === 'nodes', cluster = feature.layer.id === 'clusters';
      const text = cluster ? `[${p.point_count_abbreviated ?? p.point_count}]` : node ? (p.id === selected ? '@' : (ROLES[String(p.role)] ?? '?')) : String(p.label ?? p.name_en ?? p['name:en'] ?? p.name ?? '');
      if (!text) continue;
      const coordinate = feature.geometry.coordinates;
      const point = map.project([coordinate[0]!, coordinate[1]!]);
      // Keep markers on the true hit target. Labels use measured Unicode widths,
      // independent of geographic grid size, so emoji and large screens fit.
      const w = context.measureText(text).width;
      const x = point.x + (feature.layer.id === 'node-labels' ? cw * 2.25 : -w/2), y = point.y-ch/2;
      const key = `${text}:${Math.round(x)}:${Math.round(y)}`;
      if (seen.has(key) || x < 0 || y < 48 || x + w > width || y + ch > height - 60) continue;
      seen.add(key);
      const cells: string[] = [];
      for (let row=Math.floor((y-2)/ch);row<=Math.floor((y+ch+2)/ch);row++) for (let col=Math.floor((x-2)/cw);col<=Math.floor((x+w+2)/cw);col++) cells.push(`${col}:${row}`);
      if (cells.some(cell => occupied.has(cell))) continue;
      cells.forEach(cell => occupied.add(cell));
      context.fillStyle = '#000'; context.fillRect(x - 1, y, w + 2, ch);
      context.fillStyle = terminalColor(node ? (p.id === selected ? 2 : p.role === 'companion' ? 7 : p.role === 'room_server' ? 8 : 4) : cluster ? 4 : feature.layer.id === 'node-labels' ? 2 : 5, preferences.palette);
      context.fillText(text, x, y); drawn++;
    }
    canvas.dataset.labels = String(drawn);
  }

  function fail() {
    failed = true; root.dataset.terminalFallback = 'true'; notice.hidden = false;
    delete root.dataset.terminal;
    for (const item of originalPaint.values()) if (map.getLayer(item.layer)) map.setPaintProperty(item.layer, item.property as Parameters<typeof map.setPaintProperty>[1], item.value);
    originalPaint.clear();
    applyDisplayChrome(); view.setAppearance(undefined, true); animator.refreshAppearance();
    fx.clearRect(0, 0, effects.width, effects.height);
  }

  function paint() {
    if (disposed || failed || document.hidden) return;
    try {
      const started = performance.now();
      const { width, height } = dimensions(), dpr = Math.min(devicePixelRatio || 1, 2);
      if (canvas.width !== Math.ceil(width*dpr) || canvas.height !== Math.ceil(height*dpr)) { canvas.width=Math.ceil(width*dpr); canvas.height=Math.ceil(height*dpr); }
      context.setTransform(dpr,0,0,dpr,0,0); context.clearRect(0,0,width,height); context.textBaseline='top'; labels();
      canvas.dataset.glyphs = preferences.glyphs;
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
    const ids = map.getLayersOrder();
    // Paint settings are valid once the stylesheet exists. Waiting for every
    // tile/source to load can leave the ordinary palette on a busy live map.
    if (disposed || failed || !ids.includes('basemap-water')) return;
    const setPaint = (layer: string, property: string, value: Parameters<typeof map.setPaintProperty>[2]) => {
      const current = map.getPaintProperty(layer, property as Parameters<typeof map.getPaintProperty>[1]);
      if (JSON.stringify(current) === JSON.stringify(value)) return;
      originalPaint.set(`${layer}:${property}`, { layer, property, value: current });
      map.setPaintProperty(layer, property as Parameters<typeof map.setPaintProperty>[1], value);
    };
    // Public layer ordering includes custom layers and avoids serializing all
    // retained GeoJSON just to inspect a few layer IDs and types.
    const layers = ids.map(id => map.getLayer(id)!);
    labelLayers = layers.filter(layer => layer.type === 'symbol' || layer.id === 'nodes' || layer.id === 'clusters').map(layer => layer.id);
    for (const layer of layers) {
      if (layer.type === 'symbol') {
        setPaint(layer.id, 'text-opacity', 0);
      } else if (layer.id.startsWith('basemap-')) {
        const property = layer.type === 'background' ? 'background-color' : layer.type === 'fill' ? 'fill-color' : layer.type === 'line' ? 'line-color' : undefined;
        const color = layer.id.includes('water') ? '#08145a' : layer.id.includes('boundary') ? '#e4d9ba' : layer.id === 'basemap-landcover' ? '#124b24' : layer.id === 'basemap-landuse' ? '#383838' : layer.type === 'line' ? '#526270' : '#030609';
        if (property) setPaint(layer.id, property, layer.id === 'basemap-landcover' ? ['match', ['get','class'], ['wood','grass'], '#124b24', '#383838'] : color);
      }
    }
    capture.attach();
    paint();
  }
  const capture = terminalGraphics(map, () => {
    const { width, height, cw, ch } = dimensions();
    return { columns: Math.max(1,Math.ceil(width/cw)), rows: Math.max(1,Math.ceil(height/ch)), ascii: preferences.glyphs === 'ascii', colors: TERMINAL_COLORS.map((_,i) => terminalColor(i,preferences.palette)) };
  }, paint, fail, () => !disposed && !failed && !document.hidden);
  const visibility = () => { if (document.hidden) capture.suspend(); else { style(); schedule(); } };
  // Appearance/terrain can finish loading while the camera or feed keeps the
  // map busy. Do not wait for idle to reapply the encoded cartographic colours.
  const ensureStyle = () => {
    if (map.getLayer('basemap-water') && (map.getPaintProperty('basemap-water','fill-color') !== '#08145a'
      || (map.getLayer('node-labels') && map.getPaintProperty('node-labels','text-opacity') !== 0))) style();
  };
  const restored = () => {
    failed = false; root.dataset.terminal = 'true'; delete root.dataset.terminalFallback; notice.hidden = true;
    applyDisplayChrome(); view.setAppearance(undefined, true); animator.refreshAppearance(); style(); schedule();
  };
  notice.querySelector('button')!.addEventListener('click', restored);
  map.on('load', style); map.on('idle', style);
  map.on('render', ensureStyle);
  map.on('webglcontextrestored', restored);
  document.addEventListener('visibilitychange', visibility);
  animator.setFrameSink(source => {
    if (!source) { fx.clearRect(0, 0, effects.width, effects.height); return; }
    if (failed || document.hidden) return;
    const now = performance.now();
    if (now - lastPacket < 40 && (source.dataset.activeCount !== '0' || source.dataset.residueCount !== '0')) return;
    try { draw(source, effects, fx); lastPacket = now; } catch { fail(); }
  });
  sync(); style();
  const destroy = () => {
    if (disposed) return;
    disposed = true; capture.destroy(); animator.setFrameSink(undefined);
    map.off('load', style); map.off('idle', style);
    map.off('render', ensureStyle);
    map.off('webglcontextrestored', restored);
    map.off('remove', destroy);
    document.removeEventListener('visibilitychange', visibility); window.removeEventListener('storage', storage);
    for (const element of [canvas, effects, status, notice, settings]) element.remove();
    delete root.dataset.terminal; delete root.dataset.terminalFallback; delete root.dataset.terminalPalette;
  };
  map.on('remove', destroy);
  return destroy;
}
