// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {followViewport} from './cinematicChrome';
afterEach(()=>{document.body.replaceChildren();});
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
