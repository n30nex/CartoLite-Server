import './styles.css';
import '../networkControls.css';
import { required } from '../dom';
import { fetchState, LiveFeed } from '../api';
import { LiveStore, activityLabel } from '../state';
import { initializeDisplay, DISPLAY_EVENT, displayPreferences, prefersReducedMotion } from '../displayPreferences';
import { mountNetgraphDisplay } from '../displayControls';
import { mountCinematicDock } from '../cinematicChrome';
import { buildNodeInspectorModel, createNodeInspectorContent, searchNodes } from '../nodeInspector';
import { wireNodeSearch } from '../nodeSearch';
import { rememberNode, requestedNode, replaceInspector } from '../selection';
import { RouteSonifier, type SoundScene } from '../audio';
import { populateSoundScenes } from '../soundScenes';
import { updateSoundChrome } from '../soundControls';
import { mountSoundPreview } from '../soundPreview';
import { normalizePacketKind } from '../trafficVisuals';
import type { PacketView } from '../types';
import { FirehoseRenderer } from './renderer';
import { capacityFor, frameSize, MAX_PENDING, packetShape, pachinkoShape, KINDS, type MachineMode, type Input, type Output, type PacketShape } from './model';

const machine:MachineMode=document.documentElement.dataset.machine==='pachinko'?'pachinko':'firehose';
const pachinko=machine==='pachinko', title=pachinko?'Pachinko':'Firehose';
const stage=required(`${machine}-stage`),inspector=required('node-inspector-sheet');
let renderer:FirehoseRenderer|undefined,worker:Worker|undefined,store:LiveStore|undefined,feed:LiveFeed|undefined,sonifier:RouteSonifier|undefined;
let disposed=false,ready=false,connecting=false,connected=false,effectivePause=false,scenePaused=false,nextId=1,omitted=0;
let retryTimer:number|undefined,inspectorTimer:number|undefined,refreshSearch=()=>{},selectedNode:string|null=null;
const pending=new Map<number,{packet:PacketView;shape:PacketShape}>();
const events=new Map<number,{packet:PacketView;shape:PacketShape;slots:number[]}>();
let owners:Int32Array;
const coarsePointer=matchMedia('(pointer:coarse)');
initializeDisplay();scenePaused=prefersReducedMotion();let motionKey=`${displayPreferences().motion}:${prefersReducedMotion()}`;
const closeDisplay=mountNetgraphDisplay(()=>closePanels());
// Physical links have no time residue; the remaining shared styles apply directly.
for(const key of ['residueSeconds','detail'])document.querySelector(`[data-display="${key}"]`)?.closest('label')?.remove();
const note=document.querySelector<HTMLElement>('#display-panel .display-note');if(note)note.textContent=pachinko?'Shared colors, particle size, glow, trails, motion and text. One dot is one observed packet; lanes identify its category.':'Shared colours, link styles, effects, motion and text. Terminal keeps its own settings. Physics never changes which hops were confirmed.';
if(pachinko)for(const key of ['pattern','width','opacity'])document.querySelector(`[data-display="${key}"]`)?.closest('label')?.remove();
populateSoundScenes(required<HTMLSelectElement>('sound-scene'));
function post(message:Input,transfer:Transferable[]=[]){worker?.postMessage(message,transfer);}
function closePanels(except=''){for(const id of ['box','find','sound'])if(id!==except){required(`${id}-panel`).hidden=true;required(`${id}-button`).setAttribute('aria-expanded','false');}}
for(const id of ['box','find','sound']){
 const host=required(`${id}-control`),button=required(`${id}-button`),panel=required(`${id}-panel`);
 button.addEventListener('click',()=>{const open=panel.hidden;closePanels(id);closeDisplay();panel.hidden=!open;button.setAttribute('aria-expanded',String(open));if(open&&id==='find'){refreshSearch();required('node-search').focus();}});
 panel.querySelector('[data-close]')?.addEventListener('click',()=>{closePanels();button.focus();});
 document.addEventListener('pointerdown',e=>{if(e.target instanceof Node&&!host.contains(e.target)){panel.hidden=true;button.setAttribute('aria-expanded','false');}});
}
document.addEventListener('keydown',e=>{if(e.key!=='Escape'||document.querySelector('dialog[open]'))return;const open=['box','find','sound'].find(id=>!required(`${id}-panel`).hidden);if(open){closePanels();required(`${open}-button`).focus();}else if(!inspector.hidden){selectNode(null);stage.focus();}});
function setMode(mode:'tilt'|'orbit') {renderer?.setMode(mode);required('tilt-mode').setAttribute('aria-pressed',String(mode==='tilt'));required('orbit-mode').setAttribute('aria-pressed',String(mode==='orbit'));sync();}
function sync(){
 const count=Number(stage.dataset.beads??0),groups=Number(stage.dataset.events??0),drained=Number(stage.dataset.drained??0);
 const text=scenePaused?'Paused · no new packets are collected':!ready?'Starting the 3D scene…':!count?(pachinko?'Empty buckets. Waiting for live packets.':'An empty box. Waiting for live packets.'):pachinko?`${count.toLocaleString()} ${count===1?'packet':'packets'} · ${drained.toLocaleString()} drained${stage.dataset.draining==='true'?' · draining buckets':''}`:`${count.toLocaleString()} ${count===1?'particle':'particles'} · ${groups.toLocaleString()} ${groups===1?'packet':'packets'} · ${drained.toLocaleString()} drained`;
 if(pachinko){const counts=JSON.parse(stage.dataset.buckets??'[0,0,0,0,0,0]') as number[];for(let i=0;i<6;i++){const output=document.querySelector<HTMLOutputElement>(`[data-bucket="${KINDS[i]}"]`);if(output&&output.value!==String(counts[i]??0))output.value=String(counts[i]??0);}}
 if(required('pile-status').textContent!==text){required('pile-status').textContent=text;required('pile-status').title=text;}
 const touch=coarsePointer.matches;const hint=scenePaused?'Drag to inspect · Resume for new packets':renderer?.mode==='orbit'?(touch?'Drag to orbit · Two fingers pan/zoom':'Drag to orbit · Right-drag to pan · Scroll to zoom'):(touch?'Drag to tilt · Pinch to zoom':'Drag to tilt · Scroll to zoom');if(required('gesture-hint').textContent!==hint)required('gesture-hint').textContent=hint;
 const cap=omitted?`${omitted.toLocaleString()} events omitted at the detail cap · never replayed`:'';if(required('capacity-status').textContent!==cap)required('capacity-status').textContent=cap;
 const button=required('pause-button'),label=scenePaused?'Resume':'Pause';if(button.getAttribute('aria-pressed')!==String(scenePaused))button.setAttribute('aria-pressed',String(scenePaused));button.setAttribute('aria-label',scenePaused?'Resume physics and new packets':'Pause physics and new packets');if(button.querySelector('span')!.textContent!==label)button.querySelector('span')!.textContent=label;
 stage.dataset.paused=String(scenePaused);stage.dataset.clientOmitted=String(omitted);
 if(store){const activity=activityLabel(store.snapshot,connected);required('status').dataset.state=activity.state;if(required('status-text').textContent!==activity.text)required('status-text').textContent=activity.text;}
}
function pause(){const value=scenePaused||document.hidden||!renderer?.graphicsReady;if(value!==effectivePause||!ready){effectivePause=value;post({type:'pause',paused:value});}renderer?.setPaused(value);sonifier?.setPaused(value);sync();}
function resumeMotion(){scenePaused=false;pause();}
function selectNode(id:string|null){
 selectedNode=id;rememberNode(id);renderer?.highlight([]);if(!id||!store){inspector.hidden=true;return;}
 const nodes=new Map(store.snapshot.nodes.map(n=>[n.id,n]));const model=buildNodeInspectorModel(id,nodes,store.snapshot.routes,Date.now(),15*60_000);if(!model){inspector.hidden=true;return;}
 replaceInspector(inspector,createNodeInspectorContent(document,model,{windowLabel:'15 min',onClose:()=>selectNode(null),onSelectNeighbor:selectNode}));
 const slots:number[]=[];for(const event of events.values()){if(pachinko){if(event.shape.nodes.includes(id))slots.push(event.slots[0]!);}else event.shape.nodes.forEach((node,i)=>{if(node===id)slots.push(event.slots[i]!);});}renderer?.highlight(slots);
 const p=document.createElement('p');p.className='firehose-selection-note';p.textContent=slots.length?`${slots.length} ${pachinko?'packets involving':'particles from'} this node are in this session's ${pachinko?'machine':'pile'}.`:'No dot from this node is in this session’s pile yet.';inspector.append(p);
 const links=document.createElement('div');links.className='chrono-links';for(const [label,path]of [['Open Map','/'],['Open Netgraph','/netgraph/']]as const){const a=document.createElement('a');a.textContent=label;a.href=`${path}?node=${encodeURIComponent(id)}`;links.append(a);}inspector.append(links);inspector.hidden=false;
}
function inspect(id:number){const event=events.get(id);if(!event)return;selectedNode=null;rememberNode(null);renderer?.highlight(event.slots);
 const card=document.createElement('article');card.className='chrono-inspector';const header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');title.textContent=`${normalizePacketKind(event.packet.payloadType)} · observed packet`;close.textContent='×';close.type='button';close.className='node-inspector-close';close.setAttribute('aria-label','Close packet details');close.addEventListener('click',()=>{inspector.hidden=true;renderer?.highlight([]);stage.focus();});header.append(title,close);card.append(header);
 const detail=document.createElement('p');detail.textContent=event.packet.mode==='observer'?'Observer-only reception. A single dot does not imply a confirmed route.':`${event.packet.segments.length} confirmed ${event.packet.segments.length===1?'segment':'segments'}. The physical arrangement is not geography or a radio trajectory.`;card.append(detail);
 const node=(id:string,label:string)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.nodeId=id;b.addEventListener('click',()=>selectNode(id));return b;};
 if(event.packet.mode==='observer')card.append(node(event.packet.observer.id,event.packet.observer.label));
 else for(const edge of event.packet.segments){const row=document.createElement('div');row.className='chrono-hop';const arrow=document.createElement('span');arrow.textContent='→';row.append(node(edge.from.id,edge.from.label),arrow,node(edge.to.id,edge.to.label));card.append(row);}
 replaceInspector(inspector,card);inspector.hidden=false;close.focus({preventScroll:true});
}
function acceptPacket(packet:PacketView){if(!ready||effectivePause||disposed)return;const shape=pachinko?pachinkoShape(packet):packetShape(packet);if(!shape||pending.size>=MAX_PENDING){omitted++;sync();return;}
 const id=nextId++;pending.set(id,{packet,shape});post({type:'packet',packet:{id,kind:shape.kind,beads:pachinko?1:shape.nodes.length,links:shape.links}});
}
function workerMessage(message:Output){if(disposed)return;
 if(message.type==='impact'){renderer?.impact(message.x,message.z,message.kind,message.y);return;}
 if(message.type==='ready'){ready=true;for(let i=0;i<3;i++){const buffer=new ArrayBuffer(frameSize(message.capacity)*4);post({type:'recycle',buffer},[buffer]);}stage.dataset.capacity=String(message.capacity);stage.dataset.renderState='ready';pause();sync();window.dispatchEvent(new CustomEvent(`cartolite-${machine}-ready`,{detail:{scene:renderer}}));return;}
 if(message.type==='frame'){const old=renderer?.accept(message.buffer);if(old)post({type:'recycle',buffer:old},[old]);sync();return;}
 if(message.type==='accepted'){const entry=pending.get(message.id);pending.delete(message.id);if(entry){events.set(message.id,{...entry,slots:message.slots});for(const slot of message.slots)owners[slot]=message.id;renderer?.born(message.slots,pachinko&&selectedNode&&entry.shape.nodes.includes(selectedNode)?message.slots:message.slots.filter((_,i)=>entry.shape.nodes[i]===selectedNode),entry.shape.kind);if(!effectivePause)sonifier?.play(entry.packet);}return;}
 if(message.type==='rejected'){if(pending.delete(message.id)&&!effectivePause)omitted++;sync();return;}
 if(message.type==='removed'){for(const id of message.ids){const entry=events.get(id);if(entry)for(const slot of entry.slots)if(owners[slot]===id)owners[slot]=-1;events.delete(id);}return;}
 fail('The physics scene stopped. Reload to start a fresh box.');
}
function fail(message:string){required('fatal-message').textContent=message;required('fatal').hidden=false;required('graphics-notice').hidden=true;required('feed-notice').hidden=true;stage.dataset.renderState='unavailable';dispose();}
function dispose(){if(disposed)return;disposed=true;if(retryTimer!==undefined)clearTimeout(retryTimer);if(inspectorTimer!==undefined)clearInterval(inspectorTimer);feed?.stop();store?.destroy();sonifier?.destroy();post({type:'dispose'});worker?.terminate();renderer?.destroy();events.clear();pending.clear();}
async function connect(){
 if(connecting||disposed||store)return;connecting=true;
 try{const initial=await fetchState();if(disposed)return;const liveStore=new LiveStore(initial);store=liveStore;required('feed-notice').hidden=true;
   liveStore.subscribe(()=>{if(!required('find-panel').hidden)refreshSearch();sync();});
   refreshSearch=wireNodeSearch({input:required<HTMLInputElement>('node-search'),results:required('node-search-results'),metrics:stage,search:q=>searchNodes(liveStore.snapshot.nodes,q),select:id=>{selectNode(id);closePanels();inspector.querySelector<HTMLButtonElement>('button')?.focus();},dismiss:()=>{closePanels();required('find-button').focus();}});
   feed=new LiveFeed(initial,{onConnection(value){connected=value;required('feed-notice').hidden=value;sync();},onNode:e=>liveStore.upsertNode(e.node,e.seq),
     onPacket(event,replayed){const packet=liveStore.applyPacket(event);if(packet&&!replayed&&!document.hidden)acceptPacket(packet);},onStatus:e=>liveStore.updateStatus(e.status,e.seq),
     async recover(){const snapshot=await fetchState();if(!disposed)liveStore.replace(snapshot);return snapshot;},onError(){connected=false;required('feed-notice').hidden=false;sync();}});feed.start();
   if(requestedNode())selectNode(requestedNode());
 }catch{if(!disposed){required('feed-notice').hidden=false;required('status').dataset.state='offline';required('status-text').textContent='Reconnecting';retryTimer=window.setTimeout(()=>{if(!document.hidden)void connect();},5000);}}
 finally{connecting=false;}
}
async function start(){let phase='graphics';try{
 const capacity=capacityFor(coarsePointer.matches,displayPreferences().quality,machine);owners=new Int32Array(capacity).fill(-1);
 renderer=new FirehoseRenderer(stage,required<HTMLCanvasElement>(`${machine}-canvas`),capacity,machine);renderer.onRotation=rotation=>post({type:'rotation',rotation});renderer.onPick=slot=>{const id=owners[slot];if(id!==undefined&&id>=0)inspect(id);};
 renderer.onContext=lost=>{required('graphics-notice').hidden=!lost;pause();};
 await renderer.prepare();if(disposed)return;if(!renderer.graphicsReady)throw new Error('Graphics were interrupted during initialization');
 phase='worker';worker=new Worker(new URL('./firehose.worker.ts',import.meta.url),{type:'module'});worker.onmessage=event=>workerMessage(event.data as Output);worker.onerror=()=>fail('The physics worker could not start. Reload to try again.');worker.onmessageerror=()=>fail('The physics worker lost its connection. Reload to start a fresh box.');post({type:'init',capacity,mode:machine});
 phase='sound-controls';
 const sound=new RouteSonifier(renderer,stage);sonifier=sound;const panel=required('sound-panel');mountSoundPreview(sound,panel);sound.setStatusListener(status=>updateSoundChrome(status,sound.getVolume(),sound.getScene()));
 required('sound-toggle').addEventListener('click',()=>void sound.setEnabled(sound.status()!=='on'));required<HTMLSelectElement>('sound-scene').addEventListener('change',e=>sound.setScene((e.target as HTMLSelectElement).value as SoundScene));required<HTMLInputElement>('sound-volume').addEventListener('input',e=>sound.setVolume(Number((e.target as HTMLInputElement).value)/100));
 updateSoundChrome(sound.status(),sound.getVolume(),sound.getScene());if(!sound.supported()){for(const id of ['sound-button','sound-toggle','sound-scene','sound-volume'])required<HTMLButtonElement>(id).disabled=true;required('sound-state').textContent='Unavailable';}
 pause();setMode(pachinko?'orbit':'tilt');void connect();
 }catch(error){console.error(`${title} ${phase} initialization failed`,error instanceof Error ? error.stack : error);stage.dataset.failurePhase=phase;fail(phase==='graphics'?`${title} needs working WebGL2 graphics. Try reloading, or use Netgraph’s Canvas fallback.`:`${title} could not initialize. Reload to start a fresh session, or open Netgraph.`);}}

