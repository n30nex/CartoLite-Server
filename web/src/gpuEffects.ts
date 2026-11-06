import type { Map as LibreMap, CustomLayerInterface } from 'maplibre-gl';
import { displayColor, displayPreferences, effectStrength, scenePalette } from './displayPreferences';
import type { SurfacePoint } from './terrainProjection';
import type { PacketSignature } from './trafficVisuals';

const STRIDE = 9;
const CAPACITY = 216_000;
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 position;
layout(location=1) in vec2 uv;
layout(location=2) in vec4 color;
layout(location=3) in float shape;
uniform vec2 resolution;
out vec2 vUV; out vec4 vColor; flat out int vShape;
void main() { gl_Position=vec4(position/resolution*vec2(2.,-2.)+vec2(-1.,1.),0.,1.); vUV=uv; vColor=color; vShape=int(shape); }`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUV; in vec4 vColor; flat in int vShape;
out vec4 result;
void main() {
 float d=length(vUV);
 if(vShape==3) d=abs(vUV.y);
 if(vShape==4) d=abs(vUV.x)+abs(vUV.y);
 if(vShape==5) d=max(abs(vUV.x)*.55,abs(vUV.y));
 float aa=max(fwidth(d),.015);
 float alpha=1.-smoothstep(1.-aa,1.,d);
 if(vShape==1) alpha=exp(-4.*d*d)*(1.-smoothstep(.75,1.,d));
 if(vShape==2) alpha=(1.-smoothstep(.12,.12+aa,abs(d-.78)));
 result=vec4(vColor.rgb, vColor.a*alpha);
}`;

