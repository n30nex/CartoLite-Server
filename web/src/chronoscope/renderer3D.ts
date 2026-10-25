import * as THREE from 'three';
import { fitSceneCamera, sceneViewport } from '../sceneFraming';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DISPLAY_EVENT, displayColor, displayPreferences, lightScene, packetPalette, prefersReducedMotion } from '../displayPreferences';
import { drawPacketSignature, routeMotion } from '../packetAnimator';
import { normalizePacketKind, packetSignature, payloadColor } from '../trafficVisuals';
import { buildNetgraphLayout, extendNetgraphLayout, graphTopologyChanged, routeTopology } from '../netgraph/layout';
import { nearestNetgraphArea, type NetgraphAreaAnchor } from '../netgraph/areas';
import { distanceToGraphPath } from '../netgraph/camera';
import type { MapChanges } from '../state';
import type { EndpointV2, NodeV2, PacketView, StateV2 } from '../types';
import type { SurfacePoint } from '../terrainProjection';
import { ChronoscopeTimeline, MAX_EVENTS, MAX_SEGMENTS, type ChronoscopeMode, type Observation } from './timeline';
import { SculptureDots, SculptureStrokes, type Position3 } from './batches';

const NOW=5, kinds=['Advert','Trace','Text','ACK','Control','Other'] as const;
const roleColors={repeater:'#67ead2',companion:'#78cfff',room_server:'#d694ff',sensor:'#ffd06c',unknown:'#a6b4bf'};
interface StackNode { endpoint:EndpointV2; dx:number; dz:number; height:number }
interface Stack { nodes:Map<string,StackNode>; fallMs:number }

