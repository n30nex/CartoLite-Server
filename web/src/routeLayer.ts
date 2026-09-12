import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap } from 'maplibre-gl';
import type { Feature, LineString } from 'geojson';
import { splitWorldRoute, routeCoordinate, type Coordinate } from './worldGeometry';
import { adaptiveSurfacePath, type SurfacePoint } from './terrainProjection';
import { displayColor, displayPreferences } from './displayPreferences';

export const ROUTE_WEBGL_LAYER_ID = 'route-exact-webgl';
// From xyz, to xyz, corner (along/side), rgb, alpha, age band.
export const STROKE_VERTEX_FLOATS = 13;
type GL = WebGLRenderingContext | WebGL2RenderingContext;
interface StrokeSegment { from: [number, number, number]; to: [number, number, number]; color: string; opacity: number; band: number }
interface HitPath { id: string; band: number; points: readonly SurfacePoint[] }
interface Resources { program: WebGLProgram; buffer: WebGLBuffer; uniforms: Record<string, WebGLUniformLocation>; attributes: number[] }

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

  onAdd(map: MapLibreMap, gl: GL): void {
    this.map = map;
    this.gl = gl;
    const program = createProgram(gl);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Unable to create route stroke buffer');
    const uniforms: Record<string, WebGLUniformLocation> = {};
    for (const name of ['matrix', 'viewport', 'width', 'glow', 'opacity', 'maximum_band', 'pattern']) {
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
    map.on('terrain', this.invalidate);
    map.on('sourcedata', this.sourceChanged);
    this.dirty = true;
  }
  onRemove(map: MapLibreMap, gl: GL): void {
    map.off('move', this.cameraChanged);
    map.off('terrain', this.invalidate);
    map.off('sourcedata', this.sourceChanged);
    if (this.resources) { gl.deleteBuffer(this.resources.buffer); gl.deleteProgram(this.resources.program); }
    this.resources = undefined;
    this.map = undefined;
    this.gl = undefined;
  }
  private cameraChanged = (): void => {
    if (!this.map) return;
    const center = MercatorCoordinate.fromLngLat(this.map.getCenter());
    if (this.map.getTerrain() || Math.abs(center.x - this.origin[0]) > 1 / 256 || Math.abs(center.y - this.origin[1]) > 1 / 256) this.invalidate();
  };
  private sourceChanged = (event: { sourceId?: string }): void => {
    if (event.sourceId && event.sourceId === this.map?.getTerrain()?.source) this.invalidate();
  };
  private invalidate = (): void => { this.dirty = true; if (this.visible) this.map?.triggerRepaint(); };
  setRoutes(routes: readonly Feature<LineString>[]): void { this.routes = routes; this.invalidate(); }
  setOpacity(opacity: number): void { this.opacity = clamp(opacity, 0.2, 1); this.map?.triggerRepaint(); }
  setLightBackground(light: boolean): void { if (light !== this.lightBackground) { this.lightBackground = light; this.invalidate(); } }
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.map?.triggerRepaint();
  }
  setMaximumBand(band: number): void {
    const next = clamp(Math.round(band), 0, 3);
    if (next === this.maximumBand) return;
    this.maximumBand = next;
    if (this.visible) this.map?.triggerRepaint();
  }
  refreshAppearance(): void { this.map?.triggerRepaint(); }

  pick(point: { x: number; y: number }, allowed: (id: string) => boolean): string | undefined {
    if (!this.visible || !this.map?.getTerrain()) return undefined;
    if (this.dirty) this.upload();
    let best = 7 + displayPreferences().width / 2;
    let found: string | undefined;
    for (const path of this.hitPaths) {
      if (path.band > this.maximumBand || !allowed(path.id)) continue;
      for (let i = 1; i < path.points.length; i += 1) {
        const a = path.points[i - 1]!; const b = path.points[i]!;
        const dx = b.x - a.x; const dy = b.y - a.y;
        const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(0.001, dx * dx + dy * dy), 0, 1);
        const distance = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
        if (distance < best) { best = distance; found = path.id; }
      }
    }
    return found;
  }

  private upload(): void {
    if (!this.map || !this.gl || !this.resources) return;
    const map = this.map;
    const center = MercatorCoordinate.fromLngLat(map.getCenter());
    this.origin = [center.x, center.y, 0];
    const terrain = Boolean(map.getTerrain());
    const segments: StrokeSegment[] = [];
    this.hitPaths = [];
    for (const route of this.routes) {
      const rawFrom = route.geometry.coordinates[0]; const rawTo = route.geometry.coordinates.at(-1);
      if (!rawFrom || !rawTo) continue;
      const band = Number(route.properties?.windowBand ?? 3);
      const color = displayColor(String(route.properties?.color ?? '#73d9cf'), this.lightBackground);
      const rawOpacity = clamp(Number(route.properties?.opacity ?? 0.4), 0, 1);
      if (rawOpacity === 0) continue;
      const opacity = Math.max(this.lightBackground ? 0.95 : 0.55, rawOpacity);
      for (const pair of splitWorldRoute([rawFrom[0]!, rawFrom[1]!], [rawTo[0]!, rawTo[1]!])) {
        let fractions = [0, 1];
        if (terrain) {
          const project = (t: number): SurfacePoint => map.project(routeCoordinate(pair[0], pair[1], t));
          const seeds = [0, 0.25, 0.5, 0.75, 1].map(project);
          const width = map.getCanvas().clientWidth; const height = map.getCanvas().clientHeight;
          if (seeds.every((p) => p.x < -160) || seeds.every((p) => p.x > width + 160)
            || seeds.every((p) => p.y < -160) || seeds.every((p) => p.y > height + 160)) continue;
          const points = adaptiveSurfacePath(project);
          fractions = points.map((p) => p.progress!);
          this.hitPaths.push({ id: String(route.properties?.id ?? route.id ?? ''), band, points });
        }
        const positions = fractions.map((t) => {
          const point = routeCoordinate(pair[0], pair[1], t);
          // MapLibre returns rendered (already exaggerated) terrain elevation.
          const elevation = terrain ? map.queryTerrainElevation(point) ?? 0 : 0;
          const mercator = MercatorCoordinate.fromLngLat(point, Number.isFinite(elevation) ? elevation : 0);
          return [mercator.x, mercator.y, mercator.z] as [number, number, number];
        });
        for (let i = 1; i < positions.length; i += 1) segments.push({ from: positions[i - 1]!, to: positions[i]!, color, opacity, band });
      }
    }
    const data = strokeVertices(segments, this.origin);
    this.vertexCount = data.length / STROKE_VERTEX_FLOATS;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.resources.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.DYNAMIC_DRAW);
    this.dirty = false;
  }
  render(gl: GL, options: CustomRenderMethodInput): void {
    if (!this.resources || !this.map || !this.visible) return;
    if (this.dirty) this.upload();
    if (!this.vertexCount) return;
    const { program, buffer, uniforms, attributes } = this.resources;
    const settings = displayPreferences();
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
    gl.uniformMatrix4fv(uniforms.matrix!, false, new Float32Array(matrix));
    gl.uniform2f(uniforms.viewport!, Math.max(1, this.map.getCanvas().clientWidth), Math.max(1, this.map.getCanvas().clientHeight));
    gl.uniform1f(uniforms.width!, settings.width);
    gl.uniform1f(uniforms.glow!, settings.glow * clamp((this.map.getZoom() - 3) / 7, 0.15, 1));
    gl.uniform1f(uniforms.opacity!, this.opacity);
    gl.uniform1f(uniforms.maximum_band!, this.maximumBand);
    gl.uniform1f(uniforms.pattern!, settings.pattern === 'dashed' ? 1 : settings.pattern === 'dotted' ? 2 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    gl.depthMask(depthMask);
    if (depth) gl.enable(gl.DEPTH_TEST);
    if (cull) gl.enable(gl.CULL_FACE);
  }
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
    uniform mat4 u_matrix; uniform vec2 u_viewport; uniform float u_width; uniform float u_glow;
    attribute vec3 a_from; attribute vec3 a_to; attribute vec2 a_corner;
    attribute vec3 a_color; attribute float a_alpha; attribute float a_band;
    varying vec3 v_color; varying float v_alpha; varying float v_band; varying vec2 v_local; varying float v_length;
    void main() {
      vec4 a = u_matrix * vec4(a_from, 1.0); vec4 b = u_matrix * vec4(a_to, 1.0);
      vec2 delta = (b.xy / b.w - a.xy / a.w) * u_viewport * 0.5;
      float len = max(0.001, length(delta)); vec2 direction = delta / len;
      float extent = u_width * 0.5 + 1.0 + u_glow * 5.0;
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
    varying vec3 v_color; varying float v_alpha; varying float v_band; varying vec2 v_local; varying float v_length;
    void main() {
      if (v_band > u_maximum_band + 0.1 || v_alpha <= 0.0) discard;
      float x = v_local.x; float outside = max(-x, x - v_length);
      float distance = length(vec2(max(0.0, outside), v_local.y));
      if (u_pattern > 1.5) { float period = u_width * 2.7; distance = max(distance, length(vec2(mod(x, period) - period * 0.5, v_local.y))); }
      else if (u_pattern > 0.5 && mod(max(0.0, x), u_width * 7.0) > u_width * 4.0) discard;
      float core = 1.0 - smoothstep(u_width * 0.5 - 0.45, u_width * 0.5 + 0.55, distance);
      float glow = (1.0 - smoothstep(u_width * 0.5, u_width * 0.5 + 1.0 + u_glow * 5.0, distance)) * u_glow * 0.18;
      gl_FragColor = vec4(v_color, max(core, glow) * v_alpha * u_opacity);
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