/** Screen geometry comes from the same projector as hit testing and audio. */
export class GPUEffects {
  #gl?: WebGL2RenderingContext;
  #program?: WebGLProgram;
  #buffer?: WebGLBuffer;
  #vao?: WebGLVertexArrayObject;
  #resolution?: WebGLUniformLocation | null;
  readonly #vertices = new Float32Array(CAPACITY);
  #used = 0;
  #enabled = true;
  get hasInk(): boolean { return this.#used > 0; }
  setEnabled(enabled: boolean): void { this.#enabled = enabled; }
  #width = 1;
  #height = 1;
  get ready(): boolean { return this.#enabled && !!this.#program && !!this.#gl && !this.#gl.isContextLost(); }

  initialize(gl: WebGL2RenderingContext): void {
    this.dispose(); this.#gl = gl;
    const shaders: WebGLShader[] = [];
    const oldVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const oldBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    try {
      const program = gl.createProgram(); if (!program) throw new Error('GPU program unavailable');
      this.#program = program;
      for (const [kind, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
        const shader = gl.createShader(kind); if (!shader) throw new Error('GPU shader unavailable');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('GPU effect shader failed');
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('GPU effects link failed');
      this.#buffer = gl.createBuffer() ?? undefined; this.#vao = gl.createVertexArray() ?? undefined;
      if (!this.#buffer || !this.#vao) throw new Error('GPU effect buffers unavailable');
      gl.bindVertexArray(this.#vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.#vertices.byteLength, gl.DYNAMIC_DRAW);
      for (const [index, size, offset] of [[0,2,0],[1,2,2],[2,4,4],[3,1,8]]) {
        gl.enableVertexAttribArray(index!); gl.vertexAttribPointer(index!, size!, gl.FLOAT, false, STRIDE*4, offset!*4);
      }
      this.#resolution = gl.getUniformLocation(program, 'resolution');
    } catch { this.dispose(); }
    finally { shaders.forEach(shader => gl.deleteShader(shader)); gl.bindVertexArray(oldVAO); gl.bindBuffer(gl.ARRAY_BUFFER, oldBuffer); }
  }

  begin(width: number, height: number): void { this.#used = 0; this.#width = Math.max(1,width); this.#height = Math.max(1,height); }
  clear(): void { this.#used = 0; }

  #vertex(x: number, y: number, u: number, v: number, r: number, g: number, b: number, alpha: number, shape: number): void {
    const vertices = this.#vertices;
    let at = this.#used;
    vertices[at++] = x; vertices[at++] = y; vertices[at++] = u; vertices[at++] = v;
    vertices[at++] = r; vertices[at++] = g; vertices[at++] = b; vertices[at++] = alpha; vertices[at++] = shape;
    this.#used = at;
  }

  #quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
    color: string, opacity: number, shape: number, tail = 1): void {
    const hex = Number.parseInt(displayColor(color).slice(1),16);
    const r = (hex>>16&255)/255, g = (hex>>8&255)/255, b = (hex&255)/255;
    const start = Math.max(0,Math.min(1,opacity*tail)), end = Math.max(0,Math.min(1,opacity));
    // Write into the retained buffer without allocating corner/vertex arrays per effect.
    this.#vertex(x0,y0,-1,-1,r,g,b,start,shape); this.#vertex(x1,y1,1,-1,r,g,b,end,shape);
    this.#vertex(x2,y2,1,1,r,g,b,end,shape); this.#vertex(x0,y0,-1,-1,r,g,b,start,shape);
    this.#vertex(x2,y2,1,1,r,g,b,end,shape); this.#vertex(x3,y3,-1,1,r,g,b,start,shape);
  }

  disc(point: SurfacePoint, radius: number, color: string, opacity: number, shape = 0, grounded = false): boolean {
    if (!this.ready || this.#used+54>CAPACITY || !Number.isFinite(point.x+point.y+radius)) return false;
    const ground = grounded ? point.ground : undefined;
    const a = ground?.[0] ?? 1, b = ground?.[1] ?? 0, c = ground?.[2] ?? 0, d = ground?.[3] ?? 1;
    this.#quad(point.x+radius*(-a-c),point.y+radius*(-b-d),point.x+radius*(a-c),point.y+radius*(b-d),
      point.x+radius*(a+c),point.y+radius*(b+d),point.x+radius*(-a+c),point.y+radius*(-b+d),color,opacity,shape);
    return true;
  }

  packet(points: readonly SurfacePoint[], head: SurfacePoint, color: string, signature: PacketSignature, emphasis = 1): boolean {
    if (!this.ready || this.#used+(points.length+7)*54>CAPACITY) return false; // Canvas draws overflow; no live hop is dropped.
    const settings = displayPreferences(); const strength = effectStrength();
    const radius = 3.1 * settings.packetSize * emphasis * Math.max(.65,Math.min(1.35,head.scale ?? 1));
    const glow = strength * (settings.quality === 'economy' ? .12 : .6);
    for (let i=1;i<points.length;i++) {
      const a=points[i-1]!, b=points[i]!; if(b.breakBefore) continue;
      const length=Math.hypot(b.x-a.x,b.y-a.y); if(length<.01) continue;
      const width=radius*.55, nx=-(b.y-a.y)/length*width, ny=(b.x-a.x)/length*width;
      this.#quad(a.x+nx,a.y+ny,b.x+nx,b.y+ny,b.x-nx,b.y-ny,a.x-nx,a.y-ny,color,.95,3,Math.max(.06,(i-1)/Math.max(1,points.length-1)));
    }
    if(glow) this.disc(head,radius*3.2,color,glow,1);
    const shape=signature==='orbit'?4:signature==='tick'?5:0;
    this.disc(head,radius+1.25,scenePalette().outline,.9,shape);
    this.disc(head,radius,color,1,shape);
    this.disc(head,Math.max(.8,radius*.3),scenePalette().core,.95);
    if(signature==='ripple') this.disc(head,radius*2,color,.65,2);
    if(signature==='double') this.disc({x:head.x+radius*1.7,y:head.y},radius*.48,color,.9,4);
    if(signature==='echo' && points.length>1) this.disc(points[Math.max(0,points.length-2)]!,radius*.6,color,.5);
    return true;
  }

  draw(): void {
    const gl=this.#gl; if(!gl || !this.ready || !this.#used) return;
    const program=gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram|null;
    const vao=gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject|null;
    const buffer=gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer|null;
    const depth=gl.isEnabled(gl.DEPTH_TEST), cull=gl.isEnabled(gl.CULL_FACE), blend=gl.isEnabled(gl.BLEND);
    const depthMask=gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
    const blendState=[gl.BLEND_SRC_RGB,gl.BLEND_DST_RGB,gl.BLEND_SRC_ALPHA,gl.BLEND_DST_ALPHA].map(p=>gl.getParameter(p) as number);
    try {
      gl.useProgram(this.#program!); gl.bindVertexArray(this.#vao!); gl.bindBuffer(gl.ARRAY_BUFFER,this.#buffer!);
      gl.bufferSubData(gl.ARRAY_BUFFER,0,this.#vertices.subarray(0,this.#used));
      gl.uniform2f(this.#resolution!,this.#width,this.#height);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(false); gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES,0,this.#used/STRIDE);
    } finally {
      gl.depthMask(depthMask); (depth?gl.enable:gl.disable).call(gl,gl.DEPTH_TEST); (cull?gl.enable:gl.disable).call(gl,gl.CULL_FACE); (blend?gl.enable:gl.disable).call(gl,gl.BLEND);
      gl.blendFuncSeparate(blendState[0]!,blendState[1]!,blendState[2]!,blendState[3]!);
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.useProgram(program);
    }
  }
  dispose(): void {
    if(this.#gl && !this.#gl.isContextLost()) { if(this.#program)this.#gl.deleteProgram(this.#program); if(this.#buffer)this.#gl.deleteBuffer(this.#buffer); if(this.#vao)this.#gl.deleteVertexArray(this.#vao); }
    this.#program=undefined; this.#buffer=undefined; this.#vao=undefined; this.#used=0;
  }
}

export function mapEffects(map: LibreMap) {
  const batch=new GPUEffects(); let activeGL: WebGL2RenderingContext|undefined;
  let lastInk=false, requestedAt=0, slowFrames=0, lastFrameAt=0, slowPresentationFrames=0, budgetFallback=false;
  const measure=()=>{
    if(!requestedAt)return;
    const elapsed=performance.now()-requestedAt;requestedAt=0;
    slowFrames=elapsed>80?slowFrames+1:Math.max(0,slowFrames-1);
    if(slowFrames>=3)budgetFallback=true;
  };
  const retry=()=>{budgetFallback=false;slowFrames=0;slowPresentationFrames=0;lastFrameAt=0;requestedAt=0;};
  map.on('render',measure);map.on('moveend',retry);
  const layer: CustomLayerInterface={id:'live-packet-effects',type:'custom',renderingMode:'2d',onAdd(_map,gl){activeGL=gl as WebGL2RenderingContext;batch.initialize(activeGL);},render(){batch.draw();},onRemove(){batch.dispose();}};
  const wanted=()=>!document.documentElement.hasAttribute('data-terminal')&&displayPreferences().quality!=='economy'&&!budgetFallback
    && !(displayPreferences().quality==='auto'&&Math.max(Number(map.getContainer().dataset.eligibleRoutes)||0,Number(map.getContainer().dataset.renderedRouteSegments)||0)>2000);
  const attach=()=>{
    if(!wanted()){batch.setEnabled(false);if(map.getLayer?.(layer.id))map.removeLayer(layer.id);}
    else if(map.isStyleLoaded?.() && !map.getLayer(layer.id))map.addLayer(layer);
    map.getContainer().dataset.gpuEffectLayer=String(Boolean(map.getLayer?.(layer.id)));
  };
  const lost=()=>batch.dispose();
  const restored=()=>{if(activeGL&&wanted())batch.initialize(activeGL);attach();map.triggerRepaint();};
  map.on('load',attach); map.on('idle',attach); map.on('styledata',attach); map.on('webglcontextlost',lost); map.on('webglcontextrestored',restored); attach();
  return {batch,prepare:()=>{
    const now=performance.now();
    if(lastInk&&lastFrameAt)slowPresentationFrames=now-lastFrameAt>80?slowPresentationFrames+1:Math.max(0,slowPresentationFrames-1);
    if(slowPresentationFrames>=3)budgetFallback=true;
    lastFrameAt=now;
    const enabled=wanted();batch.setEnabled(enabled);
    // Even an empty custom layer resets MapLibre's graphics state. Remove it
    // while the independent Canvas fallback owns packet presentation.
    if(enabled)attach();else if(map.getLayer?.(layer.id))map.removeLayer(layer.id);
  },flush:()=>{
    const ink=batch.ready&&batch.hasInk;
    // A stationary faded trail does not require rerasterizing the whole basemap.
    if(ink||lastInk){if(!requestedAt)requestedAt=performance.now();map.triggerRepaint();}
    lastInk=ink;
  },destroy:()=>{map.off('render',measure);map.off('moveend',retry);map.off('load',attach);map.off('idle',attach);map.off('styledata',attach);map.off('webglcontextlost',lost);map.off('webglcontextrestored',restored);if(map.getLayer?.(layer.id))map.removeLayer(layer.id);batch.dispose();}};
}

export function canvasEffects(parent: HTMLElement, before: HTMLCanvasElement) {
  const canvas=document.createElement('canvas'); canvas.className='gpu-packet-canvas'; canvas.setAttribute('aria-hidden','true');
  Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'}); parent.insertBefore(canvas,before);
  const batch=new GPUEffects(); const gl=canvas.getContext('webgl2',{alpha:true,antialias:true,premultipliedAlpha:true});
  if(gl)batch.initialize(gl);
  const lost=(event: Event)=>{event.preventDefault();batch.dispose();}; const restored=()=>{if(gl)batch.initialize(gl);};
  canvas.addEventListener('webglcontextlost',lost); canvas.addEventListener('webglcontextrestored',restored);
  return {batch,flush:(width:number,height:number,dpr:number)=>{if(!gl)return;const w=Math.round(width*dpr),h=Math.round(height*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);batch.draw();},destroy:()=>{canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);batch.dispose();gl?.getExtension('WEBGL_lose_context')?.loseContext();canvas.remove();}};
}
