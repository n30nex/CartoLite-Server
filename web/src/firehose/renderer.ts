import * as THREE from 'three';
import { fitSceneCamera, sceneViewport } from '../sceneFraming';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { displayPreferences, lightScene, packetPalette } from '../displayPreferences';
import { NetgraphQuality } from '../netgraph/quality';
import { SceneMaterials } from '../sceneMaterials';
import { BOX, HEADER, KINDS, SPOUT, TEXTURE_WIDTH, PACHINKO, laneCenter, particleRadius, type MachineMode, type Rotation } from './model';
import { beadVertex, beadFragment, dotVertex, dotFragment, trailVertex, trailFragment, linkVertex, linkFragment, rippleVertex, rippleFragment, wellVertex, wellFragment } from './shaders';

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
  #prepared=false;
  #preparation=0;
  #surfaces=new SceneMaterials();
  #resize:ResizeObserver;
  #homeView=true;
  #frameLayout='';
  #textures:[THREE.DataTexture,THREE.DataTexture];
  #dots:THREE.Points;
  #halos:THREE.Points;
  #links:THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>;
  #births:Float32Array;
  #birthTexture:THREE.DataTexture;
  #trails:THREE.Mesh;
  #ripples:THREE.Mesh;
  #impactData=new Float32Array(24*4);
  #impactIndex=0;
  #effectUntil=0;
  #pauseTime=0;
  #frameSpan=1000/30;
  #emitTime=-100;
  #drainTime=-100;
  #nozzleLight?:THREE.MeshBasicMaterial;
  #pitLight?:THREE.MeshBasicMaterial;
  #laneLights:THREE.MeshBasicMaterial[]=[];
  #laneTimes=new Float64Array(6).fill(-100);
  #bucketFloors?:THREE.InstancedMesh;
  #draining=false;
  #selected:THREE.BufferAttribute;
  #selectedSlots:Float32Array;
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
  #drawMs=0;
  #quality=new NetgraphQuality();
  #loadQuality:'full'|'balanced'|'low'='full';
  #vector=new THREE.Vector3();
  #right=new THREE.Vector3();
  #up=new THREE.Vector3();
  #delta=new THREE.Quaternion();
  #poseA=new THREE.Quaternion();
  #poseB=new THREE.Quaternion();

  constructor(readonly stage:HTMLElement,readonly canvas:HTMLCanvasElement,readonly capacity:number,readonly machine:MachineMode='firehose'){
    this.radius=particleRadius(capacity,machine);
    // Packet edges are shaded analytically. Reserve costly full-scene MSAA on
    // the textured cabinet for an explicitly selected High graphics profile.
    this.gpu=new THREE.WebGLRenderer({canvas,antialias:machine==='firehose'||displayPreferences().quality==='high',alpha:false,powerPreference:'high-performance'});
    this.gpu.outputColorSpace=THREE.SRGBColorSpace;this.gpu.toneMapping=THREE.ACESFilmicToneMapping;this.gpu.toneMappingExposure=1.1;
    this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.controls.dampingFactor=.12;
    this.controls.minDistance=3;this.controls.maxDistance=45;this.controls.maxPolarAngle=Math.PI-.02;this.mode=machine==='pachinko'?'orbit':'tilt';this.controls.enableRotate=this.mode==='orbit';
    this.controls.addEventListener('change',this.#changed);this.controls.addEventListener('start',this.#navigate);
    const empty=new Float32Array(capacity*4);
    const texture=()=>{const t=new THREE.DataTexture(empty,TEXTURE_WIDTH,capacity/TEXTURE_WIDTH,THREE.RGBAFormat,THREE.FloatType);t.needsUpdate=true;return t;};
    this.#textures=[texture(),texture()];
    this.#births=new Float32Array(capacity).fill(-100);
    this.#birthTexture=new THREE.DataTexture(this.#births,TEXTURE_WIDTH,capacity/TEXTURE_WIDTH,THREE.RedFormat,THREE.FloatType);this.#birthTexture.needsUpdate=true;
    this.#uniforms={uPrevious:{value:this.#textures[0]},uCurrent:{value:this.#textures[1]},uBirth:{value:this.#birthTexture},uBlend:{value:1},uRadius:{value:this.radius},
      uHeight:{value:1},uDpr:{value:1},uResolution:{value:new THREE.Vector2(1,1)},uPalette:{value:KINDS.map(()=>new THREE.Color())},uDarkPalette:{value:KINDS.map(()=>new THREE.Color())},
      uTime:{value:0},uDrainEnergy:{value:0},uMotion:{value:1},uTrail:{value:1},uGlow:{value:0},uCore:{value:1},uLight:{value:0},uWidth:{value:1.5},uOpacity:{value:.8},uPattern:{value:0},
      uMachine:{value:machine==='pachinko'?1:0},uClipTop:{value:machine==='pachinko'?PACHINKO.top+.2:SPOUT.y+.04},uFadeStart:{value:machine==='pachinko'?4.8:3.6},uFadeEnd:{value:machine==='pachinko'?5.9:4.7}};
    this.#selectedSlots=new Float32Array(capacity);
    this.#selected=new THREE.BufferAttribute(this.#selectedSlots,1).setUsage(THREE.DynamicDrawUsage);
    const slots=Float32Array.from({length:capacity},(_,i)=>i);
    const dots=new THREE.BufferGeometry();dots.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(capacity*3),3));
    dots.setAttribute('aSlot',new THREE.BufferAttribute(slots,1));dots.setAttribute('aSelected',this.#selected);
    this.#dots=new THREE.Points(dots,new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:dotVertex,fragmentShader:dotFragment,uniforms:this.#uniforms,transparent:true,depthWrite:true,toneMapped:false}));this.#dots.frustumCulled=false;this.#dots.renderOrder=1;
    const halos=new THREE.BufferGeometry();halos.setAttribute('position',dots.getAttribute('position'));halos.setAttribute('aSlot',dots.getAttribute('aSlot'));
    this.#halos=new THREE.Points(halos,new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:beadVertex,fragmentShader:beadFragment,uniforms:this.#uniforms,transparent:true,depthWrite:false,toneMapped:false}));this.#halos.frustumCulled=false;this.#halos.renderOrder=4;
    const trails=new THREE.InstancedBufferGeometry();trails.setAttribute('position',new THREE.Float32BufferAttribute([0,-1,0,1,-1,0,1,1,0,0,-1,0,1,1,0,0,1,0],3));
    trails.setAttribute('aSlot',new THREE.InstancedBufferAttribute(slots,1));trails.instanceCount=capacity;
    this.#trails=new THREE.Mesh(trails,new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:trailVertex,fragmentShader:trailFragment,uniforms:this.#uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,toneMapped:false}));this.#trails.frustumCulled=false;this.#trails.renderOrder=2;
    const ripples=new THREE.InstancedBufferGeometry();ripples.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,-1,0,1,1,0,-1,1,0],3));
    for(let i=0;i<24;i++)this.#impactData[i*4+2]=-100;
    ripples.setAttribute('aImpact',new THREE.InstancedBufferAttribute(this.#impactData,4).setUsage(THREE.DynamicDrawUsage));ripples.instanceCount=24;
    this.#ripples=new THREE.Mesh(ripples,new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:rippleVertex,fragmentShader:rippleFragment,uniforms:this.#uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,toneMapped:false}));this.#ripples.frustumCulled=false;this.#ripples.renderOrder=3;this.box.add(this.#ripples);
    const links=new THREE.InstancedBufferGeometry();links.setAttribute('position',new THREE.Float32BufferAttribute([0,-1,0,1,-1,0,1,1,0,0,-1,0,1,1,0,0,1,0],3));
    links.setAttribute('aEnds',new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),2).setUsage(THREE.DynamicDrawUsage));links.instanceCount=0;
    this.#links=new THREE.Mesh(links,new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:linkVertex,fragmentShader:linkFragment,
      uniforms:this.#uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,toneMapped:false}));this.#links.frustumCulled=false;this.#links.renderOrder=2;
    this.scene.add(this.#dots,this.#halos,this.#links,this.#trails);
    this.stage.dataset.visualProfile='luminous';this.stage.dataset.sortMs='0';
    if(machine==='pachinko')this.#buildPachinko();else this.#buildStage();this.applyDisplay();this.home();
    canvas.addEventListener('pointerdown',this.#down);canvas.addEventListener('pointermove',this.#move);canvas.addEventListener('pointerup',this.#release);canvas.addEventListener('pointercancel',this.#cancel);
    canvas.addEventListener('webglcontextlost',this.#contextLost);canvas.addEventListener('webglcontextrestored',this.#contextRestored);
    stage.addEventListener('keydown',this.#key);document.addEventListener('visibilitychange',this.#visibility);
    this.#resize=new ResizeObserver(this.#resized);this.#resize.observe(stage);for(const node of document.querySelectorAll('.controls,.firehose-caption,.pachinko-buckets'))this.#resize.observe(node);this.#resized();
  }
  #material(color:number,metalness=.2,roughness=.48){const m=new THREE.MeshStandardMaterial({color,metalness,roughness});this.#materials.add(m);return m;}
  #metal(color:number){const m=new THREE.MeshMatcapMaterial({color,matcap:this.#surfaces.metal,toneMapped:false});this.#materials.add(m);return m;}
  #mesh(geometry:THREE.BufferGeometry,material:THREE.Material,parent:THREE.Object3D,x=0,y=0,z=0){const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
  #buildStage(){
    this.scene.add(new THREE.HemisphereLight(0xc9f0ff,0x09252e,2.3));const key=new THREE.DirectionalLight(0xd3f8ff,3.3);key.position.set(-4,8,5);this.scene.add(key);
    const rim=this.#metal(0xc2dce0),dark=this.#material(0x09222c,.25,.6),pipe=this.#metal(0xa7bec8);
    this.#floorMaterial=this.#material(0x09222c,.25,.6);
    const glass=new THREE.MeshBasicMaterial({color:0x5edbc7,transparent:true,opacity:.035,side:THREE.DoubleSide,forceSinglePass:true,depthWrite:false});this.#materials.add(glass);
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
    const well=this.#mesh(new THREE.CircleGeometry(2.95,64),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:wellVertex,fragmentShader:wellFragment,uniforms:this.#uniforms,toneMapped:false}),this.scene,0,-3.76,0);well.rotation.x=-Math.PI/2;
    const marks=new THREE.InstancedMesh(new THREE.BoxGeometry(.045,.012,.15),rim,40),dummy=new THREE.Object3D();
    for(let i=0;i<40;i++){const a=i*Math.PI/20;dummy.position.set(Math.cos(a)*4.15,-1.65,Math.sin(a)*4.15);dummy.rotation.y=-a;dummy.updateMatrix();marks.setMatrixAt(i,dummy.matrix);}this.scene.add(marks);
    const nozzle=new THREE.Group();nozzle.position.set(SPOUT.x,SPOUT.y+.4,SPOUT.z);this.scene.add(nozzle);
    const funnel=new THREE.MeshBasicMaterial({color:0x45cdd7,transparent:true,opacity:.14,side:THREE.DoubleSide,forceSinglePass:true,depthWrite:false});this.#materials.add(funnel);
    this.#mesh(new THREE.CylinderGeometry(.36,.7,.8,24,1,true),funnel,nozzle);
    const cage=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(.36,.7,.8,12,1,true)),new THREE.LineBasicMaterial({color:0x52bccb,transparent:true,opacity:.55}));nozzle.add(cage);
    const lip=this.#mesh(new THREE.TorusGeometry(.7,.035,8,40),rim,nozzle,0,-.4);lip.rotation.x=Math.PI/2;
    this.#mesh(new THREE.CylinderGeometry(.36,.36,.85,24),funnel,nozzle,0,.8);
    this.#nozzleLight=new THREE.MeshBasicMaterial({color:0x4bead4,transparent:true,opacity:.3});this.#materials.add(this.#nozzleLight);
    const sourceRing=this.#mesh(new THREE.TorusGeometry(.63,.014,6,48),this.#nozzleLight,nozzle,0,-.405);sourceRing.rotation.x=Math.PI/2;
    this.#pitLight=new THREE.MeshBasicMaterial({color:0x40cbe0,transparent:true,opacity:.16});this.#materials.add(this.#pitLight);
    const drainRing=this.#mesh(new THREE.TorusGeometry(3.72,.025,6,80),this.#pitLight,this.scene,0,-1.69);drainRing.rotation.x=Math.PI/2;
    const supply=this.#mesh(new THREE.CylinderGeometry(.3,.3,2.5,24),pipe,nozzle,-1.18,1.25);supply.rotation.z=Math.PI/2;
    for(const y of [.4,.65]){const collar=this.#mesh(new THREE.TorusGeometry(.37,.03,8,32),rim,nozzle,0,y);collar.rotation.x=Math.PI/2;}
    this.#label('FIREHOSE','LIVE / OBSERVED PACKETS',new THREE.Vector3(SPOUT.x,5.05,SPOUT.z),2.25,.56);
    this.#label('THE PIT','LIVE OVERFLOW',new THREE.Vector3(0,-2.3,3.65),1.6,.42);
  }
  async prepare():Promise<void>{
    const generation=++this.#preparation,started=performance.now();this.#prepared=false;this.stage.dataset.graphicsReady='false';
    await this.#surfaces.load(this.machine==='pachinko');
    if(this.#disposed||this.lost||generation!==this.#preparation)return;
    this.#surfaces.init(this.gpu,this.machine==='pachinko');this.#textures.forEach(t=>this.gpu.initTexture(t));this.gpu.initTexture(this.#birthTexture);this.#canvasTextures.forEach(t=>this.gpu.initTexture(t));
    await this.gpu.compileAsync(this.scene,this.camera);
    if(this.#disposed||this.lost||generation!==this.#preparation)return;
    // Exercise zero-count and initially hidden effects once in a single corner
    // pixel. Use the actual framebuffer/color space, with no visible fake packet.
    const hidden:THREE.Object3D[]=[],viewport=this.gpu.getViewport(new THREE.Vector4()),scissor=this.gpu.getScissor(new THREE.Vector4()),scissorTest=this.gpu.getScissorTest(),count=this.#links.geometry.instanceCount;
    this.scene.traverse(object=>{if(!object.visible){hidden.push(object);object.visible=true;}});
    try{this.#links.geometry.instanceCount=Math.max(1,count);this.gpu.setViewport(0,0,1,1);this.gpu.setScissor(0,0,1,1);this.gpu.setScissorTest(true);this.gpu.render(this.scene,this.camera);}
    finally{this.#links.geometry.instanceCount=count;for(const object of hidden)object.visible=false;this.gpu.setViewport(viewport);this.gpu.setScissor(scissor);this.gpu.setScissorTest(scissorTest);}
    this.#prepared=true;this.stage.dataset.graphicsReady='true';this.stage.dataset.warmupMs=(performance.now()-started).toFixed(1);this.stage.dataset.programs=String(this.gpu.info.programs?.length??0);this.#changed();
  }
  #buildPachinko(){
    // The generated materials already contain the machine's lighting. Avoid
    // evaluating a full lighting model behind its opaque enamel playfield.
    this.scene.add(this.box);const metal=this.#metal(0xc4d5de),dark=new THREE.MeshBasicMaterial({color:0x10232d,toneMapped:false});this.#materials.add(dark);
    const panel=new THREE.MeshBasicMaterial({map:this.#surfaces.enamel,color:0xdce5e7,toneMapped:false});this.#materials.add(panel);
    this.#mesh(new THREE.BoxGeometry(6.85,9.65,.3),dark,this.box,0,.65,-.19);
    this.#mesh(new THREE.PlaneGeometry(6.65,9.45),panel,this.box,0,.65,-.025);
    const pegs=new THREE.InstancedMesh(new THREE.CylinderGeometry(PACHINKO.pegRadius,PACHINKO.pegRadius,.26,12),metal,6*PACHINKO.rows),dummy=new THREE.Object3D();
    for(let kind=0;kind<6;kind++)for(let row=0;row<PACHINKO.rows;row++){
      dummy.position.set(laneCenter(kind)+(row%2?PACHINKO.pegOffset:-PACHINKO.pegOffset),PACHINKO.pegTop-row*PACHINKO.rowGap,.16);dummy.rotation.set(Math.PI/2,0,0);dummy.updateMatrix();pegs.setMatrixAt(kind*PACHINKO.rows+row,dummy.matrix);
    }this.box.add(pegs);
    // One bounded draw gives each lane a readable edge behind its live dots.
    const railMaterial=new THREE.MeshBasicMaterial({transparent:true,opacity:.18,depthWrite:false,toneMapped:false});this.#materials.add(railMaterial);
    const rails=new THREE.InstancedMesh(new THREE.BoxGeometry(.018,PACHINKO.top-PACHINKO.boardBottom,.012),railMaterial,12),palette=packetPalette(false);
    for(let kind=0;kind<6;kind++)for(let edge=0;edge<2;edge++){
      const index=kind*2+edge;dummy.position.set(laneCenter(kind)+(edge?1:-1)*(PACHINKO.laneWidth/2-.035),(PACHINKO.top+PACHINKO.boardBottom)/2,.015);dummy.rotation.set(0,0,0);dummy.updateMatrix();rails.setMatrixAt(index,dummy.matrix);rails.setColorAt(index,new THREE.Color(palette[KINDS[kind]!]));
    }this.box.add(rails);
    const glass=new THREE.MeshBasicMaterial({color:0x80e1e3,transparent:true,opacity:.055,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true});this.#materials.add(glass);
    const dividers=new THREE.InstancedMesh(new THREE.BoxGeometry(.025,PACHINKO.top-PACHINKO.boardBottom,.32),glass,7);
    for(let i=0;i<7;i++){dummy.position.set((i-3)*PACHINKO.lanePitch,(PACHINKO.top+PACHINKO.boardBottom)/2,.15);dummy.rotation.set(0,0,0);dummy.updateMatrix();dividers.setMatrixAt(i,dummy.matrix);}this.box.add(dividers);
    this.#bucketFloors=new THREE.InstancedMesh(new THREE.BoxGeometry(PACHINKO.laneWidth,.07,PACHINKO.front),metal,6);
    const sides=new THREE.InstancedMesh(new THREE.BoxGeometry(.035,PACHINKO.lip-PACHINKO.floor,PACHINKO.front),glass,7);
    for(let i=0;i<7;i++){dummy.position.set((i-3)*PACHINKO.lanePitch,(PACHINKO.lip+PACHINKO.floor)/2,PACHINKO.front/2);dummy.updateMatrix();sides.setMatrixAt(i,dummy.matrix);}this.box.add(sides);
    const fronts=new THREE.InstancedMesh(new THREE.BoxGeometry(PACHINKO.laneWidth,PACHINKO.lip-PACHINKO.floor,.025),glass,6);
    const lips=new THREE.InstancedMesh(new THREE.BoxGeometry(PACHINKO.laneWidth,.035,.05),metal,6);
    for(let kind=0;kind<6;kind++){
      const x=laneCenter(kind);dummy.position.set(x,PACHINKO.floor-.035,PACHINKO.front/2);dummy.updateMatrix();this.#bucketFloors.setMatrixAt(kind,dummy.matrix);
      dummy.position.set(x,(PACHINKO.lip+PACHINKO.floor)/2,PACHINKO.front);dummy.updateMatrix();fronts.setMatrixAt(kind,dummy.matrix);
      dummy.position.set(x,PACHINKO.lip,PACHINKO.front);dummy.updateMatrix();lips.setMatrixAt(kind,dummy.matrix);
      const light=new THREE.MeshBasicMaterial({transparent:true,opacity:.4});this.#materials.add(light);this.#laneLights.push(light);
      this.#mesh(new THREE.BoxGeometry(.72,.045,.04),light,this.box,x,PACHINKO.top+.03,.16);
      this.#label(KINDS[kind]!.toUpperCase(),'PACKETS',new THREE.Vector3(x,PACHINKO.floor-.35,1),.96,.25);
    }this.box.add(this.#bucketFloors,fronts,lips);
    const pit=this.#mesh(new THREE.CylinderGeometry(3.8,3,1.35,48,1,true),dark,this.scene,0,-4.55,.6);(pit.material as THREE.Material).side=THREE.DoubleSide;
    const ring=this.#mesh(new THREE.TorusGeometry(3.82,.1,8,64),metal,this.scene,0,-3.88,.6);ring.rotation.x=Math.PI/2;
    const well=this.#mesh(new THREE.CircleGeometry(3,48),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:wellVertex,fragmentShader:wellFragment,uniforms:this.#uniforms,toneMapped:false}),this.scene,0,-5.23,.6);well.rotation.x=-Math.PI/2;
    this.#pitLight=new THREE.MeshBasicMaterial({color:0x61e0ee,transparent:true,opacity:.2});this.#materials.add(this.#pitLight);
    const glow=this.#mesh(new THREE.TorusGeometry(3.63,.025,6,64),this.#pitLight,this.scene,0,-3.9,.6);glow.rotation.x=Math.PI/2;
    this.#label('PACHINKO','LIVE PACKETS / SIX TYPE LANES',new THREE.Vector3(0,5.65,0),3,.65);
    this.#links.visible=false;
  }
  #label(title:string,subtitle:string,position:THREE.Vector3,width:number,height:number){
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=160;const c=canvas.getContext('2d')!;
    c.fillStyle='#071a23';c.fillRect(0,0,640,160);c.strokeStyle='#3d8b91';c.lineWidth=4;c.strokeRect(2,2,636,156);
    c.textAlign='center';c.fillStyle='#dcfff6';c.font='700 80px system-ui';c.fillText(title,320,82);
    c.fillStyle='#8cb7bd';c.font='22px monospace';c.fillText(subtitle,320,121);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;this.#canvasTextures.push(texture);
    const label=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthWrite:false,depthTest:false}));label.renderOrder=5;label.position.copy(position);label.scale.set(width,height,1);this.scene.add(label);
  }
  #changed=()=>{this.#dirty=true;this.#request();};
  #resized=()=>{if(this.#disposed||document.hidden)return;const w=this.stage.clientWidth,h=this.stage.clientHeight;if(w<1||h<1)return;
    const p=displayPreferences(),coarse=matchMedia('(pointer:coarse)').matches;
    const quality=p.quality==='economy'?'low':p.quality==='high'?'full':this.#quality.mode==='low'||this.#loadQuality==='low'?'low':this.#quality.mode==='balanced'||this.#loadQuality==='balanced'?'balanced':'full';
    const dpr=Math.min(devicePixelRatio||1,quality==='low'?.75:quality==='balanced'?1:coarse?1.35:1.75);
    if(this.gpu.getPixelRatio()!==dpr||this.canvas.width!==Math.floor(w*dpr)||this.canvas.height!==Math.floor(h*dpr)){this.gpu.setPixelRatio(dpr);this.gpu.setSize(w,h,false);}
    // Preserve the whole box and pit in portrait without moving a user's camera.
    this.camera.aspect=w/h;this.camera.updateProjectionMatrix();const frame=sceneViewport(this.stage),key=JSON.stringify(frame);if(this.#homeView&&key!==this.#frameLayout){this.#frameLayout=key;fitSceneCamera(this.camera,this.machine==='pachinko'?[new THREE.Box3(new THREE.Vector3(-4.05,-5.3,-3.4),new THREE.Vector3(4.05,-3.7,4.6)),new THREE.Box3(new THREE.Vector3(-3.5,-4.2,-.5),new THREE.Vector3(3.5,6.05,1.2))]:[new THREE.Box3(new THREE.Vector3(-4.3,-3.85,-4.3),new THREE.Vector3(4.3,-1.5,4.3)),new THREE.Box3().setFromObject(this.box),new THREE.Box3(new THREE.Vector3(-3.2,3,-1),new THREE.Vector3(.6,5.45,.6))],frame);}this.#uniforms.uHeight!.value=h*dpr;this.#uniforms.uDpr!.value=dpr;this.#uniforms.uResolution!.value.set(w*dpr,h*dpr);this.#changed();
    this.#uniforms.uWidth!.value=Math.max(1.4,p.width)*dpr;
    this.#halos.visible=p.effects!=='minimal'&&quality!=='low';this.stage.dataset.quality=quality;this.stage.dataset.pixelRatio=dpr.toFixed(2);
    this.#trails.visible=p.effects!=='minimal';this.#ripples.visible=p.effects!=='minimal'&&quality!=='low';
  };
  applyDisplay(){const p=displayPreferences(),light=lightScene(),palette=packetPalette(this.machine==='pachinko'?false:undefined);
    this.scene.background=new THREE.Color(light?(p.basemap==='streets'?'#e7dfc9':'#e7eff0'):'#06121b');
    this.#floorMaterial?.color.set(light?(p.basemap==='streets'?'#e1d7ba':'#d5e3e7'):'#09222c');
    this.#uniforms.uPalette!.value=KINDS.map(kind=>new THREE.Color(palette[kind]));const dark=packetPalette(false);this.#uniforms.uDarkPalette!.value=KINDS.map(kind=>new THREE.Color(dark[kind]));this.#uniforms.uLight!.value=this.machine==='pachinko'?0:light?1:0;
    this.#laneLights.forEach((material,i)=>material.color.set(dark[KINDS[i]!]));
    this.#uniforms.uGlow!.value=(p.effects==='minimal'?0:p.effects==='calm'?.45:1)*(.5+.5*p.glow);this.#uniforms.uCore!.value=p.packetSize;
    this.#uniforms.uMotion!.value=p.effects==='minimal'?0:p.effects==='calm'?.45:1;this.#uniforms.uTrail!.value=p.trailLength;
    this.#uniforms.uWidth!.value=Math.max(1.4,p.width)*(this.gpu.getPixelRatio()||1);this.#uniforms.uOpacity!.value=p.opacity;
    this.#uniforms.uPattern!.value=p.pattern==='dashed'?1:p.pattern==='dotted'?2:0;
    this.#quality.resetSamples();this.#resized();this.#changed();
  }
  accept(buffer:ArrayBuffer):ArrayBuffer|undefined{
    const data=new Float32Array(buffer),old=this.#previous&&this.#previous!==this.#current?this.#previous.buffer as ArrayBuffer:undefined;
    const now=performance.now(),gap=now-this.#received;if(this.#current&&gap>8&&gap<250)this.#frameSpan=this.#frameSpan*.65+gap*.35;
    this.#previous=this.#current??data;this.#current=data;this.#received=now;
    this.#textures[0].image.data=new Float32Array(this.#previous.buffer,HEADER*4,this.capacity*4);
    this.#textures[1].image.data=new Float32Array(data.buffer,HEADER*4,this.capacity*4);this.#textures.forEach(t=>t.needsUpdate=true);
    const ends=this.#links.geometry.getAttribute('aEnds') as THREE.InstancedBufferAttribute;
    ends.array=new Float32Array(data.buffer,(HEADER+this.capacity*4)*4,this.capacity*4);ends.needsUpdate=true;this.#links.geometry.instanceCount=data[1]!;
    this.stage.dataset.beads=String(data[0]);this.stage.dataset.links=String(data[1]);this.stage.dataset.events=String(data[2]);this.stage.dataset.sleeping=String(data[3]);
    this.stage.dataset.physicsMs=data[4]!.toFixed(2);this.stage.dataset.physicsMaxMs=data[15]!.toFixed(2);this.stage.dataset.steps=String(data[13]);
    if(Number(this.stage.dataset.drained??0)<data[6]!){this.#drainTime=now/1000;this.#effectUntil=now+1400;}
    this.stage.dataset.omitted=String(data[5]);this.stage.dataset.drained=String(data[6]);this.stage.dataset.accepted=String(data[7]);this.stage.dataset.queue=String(data[14]);
    if(this.machine==='pachinko'){this.stage.dataset.buckets=JSON.stringify(Array.from(data.subarray(16,22)));this.#draining=data[22]===1;this.stage.dataset.draining=String(this.#draining);if(this.#bucketFloors)this.#bucketFloors.visible=!this.#draining;}
    // Predict heavy overdraw before the first overloaded frame reaches the
    // feedback sampler. Keep every retained dot/link and its CSS-pixel size.
    const loadQuality=data[0]!>1536?'low':data[0]!>640?'balanced':'full';
    if(loadQuality!==this.#loadQuality){this.#loadQuality=loadQuality;this.#resized();}
    this.#changed();return old;
  }
  born(slots:readonly number[],selected:readonly number[]=[],kind=0){const now=performance.now();for(const slot of slots){this.#births[slot]=now/1000;this.#selectedSlots[slot]=0;}for(const slot of selected)this.#selectedSlots[slot]=1;
    this.#birthTexture.needsUpdate=true;this.#selected.needsUpdate=true;this.#emitTime=now/1000;this.#laneTimes[kind]=now/1000;this.#effectUntil=now+3200;this.#nozzleLight?.color.copy(this.#uniforms.uPalette!.value[kind]);this.#changed();}
  impact(x:number,z:number,kind:number,y=0){if(this.paused)return;const now=performance.now();this.#impactData.set([x,this.machine==='pachinko'?y:z,now/1000,kind],(this.#impactIndex++%24)*4);this.#ripples.geometry.getAttribute('aImpact').needsUpdate=true;this.#effectUntil=Math.max(this.#effectUntil,now+1200);this.#changed();}
  clearEffects(){this.#births.fill(-100);this.#birthTexture.needsUpdate=true;for(let i=0;i<24;i++)this.#impactData[i*4+2]=-100;this.#ripples.geometry.getAttribute('aImpact').needsUpdate=true;this.#laneTimes.fill(-100);this.#effectUntil=0;this.#emitTime=this.#drainTime=-100;this.#changed();}
  highlight(slots:readonly number[]){this.#selectedSlots.fill(0);for(const slot of slots)this.#selectedSlots[slot]=1;this.#selected.needsUpdate=true;this.#changed();}
  setLinks(visible:boolean){this.#links.visible=this.machine==='firehose'&&visible;this.#changed();}
  setMode(mode:'tilt'|'orbit'){this.mode=this.machine==='pachinko'?'orbit':mode;this.controls.enableRotate=this.mode==='orbit'||this.paused;this.stage.dataset.controlMode=this.mode;this.stage.style.cursor=this.mode==='tilt'&&!this.paused?'grab':'move';}
  setPaused(value:boolean){if(value!==this.paused){const now=performance.now();if(value)this.#pauseTime=now;else{const gap=now-this.#pauseTime;for(let i=0;i<this.capacity;i++)if(this.#births[i]!>=0)this.#births[i]!+=gap/1000;for(let i=0;i<24;i++)if(this.#impactData[i*4+2]!>=0)this.#impactData[i*4+2]!+=gap/1000;for(let i=0;i<6;i++)if(this.#laneTimes[i]!>=0)this.#laneTimes[i]!+=gap/1000;this.#emitTime+=gap/1000;this.#drainTime+=gap/1000;this.#received+=gap;this.#effectUntil+=gap;this.#birthTexture.needsUpdate=true;this.#ripples.geometry.getAttribute('aImpact').needsUpdate=true;}}
    // The clock freezes the effects too; keep their illumination visible while inspecting.
    this.paused=value;const p=displayPreferences();this.#uniforms.uMotion!.value=p.effects==='minimal'?0:p.effects==='calm'?.45:1;this.controls.enableRotate=this.mode==='orbit'||value;this.#changed();}
  #navigate=()=>{this.#homeView=false;};
  home(view:'isometric'|'front'|'above'='isometric'){
    const damping=this.controls.enableDamping;this.controls.enableDamping=false;this.controls.update();this.controls.enableDamping=damping;this.#homeView=true;this.#frameLayout='';
    if(this.machine==='pachinko'){this.controls.target.set(0,.2,0);this.camera.position.set(...(view==='front'?[0,.2,23]:view==='above'?[5,12,20]:[5,3.8,22]) as [number,number,number]);}
    else{this.controls.target.set(0,.7,0);this.camera.position.set(...(view==='front'?[0,2,17]:view==='above'?[0,18,.01]:[8,10,10]) as [number,number,number]);}
    this.controls.update();this.#resized();this.#changed();
  }
  upright(){this.target.set(0,0,0,1);this.#sendRotation();}
  pour(){this.target.setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI);this.#sendRotation();}
  #sendRotation(){this.onRotation({x:this.target.x,y:this.target.y,z:this.target.z,w:this.target.w});this.#changed();}
  tilt(x:number,y:number){if(this.paused)return;this.#right.set(1,0,0).applyQuaternion(this.camera.quaternion);this.#up.set(0,1,0).applyQuaternion(this.camera.quaternion);
    this.#delta.setFromAxisAngle(this.#right,y);this.target.premultiply(this.#delta);this.#delta.setFromAxisAngle(this.#up,x);this.target.premultiply(this.#delta).normalize();this.#sendRotation();}
  projectWorld(x:number,y:number,z:number){this.#vector.set(x,y,z).project(this.camera);return{x:(this.#vector.x+1)*this.stage.clientWidth/2,y:(1-this.#vector.y)*this.stage.clientHeight/2,z:this.#vector.z};}
  project(){return this.machine==='pachinko'?this.projectWorld(0,PACHINKO.top,0):this.projectWorld(SPOUT.x,SPOUT.y,SPOUT.z);}
  position(slot:number){const b=this.#current,at=HEADER+slot*4;if(!b||!b[at+3])return;const a=this.#previous&&Math.floor(this.#previous[at+3]!/8)===Math.floor(b[at+3]!/8)?this.#previous:b,t=this.#uniforms.uBlend!.value;
    return{x:a[at]!+(b[at]!-a[at]!)*t,y:a[at+1]!+(b[at+1]!-a[at+1]!)*t,z:a[at+2]!+(b[at+2]!-a[at+2]!)*t};}
  #pick(x:number,y:number){if(!this.#current)return;let best=-1,distance=matchMedia('(pointer:coarse)').matches?22**2:12**2,depth=Infinity;
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
    if(e.shiftKey&&e.key.startsWith('Arrow'))this.#pan(e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0,e.key==='ArrowUp'?1:e.key==='ArrowDown'?-1:0);
    else if(e.key==='Home')this.home();else if(e.key==='ArrowLeft')orbit?this.#orbit(-step,0):this.tilt(-step,0);
    else if(e.key==='ArrowRight')orbit?this.#orbit(step,0):this.tilt(step,0);
    else if(e.key==='ArrowUp')orbit?this.#orbit(0,-step):this.tilt(0,-step);
    else if(e.key==='ArrowDown')orbit?this.#orbit(0,step):this.tilt(0,step);
    else if(e.key==='+'||e.key==='=')this.zoom(.88);else if(e.key==='-')this.zoom(1.12);else used=false;
    if(used)e.preventDefault();
  };
  #orbit(x:number,y:number){this.#homeView=false;const offset=this.camera.position.clone().sub(this.controls.target),s=new THREE.Spherical().setFromVector3(offset);s.theta+=x;s.phi=Math.max(.02,Math.min(Math.PI-.02,s.phi+y));this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(s));this.controls.update();this.#changed();}
  #pan(x:number,y:number){this.#homeView=false;const scale=this.camera.position.distanceTo(this.controls.target)*.035;this.#right.set(1,0,0).applyQuaternion(this.camera.quaternion).multiplyScalar(x*scale);this.#up.set(0,1,0).applyQuaternion(this.camera.quaternion).multiplyScalar(y*scale);this.#right.add(this.#up);this.camera.position.add(this.#right);this.controls.target.add(this.#right);this.controls.update();this.#changed();}
  zoom(scale:number){this.#homeView=false;this.camera.position.sub(this.controls.target).multiplyScalar(scale).clampLength(3,45).add(this.controls.target);this.controls.update();this.#changed();}
  #contextLost=(e:Event)=>{e.preventDefault();this.lost=true;this.#prepared=false;this.#preparation++;this.stage.dataset.graphicsReady='false';if(this.#frame!==undefined)cancelAnimationFrame(this.#frame);this.#frame=undefined;this.onContext(true);};
  #contextRestored=()=>{if(this.#disposed)return;this.lost=false;this.#textures.forEach(t=>t.needsUpdate=true);this.#birthTexture.needsUpdate=true;this.#selected.needsUpdate=true;void this.prepare().then(()=>{if(this.#disposed||this.lost)return;this.onContext(false);this.#changed();}).catch(()=>{this.lost=true;this.onContext(true);});};
  #visibility=()=>{this.#quality.resetSamples();if(document.hidden){if(this.#frame!==undefined)cancelAnimationFrame(this.#frame);this.#frame=undefined;}else{this.#lastDraw=0;this.#resized();this.#changed();}};
  #request(){if(this.#prepared&&this.#frame===undefined&&!this.#disposed&&!this.lost&&!document.hidden)this.#frame=requestAnimationFrame(this.#draw);}
  #draw=(now:number)=>{this.#frame=undefined;if(this.#disposed||this.lost||document.hidden)return;
    const time=this.paused?this.#pauseTime:now,blend=Math.min(1,Math.max(0,(time-this.#received)/this.#frameSpan));this.#uniforms.uBlend!.value=blend;this.#uniforms.uTime!.value=time/1000;
    const effects=!this.paused&&now<this.#effectUntil&&displayPreferences().effects!=='minimal';
    if(this.#nozzleLight)this.#nozzleLight.opacity=.2+Math.max(0,1-(time/1000-this.#emitTime)/.7)*.8*this.#uniforms.uMotion!.value;
    if(this.#pitLight)this.#pitLight.opacity=.16+Math.max(0,1-(time/1000-this.#drainTime)/1.2)*.7*this.#uniforms.uMotion!.value;
    this.#laneLights.forEach((material,kind)=>{material.opacity=.28+Math.max(0,1-(time/1000-this.#laneTimes[kind]!)/.7)*.72*this.#uniforms.uMotion!.value;});
    this.#uniforms.uDrainEnergy!.value=Math.max(0,1-(time/1000-this.#drainTime)/1.4)*this.#uniforms.uMotion!.value;
    if(this.#previous&&this.#current){this.#poseA.set(this.#previous[8]!,this.#previous[9]!,this.#previous[10]!,this.#previous[11]!);this.#poseB.set(this.#current[8]!,this.#current[9]!,this.#current[10]!,this.#current[11]!);this.box.quaternion.copy(this.#poseA).slerp(this.#poseB,blend);}
    const moved=this.controls.update();
    if(this.#dirty||moved||blend<1||effects){const started=performance.now();this.gpu.render(this.scene,this.camera);this.#drawMs=performance.now()-started;this.#visualFrames++;const frameMs=this.#lastDraw?now-this.#lastDraw:0;if(this.#lastDraw)this.#maxFrameGap=Math.max(this.#maxFrameGap,frameMs);this.#lastDraw=now;this.#dirty=false;
      this.stage.dataset.drawMs=this.#drawMs.toFixed(2);this.stage.dataset.frameSpanMs=this.#frameSpan.toFixed(2);
      this.stage.dataset.renderFrames=String(this.#visualFrames);this.stage.dataset.drawCalls=String(this.gpu.info.render.calls);this.stage.dataset.geometries=String(this.gpu.info.memory.geometries);this.stage.dataset.textures=String(this.gpu.info.memory.textures);this.stage.dataset.programs=String(this.gpu.info.programs?.length??0);
      // Idle/paused snapshots are intentionally infrequent, not slow frames.
      if(displayPreferences().quality==='auto'&&!this.paused&&(moved||effects||(this.#current&&this.#current[0]!>this.#current[3]!))
        &&this.#quality.sample(frameMs,this.#drawMs))this.#resized();}
    if(moved||(!this.paused&&blend<1)||effects)this.#request();
  };
  get graphicsReady(){return this.#prepared&&!this.lost;}
  get metrics(){return{frames:this.#visualFrames,maxFrameGap:this.#maxFrameGap,drawCalls:this.gpu.info.render.calls,geometries:this.gpu.info.memory.geometries,textures:this.gpu.info.memory.textures,programs:this.gpu.info.programs?.length??0,capacity:this.capacity,impacts:this.#impactIndex};}
  destroy(){this.#disposed=true;if(this.#frame!==undefined)cancelAnimationFrame(this.#frame);this.#resize.disconnect();this.controls.removeEventListener('change',this.#changed);this.controls.removeEventListener('start',this.#navigate);this.controls.dispose();
    this.canvas.removeEventListener('pointerdown',this.#down);this.canvas.removeEventListener('pointermove',this.#move);this.canvas.removeEventListener('pointerup',this.#release);this.canvas.removeEventListener('pointercancel',this.#cancel);
    this.canvas.removeEventListener('webglcontextlost',this.#contextLost);this.canvas.removeEventListener('webglcontextrestored',this.#contextRestored);this.stage.removeEventListener('keydown',this.#key);document.removeEventListener('visibilitychange',this.#visibility);
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
    this.scene.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.Points||object instanceof THREE.LineSegments){geometries.add(object.geometry);for(const m of Array.isArray(object.material)?object.material:[object.material])materials.add(m);}else if(object instanceof THREE.Sprite)materials.add(object.material);});
    geometries.forEach(g=>g.dispose());this.#materials.forEach(m=>materials.add(m));materials.forEach(m=>m.dispose());this.#textures.forEach(t=>t.dispose());this.#birthTexture.dispose();this.#canvasTextures.forEach(t=>t.dispose());this.#surfaces.dispose();this.gpu.dispose();this.gpu.forceContextLoss();this.#previous=undefined;this.#current=undefined;
  }
}
