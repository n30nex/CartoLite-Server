// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { FirehosePhysics, initializePhysics } from './physics';
import { HEADER, MAX_PENDING, approachRotation, frameSize, packetShape } from './model';
import type { PacketView, EndpointV2 } from '../types';

beforeAll(async()=>{await initializePhysics();});
const node=(id:string):EndpointV2=>({id,label:id,lat:43,lng:-80});
describe('Firehose public topology and real physics',()=>{
 it('keeps disconnected segments separate and observer-only packets single',()=>{
   const packet:PacketView={seq:1,id:'synthetic',at:0,payloadType:'Text',mode:'route',segments:[{routeId:'a-b',from:node('a'),to:node('b')},{routeId:'c-d',from:node('c'),to:node('d')}]};
   expect(packetShape(packet)).toEqual({kind:2,nodes:['a','b','c','d'],links:[[0,1],[2,3]]});
   expect(packetShape({...packet,mode:'observer',observer:node('x')})).toEqual({kind:2,nodes:['x'],links:[]});
   expect(packetShape({...packet,segments:[]})).toBeUndefined();
 });
 it('settles real linked beads on the floor and empties by turning the box over',()=>{
   const sim=new FirehosePhysics(512);try{
     sim.enqueue({id:1,kind:0,beads:4,links:[[0,1],[1,2],[2,3]]});
     for(let i=0;i<420;i++)sim.step();
     expect(sim.count).toBe(4);expect(sim.linkCount).toBe(3);
     const group=sim.groups.get(1)!;
     for(const slot of group.slots){const p=sim.position(slot);expect(p.y).toBeGreaterThan(-.02);expect(p.y).toBeLessThan(.7);}
     expect(sim.sleeping).toBeGreaterThan(0);
     sim.setRotation({x:0,y:0,z:1,w:0});
     for(let i=0;i<480&&sim.count;i++)sim.step();
     expect(sim.count).toBe(0);expect(sim.drained).toBe(1);expect(sim.linkCount).toBe(0);
   }finally{sim.destroy();}
 },15_000);
 it('bounds the input queue and whole-packet admission, frees joints and rejects bad rotations',()=>{
   const sim=new FirehosePhysics(128);try{
     for(let id=1;id<=MAX_PENDING+10;id++)sim.enqueue({id,kind:1,beads:4,links:[[0,1],[2,3]]});
     expect(sim.queue).toHaveLength(MAX_PENDING);expect(sim.omitted).toBe(10);
     for(let i=0;i<60&&sim.queue.length;i++)sim.step();
     expect(sim.count).toBeLessThanOrEqual(128);expect(sim.count%4).toBe(0);expect(sim.linkCount).toBe(sim.count/2);
     const frame=sim.snapshot(new ArrayBuffer(frameSize(128)*4));expect(frame[0]).toBe(sim.count);expect([...frame].every(Number.isFinite)).toBe(true);
     const target={...sim.target};sim.setRotation({x:NaN,y:0,z:0,w:1});expect(sim.target).toEqual(target);
     sim.clear();expect(sim.count).toBe(0);expect(sim.linkCount).toBe(0);expect(sim.queue).toHaveLength(0);
     expect(sim.snapshot(frame.buffer as ArrayBuffer).slice(HEADER).every(v=>v===0)).toBe(true);
     expect(sim.groups.size).toBe(0);expect(sim.free).toHaveLength(128);
   }finally{sim.destroy();}
 });
 it('fills an upright box and naturally overflows into the pit, recycling drained slots',()=>{
   const sim=new FirehosePhysics(256);let peak=0;try{
     for(let i=0;i<1800;i++){
       if(i%2===0)sim.enqueue({id:i+1,kind:i%6,beads:1,links:[]});
       sim.step();peak=Math.max(peak,sim.count);
       if(sim.drained>16&&sim.accepted>280)break;
     }
     expect(peak).toBeGreaterThan(128);expect(peak).toBeLessThanOrEqual(256);
     expect(sim.drained).toBeGreaterThan(16);expect(sim.accepted).toBeGreaterThan(256);
     expect(sim.rotation).toEqual({x:0,y:0,z:0,w:1});
   }finally{sim.destroy();}
 },15000);
 it('limits box angular speed without losing full upside-down rotation',()=>{
   let q={x:0,y:0,z:0,w:1};const target={x:0,y:0,z:1,w:0};
   q=approachRotation(q,target,.04);expect(2*Math.acos(q.w)).toBeCloseTo(.04);
   for(let i=0;i<100;i++)q=approachRotation(q,target,.04);
   expect(q.z).toBeCloseTo(1);expect(Math.hypot(q.x,q.y,q.z,q.w)).toBeCloseTo(1);
 });
});
