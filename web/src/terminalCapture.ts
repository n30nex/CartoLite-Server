import type { CustomLayerInterface, Map as LibreMap } from 'maplibre-gl';

export interface TerminalPixels { data: Uint8ClampedArray; width: number; height: number }

/** Downsample inside MapLibre, then collect an asynchronous WebGL2 pixel buffer.
 * Copying the entire GPU canvas into Canvas2D stalls software/mobile renderers. */
export function terminalCapture(map: LibreMap, size: () => [number, number], receive: (pixels: TerminalPixels) => void, failure: () => void, enabled: () => boolean) {
  let gl: WebGL2RenderingContext | undefined, texture: WebGLTexture | null = null;
  let framebuffer: WebGLFramebuffer | null = null, buffer: WebGLBuffer | null = null, fence: WebGLSync | null = null;
  let width = 0, height = 0, timer: number | undefined, requested = false, last = 0, disposed = false;
  function release() {
    clearTimeout(timer); timer = undefined;
    if (gl) { gl.deleteSync(fence); gl.deleteBuffer(buffer); gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture); }
    texture = framebuffer = buffer = fence = null; requested = false; width = height = 0;
  }
  function poll() {
    timer = undefined;
    if (!gl || !fence || disposed || gl.isContextLost()) { release(); return; }
    const result = gl.clientWaitSync(fence, 0, 0);
    if (result === gl.TIMEOUT_EXPIRED) { timer = window.setTimeout(poll, 16); return; }
    if (result === gl.WAIT_FAILED) { release(); failure(); return; }
    const binding = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    try {
      const bytes = new Uint8Array(width * height * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bytes);
      const data = new Uint8ClampedArray(bytes.length), stride = width * 4;
      for (let y = 0; y < height; y++) data.set(bytes.subarray((height - y - 1) * stride, (height - y) * stride), y * stride);
      gl.deleteSync(fence); fence = null;
      if (enabled()) receive({ data, width, height });
    } catch { failure(); }
    finally { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, binding); }
    if (requested && enabled()) { requested = false; map.triggerRepaint(); }
  }
  const layer: CustomLayerInterface = {
    id: 'terminal-capture', type: 'custom', renderingMode: '2d',
    onAdd(_map, context) { gl = context as WebGL2RenderingContext; },
    onRemove: release,
    render(context) {
      gl = context as WebGL2RenderingContext;
      if (disposed || !enabled() || gl.isContextLost()) return;
      if (fence) { requested = true; return; }
      const now = performance.now();
      if (now - last < 100) {
        if (timer === undefined) timer = window.setTimeout(() => { timer = undefined; if (enabled()) map.triggerRepaint(); }, 100 - (now - last));
        return;
      }
      last = now; clearTimeout(timer); timer = undefined;
      const readBinding = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), drawBinding = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
      const packBinding = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING), textureBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
      const scissor = gl.isEnabled(gl.SCISSOR_TEST);
      try {
        gl.disable(gl.SCISSOR_TEST);
        const [w, h] = size();
        if (!texture) { texture = gl.createTexture(); framebuffer = gl.createFramebuffer(); buffer = gl.createBuffer(); }
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        if (width !== w || height !== h) {
          width = w; height = h;
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
          gl.bufferData(gl.PIXEL_PACK_BUFFER, width * height * 4, gl.STREAM_READ);
          if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Terminal framebuffer unavailable');
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, drawBinding);
        gl.blitFramebuffer(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (!fence) throw new Error('Terminal readback unavailable');
        gl.flush(); timer = window.setTimeout(poll, 16);
      } catch { release(); failure(); }
      finally {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readBinding); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawBinding);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, packBinding); gl.bindTexture(gl.TEXTURE_2D, textureBinding);
        if (scissor) gl.enable(gl.SCISSOR_TEST);
      }
    },
  };
  map.on('webglcontextlost', release);
  return {
    attach(lastLayer: string | undefined) {
      if (disposed) return;
      if (!map.getLayer(layer.id)) map.addLayer(layer);
      else if (lastLayer !== layer.id) map.moveLayer(layer.id);
    },
    request() { if (!disposed && enabled()) map.triggerRepaint(); },
    destroy() { disposed = true; map.off('webglcontextlost', release); if (map.getLayer(layer.id)) map.removeLayer(layer.id); release(); },
  };
}
