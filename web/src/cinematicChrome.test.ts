// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {followViewport,trackPanelHistory} from './cinematicChrome';
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));document.body.replaceChildren();vi.restoreAllMocks();});
function element(id:string,x:number,y:number,width:number,height:number){
  const node=document.createElement('div');node.id=id;node.className=id;
  Object.defineProperties(node,{clientWidth:{value:width},clientHeight:{value:height}});
  node.getBoundingClientRect=()=>({x,y,left:x,top:y,right:x+width,bottom:y+height,width,height,toJSON:()=>({})});
  node.getClientRects=()=>[node.getBoundingClientRect()] as unknown as DOMRectList;
  document.body.append(node);return node;
}
it('keeps portrait activity above the Follow card and dock',()=>{
  const stage=element('stage',0,0,390,844);element('controls',8,730,374,106);element('follow-card',8,470,374,248);
  const rect=followViewport(stage);
  expect(rect.bottom).toBeLessThan(470);expect(rect.right-rect.left).toBeGreaterThan(250);expect(rect.bottom-rect.top).toBeGreaterThan(250);
});
it('uses the space beside a landscape card without covering the dock',()=>{
  const stage=element('stage',0,0,844,390);element('controls',40,330,764,52);element('follow-card',486,100,350,215);
  const rect=followViewport(stage);
  expect(rect.right).toBeLessThan(486);expect(rect.bottom).toBeLessThan(330);expect(rect.right-rect.left).toBeGreaterThan(350);
});

it('does not force menu layout when live counters update',async()=>{
  document.body.innerHTML='<div class="controls"></div><details><summary>Views</summary><section id="panel"></section></details><output id="live-count">0</output>';
  const panel=document.getElementById('panel')!,counter=document.getElementById('live-count')!;
  const measure=vi.spyOn(panel,'getClientRects').mockReturnValue([] as unknown as DOMRectList);
  trackPanelHistory(document.querySelector('.controls')!,['panel']);
  for(let count=0;count<20;count++)counter.textContent=String(count);
  await Promise.resolve();expect(measure).not.toHaveBeenCalled();
  panel.hidden=true;panel.hidden=false;
  await Promise.resolve();expect(measure).toHaveBeenCalled();
});
