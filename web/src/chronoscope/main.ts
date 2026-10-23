import './styles.css';
import '../networkControls.css';
import { required } from '../dom';
import { fetchState, LiveFeed } from '../api';
import { LiveStore, activityLabel } from '../state';
import { initializeDisplay, DISPLAY_EVENT, packetPalette } from '../displayPreferences';
import { mountNetgraphDisplay } from '../displayControls';
import { mountCinematicDock } from '../cinematicChrome';
import { buildNodeInspectorModel, createNodeInspectorContent, searchNodes } from '../nodeInspector';
import { wireNodeSearch } from '../nodeSearch';
import { rememberNode, requestedNode, replaceInspector } from '../selection';
import { RouteSonifier, type SoundScene } from '../audio';
import { populateSoundScenes } from '../soundScenes';
import { updateSoundChrome } from '../soundControls';
import { mountSoundPreview } from '../soundPreview';
import { NetgraphRegionResolver } from '../netgraph/areas';
import { mountGraphFollow } from '../netgraph/follow';
import { normalizePacketKind } from '../trafficVisuals';
import { ChronoscopeRenderer } from './renderer';
import { normalizeChronoscope, type ChronoscopeMode, type Observation } from './timeline';

const KEY = 'cartolite:chronoscope:v1';
const stage=required('chronoscope-stage'), inspector=required('node-inspector-sheet'), caption=required('chrono-status');
const mode=required<HTMLSelectElement>('chrono-mode'), windowSize=required<HTMLSelectElement>('chrono-window');
const freeze=required<HTMLButtonElement>('freeze-button'), slice=required<HTMLInputElement>('slice-time');
const soundPanel=required('sound-panel');
let renderer: ChronoscopeRenderer | undefined, sonifier: RouteSonifier | undefined, store: LiveStore | undefined;
let feed: LiveFeed | undefined, resolver: NetgraphRegionResolver | undefined, director: ReturnType<typeof mountGraphFollow> | undefined;
let connected=false, disposed=false, selected: string | null=null, recentSignature='', regionSignature='', refreshSearch=()=>{};
let settings=load();
initializeDisplay();
const closeDisplay=mountNetgraphDisplay(()=>closePanels());
populateSoundScenes(required<HTMLSelectElement>('sound-scene'));

