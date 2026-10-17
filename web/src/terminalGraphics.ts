import type { CustomLayerInterface, Map as LibreMap } from 'maplibre-gl';

const VERTEX = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}`;
// One pixel per character in the first pass; screen pixels only sample the font.
const CELLS = `#version 300 es
precision highp float;precision highp int;
uniform sampler2D terminal_scene;uniform vec2 grid;uniform int ascii;
out vec4 result;
int ink(vec3 c){
 if(max(c.r,max(c.g,c.b))<26./255.)return 0;
 if(c.b>c.r*1.8&&c.b>c.g*1.6)return 1;
 if(max(c.r,max(c.g,c.b))<100./255.)return 3;
 if(c.r>c.g*1.25&&c.b>c.g*1.12)return 6;
 if(c.r>c.b*1.3&&c.g>c.b*1.15)return 5;
 if(c.g>c.r*1.2&&c.g>c.b*.9)return 4;
 if(c.b>c.r*1.1&&c.r>c.g*.9)return 8;
 if(c.b>c.r*1.1)return 7;return 2;
}
int at(vec2 p){return ink(texture(terminal_scene,clamp(p,vec2(0),vec2(1))).rgb);}
void main(){
 vec2 cell=floor(gl_FragCoord.xy),stepSize=1./(grid*vec2(2,4));
 int mask=0,color=0,priority=-1,count=0;
 int bits[8]=int[8](1,8,2,16,4,32,64,128);
 for(int y=0;y<4;y++)for(int x=0;x<2;x++){
  vec2 p=(cell+vec2((float(x)+.5)/2.,(3.5-float(y))/4.))/grid;
  int k=at(p);
  if(k==0&&(at(p+vec2(stepSize.x,0))==1||at(p-vec2(stepSize.x,0))==1||at(p+vec2(0,stepSize.y))==1||at(p-vec2(0,stepSize.y))==1))k=2;
  if(k==0)continue;mask|=bits[y*2+x];count++;
  int rank=k==1?0:k==3?1:k==2?2:3;
  if(rank>priority){color=k;priority=rank;}
 }
 int glyph=ascii==1&&mask!=0?(color==1?260:count<3?257:count<6?258:259):mask;
 result=vec4(float(glyph%16)/255.,float(glyph/16)/255.,float(color)/255.,1);
}`;
const GLYPHS = `#version 300 es
precision highp float;precision highp int;
uniform sampler2D cells;uniform sampler2D glyphs;uniform vec2 grid;uniform vec2 viewport;uniform vec3 colors[9];
out vec4 result;
void main(){
 vec2 p=gl_FragCoord.xy/viewport*grid;
 vec3 cell=floor(texture(cells,(floor(p)+.5)/grid).rgb*255.+.5);
 vec2 local=clamp(vec2(fract(p.x),1.-fract(p.y)),vec2(.5/24.,.5/40.),vec2(1.-.5/24.,1.-.5/40.));
 vec2 uv=(cell.xy+local)/vec2(16,17);
 result=vec4(colors[int(cell.z)]*texture(glyphs,uv).a,1);
}`;

export function terminalGraphics(map: LibreMap, config: () => { columns: number; rows: number; ascii: boolean; colors: string[] }, frame: () => void, failure: () => void, enabled: () => boolean) {
  let gl: WebGL2RenderingContext | undefined, programs: WebGLProgram[] = [], textures: WebGLTexture[] = [], shaders: WebGLShader[] = [];
  let framebuffer: WebGLFramebuffer | null = null, vao: WebGLVertexArrayObject | null = null;
  let locations: Record<string, WebGLUniformLocation | null>[] = [], width = 0, height = 0, columns = 0, rows = 0, disposed = false, lastLabels = 0;
  const metrics = map.getContainer().dataset;
  function release() {
    if (gl) {
      for (const p of programs) gl.deleteProgram(p);
      for (const t of textures) gl.deleteTexture(t);
      for (const s of shaders) gl.deleteShader(s);
      gl.deleteFramebuffer(framebuffer); gl.deleteVertexArray(vao);
    }
    programs = []; textures = []; shaders = []; locations = []; framebuffer = vao = null;
    width = height = columns = rows = 0;
  }
  function initialize(g: WebGL2RenderingContext) {
    for (const fragment of [CELLS, GLYPHS]) {
      const p = g.createProgram(); if (!p) throw new Error('Terminal program unavailable'); programs.push(p);
      for (const [type, source] of [[g.VERTEX_SHADER, VERTEX], [g.FRAGMENT_SHADER, fragment]] as const) {
        const s = g.createShader(type); if (!s) throw new Error('Terminal shader unavailable'); shaders.push(s);
        g.shaderSource(s, source); g.compileShader(s);
        if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error('Terminal shader unavailable');
        g.attachShader(p, s);
      }
      g.linkProgram(p); if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error('Terminal program unavailable');
      locations.push(Object.fromEntries(['terminal_scene','grid','ascii','cells','glyphs','viewport','colors[0]'].map(name => [name,g.getUniformLocation(p,name)])));
    }
    for (const s of shaders) g.deleteShader(s); shaders = [];
    framebuffer = g.createFramebuffer(); vao = g.createVertexArray();
    if (!framebuffer || !vao) throw new Error('Terminal surface unavailable');
    for (let i = 0; i < 3; i++) {
      const t = g.createTexture(); if (!t) throw new Error('Terminal texture unavailable'); textures.push(t);
      g.bindTexture(g.TEXTURE_2D, t);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    }
    const atlas = document.createElement('canvas'); atlas.width = 384; atlas.height = 680;
    const ctx = atlas.getContext('2d'); if (!ctx) throw new Error('Terminal font unavailable');
    ctx.font = '32px ui-monospace, "DejaVu Sans Mono", monospace'; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff';
    for (let i = 1; i <= 260; i++) ctx.fillText(i < 256 ? String.fromCharCode(0x2800+i) : [' ','.','+','#',':'][i-256]!, (i%16)*24, Math.floor(i/16)*40);
    g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,atlas);
  }
  const layer: CustomLayerInterface = {
    id: 'terminal-graphics', type: 'custom', renderingMode: '2d',
    onAdd(_map, context) { gl = context as WebGL2RenderingContext; }, onRemove: release,
    render(context) {
      const g = gl = context as WebGL2RenderingContext;
      if (disposed || !enabled() || g.isContextLost()) return;
      const target = g.getParameter(g.FRAMEBUFFER_BINDING), readTarget = g.getParameter(g.READ_FRAMEBUFFER_BINDING), viewport = g.getParameter(g.VIEWPORT);
      const unpack = g.getParameter(g.PIXEL_UNPACK_BUFFER_BINDING), flip = g.getParameter(g.UNPACK_FLIP_Y_WEBGL);
      const dither = g.isEnabled(g.DITHER);
      try {
        g.bindBuffer(g.PIXEL_UNPACK_BUFFER,null); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,false);
        g.activeTexture(g.TEXTURE0);
        if (!programs.length) initialize(g);
        const options = config(), w = g.drawingBufferWidth, h = g.drawingBufferHeight;
        g.bindTexture(g.TEXTURE_2D,textures[0]!);
        if (width !== w || height !== h) { width=w; height=h; g.texImage2D(g.TEXTURE_2D,0,g.RGBA8,w,h,0,g.RGBA,g.UNSIGNED_BYTE,null); }
        // No readPixels, preserved drawing buffer, or CPU geographic copy.
        g.bindFramebuffer(g.READ_FRAMEBUFFER,target); g.copyTexSubImage2D(g.TEXTURE_2D,0,0,0,0,0,w,h);
        g.disable(g.BLEND); g.disable(g.DEPTH_TEST); g.disable(g.STENCIL_TEST); g.disable(g.SCISSOR_TEST); g.disable(g.CULL_FACE); g.disable(g.DITHER); g.colorMask(true,true,true,true);
        g.bindVertexArray(vao); g.bindFramebuffer(g.FRAMEBUFFER,framebuffer);
        g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D,textures[1]!);
        if (columns !== options.columns || rows !== options.rows) {
          columns=options.columns; rows=options.rows;
          g.texImage2D(g.TEXTURE_2D,0,g.RGBA8,columns,rows,0,g.RGBA,g.UNSIGNED_BYTE,null);
          g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,textures[1]!,0);
          if (g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE) throw new Error('Terminal surface unavailable');
        }
        g.viewport(0,0,columns,rows); g.useProgram(programs[0]!);
        const a=locations[0]!, b=locations[1]!;
        g.uniform1i(a.terminal_scene!,0); g.uniform2f(a.grid!,columns,rows); g.uniform1i(a.ascii!,Number(options.ascii)); g.drawArrays(g.TRIANGLES,0,3);
        g.bindFramebuffer(g.FRAMEBUFFER,target); g.viewport(0,0,w,h); g.useProgram(programs[1]!);
        g.activeTexture(g.TEXTURE2); g.bindTexture(g.TEXTURE_2D,textures[2]!);
        g.uniform1i(b.cells!,1); g.uniform1i(b.glyphs!,2); g.uniform2f(b.grid!,columns,rows); g.uniform2f(b.viewport!,w,h);
        g.uniform3fv(b['colors[0]']!, options.colors.flatMap(color => { const n=parseInt(color.slice(1),16); return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]; }));
        g.drawArrays(g.TRIANGLES,0,3);
        metrics.terminalRenderer='webgl2'; metrics.terminalGridCells=String(columns*rows);
        metrics.terminalSamples=String(Number(metrics.terminalSamples??0)+1);
        if (performance.now()-lastLabels>100) { frame(); lastLabels=performance.now(); }
      } catch { release(); failure(); }
      finally { g.bindFramebuffer(g.FRAMEBUFFER,target); g.bindFramebuffer(g.READ_FRAMEBUFFER,readTarget); g.viewport(...viewport as [number,number,number,number]); g.bindBuffer(g.PIXEL_UNPACK_BUFFER,unpack); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,flip); if (dither) g.enable(g.DITHER); }
    },
  };
  map.on('webglcontextlost',release);
  return {
    attach() { if (disposed) return; if (!map.getLayer(layer.id)) map.addLayer(layer); else if (map.getLayersOrder().at(-1)!==layer.id) map.moveLayer(layer.id); },
    request() { lastLabels=0; if (!disposed && enabled()) map.triggerRepaint(); },
    suspend: release,
    destroy() { disposed=true; map.off('webglcontextlost',release); if (map.getLayersOrder().includes(layer.id)) map.removeLayer(layer.id); release(); },
  };
}
