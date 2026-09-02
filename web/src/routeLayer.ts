import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from 'maplibre-gl';
import type { Feature, LineString } from 'geojson';

export const ROUTE_WEBGL_LAYER_ID = 'route-exact-webgl';
const FLOATS_PER_VERTEX = 7;
const ROUTE_TEXTURE_WIDTH = 2048;
const ROUTE_TEXTURE_HEIGHT = 1024;
const ROUTE_TEXTURE_MAX_ZOOM = 6.25;
const WORLD_NORTH = 85.051129;

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
  maximumBand: WebGLUniformLocation;
  maximumLineWidth: number;
  textureProgram: WebGLProgram;
  textureBuffer: WebGLBuffer;
  texture: WebGLTexture;
  texturePosition: number;
  textureCoordinate: number;
  textureMatrix: WebGLUniformLocation;
  textureSampler: WebGLUniformLocation;
}

export class HistoricalRouteLayer implements CustomLayerInterface {
  readonly id = ROUTE_WEBGL_LAYER_ID;
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  private map?: MapLibreMap;
  private resources?: GLResources;
  private vertices: Float32Array<ArrayBufferLike> = new Float32Array();
  private textureCanvas?: HTMLCanvasElement;
  private routes: readonly Feature<LineString>[] = [];
  private vertexCount = 0;
  private visible = false;
  private maximumBand = 3;

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    const program = createProgram(gl);
    const buffer = gl.createBuffer();
    const textureProgram = createTextureProgram(gl);
    const textureBuffer = gl.createBuffer();
    const texture = gl.createTexture();
    const lineWidthRange = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) as Float32Array | number[] | null;
    if (!buffer || !textureBuffer || !texture) throw new Error('Unable to create the historical-route buffers');
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
      maximumBand: requiredUniform(gl, program, 'u_maximum_band'),
      maximumLineWidth: Number(lineWidthRange?.[1] ?? 1),
      textureProgram,
      textureBuffer,
      texture,
      texturePosition: requiredAttribute(gl, textureProgram, 'a_position'),
      textureCoordinate: requiredAttribute(gl, textureProgram, 'a_texture_coordinate'),
      textureMatrix: requiredUniform(gl, textureProgram, 'u_matrix'),
      textureSampler: requiredUniform(gl, textureProgram, 'u_texture'),
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, routeTextureQuad(), gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.upload();
  }

  onRemove(_map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (this.resources) {
      gl.deleteBuffer(this.resources.buffer);
      gl.deleteProgram(this.resources.program);
      gl.deleteBuffer(this.resources.textureBuffer);
      gl.deleteTexture(this.resources.texture);
      gl.deleteProgram(this.resources.textureProgram);
    }
    this.resources = undefined;
    this.map = undefined;
  }

  setRoutes(routes: readonly Feature<LineString>[]): void {
    this.routes = routes;
    this.vertices = historicalRouteVertices(routes);
    this.textureCanvas = historicalRouteTexture(routes, this.maximumBand);
    this.vertexCount = this.vertices.length / FLOATS_PER_VERTEX;
    this.upload();
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
    if (this.vertexCount > 0) {
      this.textureCanvas = historicalRouteTexture(this.routes, next);
      this.uploadTexture();
    }
    if (this.visible) this.map?.triggerRepaint();
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    const resources = this.resources;
    if (!resources || !this.visible || this.vertexCount === 0) return;
    const zoom = this.map?.getZoom() ?? 3;
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (zoom < ROUTE_TEXTURE_MAX_ZOOM && this.textureCanvas) {
      gl.useProgram(resources.textureProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.textureBuffer);
      const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
      bindAttribute(gl, resources.texturePosition, 2, stride, 0);
      bindAttribute(gl, resources.textureCoordinate, 2, stride, 2);
      gl.uniformMatrix4fv(resources.textureMatrix, false, options.defaultProjectionData.mainMatrix);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, resources.texture);
      gl.uniform1i(resources.textureSampler, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }
    gl.useProgram(resources.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
    bindAttributes(gl, resources);
    gl.uniformMatrix4fv(resources.matrix, false, options.defaultProjectionData.mainMatrix);
    gl.uniform1f(resources.maximumBand, this.maximumBand);
    const pixelRatio = gl.drawingBufferWidth / Math.max(1, this.map?.getCanvas().clientWidth ?? gl.drawingBufferWidth);
    const coreWidth = zoom < 6 ? 0.75 : zoom < 10 ? 1 : 1.25;
    gl.lineWidth(Math.max(1, Math.min(resources.maximumLineWidth, pixelRatio * coreWidth)));
    gl.uniform1f(resources.opacity, 0.86);
    gl.drawArrays(gl.LINES, 0, this.vertexCount);
  }

  private upload(): void {
    if (!this.resources) return;
    const { gl, buffer } = this.resources;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertices, gl.DYNAMIC_DRAW);
    this.uploadTexture();
  }

  private uploadTexture(): void {
    if (!this.resources || !this.textureCanvas) return;
    const { gl, texture } = this.resources;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.textureCanvas);
  }
}

