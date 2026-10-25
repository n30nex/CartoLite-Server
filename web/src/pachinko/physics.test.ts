import { describe, expect, it } from 'vitest';
import { FirehosePhysics } from '../firehose/physics';
import { HEADER, PACHINKO, frameSize, laneCenter, pachinkoShape } from '../firehose/model';

describe('Pachinko packet conservation', () => {
  it('represents a packet once without turning its confirmed segments into links', () => {
    const node = (id:string) => ({id,label:id,lat:43,lng:-80});
    const shape = pachinkoShape({seq:1,id:'synthetic',at:0,payloadType:'Text',mode:'route',segments:[
      {routeId:'a',from:node('one'),to:node('two')},{routeId:'b',from:node('three'),to:node('four')},
    ]});
    expect(shape?.nodes).toEqual(['one','two','three','four']); expect(shape?.links).toEqual([]);
  });
  it('settles all six categories in their own buckets and drains them on demand', () => {
    const sim = new FirehosePhysics(512,'pachinko');
    try {
      for(let id=1;id<=36;id++)expect(sim.enqueue({id,kind:id%6,beads:1,links:[]})).toBe(true);
      for(let step=0;step<1600;step++)sim.step();
      expect(sim.accepted).toBe(36);expect(sim.count).toBe(36);expect(sim.drained).toBe(0);expect(sim.linkCount).toBe(0);
      for(const group of sim.groups.values()) {
        const p=sim.position(group.slots[0]!);
        expect(Math.abs(p.x-laneCenter(group.kind))).toBeLessThanOrEqual(PACHINKO.laneWidth/2);
        expect(p.y).toBeLessThan(PACHINKO.boardBottom);expect(p.y).toBeGreaterThanOrEqual(PACHINKO.floor);
      }
      const frame=sim.snapshot(new ArrayBuffer(frameSize(512)*4));
      expect([...frame.subarray(16,22)]).toEqual([6,6,6,6,6,6]);expect(frame.length).toBe(HEADER+512*8);
      sim.drain();for(let step=0;step<240;step++)sim.step();
      expect(sim.count).toBe(0);expect(sim.drained).toBe(36);expect(sim.omitted).toBe(0);
    } finally {sim.destroy();}
  },15000);
  it('overflows a busy bucket, recycles dots and never creates links', () => {
    const sim=new FirehosePhysics(256,'pachinko');let peak=0;
    try {
      for(let step=0;step<3000;step++) {
        if(step%3===0)sim.enqueue({id:step+1,kind:2,beads:1,links:[]});
        sim.step();peak=Math.max(peak,sim.count);
        if(sim.drained>30&&sim.accepted>200)break;
      }
      expect(sim.drained).toBeGreaterThan(30);expect(peak).toBeLessThanOrEqual(256);expect(sim.linkCount).toBe(0);
      expect(sim.count+sim.drained).toBe(sim.accepted);
      expect([...sim.groups.values()].every(group=>group.kind===2)).toBe(true);
      expect(sim.enqueue({id:99_999,kind:2,beads:2,links:[[0,1]]})).toBe(false);
    } finally {sim.destroy();}
  },15000);
});