mountCinematicDock();
required('tilt-mode').addEventListener('click',()=>setMode('tilt'));required('orbit-mode').addEventListener('click',()=>setMode('orbit'));
required('pause-button').addEventListener('click',()=>{scenePaused=!scenePaused;pause();});
required('pour-button').addEventListener('click',()=>{resumeMotion();if(pachinko)post({type:'drain'});else renderer?.pour();});required('upright-button').addEventListener('click',()=>{resumeMotion();renderer?.upright();});
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-tip]'))button.addEventListener('click',()=>{resumeMotion();const [x,y]=button.dataset.tip!.split(',').map(Number);renderer?.tilt(x!*.25,y!*.25);});
for(const id of ['reset-button','camera-home'])required(id).addEventListener('click',()=>renderer?.home());required('zoom-in').addEventListener('click',()=>renderer?.zoom(.85));required('zoom-out').addEventListener('click',()=>renderer?.zoom(1.15));
required('clear-button').addEventListener('click',()=>{pending.clear();renderer?.clearEffects();post({type:'clear'});selectNode(null);});required<HTMLInputElement>('show-links').addEventListener('change',e=>renderer?.setLinks((e.target as HTMLInputElement).checked));
required('retry-feed').addEventListener('click',()=>{if(feed)void feed.resume();else void connect();});
window.addEventListener(DISPLAY_EVENT,()=>{renderer?.applyDisplay();const key=`${displayPreferences().motion}:${prefersReducedMotion()}`;if(key!==motionKey){motionKey=key;scenePaused=prefersReducedMotion();pause();}});
document.addEventListener('visibilitychange',()=>{pause();if(!document.hidden){if(feed)void feed.resume();else void connect();}});
window.addEventListener('online',()=>{if(feed)void feed.resume();else void connect();});window.addEventListener('pageshow',e=>{if(e.persisted){pause();if(feed)void feed.resume();}});window.addEventListener('pagehide',e=>{if(!e.persisted)dispose();});
inspectorTimer=window.setInterval(()=>{if(!disposed&&!document.hidden&&selectedNode&&!inspector.hidden)selectNode(selectedNode);},60_000);
void start();
