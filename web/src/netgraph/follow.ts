import { FollowQueue, followEndpoints, followSummary } from '../liveFollow';
import type { PacketView } from '../types';
import type { NetgraphRenderer } from './renderer';

/** Same live-only queue and ten-second dwell as Map. No animation is replayed. */
export function mountGraphFollow(graph: NetgraphRenderer, select: (id: string) => void) {
  const button=document.createElement('button');button.type='button';button.className='control-button';button.textContent='◎ Follow';button.setAttribute('aria-pressed','false');
  document.querySelector('.controls')!.append(button);
  const card=document.createElement('section');card.id='follow-card';card.className='follow-card glass';card.hidden=true;card.setAttribute('aria-label','Live Follow activity');
  card.innerHTML='<header><strong>Live Follow</strong><button type="button" data-hold>Hold</button><button type="button" id="follow-close" data-close aria-label="Close Live Follow">×</button></header><label class="follow-scope">Follow area<select aria-label="Follow scope"><option value="all">Everywhere</option><option value="area">This area</option><option value="node">Selected node</option></select></label><div class="follow-copy"><strong data-title>Waiting for activity</strong><span data-detail>New live packets only</span></div><footer><span data-state>Waiting for activity</span><output aria-label="Seconds until next activity"></output></footer><progress max="10" value="0" aria-label="Time remaining on this activity"></progress><div class="follow-actions"><button type="button" data-next>Next</button><button type="button" data-inspect disabled>Inspect</button></div>';
  document.querySelector('.netgraph-app')!.append(card);
  const queue=new FollowQueue();let enabled=false,held=false;let current:PacketView|undefined;let ids:Set<string>|undefined;
  const hold=card.querySelector<HTMLButtonElement>('[data-hold]')!;
  const inspect=card.querySelector<HTMLButtonElement>('[data-inspect]')!;
  const scope=card.querySelector('select')!;
  const setEnabled=(value:boolean)=>{enabled=value;held=false;queue.clear();button.setAttribute('aria-pressed',String(value));card.hidden=!value;hold.textContent='Hold';};
  button.addEventListener('click',()=>setEnabled(!enabled));
  card.querySelector('[data-close]')!.addEventListener('click',()=>setEnabled(false));
  scope.addEventListener('change',()=>{ids=scope.value==='area'?graph.visibleNodeIDs():scope.value==='node'?new Set(graph.selectedNode()?[graph.selectedNode()!]:[]):undefined;queue.clear();});
  hold.addEventListener('click',()=>{held=!held;queue.setHeld(held,Date.now());hold.textContent=held?'Continue':'Hold';});
  card.querySelector('[data-next]')!.addEventListener('click',()=>{held=false;queue.next();hold.textContent='Hold';tick();});
  inspect.addEventListener('click',()=>{const id=current&&followEndpoints(current)[0]?.id;if(id){held=true;queue.setHeld(true,Date.now());hold.textContent='Continue';select(id);}});
  const pause=()=>{if(enabled&&!held){held=true;queue.setHeld(true,Date.now());hold.textContent='Continue';}};
  const stage=document.getElementById('netgraph-stage')!;
  stage.addEventListener('pointerdown',pause);stage.addEventListener('wheel',pause,{passive:true});stage.addEventListener('keydown',pause);
  function tick():void {
    if(!enabled||document.hidden)return;
    if(held){card.querySelector('[data-state]')!.textContent='Held · explore freely';return;}
    const packet=queue.take(Date.now());
    if(packet){current=packet;inspect.disabled=false;const summary=followSummary(packet);card.querySelector('[data-title]')!.textContent=summary.title;card.querySelector('[data-detail]')!.textContent=summary.detail;graph.followPacket(packet);}
    const remaining=queue.remaining(Date.now());card.querySelector('output')!.value=remaining?`${remaining}s`:'';card.querySelector('progress')!.value=remaining;
    card.querySelector('[data-state]')!.textContent=remaining?'Next activity in':'Waiting for activity';
  }
  const timer=window.setInterval(tick,250);
  return {offer(packet:PacketView){if(!enabled)return;const points=followEndpoints(packet);if(ids && (scope.value==='node'?!points.some(p=>ids!.has(p.id)):!points.every(p=>ids!.has(p.id))))return;const nearby=points.some(point=>{const p=graph.projectEndpoint(point);return p.x>=0&&p.x<=stage.clientWidth&&p.y>=0&&p.y<=stage.clientHeight;});queue.offer(packet,nearby?2:0,Date.now());tick();},destroy(){clearInterval(timer);stage.removeEventListener('pointerdown',pause);stage.removeEventListener('wheel',pause);stage.removeEventListener('keydown',pause);card.remove();button.remove();}};
}