function load() { try { return normalizeChronoscope(JSON.parse(localStorage.getItem(KEY)??'null')); } catch { return normalizeChronoscope(null); } }
function save() { try { localStorage.setItem(KEY,JSON.stringify(settings)); } catch { /* Storage is optional. */ } }
function closePanels(except='') {
  for(const id of ['find','sound','time','regions'])if(id!==except){required(`${id}-panel`).hidden=true;required(`${id}-button`).setAttribute('aria-expanded','false');}
}
function configurePanels() {
  for(const id of ['find','sound','time','regions']) {
    const host=required(`${id}-control`),button=required(`${id}-button`),panel=required(`${id}-panel`);
    button.addEventListener('click',()=>{const opening=panel.hidden;closePanels(id);closeDisplay();panel.hidden=!opening;button.setAttribute('aria-expanded',String(opening));if(opening&&id==='find'){refreshSearch();required<HTMLInputElement>('node-search').focus();}if(opening&&id==='time')updateRecent();});
    panel.querySelector('[data-close]')?.addEventListener('click',()=>{closePanels();button.focus();});
    document.addEventListener('pointerdown',event=>{if(event.target instanceof Node&&!host.contains(event.target)){panel.hidden=true;button.setAttribute('aria-expanded','false');}});
  }
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||document.querySelector('dialog[open]'))return;
    const open=['find','sound','time','regions'].find(id=>!required(`${id}-panel`).hidden);
    if(open){event.preventDefault();closePanels();required(`${open}-button`).focus();}
    else if(!inspector.hidden){selectNode(null);stage.focus();}
  });
}
function applySettings() {
  mode.value=settings.mode;windowSize.value=String(settings.seconds);slice.max=String(settings.seconds);
  renderer?.setWindow(settings.seconds);renderer?.setMode(settings.mode);renderer?.setRegions(settings.regions);
  required('slice-control').hidden=settings.mode!=='slice';sync();renderRegions();
}
function sync() {
  if(!renderer)return;
  const records=renderer.visibleRecords(),frozen=renderer.frozen;
  freeze.setAttribute('aria-pressed',String(frozen));freeze.textContent=frozen?'View frozen':'Freeze view';
  sonifier?.setPaused(document.hidden||frozen);
  required('regions-button').toggleAttribute('data-filtered',settings.regions!==null);
  const copy=(frozen?'Frozen · ':!connected?'Reconnecting · ':'')+(settings.regions?.length?String(settings.regions.length)+' regions · ':'')+(settings.regions?.length===0?'No regions selected':records.length?`${records.length.toLocaleString()} observed events · ${settings.seconds}s window${renderer.timeline.trimmed?' · oldest trails capped':''}`:'Waiting for activity');
  if(caption.textContent!==copy)caption.textContent=copy;
  const heading=caption.previousElementSibling,headingText='CHRONOSCOPE · '+settings.mode.toUpperCase();if(heading&&heading.textContent!==headingText)heading.textContent=headingText;
  if(!required('time-panel').hidden)updateRecent();
}
function updateRecent() {
  if(!renderer)return;
  const records=[...renderer.visibleRecords()].slice(-8).reverse(),signature=records.map(r=>r.packet.seq).join(',');
  if(signature===recentSignature)return;recentSignature=signature;
  const host=required('recent-events');host.replaceChildren();
  if(!records.length){const p=document.createElement('p');p.textContent='Waiting for activity.';host.append(p);}
  for(const record of records){const button=document.createElement('button'),dot=document.createElement('i'),text=document.createElement('span');button.type='button';
    const packet=record.packet,kind=normalizePacketKind(packet.payloadType);dot.style.setProperty('--packet-color',packetPalette()[kind]);dot.setAttribute('aria-hidden','true');
    text.textContent=`${kind} · ${packet.mode==='observer'?packet.observer.label:packet.segments[0]?.from.label??'Observed link'}${packet.mode==='observer'?' · heard only':` · ${packet.segments.length} confirmed segments`}`;
    button.append(dot,text);button.addEventListener('click',()=>{closePanels();inspectPacket(record);inspector.querySelector<HTMLButtonElement>('button')?.focus();});host.append(button);}
}
function renderRegions() {
  if(!renderer)return;
  const regions=renderer.regions,signature=JSON.stringify([regions.map(a=>[a.code,a.name]),settings.regions]);if(signature===regionSignature)return;regionSignature=signature;
  const checks=required('region-checks');checks.replaceChildren();
  for(const area of regions){const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');input.type='checkbox';input.value=area.code;input.checked=settings.regions===null||settings.regions.includes(area.code);text.textContent=`${area.code} · ${area.name}`;
    input.addEventListener('change',()=>{settings.regions=[...checks.querySelectorAll<HTMLInputElement>('input:checked')].map(el=>el.value);renderer!.setRegions(settings.regions);save();stage.dispatchEvent(new Event('graphfilter'));sync();});label.append(input,text);checks.append(label);}
  filterRegions();
}
function filterRegions() {const query=required<HTMLInputElement>('region-search').value.trim().toLocaleLowerCase();for(const row of required('region-checks').querySelectorAll('label'))row.hidden=!row.textContent?.toLocaleLowerCase().includes(query);}
function selectNode(id: string | null) {
  if(!renderer||!store)return;
  selected=id;rememberNode(id);renderer.selectNode(id);
  if(!id){inspector.hidden=true;delete required('chronoscope-app').dataset.followInspect;return;}
  required('chronoscope-app').dataset.followInspect='true';
  if(!renderer.nodeInRegions(id)){settings.regions=null;renderer.setRegions(null);save();renderRegions();}
  const model=buildNodeInspectorModel(id,renderer.nodes,store.snapshot.routes,Date.now(),15*60_000);if(!model){inspector.hidden=true;return;}
  replaceInspector(inspector,createNodeInspectorContent(document,model,{windowLabel:'15 min',onClose:()=>selectNode(null),onSelectNeighbor:next=>selectNode(next)}));
  const links=document.createElement('div');links.className='chrono-links';for(const [label,path]of [['Open Map','/'],['Open Netgraph','/netgraph/']]as const){const a=document.createElement('a');a.textContent=label;a.href=`${path}?node=${encodeURIComponent(id)}`;links.append(a);}inspector.append(links);
  inspector.setAttribute('aria-label','Selected node details');inspector.hidden=false;renderer.focusNode(id);stage.dispatchEvent(new Event('graphnavigate'));
}
function inspectPacket(record: Observation) {
  if(!renderer)return;renderer.freeze();renderer.selectPacket(record);selected=null;rememberNode(null);
  required('chronoscope-app').dataset.followInspect='true';
  const packet=record.packet,card=document.createElement('article');card.className='chrono-inspector';
  const header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');title.textContent=`${normalizePacketKind(packet.payloadType)} · observed activity`;close.type='button';close.textContent='×';close.className='node-inspector-close';close.setAttribute('aria-label','Close activity details');close.addEventListener('click',()=>{inspector.hidden=true;delete required('chronoscope-app').dataset.followInspect;renderer!.selectNode(null);stage.focus();});header.append(title,close);
  const detail=document.createElement('p');detail.textContent=`${Math.max(0,Math.round((renderer.frameTime-record.started)/1_000))} seconds ago in this view · ${packet.mode==='observer'?'Observer-only reception':`${packet.segments.length} confirmed segments`}`;card.append(header,detail);
  const nodeButton=(id:string,label:string)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.nodeId=id;button.addEventListener('click',()=>selectNode(id));return button;};
  if(packet.mode==='observer'){card.append(nodeButton(packet.observer.id,packet.observer.label));const p=document.createElement('p');p.textContent='A receiver heard this packet. No public route was confirmed.';card.append(p);}
  else for(const segment of packet.segments){const row=document.createElement('div');row.className='chrono-hop';const arrow=document.createElement('span');arrow.textContent='→';arrow.setAttribute('aria-hidden','true');row.append(nodeButton(segment.from.id,segment.from.label),arrow,nodeButton(segment.to.id,segment.to.label));card.append(row);}
  const live=document.createElement('button');live.type='button';live.textContent='Return to live';live.addEventListener('click',()=>{inspector.hidden=true;delete required('chronoscope-app').dataset.followInspect;renderer!.live();if(settings.mode==='slice'){settings.mode='sculpture';applySettings();save();}stage.focus();});card.append(live);
  replaceInspector(inspector,card);inspector.setAttribute('aria-label','Selected packet details');inspector.hidden=false;
}
function dispose() {disposed=true;feed?.stop();store?.destroy();sonifier?.destroy();director?.destroy();renderer?.destroy();resolver?.destroy();}