export function historicalRouteVertices(routes: readonly Feature<LineString>[]): Float32Array {
  const values = new Float32Array(routes.length * 2 * FLOATS_PER_VERTEX);
  let offset = 0;
  for (const route of routes) {
    const from = route.geometry.coordinates[0];
    const to = route.geometry.coordinates[route.geometry.coordinates.length - 1];
    if (!from || !to) continue;
    const first = mercator(Number(from[0]), Number(from[1]));
    const last = mercator(Number(to[0]), Number(to[1]));
    const properties = route.properties ?? {};
    const color = parseColor(String(properties.color ?? '#73d9cf'));
    const alpha = clamp(Number(properties.opacity ?? 0.4), 0.04, 1);
    const band = clamp(Number(properties.windowBand ?? 3), 0, 3);
    for (const position of [first, last]) {
      values.set([
        position[0], position[1], color[0], color[1], color[2], alpha, band,
      ], offset);
      offset += FLOATS_PER_VERTEX;
    }
  }
  return offset === values.length ? values : values.slice(0, offset);
}

function historicalRouteTexture(
  routes: readonly Feature<LineString>[],
  maximumBand: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ROUTE_TEXTURE_WIDTH;
  canvas.height = ROUTE_TEXTURE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create the historical-route texture');
  const northwest = mercator(-180, WORLD_NORTH);
  const southeast = mercator(180, -WORLD_NORTH);
  const paths = new Map<string, { path: Path2D; color: string; alpha: number; width: number }>();
  for (const route of routes) {
    const properties = route.properties ?? {};
    const band = Number(properties.windowBand ?? 3);
    if (band > maximumBand) continue;
    const from = route.geometry.coordinates[0];
    const to = route.geometry.coordinates[route.geometry.coordinates.length - 1];
    if (!from || !to) continue;
    const color = String(properties.color ?? '#73d9cf');
    const alpha = Math.round(clamp(Number(properties.opacity ?? 0.4), 0.04, 1) * 10) / 10;
    const width = Math.round(clamp(Number(properties.width ?? 1), 0.65, 1.8) * 4) / 4;
    const key = `${color}:${alpha}:${width}`;
    let group = paths.get(key);
    if (!group) {
      group = { path: new Path2D(), color, alpha, width };
      paths.set(key, group);
    }
    const first = texturePoint(Number(from[0]), Number(from[1]), northwest, southeast);
    const last = texturePoint(Number(to[0]), Number(to[1]), northwest, southeast);
    group.path.moveTo(first[0], first[1]);
    group.path.lineTo(last[0], last[1]);
  }
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const group of paths.values()) {
    context.strokeStyle = group.color;
    context.globalAlpha = group.alpha * 0.86;
    context.lineWidth = Math.max(0.7, group.width);
    context.stroke(group.path);
  }
  context.globalAlpha = 1;
  return canvas;
}

function texturePoint(
  longitude: number,
  latitude: number,
  northwest: readonly [number, number],
  southeast: readonly [number, number],
): [number, number] {
  const point = mercator(longitude, latitude);
  return [
    (point[0] - northwest[0]) / (southeast[0] - northwest[0]) * ROUTE_TEXTURE_WIDTH,
    (point[1] - northwest[1]) / (southeast[1] - northwest[1]) * ROUTE_TEXTURE_HEIGHT,
  ];
}

function routeTextureQuad(): Float32Array {
  const northwest = mercator(-180, WORLD_NORTH);
  const southeast = mercator(180, -WORLD_NORTH);
  return new Float32Array([
    northwest[0], northwest[1], 0, 0,
    southeast[0], northwest[1], 1, 0,
    northwest[0], southeast[1], 0, 1,
    southeast[0], southeast[1], 1, 1,
  ]);
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
    uniform float u_maximum_band;
    varying vec3 v_color;
    varying float v_alpha;
    varying float v_band;
    void main() {
      if (v_band > u_maximum_band + 0.1) discard;
      gl_FragColor = vec4(v_color, v_alpha * u_opacity);
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

function createTextureProgram(gl: WebGLRenderingContext | WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `
    precision highp float;
    uniform mat4 u_matrix;
    attribute vec2 a_position;
    attribute vec2 a_texture_coordinate;
    varying vec2 v_texture_coordinate;
    void main() {
      gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
      v_texture_coordinate = a_texture_coordinate;
    }
  `);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform sampler2D u_texture;
    varying vec2 v_texture_coordinate;
    void main() {
      gl_FragColor = texture2D(u_texture, v_texture_coordinate);
    }
  `);
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create the historical-route texture program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`Historical-route texture shader link failed: ${message}`);
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
