import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap } from 'maplibre-gl';
import type { Feature, LineString } from 'geojson';
import { splitWorldRoute, routeCoordinate, longitudeDelta, type Coordinate } from './worldGeometry';
import { adaptiveSurfacePath, type SurfacePoint } from './terrainProjection';
import { displayColor, displayPreferences } from './displayPreferences';

export const ROUTE_WEBGL_LAYER_ID = 'route-exact-webgl';
// From xyz, to xyz, corner (along/side), rgb, alpha, age band.
export const STROKE_VERTEX_FLOATS = 13;
type GL = WebGLRenderingContext | WebGL2RenderingContext;
interface StrokeSegment { from: [number, number, number]; to: [number, number, number]; color: string; opacity: number; band: number }
interface HitPath { id: string; band: number; positions: readonly [number, number, number][] }
interface Resources { program: WebGLProgram; buffer: WebGLBuffer; uniforms: Record<string, WebGLUniformLocation>; attributes: number[] }
interface PreparedMesh {
  data: Float32Array; origin: [number, number, number]; hitPaths: HitPath[];
  startedAt: number; workMs: number; maximumSliceMs: number; samples: number;
}

export class HistoricalRouteLayer implements CustomLayerInterface {
  readonly id = ROUTE_WEBGL_LAYER_ID;
  readonly type = 'custom' as const;
  // Terrain/buildings provide context; confirmed paths deliberately remain visible.
  readonly renderingMode = '3d' as const;
  private map?: MapLibreMap;
  private gl?: GL;
  private resources?: Resources;
  private routes: readonly Feature<LineString>[] = [];
  private hitPaths: HitPath[] = [];
  private vertexCount = 0;
  private dirty = true;
  private visible = false;
  private maximumBand = 3;
  private opacity = 0.8;
  private lightBackground = false;
  private origin: [number, number, number] = [0, 0, 0];
  private lastUploadAt = -Infinity;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private hitMatrix?: Float32Array;
  private building = false;
  private buildEpoch = 0;
  private prepared?: PreparedMesh;
  private cameraKey = '';

