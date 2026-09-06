import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from 'maplibre-gl';
import type { Feature, LineString } from 'geojson';
import { splitWorldRoute } from './worldGeometry';

export const ROUTE_WEBGL_LAYER_ID = 'route-exact-webgl';
const FLOATS_PER_VERTEX = 7;

interface GLResources {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  position: number;
  color: number;
  alpha: number;
  band: number;
  matrix: WebGLUniformLocation;
  opacity: WebGLUniformLocation;
  brightness: WebGLUniformLocation;
  maximumBand: WebGLUniformLocation;
  maximumLineWidth: number;
}

export class HistoricalRouteLayer implements CustomLayerInterface {
  readonly id = ROUTE_WEBGL_LAYER_ID;
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  private map?: MapLibreMap;
  private resources?: GLResources;
  private vertices: Float32Array<ArrayBufferLike> = new Float32Array();
  private vertexCount = 0;
  private visible = false;
  private maximumBand = 3;
  private opacity = 0.8;
  private lightBackground = false;

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    const program = createProgram(gl);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Unable to create the historical-route buffer');
    const lineWidthRange = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) as Float32Array | number[] | null;
    this.resources = {
      gl,
      program,
      buffer,
      position: requiredAttribute(gl, program, 'a_position'),
      color: requiredAttribute(gl, program, 'a_color'),
      alpha: requiredAttribute(gl, program, 'a_alpha'),
      band: requiredAttribute(gl, program, 'a_band'),
      matrix: requiredUniform(gl, program, 'u_matrix'),
      opacity: requiredUniform(gl, program, 'u_opacity'),
      brightness: requiredUniform(gl, program, 'u_brightness'),
      maximumBand: requiredUniform(gl, program, 'u_maximum_band'),
      maximumLineWidth: Number(lineWidthRange?.[1] ?? 1),
    };
    this.upload();
  }

  onRemove(_map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (this.resources) {
      gl.deleteBuffer(this.resources.buffer);
      gl.deleteProgram(this.resources.program);
    }
    this.resources = undefined;
    this.map = undefined;
  }

  setRoutes(routes: readonly Feature<LineString>[]): void {
    this.vertices = historicalRouteVertices(routes);
    this.vertexCount = this.vertices.length / FLOATS_PER_VERTEX;
    this.upload();
    this.map?.triggerRepaint();
  }

  setOpacity(opacity: number): void {
    this.opacity = clamp(opacity, 0.2, 1);
    this.map?.triggerRepaint();
  }

  setLightBackground(light: boolean): void {
    this.lightBackground = light;
    this.map?.triggerRepaint();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.map?.triggerRepaint();
  }

  setMaximumBand(maximumBand: number): void {
    const next = Math.max(0, Math.min(3, Math.round(maximumBand)));
    if (this.maximumBand === next) return;
    this.maximumBand = next;
    if (this.visible) this.map?.triggerRepaint();
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    const resources = this.resources;
    if (!resources || !this.visible || this.vertexCount === 0) return;
    const zoom = this.map?.getZoom() ?? 3;
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(resources.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
    bindAttributes(gl, resources);
    gl.uniformMatrix4fv(resources.matrix, false, options.defaultProjectionData.mainMatrix);
    gl.uniform1f(resources.maximumBand, this.maximumBand);
    const pixelRatio = gl.drawingBufferWidth / Math.max(1, this.map?.getCanvas().clientWidth ?? gl.drawingBufferWidth);
    const coreWidth = zoom < 6 ? 0.75 : zoom < 10 ? 1 : 1.25;
    gl.lineWidth(Math.max(1, Math.min(resources.maximumLineWidth, pixelRatio * coreWidth)));
    gl.uniform1f(resources.opacity, this.opacity);
    gl.uniform1f(resources.brightness, this.lightBackground ? 0.58 : 1);
    gl.drawArrays(gl.LINES, 0, this.vertexCount);
  }

  private upload(): void {
    if (!this.resources) return;
    const { gl, buffer } = this.resources;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertices, gl.DYNAMIC_DRAW);
  }

}

export function historicalRouteVertices(routes: readonly Feature<LineString>[]): Float32Array {
  const values = new Float32Array(routes.length * 4 * FLOATS_PER_VERTEX);
  let offset = 0;
  for (const route of routes) {
    const from = route.geometry.coordinates[0];
    const to = route.geometry.coordinates[route.geometry.coordinates.length - 1];
    if (!from || !to) continue;
    const properties = route.properties ?? {};
    const color = parseColor(String(properties.color ?? '#73d9cf'));
    const alpha = clamp(Number(properties.opacity ?? 0.4), 0.04, 1);
    const band = clamp(Number(properties.windowBand ?? 3), 0, 3);
    for (const pair of splitWorldRoute([Number(from[0]), Number(from[1])], [Number(to[0]), Number(to[1])])) {
      for (const point of pair) {
        const position = mercator(point[0], point[1]);
        values.set([
          position[0], position[1], color[0], color[1], color[2], alpha, band,
        ], offset);
        offset += FLOATS_PER_VERTEX;
      }
    }
  }
  return offset === values.length ? values : values.slice(0, offset);
}

function bindAttributes(gl: WebGLRenderingContext | WebGL2RenderingContext, resources: GLResources): void {
  const stride = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;
  bindAttribute(gl, resources.position, 2, stride, 0);
  bindAttribute(gl, resources.color, 3, stride, 2);
  bindAttribute(gl, resources.alpha, 1, stride, 5);
  bindAttribute(gl, resources.band, 1, stride, 6);
}

function bindAttribute(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  location: number,
  size: number,
  stride: number,
  floatOffset: number,
): void {
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, floatOffset * Float32Array.BYTES_PER_ELEMENT);
}

function createProgram(gl: WebGLRenderingContext | WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `
    precision highp float;
    uniform mat4 u_matrix;
    attribute vec2 a_position;
    attribute vec3 a_color;
    attribute float a_alpha;
    attribute float a_band;
    varying vec3 v_color;
    varying float v_alpha;
    varying float v_band;
    void main() {
      gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
      v_color = a_color;
      v_alpha = a_alpha;
      v_band = a_band;
    }
  `);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform float u_opacity;
    uniform float u_brightness;
    uniform float u_maximum_band;
    varying vec3 v_color;
    varying float v_alpha;
    varying float v_band;
    void main() {
      if (v_band > u_maximum_band + 0.1) discard;
      gl_FragColor = vec4(v_color * u_brightness, v_alpha * u_opacity);
    }
  `);
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create the historical-route shader program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`Historical-route shader link failed: ${message}`);
  }
  return program;
}

function compileShader(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create a historical-route shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown compile error';
    gl.deleteShader(shader);
    throw new Error(`Historical-route shader compile failed: ${message}`);
  }
  return shader;
}

function requiredAttribute(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): number {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) throw new Error(`Historical-route shader is missing ${name}`);
  return location;
}

function requiredUniform(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`Historical-route shader is missing ${name}`);
  return location;
}

function mercator(longitude: number, latitude: number): [number, number] {
  const lng = clamp(longitude, -180, 180);
  const lat = clamp(latitude, -85.0511287798, 85.0511287798);
  const radians = lat * Math.PI / 180;
  return [
    (lng + 180) / 360,
    (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2,
  ];
}

function parseColor(color: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/iu.exec(color);
  const value = Number.parseInt(match?.[1] ?? '73d9cf', 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}