async function start() {
  try {
    const scene=new ChronoscopeRenderer(stage,required<HTMLCanvasElement>('chrono-canvas'),required<HTMLCanvasElement>('chrono-effects'),{node:selectNode,packet:inspectPacket,change:sync});renderer=scene;
    const areas=new NetgraphRegionResolver();resolver=areas;
    const initial=await fetchState();if(disposed)return;
    try{scene.setAssignments(await areas.resolve(initial.nodes));}catch{/* Coordinate-derived fallback remains usable. */}
    if(disposed)return;
    const liveStore=new LiveStore(initial);store=liveStore;
    const sound=new RouteSonifier(scene,stage);sonifier=sound;
    mountSoundPreview(sound,soundPanel);sound.setStatusListener(status=>updateSoundChrome(status,sound.getVolume(),sound.getScene()));
    required('sound-toggle').addEventListener('click',()=>void sound.setEnabled(sound.status()!=='on'));
    required<HTMLSelectElement>('sound-scene').addEventListener('change',event=>sound.setScene((event.target as HTMLSelectElement).value as SoundScene));
    required<HTMLInputElement>('sound-volume').addEventListener('input',event=>sound.setVolume(Number((event.target as HTMLInputElement).value)/100));
    updateSoundChrome(sound.status(),sound.getVolume(),sound.getScene());
    const updateStatus=()=>{const state=activityLabel(liveStore.snapshot,connected);required('status').dataset.state=state.state;if(required('status-text').textContent!==state.text)required('status-text').textContent=state.text;sync();};
    let resolving=false,areasDirty=false;
    const refreshAreas=async()=>{
      if(resolving)return;resolving=true;
      try{while(areasDirty&&!disposed){areasDirty=false;const nodes=liveStore.snapshot.nodes;const assignments=await areas.resolve(nodes);if(disposed)return;
        // A newer coordinate update gets another bounded pass; no worker queue grows.
        if(nodes.some(node=>{const current=scene.nodes.get(node.id);return current&& (current.lng!==node.lng||current.lat!==node.lat);})){areasDirty=true;continue;}
        scene.setAssignments(assignments);scene.render(liveStore.snapshot,{reset:true});renderRegions();
      }}catch{/* Keep coordinate-derived fallback until the next update. */}finally{resolving=false;}
    };
    liveStore.subscribe((state,changes)=>{scene.render(state,changes);renderRegions();refreshSearch();updateStatus();});
    applySettings();
    refreshSearch=wireNodeSearch({input:required<HTMLInputElement>('node-search'),results:required('node-search-results'),metrics:stage,search:q=>searchNodes(scene.nodes.values(),q),select:id=>{selectNode(id);closePanels();inspector.querySelector<HTMLButtonElement>('button')?.focus();},dismiss:()=>{closePanels();required('find-button').focus();}});
    const following=mountGraphFollow({holdView(){},selectedNode:()=>selected,captureFollowArea(){const ids=new Set([...scene.nodes.values()].filter(n=>{const p=scene.projectEndpoint(n);return p.x>=0&&p.y>=0&&p.x<=stage.clientWidth&&p.y<=stage.clientHeight;}).map(n=>n.id));return id=>ids.has(id);},nodeInRegions:id=>scene.nodeInRegions(id),projectEndpoint:endpoint=>scene.projectEndpoint(endpoint),followPacket:packet=>{if(!scene.frozen)scene.focusNode(packet.mode==='observer'?packet.observer.id:packet.segments[0]!.from.id);}},id=>selectNode(id),stage);director=following;
    const liveFeed=new LiveFeed(initial,{
      onConnection(value){connected=value;updateStatus();},
      onNode(event){const previous=scene.nodes.get(event.node.id);liveStore.upsertNode(event.node,event.seq);if(!previous||previous.lat!==event.node.lat||previous.lng!==event.node.lng){areasDirty=true;void refreshAreas();}},
      onPacket(event,replayed){const packet=liveStore.applyPacket(event);if(!packet||replayed||document.hidden)return;scene.addPacket(packet);if(!scene.frozen){sound.play(packet);following.offer(packet);}sync();},
      onStatus:event=>liveStore.updateStatus(event.status,event.seq),
      async recover(){const snapshot=await fetchState();if(disposed)return snapshot;if(snapshot.bootId!==liveStore.snapshot.bootId)scene.clear();try{scene.setAssignments(await areas.resolve(snapshot.nodes));}catch{/* Keep public coordinate fallback. */}if(!disposed)liveStore.replace(snapshot);return snapshot;},
      onError(){connected=false;updateStatus();},
    });feed=liveFeed;liveFeed.start();
    if(requestedNode())selectNode(requestedNode());
    window.dispatchEvent(new CustomEvent('cartolite-chronoscope-ready',{detail:{scene}}));
  } catch {dispose();required('fatal').hidden=false;required('status').dataset.state='offline';required('status-text').textContent='Unavailable';}
}