  onAdd(map: MapLibreMap, gl: GL): void {
    this.map = map;
    this.gl = gl;
    const program = createProgram(gl);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Unable to create route stroke buffer');
    const uniforms: Record<string, WebGLUniformLocation> = {};
    for (const name of ['matrix', 'viewport', 'width', 'glow', 'opacity', 'maximum_band', 'pattern', 'casing', 'outline']) {
      const location = gl.getUniformLocation(program, `u_${name}`);
      if (location === null) throw new Error(`Missing route uniform: ${name}`);
      uniforms[name] = location;
    }
    const attributes = ['from', 'to', 'corner', 'color', 'alpha', 'band'].map((name) => {
      const location = gl.getAttribLocation(program, `a_${name}`);
      if (location < 0) throw new Error(`Missing route attribute: ${name}`);
      return location;
    });
    this.resources = { program, buffer, uniforms, attributes };
    map.on('move', this.cameraChanged);
    map.on('moveend', this.cameraChanged);
    map.on('terrain', this.invalidate);
    map.on('sourcedata', this.sourceChanged);
    this.dirty = true;
  }
  onRemove(map: MapLibreMap, gl: GL): void {
    map.off('move', this.cameraChanged);
    map.off('moveend', this.cameraChanged);
    map.off('terrain', this.invalidate);
    map.off('sourcedata', this.sourceChanged);
    if (this.resources) { gl.deleteBuffer(this.resources.buffer); gl.deleteProgram(this.resources.program); }
    this.resources = undefined;
    this.cancelBuild();
    this.map = undefined;
    this.gl = undefined;
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
  }
  private cameraChanged = (): void => {
    if (!this.map) return;
    const location = this.map.getCenter();
    const canvas = this.map.getCanvas();
    const key = [location.lng.toFixed(7), location.lat.toFixed(7), this.map.getZoom().toFixed(3),
      this.map.getPitch().toFixed(2), this.map.getBearing().toFixed(2), canvas.clientWidth, canvas.clientHeight,
      JSON.stringify(this.map.getPadding())].join(':');
    if (key === this.cameraKey) return;
    this.cameraKey = key;
    const center = MercatorCoordinate.fromLngLat(location);
    if (this.map.getTerrain() || Math.abs(center.x - this.origin[0]) > 1 / 256 || Math.abs(center.y - this.origin[1]) > 1 / 256) this.scheduleResample();
  };
  private sourceChanged = (event: { sourceId?: string; sourceDataType?: string }): void => {
    if ((!event.sourceDataType || event.sourceDataType === 'content') && event.sourceId && event.sourceId === this.map?.getTerrain()?.source) this.scheduleResample();
  };
  private scheduleResample(): void {
    if (!this.visible) { this.dirty = true; return; }
    const delay = Math.max(0, 200 - (performance.now() - this.lastUploadAt));
    if (delay === 0) { this.invalidate(); return; }
    if (this.refreshTimer !== undefined) return;
    this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; this.invalidate(); }, delay);
  }
  private invalidate = (): void => { this.dirty = true; if (this.visible) this.map?.triggerRepaint(); };
  private cancelBuild(): void {
    this.buildEpoch += 1; this.building = false; this.prepared = undefined; this.dirty = true;
    if (this.map) this.map.getContainer().dataset.routeMeshBusy = 'false';
  }
  setRoutes(routes: readonly Feature<LineString>[]): void { this.cancelBuild(); this.routes = routes; this.invalidate(); }
  setOpacity(opacity: number): void { this.opacity = clamp(opacity, 0.2, 1); this.map?.triggerRepaint(); }
  setLightBackground(light: boolean): void { if (light !== this.lightBackground) { this.cancelBuild(); this.lightBackground = light; this.invalidate(); } }
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) this.cancelBuild();
    this.map?.triggerRepaint();
  }
  setMaximumBand(band: number): void {
    const next = clamp(Math.round(band), 0, 3);
    if (next === this.maximumBand) return;
    this.maximumBand = next;
    if (this.map?.getTerrain()) this.cancelBuild();
    if (this.visible) this.map?.triggerRepaint();
  }
  refreshAppearance(): void { this.map?.triggerRepaint(); }

  pick(point: { x: number; y: number }, allowed: (id: string) => boolean): string | undefined {
    if (!this.visible || !this.map?.getTerrain()) return undefined;
    if (!this.hitMatrix) return undefined;
    const matrix = this.hitMatrix;
    const width = this.map.getCanvas().clientWidth; const height = this.map.getCanvas().clientHeight;
    const project = (position: readonly number[]): SurfacePoint | undefined => {
      const x = position[0]! - this.origin[0]; const y = position[1]! - this.origin[1]; const z = position[2]!;
      const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
      if (w <= 0) return undefined;
      return { x: ((matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) / w + 1) * width / 2,
        y: (1 - (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) / w) * height / 2 };
    };
    let best = 7 + displayPreferences().width / 2;
    let found: string | undefined;
    for (const path of this.hitPaths) {
      if (path.band > this.maximumBand || !allowed(path.id)) continue;
      const points = path.positions.map(project);
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1]; const b = points[i];
        if (!a || !b) continue;
        const dx = b.x - a.x; const dy = b.y - a.y;
        const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(0.001, dx * dx + dy * dy), 0, 1);
        const distance = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
        if (distance < best) { best = distance; found = path.id; }
      }
    }
    return found;
  }

  private async upload(matrix: readonly number[]): Promise<void> {
    if (!this.map || !this.gl || !this.resources) return;
    const map = this.map;
    const started = performance.now();
    const center = MercatorCoordinate.fromLngLat(map.getCenter());
    const origin: [number, number, number] = [center.x, center.y, 0];
    const epoch = ++this.buildEpoch;
    this.building = true;
    this.dirty = false;
    map.getContainer().dataset.routeMeshBusy = 'true';
    const routes = this.routes;
    const terrain = Boolean(map.getTerrain());
    const bounds = map.getBounds();
    const view: [number, number, number, number] = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    const width = map.getCanvas().clientWidth; const height = map.getCanvas().clientHeight;
    const projections = new Map<string, SurfacePoint>();
    const elevations = new Map<string, [number, number, number]>();
    const project = (point: Coordinate): SurfacePoint => {
      const key = point.join(',');
      let result = projections.get(key);
      if (!result) {
        const [x, y, z] = position(point);
        const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
        const divisor = Math.abs(w) < 1e-9 ? (w < 0 ? -1e-9 : 1e-9) : w;
        result = { x: ((matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) / divisor + 1) * width / 2,
          y: (1 - (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) / divisor) * height / 2 };
        projections.set(key, result);
      }
      return result;
    };
    const position = (point: Coordinate): [number, number, number] => {
      const key = point.join(',');
      let result = elevations.get(key);
      if (!result) {
        const coordinate: [number, number] = [point[0], point[1]];
        const elevation = terrain ? map.queryTerrainElevation(coordinate) ?? 0 : 0;
        const mercator = MercatorCoordinate.fromLngLat(coordinate, Number.isFinite(elevation) ? elevation : 0);
        result = [mercator.x, mercator.y, mercator.z];
        elevations.set(key, result);
      }
      return result;
    };
    const segments: StrokeSegment[] = [];
    const hitPaths: HitPath[] = [];
    const chunks: Float32Array[] = [];
    let sliceStarted = performance.now();
    let maximumSlice = 0;
    let workMs = 0;
    for (const route of routes) {
      const rawFrom = route.geometry.coordinates[0]; const rawTo = route.geometry.coordinates.at(-1);
      if (!rawFrom || !rawTo) continue;
      const band = Number(route.properties?.windowBand ?? 3);
      if (terrain && band > this.maximumBand) continue;
      const color = displayColor(String(route.properties?.color ?? '#73d9cf'), this.lightBackground);
      const rawOpacity = clamp(Number(route.properties?.opacity ?? 0.4), 0, 1);
      if (rawOpacity === 0) continue;
      const opacity = Math.max(this.lightBackground ? 0.95 : 0.55, rawOpacity);
      const pieces = splitWorldRoute([rawFrom[0]!, rawFrom[1]!], [rawTo[0]!, rawTo[1]!]);
      for (const pair of pieces) {
        let fractions = [0, 1];
        if (terrain) {
          // Reject distant routes before MapLibre's terrain-aware projection,
          // which otherwise recomputes terrain tile coverage for every sample.
          if (!routeMayIntersectView(pair[0], pair[1], view)) continue;
          const sample = (t: number): SurfacePoint => project(routeCoordinate(pair[0], pair[1], t));
          const seeds = [0, 0.25, 0.5, 0.75, 1].map(sample);
          if (seeds.every((p) => p.x < -160) || seeds.every((p) => p.x > width + 160)
            || seeds.every((p) => p.y < -160) || seeds.every((p) => p.y > height + 160)) continue;
          const points = adaptiveSurfacePath(sample, pieces.length > 1 ? 3 : 4);
          fractions = points.map((p) => p.progress!);
        }
        const positions = fractions.map((t) => {
          const point = routeCoordinate(pair[0], pair[1], t);
          return position(point);
        });
        if (terrain) hitPaths.push({ id: String(route.properties?.id ?? route.id ?? ''), band, positions });
        for (let i = 1; i < positions.length; i += 1) segments.push({ from: positions[i - 1]!, to: positions[i]!, color, opacity, band });
        if (terrain) {
          chunks.push(strokeVertices(segments, origin));
          segments.length = 0;
          const elapsed = performance.now() - sliceStarted;
          if (elapsed >= 6) {
            maximumSlice = Math.max(maximumSlice, elapsed);
            workMs += elapsed;
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            if (this.map !== map || this.buildEpoch !== epoch) return;
            sliceStarted = performance.now();
          }
        }
      }
    }
    let data: Float32Array;
    if (terrain) {
      data = new Float32Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    } else data = strokeVertices(segments, origin);
    if (this.map !== map || this.buildEpoch !== epoch) return;
    const finalSlice = performance.now() - sliceStarted;
    workMs += finalSlice;
    maximumSlice = Math.max(maximumSlice, finalSlice);
    this.prepared = { data, origin, hitPaths, startedAt: started, workMs, maximumSliceMs: maximumSlice, samples: terrain ? projections.size : 0 };
    this.building = false;
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    if (terrain) map.triggerRepaint();
  }
  render(gl: GL, options: CustomRenderMethodInput): void {
    if (!this.resources || !this.map || !this.visible) return;
    if (this.dirty && !this.building) void this.upload(Array.from(options.defaultProjectionData.mainMatrix)).catch(() => {
      this.building = false;
      if (this.map) this.map.getContainer().dataset.routeMeshBusy = 'false';
      console.warn('Historical route geometry could not be prepared');
    });
    if (this.prepared) {
      const commitStarted = performance.now();
      const { data, origin, hitPaths, startedAt, workMs, maximumSliceMs, samples } = this.prepared;
      this.origin = origin;
      this.hitPaths = hitPaths;
      this.vertexCount = data.length / STROKE_VERTEX_FLOATS;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.resources.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      this.prepared = undefined;
      this.lastUploadAt = performance.now();
      const commitMs = this.lastUploadAt - commitStarted;
      const container = this.map.getContainer();
      container.dataset.routeMeshUploadMs = (workMs + commitMs).toFixed(1);
      container.dataset.routeMeshDurationMs = (this.lastUploadAt - startedAt).toFixed(1);
      container.dataset.routeMeshMaxSliceMs = Math.max(maximumSliceMs, commitMs).toFixed(1);
      container.dataset.routeTerrainSamples = String(samples);
      this.map.getContainer().dataset.routeMeshBusy = String(this.building);
    }
    if (!this.vertexCount) return;
    const { program, buffer, uniforms, attributes } = this.resources;
    const settings = displayPreferences();
    // Preserve every core stroke and pattern; omit decorative passes when a
    // dense close view carries as much geometry as a regional overview.
    const denseOverview = this.routes.length > 2000 && (this.map.getZoom() < 11 || this.vertexCount > 12000);
    const depth = gl.isEnabled(gl.DEPTH_TEST);
    const cull = gl.isEnabled(gl.CULL_FACE);
    const depthMask = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    let offset = 0;
    [3, 3, 2, 3, 1, 1].forEach((size, index) => {
      gl.enableVertexAttribArray(attributes[index]!);
      gl.vertexAttribPointer(attributes[index]!, size, gl.FLOAT, false, STROKE_VERTEX_FLOATS * 4, offset * 4);
      offset += size;
    });
    // Rebase in double precision before uploading floats, keeping close-zoom endpoints aligned.
    const matrix = Array.from(options.defaultProjectionData.mainMatrix);
    for (let row = 0; row < 4; row += 1) matrix[12 + row] = matrix[12 + row]! + matrix[row]! * this.origin[0] + matrix[4 + row]! * this.origin[1];
    this.hitMatrix = new Float32Array(matrix);
    gl.uniformMatrix4fv(uniforms.matrix!, false, this.hitMatrix);
    gl.uniform2f(uniforms.viewport!, Math.max(1, this.map.getCanvas().clientWidth), Math.max(1, this.map.getCanvas().clientHeight));
    gl.uniform1f(uniforms.width!, settings.width);
    gl.uniform1f(uniforms.glow!, denseOverview ? 0 : settings.glow * clamp((this.map.getZoom() - 3) / 7, 0.15, 1));
    gl.uniform1f(uniforms.outline!, denseOverview ? 0 : 1);
    gl.uniform1f(uniforms.opacity!, this.opacity);
    gl.uniform1f(uniforms.maximum_band!, this.maximumBand);
    gl.uniform1f(uniforms.pattern!, settings.pattern === 'dashed' ? 1 : settings.pattern === 'dotted' ? 2 : 0);
    if (this.lightBackground) gl.uniform3f(uniforms.casing!, 0.97, 0.99, 0.95);
    else gl.uniform3f(uniforms.casing!, 0.025, 0.055, 0.075);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    gl.depthMask(depthMask);
    if (depth) gl.enable(gl.DEPTH_TEST);
    if (cull) gl.enable(gl.CULL_FACE);
  }
}

