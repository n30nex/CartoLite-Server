import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { displayPreferences, lightScene, packetPalette } from '../displayPreferences';
import { BOX, HEADER, KINDS, SPOUT, TEXTURE_WIDTH, particleRadius, type Rotation } from './model';
import { beadVertex, beadFragment, linkVertex, linkFragment } from './shaders';

export class FirehoseRenderer {
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.PerspectiveCamera(38,1,.08,100);
  readonly controls:OrbitControls;
  readonly gpu:THREE.WebGLRenderer;
  readonly box=new THREE.Group();
  readonly target=new THREE.Quaternion();
  readonly radius:number;
  mode:'tilt'|'orbit'='tilt';
  paused=false;
  lost=false;
  onRotation=(_rotation:Rotation)=>{};
  onPick=(_slot:number)=>{};
  onContext=(_lost:boolean)=>{};
  #previous?:Float32Array;
  #current?:Float32Array;
  #received=0;
  #frame?:number;
  #disposed=false;
  #resize:ResizeObserver;
  #textures:[THREE.DataTexture,THREE.DataTexture];
  #points:THREE.Points;
  #halos:THREE.Points;
  #links:THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>;
  #born:THREE.BufferAttribute;
  #selected:THREE.BufferAttribute;
  #uniforms:Record<string,THREE.IUniform>;
  #materials=new Set<THREE.Material>();
  #floorMaterial?:THREE.MeshStandardMaterial;
  #canvasTextures:THREE.Texture[]=[];
  #pointer=new Map<number,{x:number;y:number}>();
  #pressed?:{id:number;x:number;y:number;moved:boolean};
  #dirty=true;
  #visualFrames=0;
  #lastDraw=0;
  #maxFrameGap=0;
  #vector=new THREE.Vector3();
  #right=new THREE.Vector3();
  #up=new THREE.Vector3();
  #delta=new THREE.Quaternion();
  #poseA=new THREE.Quaternion();
  #poseB=new THREE.Quaternion();