configurePanels();mountCinematicDock();
mode.addEventListener('change',()=>{settings.mode=mode.value as ChronoscopeMode;renderer?.setMode(settings.mode);required('slice-control').hidden=settings.mode!=='slice';save();sync();});
windowSize.addEventListener('change',()=>{settings=normalizeChronoscope({...settings,seconds:Number(windowSize.value)});renderer?.setWindow(settings.seconds);slice.max=String(settings.seconds);save();sync();});
freeze.addEventListener('click',()=>renderer?.freeze());required('live-button').addEventListener('click',()=>{if(settings.mode==='slice'){settings.mode='sculpture';mode.value=settings.mode;renderer?.setMode(settings.mode);required('slice-control').hidden=true;save();}renderer?.live();});
slice.addEventListener('input',()=>{renderer?.setSlice(Number(slice.value));required<HTMLOutputElement>('slice-output').value=`${slice.value==='0'?'Now':`${slice.value}s ago`} · ±2s`;});
required('regions-all').addEventListener('click',()=>{settings.regions=null;renderer?.setRegions(null);save();renderRegions();stage.dispatchEvent(new Event('graphfilter'));sync();});
required('regions-none').addEventListener('click',()=>{settings.regions=[];renderer?.setRegions([]);save();renderRegions();stage.dispatchEvent(new Event('graphfilter'));sync();});
required('region-search').addEventListener('input',filterRegions);required('reset-button').addEventListener('click',()=>{renderer?.home();stage.dispatchEvent(new Event('graphnavigate'));});
window.addEventListener('storage',event=>{if(event.key===KEY||event.key===null){settings=load();applySettings();}});
window.addEventListener(DISPLAY_EVENT,()=>{recentSignature='';sync();});
document.addEventListener('visibilitychange',()=>{sonifier?.setPaused(document.hidden||Boolean(renderer?.frozen));if(!document.hidden)void feed?.resume();});
window.addEventListener('online',()=>void feed?.resume());window.addEventListener('pageshow',event=>{if(event.persisted)void feed?.resume();});
window.addEventListener('pagehide',event=>{if(!event.persisted)dispose();});
void start();