/** Conservative geographic culling; lines crossing the view are retained. */
export function routeMayIntersectView(a: Coordinate, b: Coordinate, view: readonly [number, number, number, number]): boolean {
  const [west, south, east, north] = view;
  const span = east >= west ? east - west : east + 360 - west;
  const center = west + span / 2;
  const x1 = center + longitudeDelta(center, a[0]);
  const x2 = x1 + longitudeDelta(a[0], b[0]);
  const padX = Math.max(0.025, span * 0.15);
  const padY = Math.max(0.025, (north - south) * 0.15);
  if (Math.max(a[1], b[1]) < south - padY || Math.min(a[1], b[1]) > north + padY) return false;
  return span >= 360 || [-360, 0, 360].some(offset =>
    !(Math.max(x1, x2) + offset < west - padX || Math.min(x1, x2) + offset > west + span + padX));
}

function strokeVertices(segments: readonly StrokeSegment[], origin: [number, number, number] = [0, 0, 0]): Float32Array {
  const data = new Float32Array(segments.length * 6 * STROKE_VERTEX_FLOATS);
  let offset = 0;
  for (const segment of segments) {
    const color = parseColor(segment.color);
    for (const [along, side] of [[0, -1], [1, -1], [1, 1], [0, -1], [1, 1], [0, 1]]) {
      data.set([...segment.from.map((v, i) => v - origin[i]!), ...segment.to.map((v, i) => v - origin[i]!), along!, side!, ...color, segment.opacity, segment.band], offset);
      offset += STROKE_VERTEX_FLOATS;
    }
  }
  return data;
}
export function historicalRouteVertices(routes: readonly Feature<LineString>[]): Float32Array {
  const segments: StrokeSegment[] = [];
  const position = (p: Coordinate): [number, number, number] => {
    const m = MercatorCoordinate.fromLngLat([p[0], p[1]], 0);
    return [m.x, m.y, m.z];
  };
  for (const route of routes) {
    const a = route.geometry.coordinates[0]; const b = route.geometry.coordinates.at(-1);
    if (!a || !b) continue;
    for (const [from, to] of splitWorldRoute([a[0]!, a[1]!], [b[0]!, b[1]!])) segments.push({
      from: position(from), to: position(to), color: String(route.properties?.color ?? '#73d9cf'),
      opacity: Number(route.properties?.opacity ?? 0.4), band: Number(route.properties?.windowBand ?? 3),
    });
  }
  return strokeVertices(segments);
}

