import { canvasEffects } from '../gpuEffects';
import { DISPLAY_EVENT, canvasColorWithAlpha as alpha, displayColor, displayPreferences, effectStrength, lightScene, lineDash, prefersReducedMotion } from '../displayPreferences';
import { drawPacketSignature, packetTrail, routeMotion, segmentNearViewport } from '../packetAnimator';
import { packetSignature, payloadColor } from '../trafficVisuals';
import type { EndpointV2, NodeV2, PacketView, StateV2 } from '../types';
import type { MapChanges } from '../state';
import type { SurfacePoint } from '../terrainProjection';
import { buildNetgraphLayout, extendNetgraphLayout, graphTopologyChanged, routeTopology } from '../netgraph/layout';
import { nearestNetgraphArea, type NetgraphAreaAnchor } from '../netgraph/areas';
import { distanceToGraphPath } from '../netgraph/camera';
import { ChronoscopeTimeline, type ChronoscopeMode, type Observation } from './timeline';

type Point = { x: number; y: number };
const ROLES = { repeater: '#67ead2', companion: '#78cfff', room_server: '#d694ff', sensor: '#ffd06c', unknown: '#a6b4bf' };

/** Orthographic time depth keeps old traces aligned and projection work bounded. */
export class ChronoscopeCanvasRenderer {
  readonly timeline = new ChronoscopeTimeline();
  readonly #ctx: CanvasRenderingContext2D;
  readonly #fx: CanvasRenderingContext2D;
  readonly #base = document.createElement('canvas');
  readonly #baseCtx: CanvasRenderingContext2D;
  readonly #gpu: ReturnType<typeof canvasEffects>;
  readonly #resize: ResizeObserver;
  readonly #pointers = new Map<number, Point>();
  #points = new Map<string, Point>();
  #nodes = new Map<string, NodeV2>();
  #assignments = new Map<string, NetgraphAreaAnchor>();
  #layout = buildNetgraphLayout([], []);
  #bounds = this.#layout.bounds;
  #framed = false;
  #topology = new Map<string, string>();
  #records: readonly Observation[] = [];
  #hits: Array<{ record: Observation; path: readonly SurfacePoint[] }> = [];
  #regions: Set<string> | null = null;
  #selected: string | null = null;
  #selectedEvent: number | null = null;
  #width = 1; #height = 1; #dpr = 1; #scale = 1; #depth = 0;
  #pan = { x: 0, y: 0 }; #zoom = 1; #angle = -.12;
  #mode: ChronoscopeMode = 'sculpture'; #seconds = 60; #slice = 0;
  #frame = 0; #timer = 0; #dirty = true; #disposed = false;
  #dragged = false; #pointerStart?: Point; #gesture?: { distance: number; zoom: number };
  #drawMS = 0; #lastStats = 0;
  constructor(readonly stage: HTMLElement, readonly canvas: HTMLCanvasElement, readonly effects: HTMLCanvasElement,
    readonly callbacks: { node(id: string | null): void; packet(record: Observation): void; change?(): void }) {
    const ctx = canvas.getContext('2d'), fx = effects.getContext('2d'), base = this.#base.getContext('2d');
    if (!ctx || !fx || !base) throw new Error('Canvas is unavailable');
    this.#ctx = ctx; this.#fx = fx; this.#baseCtx = base;
    this.#gpu = canvasEffects(stage, effects);
    this.#resize = new ResizeObserver(this.resize); this.#resize.observe(stage);
    stage.addEventListener('pointerdown', this.pointerDown);
    stage.addEventListener('pointermove', this.pointerMove);
    stage.addEventListener('pointerup', this.pointerUp);
    stage.addEventListener('pointercancel', this.pointerCancel);
    stage.addEventListener('lostpointercapture', this.pointerCancel);
    stage.addEventListener('wheel', this.wheel, { passive: false });
    stage.addEventListener('keydown', this.keydown);
    window.addEventListener(DISPLAY_EVENT, this.appearance);
    document.addEventListener('visibilitychange', this.visibility);
    this.resize();
  }
  get nodes(): ReadonlyMap<string, NodeV2> { return this.#nodes; }
  get regions() { return this.#layout.areas; }
  get selected(): string | null { return this.#selected; }
  get mode(): ChronoscopeMode { return this.#mode; }
  get seconds(): number { return this.#seconds; }
  get sliceSeconds(): number { return this.#slice; }
  get frozen(): boolean { return this.timeline.frozen; }
  get frameTime(): number { return this.timeline.clock(performance.now()); }
  setAssignments(areas: Map<string, NetgraphAreaAnchor>): void { this.#assignments = areas; }
  render(state: Readonly<StateV2>, changes: MapChanges | null): void {
    if (!changes) return;
    const started = performance.now();
    const changed = changes.reset || changes.nodes?.some(n => !this.#nodes.has(n.id)) || graphTopologyChanged(this.#topology, changes.routes ?? [], state.routes.length);
    this.#nodes = new Map(state.nodes.map(n => [n.id, n]));
    if (changed) {
      this.#layout = extendNetgraphLayout(this.#layout, state.nodes, state.routes, this.#assignments, true);
      this.#topology = routeTopology(state.routes); this.reproject();
    }
    this.#dirty = true; this.request();
    this.stage.dataset.totalNodes = String(state.nodes.length); this.stage.dataset.totalRoutes = String(state.routes.length);
    this.stage.dataset.renderState = 'idle';
    this.stage.dataset.renderApplyMs = String(performance.now() - started);
  }
  setMode(mode: ChronoscopeMode): void { this.#mode = mode; if (mode === 'slice') this.freeze(); this.reproject(); this.request(); }
  setWindow(seconds: number): void { this.#seconds = seconds; this.#slice = Math.min(this.#slice, seconds); this.reproject(); this.request(); }
  setSlice(seconds: number): void { this.#slice = seconds; this.freeze(); this.request(); }
  setRegions(regions: string[] | null): void {
    if (regions === null && this.#regions === null || regions !== null && this.#regions?.size === regions.length && regions.every(code => this.#regions!.has(code))) return;
    this.#regions = regions === null ? null : new Set(regions); this.#pan = {x:0,y:0}; this.#zoom=1; this.#framed=false;
    if (this.#selectedEvent!==null || this.#selected&&!this.nodeInRegions(this.#selected)) this.callbacks.node(null);
    this.reproject(); this.request();
  }
  nodeInRegions(id: string): boolean { return !this.#regions || this.#regions.has(this.#layout.positions.get(id)?.areaCode ?? this.#assignments.get(id)?.code ?? ''); }
  selectNode(id: string | null): void { this.#selected = id; this.#selectedEvent = null; this.#dirty = true; this.request(); }
  selectPacket(record: Observation): void { this.#selectedEvent = record.packet.seq; this.#selected = null; this.#dirty = true; this.request(); }
  focusNode(id: string): void {
    this.#pan = { x: 0, y: 0 }; this.reproject(); const p = this.#points.get(id);
    if (p) { this.#pan = { x: this.#width * .5 - p.x, y: (this.#height - this.#depth) * .5 - p.y }; this.reproject(); }
    this.request();
  }
  home(): void { this.#pan = { x: 0, y: 0 }; this.#zoom = 1; this.#angle = -.12; this.#framed=false; this.reproject(); this.request(); }
  panBy(x: number, y: number): void { this.#pan.x += x; this.#pan.y += y; this.reproject(); this.request(); }
  zoomBy(factor: number): void { this.#zoom = Math.max(.2, Math.min(12, this.#zoom * factor)); this.reproject(); this.request(); }
  rotateBy(delta: number): void { this.#angle += delta; this.reproject(); this.request(); }
  freeze(): void { this.timeline.freeze(performance.now()); this.stage.dispatchEvent(new Event('graphnavigate')); this.request(); this.callbacks.change?.(); }
  live(): void { this.timeline.resume(); this.#selectedEvent = null; this.request(); this.callbacks.change?.(); }
  clear(): void { this.timeline.clear(); this.#selectedEvent = null; this.request(); }
  addPacket(packet: PacketView): Observation | undefined {
    if (document.hidden) return;
    const record = this.timeline.add(packet, performance.now()); if (!this.frozen) this.request(); return record;
  }
  visibleRecords(): readonly Observation[] { return this.timeline.visible(performance.now(), this.#seconds).filter(r => this.matches(r)); }
  inspectionRecords(): readonly Observation[] {
    const at=this.frameTime;
    return this.visibleRecords().filter(record=>this.#mode!=='slice'||Math.abs((at-record.started)/1_000-this.#slice)<=2);
  }
  matches(record: Observation): boolean {
    const packet = record.packet;
    return packet.mode === 'observer' ? this.nodeInRegions(packet.observer.id)
      : packet.segments.some(s => this.nodeInRegions(s.from.id) && this.nodeInRegions(s.to.id));
  }
  project(coordinates: [number, number]): Point {
    const node = [...this.#nodes.values()].find(n => n.lng === coordinates[0] && n.lat === coordinates[1]);
    return node ? this.projectEndpoint(node) : { x: -10_000, y: -10_000 };
  }
  projectEndpoint(endpoint: EndpointV2): Point {
    if (!this.nodeInRegions(endpoint.id)) return { x: -10_000, y: -10_000 };
    const point = this.#points.get(endpoint.id); if (point) return point;
    const anchor = this.#assignments.get(endpoint.id) ?? nearestNetgraphArea(endpoint.lat, endpoint.lng);
    const area = this.#layout.areas.find(a => a.code === anchor.code);
    return area ? this.world(area) : { x: -10_000, y: -10_000 };
  }
  projectSegment(segment: { from: EndpointV2; to: EndpointV2 }): readonly SurfacePoint[] {
    if (!this.nodeInRegions(segment.from.id) || !this.nodeInRegions(segment.to.id)) return [];
    return [{ ...this.projectEndpoint(segment.from), progress: 0 }, { ...this.projectEndpoint(segment.to), progress: 1 }];
  }
  private world(point: Point): Point {
    const b = this.#bounds, dx = point.x - (b.minX + b.maxX) / 2, dy = point.y - (b.minY + b.maxY) / 2;
    const angle = this.#mode === 'sculpture' ? this.#angle : 0, c = Math.cos(angle), s = Math.sin(angle);
    return { x: this.#width / 2 + (dx * c - dy * s) * this.#scale + this.#pan.x,
      y: (this.#height - this.#depth) / 2 + (dx * s + dy * c) * this.#scale * (this.#mode === 'sculpture' ? .48 : 1) + this.#pan.y };
  }
  private reproject(): void {
    const areas = this.#regions ? this.#layout.areas.filter(a => this.#regions!.has(a.code)) : [];
    // New regions may arrive off-screen. Only the first frame, Fit, or an explicit
    // region change reframes the scene; incoming traffic never moves the camera.
    if(!this.#framed){
      this.#bounds = areas.length ? {minX:Math.min(...areas.map(a=>a.x-a.radius)),maxX:Math.max(...areas.map(a=>a.x+a.radius)),minY:Math.min(...areas.map(a=>a.y-a.radius)),maxY:Math.max(...areas.map(a=>a.y+a.radius))} : this.#layout.bounds;
      this.#framed=this.#layout.positions.size>0;
    }
    const b = this.#bounds;
    this.#depth = this.#mode === 'sculpture' ? Math.max(30, this.#height - 190) * .43 : 0;
    const angle = this.#mode === 'sculpture' ? this.#angle : 0, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    const w = Math.max(1, b.maxX - b.minX), h = Math.max(1, b.maxY - b.minY), squash = this.#mode === 'sculpture' ? .48 : 1;
    this.#scale = Math.min(Math.max(80, this.#width - 140) / (w * c + h * s), Math.max(80, this.#height - this.#depth - 170) / ((w * s + h * c) * squash)) * this.#zoom;
    this.#points = new Map([...this.#layout.positions].map(([id, p]) => [id, this.world(p)]));
    this.#dirty = true;
  }
  private resize = (): void => {
    if (document.hidden) { this.#dirty=true; return; }
    this.#width = Math.max(1, this.stage.clientWidth); this.#height = Math.max(1, this.stage.clientHeight);
    this.#dpr = Math.min(devicePixelRatio || 1, displayPreferences().quality === 'economy' ? 1 : 2);
    const width=Math.round(this.#width*this.#dpr),height=Math.round(this.#height*this.#dpr);
    for (const canvas of [this.canvas, this.effects, this.#base]) if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    this.reproject(); this.request();
  };
  private appearance = (): void => {
    this.#dirty=true;if(document.hidden)return;
    const dpr=Math.min(devicePixelRatio||1,displayPreferences().quality==='economy'?1:2);
    if(dpr!==this.#dpr)this.resize();else this.request();
  };
  private visibility = (): void => {
    cancelAnimationFrame(this.#frame); clearTimeout(this.#timer); this.#frame = this.#timer = 0;
    if (!document.hidden) { this.timeline.prune(performance.now()); this.resize(); }
  };
  private request(): void {
    if (!this.#disposed && !document.hidden && !this.#frame) { clearTimeout(this.#timer); this.#timer = 0; this.#frame = requestAnimationFrame(this.draw); }
  }
  private base(): void {
    const ctx = this.#baseCtx; ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0); ctx.clearRect(0, 0, this.#width, this.#height);
    const palette = displayPreferences(), light = lightScene();
    const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    ctx.font = `${palette.textSize === 'large' ? 14 : 12}px system-ui`; ctx.textBaseline = 'middle';
    for (const area of this.#layout.areas) {
      if (this.#regions && !this.#regions.has(area.code)) continue;
      const p = this.world(area), radius = Math.max(14, area.radius * this.#scale), ry = radius * (this.#mode === 'sculpture' ? .48 : 1);
      ctx.strokeStyle = alpha('#73d9cf', light ? .24 : .18); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, radius, ry, 0, 0, Math.PI * 2); ctx.stroke();
      const label = area.code, name = area.name.length > 30 ? area.name.slice(0,29)+'…' : area.name;
      const width = Math.max(ctx.measureText(label).width,ctx.measureText(name).width), box = { x: p.x - width / 2, y: p.y - ry - 36, w: width, h: 30 };
      if (!boxes.some(b => box.x < b.x + b.w + 8 && box.x + box.w + 8 > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) {
        boxes.push(box); ctx.fillStyle = displayColor('#d2e0ef'); ctx.textAlign='center';ctx.fillText(label,p.x,box.y+9);
        ctx.font=`${palette.textSize==='large'?12:10}px system-ui`;ctx.fillStyle=alpha('#d2e0ef',.8);ctx.fillText(name,p.x,box.y+24);ctx.font=`${palette.textSize==='large'?14:12}px system-ui`;ctx.textAlign='left';
      }
    }
    const count = this.#regions ? this.#layout.areas.reduce((sum,a)=>sum+(this.#regions!.has(a.code)?a.nodeCount:0),0) : this.#nodes.size;
    const detail = palette.detail === 'complete' ? 1 : Math.min(1, Math.sqrt(240 / Math.max(1, count)) * Math.sqrt(this.#zoom));
    for (const [id, p] of this.#points) {
      if (!this.nodeInRegions(id) || p.x < 0 || p.x > this.#width || p.y < 0 || p.y > this.#height) continue;
      const node = this.#nodes.get(id); if (!node) continue;
      const selected = id === this.#selected;
      ctx.fillStyle = alpha(ROLES[node.role], this.#selected && !selected ? .2 : .25 + .6 * detail);
      ctx.beginPath(); ctx.arc(p.x, p.y, selected ? 5 : Math.min(3.3, .8 + detail * 1.4 * Math.sqrt(this.#zoom)), 0, Math.PI * 2); ctx.fill();
      if (selected) { ctx.strokeStyle = displayColor('#f5cf76'); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = displayColor('#d2e0ef'); ctx.fillText(node.label.slice(0, 40), p.x + 14, p.y); }
    }
    this.#dirty = false;
  }
  private stroke(ctx: CanvasRenderingContext2D, points: readonly Point[], color: string, opacity: number, width: number, glow = false): void {
    if (points.length < 2) return;
    ctx.beginPath(); ctx.moveTo(points[0]!.x, points[0]!.y); for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
    if (glow) { ctx.strokeStyle = alpha(color, opacity * .15); ctx.lineWidth = width + 7; ctx.stroke(); }
    ctx.strokeStyle = alpha(color, opacity); ctx.lineWidth = width; ctx.stroke();
  }
  private draw = (now: number): void => {
    this.#frame = 0; if (this.#disposed || document.hidden) return;
    const start = performance.now(), reduced = prefersReducedMotion(), prefs = displayPreferences();
    this.timeline.prune(now);
    const at = this.timeline.clock(now), ctx = this.#ctx, fx = this.#fx;
    for (const c of [ctx, fx]) { c.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0); c.clearRect(0, 0, this.#width, this.#height); c.lineCap = 'round'; }
    this.#gpu.batch.begin(this.#width, this.#height);
    this.#gpu.batch.setEnabled(!reduced && prefs.quality !== 'economy');
    if (this.#dirty) this.base();
    const b = this.#bounds;
    const corners = [{x:b.minX,y:b.minY},{x:b.maxX,y:b.minY},{x:b.maxX,y:b.maxY},{x:b.minX,y:b.maxY}].map(p => {
      const q=this.world(p),cx=this.#width/2,cy=(this.#height-this.#depth)/2;
      // The time ruler stays readable while the spatial view pans and zooms.
      return {x:cx+(q.x-cx-this.#pan.x)/this.#zoom,y:cy+(q.y-cy-this.#pan.y)/this.#zoom};
    });
    if (this.#layout.positions.size && this.#mode === 'sculpture') {
      for (const [index,p] of corners.entries()) this.stroke(ctx,[p,{x:p.x,y:p.y+this.#depth}],'#73d9cf',index===0?.32:.1,1);
      for (const part of [1, 2 / 3, 1 / 3, 0]) {
        const polygon = corners.map(p => ({ x: p.x, y: p.y + part * this.#depth }));
        ctx.beginPath(); ctx.moveTo(polygon[0]!.x, polygon[0]!.y); for (const p of polygon.slice(1)) ctx.lineTo(p.x, p.y); ctx.closePath();
        ctx.fillStyle = alpha('#73d9cf', part === 0 ? .035 : .008); ctx.fill(); ctx.strokeStyle = alpha('#73d9cf', part === 0 ? .3 : .12); ctx.lineWidth = 1; ctx.stroke();
        const p = polygon[0]!; ctx.font = `${prefs.textSize==='large'?13:11}px system-ui`; ctx.fillStyle = displayColor('#d2e0ef'); ctx.textAlign = 'right';
        ctx.fillText(part ? `${Math.round(part * this.#seconds)}s ago` : 'NOW', Math.max(56, p.x - 10), p.y + 4); ctx.textAlign = 'left';
      }
    }
    this.#records = this.inspectionRecords(); this.#hits = [];
    const live: Observation[] = [];
    const background = prefs.detail === 'complete' ? 1 : Math.max(.2,Math.min(1,Math.sqrt(60 / Math.max(1,this.#records.length))));
    const decorative = !reduced && prefs.quality !== 'economy' && (prefs.quality === 'high' || this.#drawMS < 12) && effectStrength() > 0;
    ctx.setLineDash(lineDash());
    for (const record of this.#records) {
      const age = Math.max(0, at - record.started), inFlight = record.animate && age < record.duration + 440;
      if (this.#mode === 'slice' && Math.abs(age / 1_000 - this.#slice) > 2) continue;
      const packet = record.packet, highlighted = this.#selectedEvent === packet.seq || Boolean(this.#selected && (packet.mode === 'observer' ? packet.observer.id === this.#selected : packet.segments.some(s => s.from.id === this.#selected || s.to.id === this.#selected)));
      const dimmed = (this.#selected || this.#selectedEvent !== null) && !highlighted;
      const settle = record.animate ? Math.min(1,Math.max(0,(age-record.duration)/440)) : 1;
      const offset = this.#mode === 'sculpture' ? settle * age / (this.#seconds * 1_000) * this.#depth : 0;
      const opacity = dimmed ? .04 : highlighted ? .95 : inFlight ? .68 : background * Math.max(.12, .6 * (1 - age / (this.#seconds * 1_000)));
      const color = payloadColor(packet.payloadType);
      if (packet.mode === 'observer') {
        if (!this.nodeInRegions(packet.observer.id)) continue;
        const p = this.projectEndpoint(packet.observer), r = inFlight && !reduced ? 6 + age / 80 : 4;
        ctx.strokeStyle = alpha(color, opacity); ctx.lineWidth = highlighted ? 2.5 : 1.5; ctx.beginPath(); ctx.ellipse(p.x, p.y + offset, r, this.#mode === 'sculpture' ? r * .48 : r, 0, 0, Math.PI * 2); ctx.stroke();
        this.#hits.push({record, path:[{x:p.x-8,y:p.y+offset},{x:p.x+8,y:p.y+offset}]});
      } else for (const segment of packet.segments) {
        const path = this.projectSegment(segment).map(p => ({...p, y:p.y + offset}));
        if (path.length < 2 || !segmentNearViewport(path[0]!, path[1]!, this.#width, this.#height, 20)) continue;
        this.stroke(ctx, path, color, opacity * prefs.opacity, highlighted ? prefs.width + 1 : prefs.width, decorative && (highlighted || inFlight));
        this.#hits.push({record, path});
      }
      if (inFlight && !dimmed) live.push(record);
    }
    ctx.setLineDash([]); ctx.drawImage(this.#base, 0, 0, this.#width, this.#height);
    for (const record of live.slice(-32)) {
      if (record.packet.mode !== 'route') continue;
      const motion = routeMotion(record.weights, Math.max(0, at - record.started), record.duration);
      const segment = record.packet.segments[motion.segmentIndex]; if (!segment) continue;
      const path = this.projectSegment(segment); if (path.length < 2) continue;
      const from = path[0]!, to = path[1]!, t = reduced ? .5 : motion.localProgress;
      const head = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      const color = payloadColor(record.packet.payloadType), signature = packetSignature(record.packet.payloadType), size = prefs.packetSize;
      const trail = packetTrail(from,head,48*prefs.trailLength);
      if (!reduced) {
        this.stroke(fx, [trail.tail,head], color, .95, 2.2 * size, decorative);
      }
      if (!this.#gpu.batch.packet([trail.tail, head], head, color, signature)) {
        fx.fillStyle = displayColor(color); fx.beginPath(); fx.arc(head.x, head.y, 3.5 * size, 0, Math.PI * 2); fx.fill();
        fx.fillStyle = displayColor('#ffffff'); fx.beginPath(); fx.arc(head.x, head.y, 1.1 * size, 0, Math.PI * 2); fx.fill();
      }
      drawPacketSignature(fx, head, {x:to.x-from.x,y:to.y-from.y}, color, signature, reduced ? 0 : at-record.started);
      const age = at - record.started;
      const segmentStart=record.weights.slice(0,motion.segmentIndex).reduce((sum,weight)=>sum+weight,0)*record.duration;
      for (const [point, phase] of [[from, (age-segmentStart) / 260], [to, (age - record.duration) / 440]] as const) {
        if (phase < 0 || phase > 1) continue;
        fx.strokeStyle = alpha(color, 1 - phase); fx.lineWidth = 1.5; fx.beginPath(); fx.ellipse(point.x,point.y,5+phase*15,(5+phase*15)*(this.#mode==='sculpture'?.48:1),0,0,Math.PI*2); fx.stroke();
      }
    }
    this.#gpu.flush(this.#width, this.#height, this.#dpr);
    this.#drawMS = this.#drawMS * .85 + (performance.now() - start) * .15;
    Object.assign(this.stage.dataset, { mode:this.#mode, frozen:String(this.frozen), eventCount:String(this.timeline.records.length), segmentCount:String(this.timeline.segmentCount),
      visibleEvents:String(this.#records.length), activeCount:String(this.frozen?0:live.length), motionMode:reduced?'static':'animated', renderer:this.#gpu.batch.ready?'webgl2':'canvas2d', drawMs:this.#drawMS.toFixed(2), windowSeconds:String(this.#seconds) });
    if (now - this.#lastStats > 500) { this.#lastStats = now; this.callbacks.change?.(); }
    if (this.#records.length && !this.frozen) this.#timer = window.setTimeout(() => { this.#timer = 0; this.request(); }, reduced ? 1_000 : prefs.quality === 'economy' || this.#drawMS > 12 ? 50 : 16);
  };
  private local(event: PointerEvent): Point { const rect = this.stage.getBoundingClientRect(); return { x:event.clientX-rect.left,y:event.clientY-rect.top }; }
  private pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return; this.stage.focus({preventScroll:true}); this.stage.setPointerCapture(event.pointerId);
    const point = this.local(event); this.#pointers.set(event.pointerId,point); this.#pointerStart=point; this.#dragged=false;
    if (this.#pointers.size === 2) { const [a,b]=[...this.#pointers.values()]; this.#gesture={distance:Math.hypot(a!.x-b!.x,a!.y-b!.y),zoom:this.#zoom}; this.#dragged=true; }
  };
  private pointerMove = (event: PointerEvent): void => {
    const last = this.#pointers.get(event.pointerId); if (!last) return;
    const p=this.local(event); this.#pointers.set(event.pointerId,p);
    if (this.#gesture && this.#pointers.size===2) { const [a,b]=[...this.#pointers.values()]; this.#zoom=Math.max(.2,Math.min(12,this.#gesture.zoom*Math.hypot(a!.x-b!.x,a!.y-b!.y)/Math.max(1,this.#gesture.distance))); this.reproject(); this.request(); return; }
    if (this.#pointerStart && Math.hypot(p.x-this.#pointerStart.x,p.y-this.#pointerStart.y)>5) this.#dragged=true;
    if (this.#dragged) { if(event.shiftKey&&this.#mode==='sculpture')this.rotateBy((p.x-last.x)*.004);else this.panBy(p.x-last.x,p.y-last.y); }
  };
  private pointerUp = (event: PointerEvent): void => {
    const p=this.local(event); this.#pointers.delete(event.pointerId); this.#gesture=undefined;
    if (!this.#dragged) {
      let node: string | null=null, distance=16;
      for(const [id,point] of this.#points) { const d=Math.hypot(point.x-p.x,point.y-p.y);if(this.nodeInRegions(id)&&d<distance){distance=d;node=id;} }
      if(node)this.callbacks.node(node);
      else { const hit=[...this.#hits].reverse().find(hit=>distanceToGraphPath(hit.path,p.x,p.y)<9);if(hit)this.callbacks.packet(hit.record);else this.callbacks.node(null); }
    }
    if(this.stage.hasPointerCapture(event.pointerId))this.stage.releasePointerCapture(event.pointerId);
  };
  private pointerCancel = (event: PointerEvent): void => { this.#pointers.delete(event.pointerId); this.#gesture=undefined; this.#dragged=true; };
  private wheel = (event: WheelEvent): void => { event.preventDefault(); this.zoomBy(Math.exp(-event.deltaY*.001)); };
  private keydown = (event: KeyboardEvent): void => {
    if(event.target!==this.stage||event.altKey||event.metaKey||event.ctrlKey)return;
    if(event.shiftKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight'))this.rotateBy(event.key==='ArrowLeft'?-.1:.1);
    else switch(event.key){case 'ArrowLeft':this.panBy(-40,0);break;case 'ArrowRight':this.panBy(40,0);break;case 'ArrowUp':this.panBy(0,-40);break;case 'ArrowDown':this.panBy(0,40);break;case '+':case '=':this.zoomBy(1.3);break;case '-':this.zoomBy(1/1.3);break;case 'Home':this.home();break;default:return;}event.preventDefault();
  };
  destroy(): void {
    this.#disposed=true;cancelAnimationFrame(this.#frame);clearTimeout(this.#timer);this.#resize.disconnect();this.#gpu.destroy();this.timeline.clear();
    this.stage.removeEventListener('pointerdown',this.pointerDown);this.stage.removeEventListener('pointermove',this.pointerMove);this.stage.removeEventListener('pointerup',this.pointerUp);this.stage.removeEventListener('pointercancel',this.pointerCancel);this.stage.removeEventListener('lostpointercapture',this.pointerCancel);this.stage.removeEventListener('wheel',this.wheel);this.stage.removeEventListener('keydown',this.keydown);
    window.removeEventListener(DISPLAY_EVENT,this.appearance);document.removeEventListener('visibilitychange',this.visibility);
  }
}