  constructor(readonly stage:HTMLElement,readonly canvas:HTMLCanvasElement,readonly capacity:number){
    this.radius=particleRadius(capacity);
    this.gpu=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    this.gpu.outputColorSpace=THREE.SRGBColorSpace;this.gpu.toneMapping=THREE.ACESFilmicToneMapping;this.gpu.toneMappingExposure=1.1;
    this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.controls.dampingFactor=.12;
    this.controls.minDistance=3;this.controls.maxDistance=45;this.controls.maxPolarAngle=Math.PI;this.controls.enableRotate=false;
    this.controls.addEventListener('change',this.#changed);
    const empty=new Float32Array(capacity*4);
    const texture=()=>{const t=new THREE.DataTexture(empty,TEXTURE_WIDTH,capacity/TEXTURE_WIDTH,THREE.RGBAFormat,THREE.FloatType);t.needsUpdate=true;return t;};
    this.#textures=[texture(),texture()];
    this.#uniforms={uPrevious:{value:this.#textures[0]},uCurrent:{value:this.#textures[1]},uBlend:{value:1},uRadius:{value:this.radius},
      uHeight:{value:1},uDpr:{value:1},uResolution:{value:new THREE.Vector2(1,1)},uPalette:{value:KINDS.map(()=>new THREE.Color())},
      uTime:{value:0},uGlow:{value:0},uCore:{value:1},uLight:{value:0},uWidth:{value:1.5},uOpacity:{value:.8},uPattern:{value:0}};
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(capacity*3),3));
    geometry.setAttribute('aSlot',new THREE.Float32BufferAttribute(Float32Array.from({length:capacity},(_,i)=>i),1));
    this.#born=new THREE.BufferAttribute(new Float32Array(capacity).fill(-100),1).setUsage(THREE.DynamicDrawUsage);
    this.#selected=new THREE.BufferAttribute(new Float32Array(capacity),1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aBorn',this.#born);geometry.setAttribute('aSelected',this.#selected);
    const pointMaterial=(halo:number)=>new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:beadVertex,fragmentShader:beadFragment,
      uniforms:{...this.#uniforms,uHalo:{value:halo}},transparent:true,depthWrite:!halo,toneMapped:false});
    this.#points=new THREE.Points(geometry,pointMaterial(0));this.#points.frustumCulled=false;this.#points.renderOrder=3;
    this.#halos=new THREE.Points(geometry,pointMaterial(1));this.#halos.frustumCulled=false;this.#halos.renderOrder=4;
    const links=new THREE.InstancedBufferGeometry();links.setAttribute('position',new THREE.Float32BufferAttribute([0,-1,0,1,-1,0,1,1,0,0,-1,0,1,1,0,0,1,0],3));
    links.setAttribute('aEnds',new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),2).setUsage(THREE.DynamicDrawUsage));links.instanceCount=0;
    this.#links=new THREE.Mesh(links,new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:linkVertex,fragmentShader:linkFragment,
      uniforms:this.#uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));this.#links.frustumCulled=false;this.#links.renderOrder=2;
    this.scene.add(this.#points,this.#halos,this.#links);
    this.#buildStage();this.applyDisplay();this.home();
    canvas.addEventListener('pointerdown',this.#down);canvas.addEventListener('pointermove',this.#move);canvas.addEventListener('pointerup',this.#release);canvas.addEventListener('pointercancel',this.#cancel);
    canvas.addEventListener('webglcontextlost',this.#contextLost);canvas.addEventListener('webglcontextrestored',this.#contextRestored);
    stage.addEventListener('keydown',this.#key);document.addEventListener('visibilitychange',this.#visibility);
    this.#resize=new ResizeObserver(this.#resized);this.#resize.observe(stage);this.#resized();
  }
  #material(color:number,metalness=.2,roughness=.48){const m=new THREE.MeshStandardMaterial({color,metalness,roughness});this.#materials.add(m);return m;}
  #mesh(geometry:THREE.BufferGeometry,material:THREE.Material,parent:THREE.Object3D,x=0,y=0,z=0){const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
  #buildStage(){
    this.scene.add(new THREE.HemisphereLight(0xc9f0ff,0x09252e,2.3));const key=new THREE.DirectionalLight(0xd3f8ff,3.3);key.position.set(-4,8,5);this.scene.add(key);
    const rim=this.#material(0x37717b,.7,.27),dark=this.#material(0x09222c,.25,.6),pipe=this.#material(0x385863,.8,.3);
    this.#floorMaterial=this.#material(0x09222c,.25,.6);
    const glass=new THREE.MeshBasicMaterial({color:0x5edbc7,transparent:true,opacity:.035,side:THREE.DoubleSide,depthWrite:false});this.#materials.add(glass);
    this.box.position.y=BOX.centerY;this.scene.add(this.box);
    this.#mesh(new THREE.BoxGeometry(BOX.width+.18,.16,BOX.depth+.18),this.#floorMaterial,this.box,0,-BOX.height/2-.08);
    const grid=new THREE.GridHelper(BOX.width,24,0x347584,0x183c46);grid.scale.z=BOX.depth/BOX.width;grid.position.y=-BOX.height/2+.003;this.box.add(grid);
    const wall=(w:number,h:number,d:number,x:number,z:number)=>this.#mesh(new THREE.BoxGeometry(w,h,d),glass,this.box,x,0,z);
    wall(.05,BOX.height,BOX.depth,-BOX.width/2,0);wall(.05,BOX.height,BOX.depth,BOX.width/2,0);
    wall(BOX.width,BOX.height,.05,0,-BOX.depth/2);wall(BOX.width,BOX.height,.05,0,BOX.depth/2);
    const edges=new THREE.EdgesGeometry(new THREE.BoxGeometry(BOX.width+.12,BOX.height,BOX.depth+.12));
    const frame=new THREE.LineSegments(edges,new THREE.LineBasicMaterial({color:0x60d8ca,transparent:true,opacity:.6}));this.box.add(frame);
    for(const x of [-1,1])for(const z of [-1,1])this.#mesh(new THREE.CylinderGeometry(.035,.035,BOX.height+.12,8),rim,this.box,x*(BOX.width/2+.06),0,z*(BOX.depth/2+.06));
    // The pit is open: overflow and tipped chains disappear down its dark throat.
    const pit=this.#mesh(new THREE.CylinderGeometry(3.9,2.9,2.1,64,1,true),dark,this.scene,0,-2.7,0);(pit.material as THREE.MeshStandardMaterial).side=THREE.DoubleSide;
    const ring=this.#mesh(new THREE.TorusGeometry(3.92,.11,8,80),rim,this.scene,0,-1.65,0);ring.rotation.x=Math.PI/2;
    const well=this.#mesh(new THREE.CircleGeometry(2.95,64),new THREE.MeshBasicMaterial({color:0x01070b}),this.scene,0,-3.76,0);well.rotation.x=-Math.PI/2;
    const marks=new THREE.InstancedMesh(new THREE.BoxGeometry(.045,.012,.15),rim,40),dummy=new THREE.Object3D();
    for(let i=0;i<40;i++){const a=i*Math.PI/20;dummy.position.set(Math.cos(a)*4.15,-1.65,Math.sin(a)*4.15);dummy.rotation.y=-a;dummy.updateMatrix();marks.setMatrixAt(i,dummy.matrix);}this.scene.add(marks);
    const nozzle=new THREE.Group();nozzle.position.set(SPOUT.x,SPOUT.y+.4,SPOUT.z);this.scene.add(nozzle);
    this.#mesh(new THREE.CylinderGeometry(.36,.55,.8,32,1,true),pipe,nozzle);
    const lip=this.#mesh(new THREE.TorusGeometry(.55,.055,8,40),rim,nozzle,0,-.4);lip.rotation.x=Math.PI/2;
    this.#mesh(new THREE.CylinderGeometry(.36,.36,.85,24),pipe,nozzle,0,.8);
    const supply=this.#mesh(new THREE.CylinderGeometry(.3,.3,2.5,24),pipe,nozzle,-1.18,1.25);supply.rotation.z=Math.PI/2;
    for(const y of [.4,.65]){const collar=this.#mesh(new THREE.TorusGeometry(.37,.03,8,32),rim,nozzle,0,y);collar.rotation.x=Math.PI/2;}
    this.#label('FIREHOSE','LIVE / OBSERVED PACKETS',new THREE.Vector3(SPOUT.x,5.05,SPOUT.z),2.25,.56);
    this.#label('THE PIT','SPILL · TILT · START AGAIN',new THREE.Vector3(0,-2.3,3.65),1.6,.42);
  }
  #label(title:string,subtitle:string,position:THREE.Vector3,width:number,height:number){
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=160;const c=canvas.getContext('2d')!;
    c.fillStyle='#071a23';c.fillRect(0,0,640,160);c.strokeStyle='#3d8b91';c.lineWidth=4;c.strokeRect(2,2,636,156);
    c.textAlign='center';c.fillStyle='#dcfff6';c.font='600 55px monospace';c.fillText(title,320,72);
    c.fillStyle='#8cb7bd';c.font='22px monospace';c.fillText(subtitle,320,121);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;this.#canvasTextures.push(texture);
    const label=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthWrite:false}));label.position.copy(position);label.scale.set(width,height,1);this.scene.add(label);
  }
  #changed=()=>{this.#dirty=true;this.#request();};
  #resized=()=>{if(this.#disposed||document.hidden)return;const w=this.stage.clientWidth,h=this.stage.clientHeight;if(w<1||h<1)return;
    const p=displayPreferences(),coarse=matchMedia('(pointer:coarse)').matches;const dpr=Math.min(devicePixelRatio||1,p.quality==='economy'?1:coarse?1.35:1.75);
    if(this.gpu.getPixelRatio()!==dpr||this.canvas.width!==Math.floor(w*dpr)||this.canvas.height!==Math.floor(h*dpr)){this.gpu.setPixelRatio(dpr);this.gpu.setSize(w,h,false);}
    this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.#uniforms.uHeight!.value=h*dpr;this.#uniforms.uDpr!.value=dpr;this.#uniforms.uResolution!.value.set(w*dpr,h*dpr);this.#changed();
    this.#uniforms.uWidth!.value=Math.max(1.4,p.width)*dpr;
  };
  applyDisplay(){const p=displayPreferences(),light=lightScene(),palette=packetPalette();
    this.scene.background=new THREE.Color(light?(p.basemap==='streets'?'#e7dfc9':'#e7eff0'):'#06121b');
    this.#floorMaterial?.color.set(light?(p.basemap==='streets'?'#e1d7ba':'#d5e3e7'):'#09222c');
    this.#uniforms.uPalette!.value=KINDS.map(kind=>new THREE.Color(palette[kind]));this.#uniforms.uLight!.value=light?1:0;
    this.#uniforms.uGlow!.value=p.effects==='minimal'?0:p.effects==='calm'?.3:.9;this.#uniforms.uCore!.value=p.packetSize;
    this.#uniforms.uWidth!.value=Math.max(1.4,p.width)*(this.gpu.getPixelRatio()||1);this.#uniforms.uOpacity!.value=p.opacity;
    this.#uniforms.uPattern!.value=p.pattern==='dashed'?1:p.pattern==='dotted'?2:0;
    this.#halos.visible=p.effects!=='minimal';this.#resized();this.#changed();
  }
  accept(buffer:ArrayBuffer):ArrayBuffer|undefined{
    const data=new Float32Array(buffer),old=this.#previous&&this.#previous!==this.#current?this.#previous.buffer as ArrayBuffer:undefined;
    this.#previous=this.#current??data;this.#current=data;this.#received=performance.now();
    this.#textures[0].image.data=new Float32Array(this.#previous.buffer,HEADER*4,this.capacity*4);
    this.#textures[1].image.data=new Float32Array(data.buffer,HEADER*4,this.capacity*4);this.#textures.forEach(t=>t.needsUpdate=true);
    const ends=this.#links.geometry.getAttribute('aEnds') as THREE.InstancedBufferAttribute;
    ends.array=new Float32Array(data.buffer,(HEADER+this.capacity*4)*4,this.capacity*4);ends.needsUpdate=true;this.#links.geometry.instanceCount=data[1]!;
    this.stage.dataset.beads=String(data[0]);this.stage.dataset.links=String(data[1]);this.stage.dataset.events=String(data[2]);this.stage.dataset.sleeping=String(data[3]);
    this.stage.dataset.physicsMs=data[4]!.toFixed(2);this.stage.dataset.physicsMaxMs=data[15]!.toFixed(2);this.stage.dataset.steps=String(data[13]);
    this.stage.dataset.omitted=String(data[5]);this.stage.dataset.drained=String(data[6]);this.stage.dataset.accepted=String(data[7]);this.stage.dataset.queue=String(data[14]);
    this.#changed();return old;
  }
  born(slots:readonly number[],selected:readonly number[]=[]){const now=performance.now()/1000;for(const slot of slots){this.#born.setX(slot,now);this.#selected.setX(slot,0);}for(const slot of selected)this.#selected.setX(slot,1);this.#born.needsUpdate=true;this.#selected.needsUpdate=true;this.#changed();}
  highlight(slots:readonly number[]){(this.#selected.array as Float32Array).fill(0);for(const slot of slots)this.#selected.setX(slot,1);this.#selected.needsUpdate=true;this.#changed();}
  setLinks(visible:boolean){this.#links.visible=visible;this.#changed();}
  setMode(mode:'tilt'|'orbit'){this.mode=mode;this.controls.enableRotate=mode==='orbit'||this.paused;this.stage.dataset.controlMode=mode;this.stage.style.cursor=mode==='tilt'&&!this.paused?'grab':'move';}
  setPaused(value:boolean){this.paused=value;this.controls.enableRotate=this.mode==='orbit'||value;this.#changed();}
  home(){this.camera.position.set(8,10,10);this.controls.target.set(0,.7,0);this.controls.update();this.#changed();}
  upright(){this.target.set(0,0,0,1);this.#sendRotation();}
  pour(){this.target.setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI);this.#sendRotation();}
  #sendRotation(){this.onRotation({x:this.target.x,y:this.target.y,z:this.target.z,w:this.target.w});this.#changed();}
  tilt(x:number,y:number){if(this.paused)return;this.#right.set(1,0,0).applyQuaternion(this.camera.quaternion);this.#up.set(0,1,0).applyQuaternion(this.camera.quaternion);
    this.#delta.setFromAxisAngle(this.#right,y);this.target.premultiply(this.#delta);this.#delta.setFromAxisAngle(this.#up,x);this.target.premultiply(this.#delta).normalize();this.#sendRotation();}
  projectWorld(x:number,y:number,z:number){this.#vector.set(x,y,z).project(this.camera);return{x:(this.#vector.x+1)*this.stage.clientWidth/2,y:(1-this.#vector.y)*this.stage.clientHeight/2,z:this.#vector.z};}
  project(){return this.projectWorld(SPOUT.x,SPOUT.y,SPOUT.z);}
  position(slot:number){const data=this.#current,at=HEADER+slot*4;if(!data||!data[at+3])return;return{x:data[at]!,y:data[at+1]!,z:data[at+2]!};}
  #pick(x:number,y:number){if(!this.#current)return;let best=-1,distance=100,depth=Infinity;
    for(let slot=0;slot<this.capacity;slot++){const p=this.position(slot);if(!p)continue;const q=this.projectWorld(p.x,p.y,p.z),d=(q.x-x)**2+(q.y-y)**2;
      if(q.z>=-1&&q.z<=1&&d<=distance&&(d<distance*.65||q.z<depth)){best=slot;distance=d;depth=q.z;}}
    if(best>=0)this.onPick(best);
  }
  #down=(e:PointerEvent)=>{this.#pointer.set(e.pointerId,{x:e.clientX,y:e.clientY});if(e.button===0&&this.#pointer.size===1){this.#pressed={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};this.stage.focus({preventScroll:true});}};
  #move=(e:PointerEvent)=>{const old=this.#pointer.get(e.pointerId);if(!old)return;this.#pointer.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.#pressed&&Math.hypot(e.clientX-this.#pressed.x,e.clientY-this.#pressed.y)>5)this.#pressed.moved=true;
    if(this.mode==='tilt'&&!this.paused&&this.#pointer.size===1&&e.buttons===1&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey)this.tilt((e.clientX-old.x)*.008,(e.clientY-old.y)*.008);
  };
  #release=(e:PointerEvent)=>{if(this.#pressed?.id===e.pointerId&&!this.#pressed.moved&&this.#pointer.size===1){const b=this.canvas.getBoundingClientRect();this.#pick(e.clientX-b.left,e.clientY-b.top);}this.#pointer.delete(e.pointerId);this.#pressed=undefined;};
  #cancel=(e:PointerEvent)=>{this.#pointer.delete(e.pointerId);this.#pressed=undefined;};
  #key=(e:KeyboardEvent)=>{if(e.target!==this.stage)return;const step=.18;let used=true;
    const orbit=this.paused||this.mode==='orbit';
    if(e.key==='Home')this.home();else if(e.key==='ArrowLeft')orbit?this.#orbit(-step,0):this.tilt(-step,0);
    else if(e.key==='ArrowRight')orbit?this.#orbit(step,0):this.tilt(step,0);
    else if(e.key==='ArrowUp')orbit?this.#orbit(0,-step):this.tilt(0,-step);
    else if(e.key==='ArrowDown')orbit?this.#orbit(0,step):this.tilt(0,step);
    else if(e.key==='+'||e.key==='=')this.zoom(.88);else if(e.key==='-')this.zoom(1.12);else used=false;
    if(used)e.preventDefault();
  };
  #orbit(x:number,y:number){const offset=this.camera.position.clone().sub(this.controls.target),s=new THREE.Spherical().setFromVector3(offset);s.theta+=x;s.phi=Math.max(.02,Math.min(Math.PI-.02,s.phi+y));this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(s));this.controls.update();this.#changed();}
  zoom(scale:number){this.camera.position.sub(this.controls.target).multiplyScalar(scale).clampLength(3,45).add(this.controls.target);this.controls.update();this.#changed();}
  #contextLost=(e:Event)=>{e.preventDefault();this.lost=true;if(this.#frame!==undefined)cancelAnimationFrame(this.#frame);this.#frame=undefined;this.onContext(true);};
  #contextRestored=()=>{if(this.#disposed)return;this.lost=false;this.#textures.forEach(t=>t.needsUpdate=true);this.#born.needsUpdate=true;this.#selected.needsUpdate=true;this.onContext(false);this.#changed();};
  #visibility=()=>{if(document.hidden){if(this.#frame!==undefined)cancelAnimationFrame(this.#frame);this.#frame=undefined;}else{this.#lastDraw=0;this.#resized();this.#changed();}};
  #request(){if(this.#frame===undefined&&!this.#disposed&&!this.lost&&!document.hidden)this.#frame=requestAnimationFrame(this.#draw);}
  #draw=(now:number)=>{this.#frame=undefined;if(this.#disposed||this.lost||document.hidden)return;
    const blend=Math.min(1,(now-this.#received)/(1000/30));this.#uniforms.uBlend!.value=blend;this.#uniforms.uTime!.value=now/1000;
    if(this.#previous&&this.#current){this.#poseA.set(this.#previous[8]!,this.#previous[9]!,this.#previous[10]!,this.#previous[11]!);this.#poseB.set(this.#current[8]!,this.#current[9]!,this.#current[10]!,this.#current[11]!);this.box.quaternion.copy(this.#poseA).slerp(this.#poseB,blend);}
    const moved=this.controls.update();
    if(this.#dirty||moved||blend<1){this.gpu.render(this.scene,this.camera);this.#visualFrames++;if(this.#lastDraw)this.#maxFrameGap=Math.max(this.#maxFrameGap,now-this.#lastDraw);this.#lastDraw=now;this.#dirty=false;
      this.stage.dataset.renderFrames=String(this.#visualFrames);this.stage.dataset.drawCalls=String(this.gpu.info.render.calls);this.stage.dataset.geometries=String(this.gpu.info.memory.geometries);this.stage.dataset.textures=String(this.gpu.info.memory.textures);}
    if(moved||(!this.paused&&blend<1))this.#request();
  };
  get metrics(){return{frames:this.#visualFrames,maxFrameGap:this.#maxFrameGap,drawCalls:this.gpu.info.render.calls,geometries:this.gpu.info.memory.geometries,textures:this.gpu.info.memory.textures,capacity:this.capacity};}
  destroy(){this.#disposed=true;if(this.#frame!==undefined)cancelAnimationFrame(this.#frame);this.#resize.disconnect();this.controls.removeEventListener('change',this.#changed);this.controls.dispose();
    this.canvas.removeEventListener('pointerdown',this.#down);this.canvas.removeEventListener('pointermove',this.#move);this.canvas.removeEventListener('pointerup',this.#release);this.canvas.removeEventListener('pointercancel',this.#cancel);
    this.canvas.removeEventListener('webglcontextlost',this.#contextLost);this.canvas.removeEventListener('webglcontextrestored',this.#contextRestored);this.stage.removeEventListener('keydown',this.#key);document.removeEventListener('visibilitychange',this.#visibility);
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
    this.scene.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.Points||object instanceof THREE.LineSegments){geometries.add(object.geometry);for(const m of Array.isArray(object.material)?object.material:[object.material])materials.add(m);}else if(object instanceof THREE.Sprite)materials.add(object.material);});
    geometries.forEach(g=>g.dispose());this.#materials.forEach(m=>materials.add(m));materials.forEach(m=>m.dispose());this.#textures.forEach(t=>t.dispose());this.#canvasTextures.forEach(t=>t.dispose());this.gpu.dispose();this.gpu.forceContextLoss();this.#previous=undefined;this.#current=undefined;
  }
}