function createProgram(gl: GL): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `
    precision highp float;
    uniform mat4 u_matrix; uniform vec2 u_viewport; uniform float u_width; uniform float u_glow; uniform float u_outline;
    attribute vec3 a_from; attribute vec3 a_to; attribute vec2 a_corner;
    attribute vec3 a_color; attribute float a_alpha; attribute float a_band;
    varying vec3 v_color; varying float v_alpha; varying float v_band; varying vec2 v_local; varying float v_length;
    void main() {
      vec4 a = u_matrix * vec4(a_from, 1.0); vec4 b = u_matrix * vec4(a_to, 1.0);
      vec2 delta = (b.xy / b.w - a.xy / a.w) * u_viewport * 0.5;
      float len = max(0.001, length(delta)); vec2 direction = delta / len;
      float extent = u_width * 0.5 + max(0.55, u_outline) + u_glow * 5.0;
      vec4 point = mix(a, b, a_corner.x);
      vec2 shift = (direction * (a_corner.x * 2.0 - 1.0) + vec2(-direction.y, direction.x) * a_corner.y) * extent;
      point.xy += shift * 2.0 / u_viewport * point.w;
      gl_Position = point;
      v_local = vec2(mix(-extent, len + extent, a_corner.x), a_corner.y * extent);
      v_length = len; v_color = a_color; v_alpha = a_alpha * step(0.001, a.w) * step(0.001, b.w); v_band = a_band;
    }
  `);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision highp float;
    uniform float u_width; uniform float u_glow; uniform float u_opacity; uniform float u_maximum_band; uniform float u_pattern;
    uniform vec3 u_casing; uniform float u_outline;
    varying vec3 v_color; varying float v_alpha; varying float v_band; varying vec2 v_local; varying float v_length;
    void main() {
      if (v_band > u_maximum_band + 0.1 || v_alpha <= 0.0) discard;
      float x = v_local.x; float outside = max(-x, x - v_length);
      float distance = abs(v_local.y);
      if (outside > 0.0) distance = length(vec2(outside, v_local.y));
      if (u_pattern > 1.5) { float period = u_width * 2.7; distance = max(distance, length(vec2(mod(x, period) - period * 0.5, v_local.y))); }
      else if (u_pattern > 0.5 && mod(max(0.0, x), u_width * 7.0) > u_width * 4.0) discard;
      float core = 1.0 - smoothstep(u_width * 0.5 - 0.45, u_width * 0.5 + 0.55, distance);
      float glow = 0.0; float rim = 0.0; vec3 ink = v_color;
      if (u_glow > 0.001) glow = (1.0 - smoothstep(u_width * 0.5, u_width * 0.5 + 1.0 + u_glow * 5.0, distance)) * u_glow * 0.18;
      if (u_outline > 0.0) rim = (1.0 - smoothstep(u_width * 0.5 + 0.25, u_width * 0.5 + u_outline, distance)) * (1.0 - core);
      if (rim > 0.001) ink = (v_color * core + u_casing * rim) / max(0.001, core + rim);
      gl_FragColor = vec4(ink, max(core + rim * 0.8, glow) * v_alpha * u_opacity);
    }
  `);
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create route stroke program');
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { const error = gl.getProgramInfoLog(program); gl.deleteProgram(program); throw new Error(`Route stroke link failed: ${error}`); }
  return program;
}
function compileShader(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create route shader');
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`Route shader failed: ${error}`); }
  return shader;
}
function parseColor(color: string): [number, number, number] {
  const value = Number.parseInt(/^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : '73d9cf', 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }
