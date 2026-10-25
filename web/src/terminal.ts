import type { LiveMap } from './map';
import type { PacketAnimator } from './packetAnimator';
import { browserStorage } from './browserStorage';
import { applyDisplayChrome, displayPreferences, DISPLAY_EVENT, effectStrength, prefersReducedMotion, setDisplayColors } from './displayPreferences';
import { terminalGraphics } from './terminalGraphics';
import { characterCells } from './terminalGrid';
import { loadTerminal, TERMINAL_FONTS, TERMINAL_KEY, TERMINAL_LEGACY_KEY, shade, terminalNeedsRecovery } from './terminalProfile';
import { terminalControls } from './terminalControls';
import './terminal.css';

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
  let preferences = loadTerminal(browserStorage());
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
  status.innerHTML = '<strong>CARTOLITE BBS</strong><span class="terminal-coordinates"></span><span class="terminal-scope"></span><span class="terminal-help">Drag to pan · Scroll to zoom · Find to inspect</span>';
  host.after(status);
  const notice = document.createElement('div'); notice.className = 'terminal-notice glass'; notice.hidden = true;
  notice.innerHTML = '<span>Terminal graphics paused. The map and live traffic are still available.</span><button type="button">Retry Terminal</button>';
  host.after(notice);
  const controls = terminalControls(preferences, value => {
    preferences=value;
    try { browserStorage().setItem(TERMINAL_KEY,JSON.stringify(preferences)); } catch { /* Session settings still work. */ }
    sync();
  });
  const { settings }=controls;
  document.querySelector('#map-appearance > summary')!.after(settings);
  const allReset=document.querySelector<HTMLButtonElement>('#reset-appearance')!;
  const resetTerminal=()=>settings.querySelector<HTMLButtonElement>('[data-reset-terminal]')!.click();
  allReset.addEventListener('click',resetTerminal);
  if(allReset.nextElementSibling)allReset.nextElementSibling.textContent='Resets Terminal layers and display. Map, Netgraph and sound settings stay unchanged.';
  const font = (size: number) => `${preferences.weight} ${size}px ${TERMINAL_FONTS[preferences.font].family}`;
  const packetColours = () => ({2:preferences.colours.core,3:preferences.colours.other,4:preferences.colours.advert,5:preferences.colours.trace,6:preferences.colours.text,7:preferences.colours.ack,8:preferences.colours.control});
  let loadedFont = '';
  const sync = () => {
    controls.sync(preferences);
    root.dataset.terminalPalette = preferences.palette;
    root.dataset.terminalTraffic = preferences.traffic;
    root.dataset.terminalFont = preferences.font;
    for(const [key,value] of Object.entries(preferences.colours))root.style.setProperty(`--terminal-${key}`,value);
    root.style.setProperty('--terminal-font',TERMINAL_FONTS[preferences.uiFont].family);
    root.style.setProperty('--terminal-scale',String(preferences.uiScale));
    applyColours();
    view.setAppearance(undefined,true); animator.setPresentationGlow(preferences.liveGlow);animator.refreshAppearance(); style();
    const nextFont=[preferences.font,preferences.uiFont,preferences.weight].join(':');
    if(loadedFont!==nextFont) {
      loadedFont=nextFont;
      void Promise.all([document.fonts.load(font(32)),document.fonts.load(`16px ${TERMINAL_FONTS[preferences.uiFont].family}`)])
        .then(()=>{if(!disposed && !failed && nextFont===loadedFont)capture.refreshFont();}).catch(()=>{ /* System fallback remains usable. */ });
    }
    fx.clearRect(0,0,effects.width,effects.height);
    lastPacket=0;
    schedule();
  };
  const storage = (event: StorageEvent) => { if (event.key === TERMINAL_KEY || event.key === TERMINAL_LEGACY_KEY || event.key === null) { preferences=loadTerminal(browserStorage()); sync(); } };
  window.addEventListener('storage', storage);

  function applyColours() {
    if(failed)return;
    const c=preferences.colours;
    root.dataset.terminalRecovery=String(terminalNeedsRecovery(preferences));
    for(const kind of ['advert','trace','text','ack','control','other'] as const) {
      root.style.setProperty(`--terminal-${kind}-rgb`,[1,3,5].map(i=>parseInt(c[kind].slice(i,i+2),16)).join(','));
    }
    setDisplayColors({
      '#4de7c4':c.advert,'#ffd15a':c.trace,'#ff75b5':c.text,'#78cfff':c.ack,'#a78bfa':c.control,'#9caebd':c.other,
      '#73d9cf':c.advert,'#45c27f':c.repeater,'#53a7e8':c.companion,'#ab76dc':c.room,'#a2ad57':c.sensor,'#8794a6':c.sensor,
      '#ffffff':c.core,'#eaffff':c.core,'#f2ffff':c.core,'#edfffd':c.core,'#e5fffc':c.core,
      '#f3b844':c.neighbours,'#f2bd55':c.selection,'#fff0b8':c.selection,'#f5cf76':c.selection,
      '#69d1ca':c.boundary,'#8ec5c1':c.places,'#f6d77f':c.labels,'#d2e0ef':c.labels,
      '#02070b':c.background,'#061216':c.background,'#08272c':c.background,'#bce9e5':c.labels,'#48d5c7':c.repeater,'#32c8bb':c.repeater,
    });
    applyDisplayChrome();
  }
  const displayChanged=()=>{ applyColours(); style(); schedule(); };
  window.addEventListener(DISPLAY_EVENT,displayChanged);

  function dimensions() {
    const width = host.clientWidth, height = host.clientHeight;
    // Bound raster work on very large screens without dropping any route data.
    let size = Math.max(preferences.size, Math.floor(Math.sqrt(width*height/16000)/.83)), cw = 0, ch = 0;
    do {
      context.font = font(size);
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
    const colours=packetColours();
    const cells = characterCells(read.getImageData(0, 0, sample.width, sample.height), preferences.glyphs === 'ascii', colours);
    ctx.font = font(size);
    ctx.textBaseline = 'top';
    const glow = prefersReducedMotion() ? 0 : preferences.liveGlow * effectStrength() * (source.dataset.qualityMode === 'low' ? 2 : source.dataset.qualityMode === 'balanced' ? 4 : 6);
    ctx.lineWidth=.5;
    // Batch colour/brightness runs. Bound decorative work before reducing cores.
    let visible = 0, blooms=0;
    for (let y = 0; y < cells.rows; y++) for (let x = 0; x < cells.columns;) {
      const start = x, color = cells.colors[y * cells.columns + x]!, energy=cells.energy[y*cells.columns+x]!;
      let text = '';
      do { text += cells.glyphs[y * cells.columns + x]!; x++; } while (x < cells.columns && cells.colors[y * cells.columns + x] === color && cells.energy[y*cells.columns+x] === energy);
      if (!color) continue;
      ctx.globalAlpha=Math.min(1,energy/255*1.35);
      ctx.fillStyle=ctx.strokeStyle=ctx.shadowColor=colours[color as keyof typeof colours]??preferences.colours.core;
      ctx.shadowBlur=blooms++<120 ? glow : 0;
      // A console font may fall back for Braille. Keep its glyphs inside the
      // same geographic cells instead of letting the fallback widen the trail.
      ctx.strokeText(text,start*cw,y*ch,(x-start)*cw); ctx.fillText(text,start*cw,y*ch,(x-start)*cw); visible+=x-start;
    }
    ctx.shadowBlur=0; ctx.fillStyle=preferences.colours.core;
    for(let i=0;i<cells.hot.length;i++) if(cells.hot[i]!==' ') {
      ctx.globalAlpha=cells.energy[i]!/255;
      ctx.fillText(cells.hot[i]!,i%cells.columns*cw,Math.floor(i/cells.columns)*ch,cw);
    }
    ctx.globalAlpha=1;
    target.dataset.glow=String(glow);
    target.dataset.cells = String(visible); target.dataset.columns = String(cells.columns);
    target.dataset.glyphs = preferences.glyphs;
  }

  function labels() {
    const { width, height } = dimensions(), size = preferences.fontSize * (displayPreferences().textSize==='large'?1.25:1);
    context.font = font(size);
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
      context.font = font(size);
      const text = cluster ? `[${p.point_count_abbreviated ?? p.point_count}]` : node ? (p.id === selected ? '@' : (ROLES[String(p.role)] ?? '?')) : String(p.label ?? p.name_en ?? p['name:en'] ?? p.name ?? '');
      if (!text) continue;
      const coordinate = feature.geometry.coordinates;
      const point = map.project([coordinate[0]!, coordinate[1]!]);
      // Keep markers on the true hit target. Labels use measured Unicode widths,
      // independent of geographic grid size, so emoji and large screens fit.
      const w = context.measureText(text).width;
      const key = `${feature.layer.id}:${text}:${Math.round(point.x)}:${Math.round(point.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const nodeLabel = feature.layer.id === 'node-labels', centered = Math.max(2,Math.min(width-w-2,point.x-w/2));
      const positions = nodeLabel ? [[point.x+cw*2.25,point.y-ch/2],[centered,point.y+ch*1.5],[centered,point.y-ch*2.5]] : [[point.x-w/2,point.y-ch/2]];
      for (const [x=0,y=0] of positions) {
        if (x < 0 || y < 48 || x+w > width || y+ch > height-60) continue;
        const cells: string[] = [];
        for (let row=Math.floor((y-2)/ch);row<=Math.floor((y+ch+2)/ch);row++) for (let col=Math.floor((x-2)/cw);col<=Math.floor((x+w+2)/cw);col++) cells.push(`${col}:${row}`);
        if (cells.some(cell => occupied.has(cell))) continue;
        cells.forEach(cell => occupied.add(cell));
        context.fillStyle = preferences.colours.background; context.fillRect(x-1,y,w+2,ch);
        const c=preferences.colours;
    root.dataset.terminalRecovery=String(terminalNeedsRecovery(preferences));
        context.fillStyle = selected && p.id===selected ? c.selection : node ? (p.role==='companion'?c.companion:p.role==='room_server'?c.room:p.role==='repeater'?c.repeater:c.sensor) : cluster?c.repeater:nodeLabel?c.labels:shade(c.places,preferences.labelBrightness);
        context.shadowColor=String(context.fillStyle); context.shadowBlur=node || cluster ? 3*effectStrength() : 0;
        context.globalAlpha=node && p.id!==selected && typeof p.opacity==='number' ? Math.max(.65,Math.min(1,p.opacity)) : 1;
        context.fillText(text,x,y); context.shadowBlur=0; context.globalAlpha=1; drawn++; break;
      }
    }
    canvas.dataset.labels = String(drawn);
  }

  function fail() {
    if (failed || disposed) return;
    failed = true; root.dataset.terminalFallback = 'true'; notice.hidden = false;
    delete root.dataset.terminal; delete root.dataset.terminalRecovery;
    fx.clearRect(0, 0, effects.width, effects.height);
    // Shader failure can arrive inside MapLibre's custom-layer render pass.
    // Restore its GL state before changing paint/layer state for the fallback.
    queueMicrotask(() => {
      if (!failed || disposed) return;
      // Retry must re-enter the native custom-layer lifecycle as well as rebuild
      // our shaders; keeping the failed layer installed can leave a stale frame.
      capture.detach();
      for (const item of originalPaint.values()) if (map.getLayer(item.layer)) map.setPaintProperty(item.layer, item.property as Parameters<typeof map.setPaintProperty>[1], item.value);
      originalPaint.clear();
      setDisplayColors();
      animator.setPresentationGlow(1);
      applyDisplayChrome(); view.setAppearance(undefined, true); animator.refreshAppearance();
    });
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
      const routes=document.querySelector('#routes-button')?.getAttribute('aria-pressed')==='true';
      const live=document.querySelector('#live-packets-button')?.getAttribute('aria-pressed')==='true';
      const window=document.querySelector<HTMLSelectElement>('#route-window')?.selectedOptions[0]?.textContent??'';
      status.querySelector('.terminal-scope')!.textContent=routes?`Links ${window}${live?'':' · live off'}`:live?'Live only':'Traffic hidden';
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
      // These colours encode semantic classes for the GPU classifier. A colour
      // transition can temporarily turn water into road/terrain ink after Retry.
      const transition = `${property}-transition` as Parameters<typeof map.getPaintProperty>[1];
      const oldTransition = map.getPaintProperty(layer, transition);
      if (!originalPaint.has(`${layer}:${transition}`)) originalPaint.set(`${layer}:${transition}`, { layer, property: transition, value: oldTransition });
      if (JSON.stringify(oldTransition) !== '{"duration":0,"delay":0}') map.setPaintProperty(layer, transition, { duration: 0, delay: 0 });
      const current = map.getPaintProperty(layer, property as Parameters<typeof map.getPaintProperty>[1]);
      if (JSON.stringify(current) === JSON.stringify(value)) return;
      if(!originalPaint.has(`${layer}:${property}`))originalPaint.set(`${layer}:${property}`, { layer, property, value: current });
      map.setPaintProperty(layer, property as Parameters<typeof map.setPaintProperty>[1], value);
    };
    // Public layer ordering includes custom layers and avoids serializing all
    // retained GeoJSON just to inspect a few layer IDs and types.
    const layers = ids.map(id => map.getLayer(id)!);
    labelLayers = layers.filter(layer => layer.type === 'symbol' || layer.id === 'nodes' || layer.id === 'clusters').map(layer => layer.id);
    for (const layer of layers) {
      if (layer.type === 'symbol') {
        setPaint(layer.id, 'text-opacity', 0);
      } else if (['nodes','nodes-glow','node-core'].includes(layer.id)) {
        setPaint(layer.id,'circle-opacity',0);
        if(layer.id==='nodes')setPaint(layer.id,'circle-stroke-opacity',0);
      } else if(layer.id==='building-footprints') {
        setPaint(layer.id,'fill-color','#ffd15a');setPaint(layer.id,'fill-opacity',1);
      } else if(layer.id==='building-extrusions') {
        setPaint(layer.id,'fill-extrusion-color','#ffd15a');setPaint(layer.id,'fill-extrusion-opacity',1);
      }
      else if(layer.id==='terrain-hillshade') {
        setPaint(layer.id,'hillshade-shadow-color','#030609');setPaint(layer.id,'hillshade-highlight-color','#72b89b');
      } else if (layer.id.startsWith('basemap-')) {
        const property = layer.type === 'background' ? 'background-color' : layer.type === 'fill' ? 'fill-color' : layer.type === 'line' ? 'line-color' : undefined;
        const color = layer.id.includes('water') ? '#08145a' : layer.id.includes('boundary') ? '#c184f6' : layer.id === 'basemap-landcover' ? '#124b24' : layer.id === 'basemap-landuse' ? '#383838' : layer.type === 'line' ? '#405060' : '#030609';
        if (property) setPaint(layer.id, property, layer.id === 'basemap-landcover' ? ['match', ['get','class'], ['wood','grass'], '#124b24', '#383838'] : color);
      }
    }
    capture.attach();
    paint();
  }
  const capture = terminalGraphics(map, () => {
    const { width, height, cw, ch } = dimensions();
    const c=preferences.colours;
    root.dataset.terminalRecovery=String(terminalNeedsRecovery(preferences));
    return { columns: Math.max(1,Math.ceil(width/cw)), rows: Math.max(1,Math.ceil(height/ch)), mode:['braille','ascii','blocks','cell'].indexOf(preferences.glyphs),
      colors:[c.background,c.water,c.terrain,c.roads,c.terrain,c.buildings,c.boundary,c.shore,c.boundary,c.vegetation,c.urban,c.shore],brightness:preferences.mapBrightness,font:font(32) };
  }, paint, fail, () => !disposed && !failed && !document.hidden);
  const visibility = () => { if (document.hidden) capture.suspend(); else { style(); schedule(); } };
  // Appearance/terrain can finish loading while the camera or feed keeps the
  // map busy. Do not wait for idle to reapply the encoded cartographic colours.
  const ensureStyle = () => {
    if (map.getLayer('basemap-water') && (map.getPaintProperty('basemap-water','fill-color') !== '#08145a'
      || (map.getLayer('node-labels') && map.getPaintProperty('node-labels','text-opacity') !== 0)
      || (map.getLayer('nodes') && map.getPaintProperty('nodes','circle-opacity') !== 0)
      || (map.getLayer('building-footprints') && map.getPaintProperty('building-footprints','fill-color') !== '#ffd15a'))) style();
  };
  const restored = () => {
    failed = false; root.dataset.terminal = 'true'; delete root.dataset.terminalFallback; notice.hidden = true;
    sync();
  };
  notice.querySelector('button')!.addEventListener('click', restored);
  map.on('load', style); map.on('style.load',style);map.on('idle', style);
  map.on('render', ensureStyle);
  map.on('webglcontextrestored', restored);
  document.addEventListener('visibilitychange', visibility);
  animator.setFrameSink(source => {
    if (!source) { fx.clearRect(0, 0, effects.width, effects.height); return; }
    if (failed || document.hidden) return;
    const now = performance.now();
    if (now - lastPacket < 40 && (source.dataset.activeCount !== '0' || source.dataset.residueCount !== '0')) return;
    try {
      if(preferences.traffic==='smooth') {
        // Show the original canvas directly: no full-screen copy or second clock.
        effects.dataset.cells=source.dataset.activeCount??'0';effects.dataset.glow='0';
      } else draw(source, effects, fx);
      lastPacket = now;
    } catch { fail(); }
  });
  sync(); style();
  const destroy = () => {
    if (disposed) return;
    disposed = true; capture.destroy(); animator.setFrameSink(undefined);
    map.off('load', style); map.off('style.load',style);map.off('idle', style);
    map.off('render', ensureStyle);
    map.off('webglcontextrestored', restored);
    map.off('remove', destroy);
    document.removeEventListener('visibilitychange', visibility); window.removeEventListener('storage', storage);
    window.removeEventListener(DISPLAY_EVENT,displayChanged);allReset.removeEventListener('click',resetTerminal);setDisplayColors();animator.setPresentationGlow(1);
    for (const element of [canvas, effects, status, notice, settings]) element.remove();
    delete root.dataset.terminal; delete root.dataset.terminalRecovery; delete root.dataset.terminalFallback; delete root.dataset.terminalPalette;
    delete root.dataset.terminalTraffic;delete root.dataset.terminalFont;
  };
  map.on('remove', destroy);
  return destroy;
}
