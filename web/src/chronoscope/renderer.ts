import { ChronoscopeCanvasRenderer } from './canvasRenderer';
import { Chronoscope3DRenderer } from './renderer3D';

export type ChronoscopeRenderer = ChronoscopeCanvasRenderer | Chronoscope3DRenderer;

export async function createChronoscopeRenderer(...args: ConstructorParameters<typeof ChronoscopeCanvasRenderer>): Promise<ChronoscopeRenderer> {
  let context: WebGL2RenderingContext | null = null;
  try { context = args[1].getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' }); } catch { /* Canvas remains usable when graphics are blocked. */ }
  if (!context) {
    args[0].dataset.cameraMode = 'canvas';
    return new ChronoscopeCanvasRenderer(...args);
  }
  const renderer = new Chronoscope3DRenderer(...args, context);
  try { await renderer.prepare(); return renderer; }
  catch (error) { renderer.destroy(); throw error; }
}