/** Real 3D projection with bounded, batched packet sculptures and a fixed layout. */
export class Chronoscope3DRenderer {
  readonly timeline=new ChronoscopeTimeline(true);
  readonly scene=new THREE.Scene();readonly camera=new THREE.PerspectiveCamera(42,1,.05,200);
  readonly gpu:THREE.WebGLRenderer;readonly controls:OrbitControls;
  readonly #overlay:CanvasRenderingContext2D;readonly #resize:ResizeObserver;
  readonly #uniforms:Record<string,THREE.IUniform>={uResolution:{value:new THREE.Vector2(1,1)},uDpr:{value:1},uLight:{value:0},uPattern:{value:0}};
  readonly #strokes=new SculptureStrokes(MAX_SEGMENTS*2+1536,this.#uniforms);
  readonly #dots=new SculptureDots(MAX_SEGMENTS*3+MAX_EVENTS*2,this.#uniforms);
  #known=new SculptureDots(16,this.#uniforms);
  #frameGeometry=new THREE.Group();#floorMaterial=new THREE.MeshStandardMaterial({color:0x0b2230,roughness:.8,metalness:.15});
  #layout=buildNetgraphLayout([],[]);#nodes=new Map<string,NodeV2>();#assignments=new Map<string,NetgraphAreaAnchor>();#topology=new Map<string,string>();
  #regions:Set<string>|null=null;#selected:string|null=null;#selectedEvent:number|null=null;
  #mode:ChronoscopeMode='sculpture';#seconds=60;#slice=0;#framed=false;#originX=0;#originZ=0;#scale=1;
  #stacks=new Map<Observation,Stack>();#levels=new Map<string,{next:number;refs:number}>();
  #frame=0;#timer=0;#prepared=false;#disposed=false;#lost=false;#resumeAfterContext=false;
  #homeView=true;#frameLayout='';
  readonly #volume=new THREE.Box3(new THREE.Vector3(-6.5,-.3,-4.5),new THREE.Vector3(6.5,5.3,4.5));
  #width=1;#height=1;#dpr=1;#reduced=false;#drawMS=0;#lastStats=0;#frames=0;
  #palette:THREE.Color[]=[];#roles=new Map<string,THREE.Color>();#accent=new THREE.Color('#ffd06c');#shadow=new THREE.Color('#020a10');
  #a:Position3={x:0,y:0,z:0};#b:Position3={x:0,y:0,z:0};#c:Position3={x:0,y:0,z:0};#vector=new THREE.Vector3();
  #down?:{x:number;y:number;id:number};#dragged=false;
  #signatures:Array<{record:Observation;x:number;y:number;dx:number;dy:number;age:number}>=[];
  #sculpturePose?:{position:THREE.Vector3;target:THREE.Vector3;zoom:number;home:boolean;view:THREE.PerspectiveCamera['view']};
  constructor(readonly stage:HTMLElement,readonly canvas:HTMLCanvasElement,readonly effects:HTMLCanvasElement,
    readonly callbacks:{node(id:string|null):void;packet(record:Observation):void;change?():void},context:WebGL2RenderingContext){
    const overlay=effects.getContext('2d');if(!overlay)throw new Error('Canvas labels are unavailable');this.#overlay=overlay;
    this.gpu=new THREE.WebGLRenderer({canvas,context,antialias:true,alpha:false,powerPreference:'high-performance'});this.gpu.outputColorSpace=THREE.SRGBColorSpace;this.gpu.toneMapping=THREE.ACESFilmicToneMapping;
    this.controls=new OrbitControls(this.camera,stage);this.controls.enableDamping=true;this.controls.dampingFactor=.12;this.controls.minDistance=3;this.controls.maxDistance=65;this.controls.minPolarAngle=.03;this.controls.maxPolarAngle=Math.PI-.03;
    this.controls.addEventListener('change',this.request);this.controls.addEventListener('start',this.manualNavigate);
    this.scene.add(this.#strokes.mesh,this.#dots.mesh,this.#known.mesh);
    this.scene.add(new THREE.HemisphereLight(0xd6f4ff,0x09232f,2));const key=new THREE.DirectionalLight(0xd5f7ff,2.4);key.position.set(-6,9,7);this.scene.add(key);
    const plinth=new THREE.Mesh(new THREE.BoxGeometry(13,.14,9),this.#floorMaterial);plinth.position.y=-.12;this.scene.add(plinth);
    const volume=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(12.5,NOW,8.5)),new THREE.LineBasicMaterial({color:0x6dc8c8,transparent:true,opacity:.18}));volume.position.y=NOW/2;this.#frameGeometry.add(volume);
    const grid=new THREE.GridHelper(12.5,24,0x3f9ea2,0x1b5360);grid.scale.z=8.5/12.5;grid.position.y=NOW;(grid.material as THREE.Material).transparent=true;(grid.material as THREE.Material).opacity=.18;this.#frameGeometry.add(grid);this.scene.add(this.#frameGeometry);
    stage.addEventListener('pointerdown',this.pointerDown);stage.addEventListener('pointermove',this.pointerMove);stage.addEventListener('pointerup',this.pointerUp);stage.addEventListener('pointercancel',this.pointerCancel);stage.addEventListener('keydown',this.keydown);
    canvas.addEventListener('webglcontextlost',this.contextLost);canvas.addEventListener('webglcontextrestored',this.contextRestored);
    window.addEventListener(DISPLAY_EVENT,this.appearance);document.addEventListener('visibilitychange',this.visibility);
    this.#resize=new ResizeObserver(this.resize);this.#resize.observe(stage);for(const node of document.querySelectorAll('.controls,.chrono-caption'))this.#resize.observe(node);this.appearance();this.home();this.resize();
  }
  async prepare(){await this.gpu.compileAsync(this.scene,this.camera);if(this.#disposed||this.#lost)return;this.#prepared=true;this.stage.dataset.graphicsReady='true';this.request();}
  get nodes():ReadonlyMap<string,NodeV2>{return this.#nodes;}get regions(){return this.#layout.areas;}get selected(){return this.#selected;}
  get mode(){return this.#mode;}get seconds(){return this.#seconds;}get sliceSeconds(){return this.#slice;}get frozen(){return this.timeline.frozen;}
  get frameTime(){return this.timeline.clock(performance.now());}
  get settledCount(){const at=this.frameTime;return this.visibleRecords().filter(record=>this.drop(record,at)>=1).length;}
  get metrics(){return{frames:this.#frames,drawCalls:this.gpu.info.render.calls,geometries:this.gpu.info.memory.geometries,textures:this.gpu.info.memory.textures,stackRecords:this.#stacks.size,stackNodes:this.#levels.size};}
  setAssignments(value:Map<string,NetgraphAreaAnchor>){this.#assignments=value;}
  render(state:Readonly<StateV2>,changes:MapChanges|null){
    if(!changes)return;const started=performance.now();
    const changed=changes.reset||changes.nodes?.some(node=>!this.#nodes.has(node.id))||graphTopologyChanged(this.#topology,changes.routes??[],state.routes.length);
    if(changes.reset||this.#nodes.size!==state.nodes.length)this.#nodes=new Map(state.nodes.map(node=>[node.id,node]));else for(const node of changes.nodes??[])this.#nodes.set(node.id,node);
    if(changed){this.#layout=extendNetgraphLayout(this.#layout,state.nodes,state.routes,this.#assignments,true);this.#topology=routeTopology(state.routes);this.frameBounds();}
    if(changed||changes.nodes?.length)this.updateKnown();this.request();Object.assign(this.stage.dataset,{totalNodes:String(state.nodes.length),totalRoutes:String(state.routes.length),renderApplyMs:String(performance.now()-started),renderState:'idle'});
  }
  setMode(mode:ChronoscopeMode){
    if(this.#mode==='sculpture'&&mode!=='sculpture')this.#sculpturePose={position:this.camera.position.clone(),target:this.controls.target.clone(),zoom:this.camera.zoom,home:this.#homeView,view:this.camera.view?{...this.camera.view}:null};
    const changed=this.#mode!==mode;this.#mode=mode;if(mode==='slice')this.freeze();
    this.controls.enableRotate=mode==='sculpture';this.controls.minPolarAngle=mode==='sculpture'?.03:0;this.controls.mouseButtons.LEFT=mode==='sculpture'?THREE.MOUSE.ROTATE:THREE.MOUSE.PAN;this.controls.touches.ONE=mode==='sculpture'?THREE.TOUCH.ROTATE:THREE.TOUCH.PAN;
    this.#frameGeometry.visible=mode==='sculpture';
    if(changed){if(mode==='sculpture'&&this.#sculpturePose){this.camera.position.copy(this.#sculpturePose.position);this.controls.target.copy(this.#sculpturePose.target);this.camera.zoom=this.#sculpturePose.zoom;this.camera.view=this.#sculpturePose.view?{...this.#sculpturePose.view}:null;this.#homeView=this.#sculpturePose.home;this.camera.updateProjectionMatrix();this.controls.update();if(this.#homeView){this.#frameLayout='';this.resize();}}else this.home();}
    this.updateKnown();this.request();
  }
  setWindow(seconds:number){this.#seconds=seconds;this.#slice=Math.min(this.#slice,seconds);this.request();}
  setSlice(seconds:number){this.#slice=seconds;this.freeze();this.request();}
  setRegions(regions:string[]|null){
    if(regions===null&&this.#regions===null||regions!==null&&this.#regions?.size===regions.length&&regions.every(code=>this.#regions!.has(code)))return;
    this.#regions=regions===null?null:new Set(regions);this.#framed=false;this.frameBounds();this.home();
    if(this.#selectedEvent!==null||this.#selected&&!this.nodeInRegions(this.#selected))this.callbacks.node(null);
    this.updateKnown();this.request();
  }
  nodeInRegions(id:string){return !this.#regions||this.#regions.has(this.#layout.positions.get(id)?.areaCode??this.#assignments.get(id)?.code??'');}
  selectNode(id:string|null){this.#selected=id;this.#selectedEvent=null;this.updateKnown();this.request();}
  selectPacket(record:Observation){this.#selectedEvent=record.packet.seq;this.#selected=null;this.updateKnown();this.request();}
  focusNode(id:string){this.#homeView=false;const node=this.#nodes.get(id);if(!node||!this.world(node,this.#a))return;const delta=this.camera.position.clone().sub(this.controls.target);this.controls.target.set(this.#a.x,this.#a.y,this.#a.z);this.camera.position.copy(this.controls.target).add(delta);this.controls.update();this.request();}
  home(){const damping=this.controls.enableDamping;this.controls.enableDamping=false;this.controls.update();this.controls.enableDamping=damping;this.#homeView=true;this.#frameLayout='';this.#framed=false;this.frameBounds();if(this.#mode==='sculpture'){this.camera.position.set(11,10,15);this.controls.target.set(0,2.25,0);}else{this.camera.clearViewOffset();this.camera.position.set(0,19,.001);this.controls.target.set(0,.1,0);}this.controls.update();this.resize();this.updateKnown();this.request();}
  panBy(x:number,y:number){this.#homeView=false;const scale=this.camera.position.distanceTo(this.controls.target)/Math.max(100,this.#height);const right=new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion).multiplyScalar(x*scale),up=new THREE.Vector3(0,1,0).applyQuaternion(this.camera.quaternion).multiplyScalar(-y*scale);right.add(up);this.camera.position.add(right);this.controls.target.add(right);this.controls.update();this.request();}
  zoomBy(factor:number){this.#homeView=false;this.camera.position.sub(this.controls.target).multiplyScalar(1/factor).clampLength(3,65).add(this.controls.target);this.controls.update();this.request();}
  rotateBy(delta:number,pitch=0){this.#homeView=false;if(this.#mode!=='sculpture')return;const offset=this.camera.position.clone().sub(this.controls.target),spherical=new THREE.Spherical().setFromVector3(offset);spherical.theta+=delta;spherical.phi=Math.max(.03,Math.min(Math.PI-.03,spherical.phi+pitch));this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(spherical));this.controls.update();this.request();}
  freeze(){this.timeline.freeze(performance.now());this.navigate();this.request();this.callbacks.change?.();}
  live(){this.timeline.resume();this.#selectedEvent=null;this.request();this.callbacks.change?.();}
  clear(){this.timeline.clear();this.#stacks.clear();this.#levels.clear();this.#selectedEvent=null;this.request();this.callbacks.change?.();}
  addPacket(packet:PacketView):Observation|undefined{if(document.hidden)return;const record=this.timeline.add(packet,performance.now());if(!this.frozen)this.request();return record;}
  visibleRecords():readonly Observation[]{return this.timeline.visible(performance.now(),this.#seconds,this.#mode==='sculpture').filter(record=>this.matches(record));}
  inspectionRecords():readonly Observation[]{const at=this.frameTime;return this.visibleRecords().filter(record=>this.#mode!=='slice'||Math.abs((at-record.started)/1000-this.#slice)<=2);}
  matches(record:Observation){return record.packet.mode==='observer'?this.nodeInRegions(record.packet.observer.id):record.packet.segments.some(segment=>this.nodeInRegions(segment.from.id)&&this.nodeInRegions(segment.to.id));}
  project(coordinates:[number,number]){const node=[...this.#nodes.values()].find(node=>node.lng===coordinates[0]&&node.lat===coordinates[1]);return node?this.projectEndpoint(node):{x:-10000,y:-10000};}
  projectEndpoint(endpoint:EndpointV2){if(!this.nodeInRegions(endpoint.id)||!this.world(endpoint,this.#a))return{x:-10000,y:-10000};return this.screen(this.#a);}
  projectSegment(segment:{from:EndpointV2;to:EndpointV2}):readonly SurfacePoint[]{if(!this.nodeInRegions(segment.from.id)||!this.nodeInRegions(segment.to.id))return[];return[{...this.projectEndpoint(segment.from),progress:0},{...this.projectEndpoint(segment.to),progress:1}];}
  private frameBounds(){
    if(this.#framed)return;let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const [id,point] of this.#layout.positions){if(!this.nodeInRegions(id))continue;minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);}
    if(!Number.isFinite(minX)){const bounds=this.#layout.bounds;minX=bounds.minX;maxX=bounds.maxX;minY=bounds.minY;maxY=bounds.maxY;}
    const padding=Math.max(12,Math.max(maxX-minX,maxY-minY)*.08);minX-=padding;maxX+=padding;minY-=padding;maxY+=padding;
    this.#originX=(minX+maxX)/2;this.#originZ=(minY+maxY)/2;this.#scale=Math.min(12/Math.max(1,maxX-minX),8/Math.max(1,maxY-minY));this.#framed=this.#layout.positions.size>0;
  }
  private world(endpoint:EndpointV2,out:Position3):boolean{
    let point:{x:number;y:number}|undefined=this.#layout.positions.get(endpoint.id);
    if(!point){const area=this.#assignments.get(endpoint.id)??nearestNetgraphArea(endpoint.lat,endpoint.lng);point=this.#layout.areas.find(candidate=>candidate.code===area.code);}
    if(!point)return false;out.x=(point.x-this.#originX)*this.#scale;out.z=(point.y-this.#originZ)*this.#scale;out.y=this.#mode==='sculpture'?NOW:.1;return true;
  }
  private screen(p:Position3){this.#vector.set(p.x,p.y,p.z).project(this.camera);return{x:(this.#vector.x+1)*this.#width/2,y:(1-this.#vector.y)*this.#height/2,z:this.#vector.z};}
  private stack(record:Observation):Stack{
    let stack=this.#stacks.get(record);if(stack)return stack;
    stack={nodes:new Map(),fallMs:this.#seconds*1000};
    const add=(endpoint:EndpointV2)=>{if(stack!.nodes.has(endpoint.id))return;let level=this.#levels.get(endpoint.id);if(!level){level={next:0,refs:0};this.#levels.set(endpoint.id,level);}const slot=level.next++%MAX_EVENTS,ring=slot%6,angle=ring*2.399963,radius=Math.sqrt(ring)*.045;level.refs++;stack!.nodes.set(endpoint.id,{endpoint,dx:Math.cos(angle)*radius,dz:Math.sin(angle)*radius,height:.12+2.55*(1-Math.exp(-Math.floor(slot/6)*.07))});};
    if(record.packet.mode==='observer')add(record.packet.observer);else for(const segment of record.packet.segments){add(segment.from);add(segment.to);}
    this.#stacks.set(record,stack);return stack;
  }
  private drop(record:Observation,at:number){if(!record.animate||this.#reduced)return 1;return Math.max(0,Math.min(1,(at-record.started-record.duration)/this.stack(record).fallMs));}
  private packetPoint(record:Observation,node:StackNode,at:number,out:Position3){if(!this.world(node.endpoint,out))return false;if(this.#mode==='sculpture'){const t=this.drop(record,at);out.x+=node.dx*t;out.z+=node.dz*t;out.y=NOW+(node.height-NOW)*t;}return true;}
  private trimStacks(){const retained=new Set(this.timeline.records);if(this.frozen)for(const record of this.timeline.visible(this.frameTime,this.#seconds,true))retained.add(record);for(const[record,stack]of this.#stacks)if(!retained.has(record)){for(const id of stack.nodes.keys()){const level=this.#levels.get(id);if(level&&!--level.refs)this.#levels.delete(id);}this.#stacks.delete(record);}}
  private updateKnown(){
    if(this.#known.capacity<this.#nodes.size){this.scene.remove(this.#known.mesh);this.#known.dispose();this.#known=new SculptureDots(2**Math.ceil(Math.log2(Math.max(16,this.#nodes.size))),this.#uniforms);this.scene.add(this.#known.mesh);}
    this.#known.count=0;for(const node of this.#nodes.values()){if(!this.nodeInRegions(node.id)||!this.world(node,this.#a))continue;const selected=node.id===this.#selected;this.#known.add(this.#a,selected?this.#accent:this.#roles.get(node.role)??this.#shadow,selected?1:.24,selected?8:3);}
    this.#known.upload();
  }
  private ring(center:Position3,radius:number,color:THREE.Color,alpha:number){let x=center.x+radius,z=center.z;for(let i=1;i<=16;i++){const angle=i*Math.PI/8,nx=center.x+Math.cos(angle)*radius,nz=center.z+Math.sin(angle)*radius;this.#a.x=x;this.#a.y=center.y;this.#a.z=z;this.#b.x=nx;this.#b.y=center.y;this.#b.z=nz;this.#strokes.add(this.#a,this.#b,color,alpha,1.2);x=nx;z=nz;}}
  private draw=(now:number)=>{
    this.#frame=0;if(this.#timer){clearTimeout(this.#timer);this.#timer=0;}if(this.#disposed||this.#lost||document.hidden||!this.#prepared)return;const started=performance.now(),prefs=displayPreferences(),reduced=prefersReducedMotion(),at=this.frameTime;
    this.#reduced=reduced;this.controls.update();this.trimStacks();const records=this.inspectionRecords();this.#strokes.count=this.#dots.count=0;this.#signatures.length=0;let active=0,settled=0,moving=false,rings=0,glows=0,shadows=0;
    const background=prefs.detail==='complete'?1:Math.max(.25,Math.min(1,Math.sqrt(70/Math.max(1,records.length))));
    for(const record of records){
      const stack=this.stack(record),age=Math.max(0,at-record.started),fresh=record.animate&&age<record.duration+440,down=this.drop(record,at);if(down>=1)settled++;else moving=true;if(fresh&&!this.frozen)active++;
      const selected=this.#selectedEvent===record.packet.seq||Boolean(this.#selected&&stack.nodes.has(this.#selected));const dimmed=(this.#selected||this.#selectedEvent!==null)&&!selected;
      const kind=kinds.indexOf(normalizePacketKind(record.packet.payloadType)),color=this.#palette[kind]!,opacity=dimmed?.07:selected?1:fresh?.95:background*(this.#mode==='sculpture'?.68:Math.max(.15,.7*(1-age/(this.#seconds*1000))));
      for(const node of stack.nodes.values())if(this.nodeInRegions(node.endpoint.id)&&this.packetPoint(record,node,at,this.#a))this.#dots.add(this.#a,selected?this.#accent:color,opacity,(fresh?6.5:4.6)*prefs.packetSize);
      if(record.packet.mode==='route'){
        for(const segment of record.packet.segments){if(!this.nodeInRegions(segment.from.id)||!this.nodeInRegions(segment.to.id))continue;
          if(!this.packetPoint(record,stack.nodes.get(segment.from.id)!,at,this.#a)||!this.packetPoint(record,stack.nodes.get(segment.to.id)!,at,this.#b))continue;
          if(!reduced&&prefs.effects!=='minimal'&&prefs.quality!=='economy'&&(fresh||selected)&&glows++<512)this.#strokes.add(this.#a,this.#b,color,.16*prefs.glow*(prefs.effects==='calm'?.4:1),Math.max(1.4,prefs.width)+Math.min(7,4*prefs.glow),true);
          this.#strokes.add(this.#a,this.#b,selected?this.#accent:color,opacity*prefs.opacity,Math.max(this.#mode==='sculpture'?2.3:1.4,prefs.width)+(selected?1.2:0));
          if(this.#mode==='sculpture'&&down>=1&&prefs.quality!=='economy'&&shadows++<256){const ax=this.#a.x,az=this.#a.z,bx=this.#b.x,bz=this.#b.z;this.#a.x=ax+this.#a.y*.3;this.#a.z=az-this.#a.y*.35;this.#b.x=bx+this.#b.y*.3;this.#b.z=bz-this.#b.y*.35;this.#a.y=this.#b.y=.012;this.#strokes.add(this.#a,this.#b,this.#shadow,.14*background,5,true);}
        }
        if(fresh&&record.animate&&!dimmed){const motion=routeMotion(record.weights,age,record.duration),segment=record.packet.segments[motion.segmentIndex];if(segment&&this.nodeInRegions(segment.from.id)&&this.nodeInRegions(segment.to.id)&&this.world(segment.from,this.#a)&&this.world(segment.to,this.#b)){
          const t=reduced?.5:motion.localProgress;this.#c.x=this.#a.x+(this.#b.x-this.#a.x)*t;this.#c.y=this.#a.y;this.#c.z=this.#a.z+(this.#b.z-this.#a.z)*t;this.#dots.add(this.#c,color,1,9*prefs.packetSize);
          if(!reduced&&prefs.effects!=='minimal'){const point=this.screen(this.#c),from=this.screen(this.#a),to=this.screen(this.#b);if(point.z>=-1&&point.z<=1){this.#signatures.push({record,x:point.x,y:point.y,dx:to.x-from.x,dy:to.y-from.y,age});if(this.#signatures.length>32)this.#signatures.shift();}}
          if(!reduced&&prefs.effects!=='minimal'){const tail=Math.max(0,t-.13*prefs.trailLength);this.#a.x+= (this.#b.x-this.#a.x)*tail;this.#a.z+=(this.#b.z-this.#a.z)*tail;this.#strokes.add(this.#a,this.#c,color,.9,2.8*prefs.packetSize);}
        }}
      }
      if(fresh&&!reduced&&prefs.effects!=='minimal'&&rings<32){const node=stack.nodes.values().next().value as StackNode|undefined;if(node&&this.nodeInRegions(node.endpoint.id)&&this.world(node.endpoint,this.#c)){const phase=age/700;if(phase<1){this.ring(this.#c,.08+phase*.3,color,(1-phase)*.6);rings++;}}}
    }
    this.#strokes.upload();this.#dots.upload();this.gpu.render(this.scene,this.camera);this.labels();this.#frames++;this.#drawMS=this.#drawMS*.85+(performance.now()-started)*.15;
    Object.assign(this.stage.dataset,{mode:this.#mode,frozen:String(this.frozen),eventCount:String(this.timeline.records.length),segmentCount:String(this.timeline.segmentCount),visibleEvents:String(records.length),activeCount:String(active),settledCount:String(settled),motionMode:reduced?'static':'animated',renderer:'webgl2',cameraMode:this.#mode==='sculpture'?'orbit':'flat',drawMs:this.#drawMS.toFixed(2),drawCalls:String(this.gpu.info.render.calls),windowSeconds:String(this.#seconds)});
    if(now-this.#lastStats>500){this.#lastStats=now;this.callbacks.change?.();}
    if(!this.#frame&&records.length&&!this.frozen){const delay=!reduced&&(moving||active)?prefs.quality==='economy'||this.#drawMS>12?33:16:1000;this.#timer=window.setTimeout(()=>{this.#timer=0;this.request();},delay);}
  };
  private labels(){const c=this.#overlay;c.setTransform(this.#dpr,0,0,this.#dpr,0,0);c.clearRect(0,0,this.#width,this.#height);for(const sign of this.#signatures)drawPacketSignature(c,{x:sign.x,y:sign.y},{x:sign.dx,y:sign.dy},payloadColor(sign.record.packet.payloadType),packetSignature(sign.record.packet.payloadType),sign.age);c.font=`${displayPreferences().textSize==='large'?14:11}px system-ui`;const used:{x:number;y:number;w:number}[]=[];
    const label=(text:string,point:Position3,strong=false)=>{const p=this.screen(point);if(p.z< -1||p.z>1||p.x<24||p.x>this.#width-24||p.y<70||p.y>this.#height-80)return;const w=c.measureText(text).width;if(!strong&&used.some(v=>Math.abs(v.y-p.y)<18&&Math.abs(v.x-p.x)<(v.w+w)/2+12))return;used.push({x:p.x,y:p.y,w});c.fillStyle=lightScene()?'#f3f5ede6':'#07131ce6';c.fillRect(p.x-w/2-5,p.y-12,w+10,18);c.textAlign='center';c.fillStyle=strong?packetPalette().Trace:displayColor('#d2e0ef');c.fillText(text,p.x,p.y+1);};
    const selected=this.#selected&&this.#nodes.get(this.#selected);if(selected&&this.world(selected,this.#a))label(selected.label,this.#a,true);
    for(const area of this.#layout.areas){if(this.#regions&&!this.#regions.has(area.code))continue;this.#a.x=(area.x-this.#originX)*this.#scale;this.#a.z=(area.y-this.#originZ)*this.#scale;this.#a.y=this.#mode==='sculpture'?NOW+.18:.18;label(area.name??area.code,this.#a);}
    if(this.#mode==='sculpture'){label('NOW',{x:-6.25,y:NOW,z:4.25},true);label('SESSION SCULPTURE',{x:-5,y:.1,z:4.25},true);}
  }
  private resize=()=>{if(this.#disposed||document.hidden)return;this.#width=Math.max(1,this.stage.clientWidth);this.#height=Math.max(1,this.stage.clientHeight);const prefs=displayPreferences();this.#dpr=Math.min(devicePixelRatio||1,prefs.quality==='economy'?1:1.5);this.gpu.setPixelRatio(this.#dpr);this.gpu.setSize(this.#width,this.#height,false);this.effects.width=Math.round(this.#width*this.#dpr);this.effects.height=Math.round(this.#height*this.#dpr);this.camera.aspect=this.#width/this.#height;this.camera.updateProjectionMatrix();const frame=sceneViewport(this.stage),key=JSON.stringify(frame);if(this.#homeView&&key!==this.#frameLayout){this.#frameLayout=key;if(this.#mode==='sculpture')fitSceneCamera(this.camera,[this.#volume],frame);else{this.camera.zoom=Math.min(1,this.camera.aspect/1.1);this.camera.updateProjectionMatrix();}}this.#uniforms.uResolution!.value.set(this.#width*this.#dpr,this.#height*this.#dpr);this.#uniforms.uDpr!.value=this.#dpr;this.request();};
  private appearance=()=>{this.#reduced=prefersReducedMotion();const p=displayPreferences(),light=lightScene(),palette=packetPalette();this.#palette=kinds.map(kind=>new THREE.Color(palette[kind]));this.#accent.set(palette.Trace);this.#roles=new Map(Object.entries(roleColors).map(([role,color])=>[role,new THREE.Color(displayColor(color))]));this.#uniforms.uLight!.value=light?1:0;this.#uniforms.uPattern!.value=p.pattern==='dashed'?1:p.pattern==='dotted'?2:0;this.scene.background=new THREE.Color(light?(p.basemap==='streets'?'#e7dfc9':'#e7eff0'):'#071319');this.#floorMaterial.color.set(light?'#dbe5e6':'#0b2230');this.updateKnown();this.resize();this.request();};
  private request=()=>{if(this.#timer){clearTimeout(this.#timer);this.#timer=0;}if(!this.#frame&&!this.#disposed&&!this.#lost&&this.#prepared&&!document.hidden)this.#frame=requestAnimationFrame(this.draw);};
  private manualNavigate=()=>{this.#homeView=false;this.navigate();};
  private navigate=()=>{this.stage.dispatchEvent(new Event('graphnavigate'));};
  private visibility=()=>{if(document.hidden){if(this.#frame)cancelAnimationFrame(this.#frame);if(this.#timer)clearTimeout(this.#timer);this.#frame=this.#timer=0;}else this.request();};
  private pointerDown=(event:PointerEvent)=>{if(this.#down){this.#dragged=true;return;}this.#down={x:event.clientX,y:event.clientY,id:event.pointerId};this.#dragged=false;this.stage.focus({preventScroll:true});};
  private pointerMove=(event:PointerEvent)=>{if(this.#down&&Math.hypot(event.clientX-this.#down.x,event.clientY-this.#down.y)>5)this.#dragged=true;};
  private pointerCancel=()=>{this.#down=undefined;this.#dragged=true;};
  private pointerUp=(event:PointerEvent)=>{const down=this.#down;this.#down=undefined;if(!down||this.#dragged||down.id!==event.pointerId)return;const box=this.stage.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;
    for(const node of this.#nodes.values()){if(!this.nodeInRegions(node.id))continue;const p=this.projectEndpoint(node);if(Math.hypot(p.x-x,p.y-y)<9){this.callbacks.node(node.id);return;}}
    const at=this.frameTime;let hit:Observation|undefined,best=9;
    for(const record of this.inspectionRecords()){const stack=this.stack(record);if(record.packet.mode==='observer'){if(this.packetPoint(record,stack.nodes.get(record.packet.observer.id)!,at,this.#a)){const p=this.screen(this.#a),d=Math.hypot(p.x-x,p.y-y);if(d<best){best=d;hit=record;}}}else for(const segment of record.packet.segments){if(!this.nodeInRegions(segment.from.id)||!this.nodeInRegions(segment.to.id)||!this.packetPoint(record,stack.nodes.get(segment.from.id)!,at,this.#a)||!this.packetPoint(record,stack.nodes.get(segment.to.id)!,at,this.#b))continue;const a=this.screen(this.#a),b=this.screen(this.#b);if(a.z< -1||a.z>1||b.z< -1||b.z>1)continue;const d=distanceToGraphPath([a,b],x,y);if(d<best){best=d;hit=record;}}}
    if(hit)this.callbacks.packet(hit);else this.callbacks.node(null);
  };
  private keydown=(event:KeyboardEvent)=>{if(event.target!==this.stage)return;let used=true;switch(event.key){case'Home':this.home();break;case'+':case'=':this.zoomBy(1.12);break;case'-':this.zoomBy(1/1.12);break;case'ArrowLeft':event.shiftKey?this.rotateBy(-.12):this.panBy(24,0);break;case'ArrowRight':event.shiftKey?this.rotateBy(.12):this.panBy(-24,0);break;case'ArrowUp':event.shiftKey?this.rotateBy(0,-.12):this.panBy(0,24);break;case'ArrowDown':event.shiftKey?this.rotateBy(0,.12):this.panBy(0,-24);break;default:used=false;}if(used){event.preventDefault();this.navigate();}};
  private contextLost=(event:Event)=>{event.preventDefault();this.#lost=true;this.#prepared=false;this.#resumeAfterContext=!this.frozen;if(this.#resumeAfterContext)this.timeline.freeze(performance.now());this.stage.dataset.graphicsReady='false';if(this.#frame)cancelAnimationFrame(this.#frame);if(this.#timer)clearTimeout(this.#timer);this.#frame=this.#timer=0;this.callbacks.change?.();};
  private contextRestored=()=>{if(this.#disposed)return;this.#lost=false;void this.prepare().then(()=>{if(this.#disposed||this.#lost)return;if(this.#resumeAfterContext)this.timeline.resume();this.updateKnown();this.request();this.callbacks.change?.();}).catch(()=>{this.#lost=true;const fatal=document.getElementById('fatal');if(fatal){fatal.hidden=false;const text=fatal.querySelector('p');if(text)text.textContent='Graphics could not recover. Reload this view, or open Netgraph.';}});};
  destroy(){this.#disposed=true;if(this.#frame)cancelAnimationFrame(this.#frame);if(this.#timer)clearTimeout(this.#timer);this.#resize.disconnect();this.controls.removeEventListener('change',this.request);this.controls.removeEventListener('start',this.manualNavigate);this.controls.dispose();
    this.stage.removeEventListener('pointerdown',this.pointerDown);this.stage.removeEventListener('pointermove',this.pointerMove);this.stage.removeEventListener('pointerup',this.pointerUp);this.stage.removeEventListener('pointercancel',this.pointerCancel);this.stage.removeEventListener('keydown',this.keydown);this.canvas.removeEventListener('webglcontextlost',this.contextLost);this.canvas.removeEventListener('webglcontextrestored',this.contextRestored);window.removeEventListener(DISPLAY_EVENT,this.appearance);document.removeEventListener('visibilitychange',this.visibility);
    const geometry=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();this.scene.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.Points||object instanceof THREE.LineSegments){geometry.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}});geometry.forEach(item=>item.dispose());materials.forEach(item=>item.dispose());this.gpu.dispose();this.gpu.forceContextLoss();this.timeline.clear();this.#stacks.clear();this.#levels.clear();this.#nodes.clear();
  }
}
