import RAPIER, { type RigidBody, type World } from '@dimforge/rapier3d-compat';
import { BOX, HEADER, MAX_PACKET_BEADS, MAX_PACKET_LINKS, MAX_PENDING, PIT_Y, SPOUT, UPRIGHT,
  approachRotation, frameSize, normalizedRotation, particleRadius, type PhysicalPacket, type Rotation } from './model';

interface Group { id: number; bodies: RigidBody[]; slots: number[]; links: [number, number][] }
export const initializePhysics = () => RAPIER.init();

/** One bounded worker-owned world. Sleeping settled beads still have real collisions. */
export class FirehosePhysics {
  readonly world:World;
  readonly radius: number;
  readonly groups = new Map<number, Group>();
  readonly box: RigidBody;
  readonly free: number[];
  readonly generations: Uint32Array;
  readonly queue: PhysicalPacket[] = [];
  rotation: Rotation = {...UPRIGHT};
  target: Rotation = {...UPRIGHT};
  accepted = 0;
  omitted = 0;
  drained = 0;
  steps = 0;
  stepMs = 0;
  maxStepMs = 0;
  linkCount = 0;
  sleeping = 0;
  #turning = false;
  onAccepted = (_id: number, _slots: number[]) => {};
  onRejected = (_id: number) => {};
  onRemoved = (_ids: number[]) => {};

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 128 || capacity > 4096 || capacity % 128) throw new Error('Invalid physical capacity');
    this.world=new RAPIER.World({ x:0, y:-9.81, z:0 });
    this.radius=particleRadius(capacity); this.free=Array.from({length:capacity},(_,i)=>capacity-1-i); this.generations=new Uint32Array(capacity);
    this.world.timestep=1/60;this.world.numSolverIterations=4;this.world.maxCcdSubsteps=1;
    this.box=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,BOX.centerY,0));
    const wall=(hx:number,hy:number,hz:number,x:number,y:number,z:number)=>this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx,hy,hz).setTranslation(x,y,z).setFriction(0.42).setRestitution(0.08),this.box);
    wall(BOX.width/2+0.09,0.08,BOX.depth/2+0.09,0,-BOX.height/2-0.08,0);
    wall(0.065,BOX.height/2,BOX.depth/2, -BOX.width/2-0.065,0,0);
    wall(0.065,BOX.height/2,BOX.depth/2, BOX.width/2+0.065,0,0);
    wall(BOX.width/2+0.13,BOX.height/2,0.065,0,0,-BOX.depth/2-0.065);
    wall(BOX.width/2+0.13,BOX.height/2,0.065,0,0, BOX.depth/2+0.065);
  }
  get count(): number { return this.capacity-this.free.length; }
  enqueue(packet: PhysicalPacket): boolean {
    if (!Number.isSafeInteger(packet.id) || packet.id<1 || this.groups.has(packet.id) || this.queue.some(p=>p.id===packet.id)
      || !Number.isInteger(packet.beads) || packet.beads<1 || packet.beads>MAX_PACKET_BEADS
      || !Number.isInteger(packet.kind) || packet.kind<0 || packet.kind>5 || packet.links.length>MAX_PACKET_LINKS
      || packet.links.some(([a,b])=>!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=packet.beads||b>=packet.beads||a===b)
      || this.queue.length>=MAX_PENDING) {this.omitted++;this.onRejected(packet.id);return false;}
    this.queue.push(packet);return true;
  }
  setRotation(value: Rotation): void {
    const target=normalizedRotation(value);if(target)this.target=target;
  }
  discardPending(): void { for(const packet of this.queue)this.onRejected(packet.id);this.omitted+=this.queue.length;this.queue.length=0; }
  #spawn(packet: PhysicalPacket): void {
    if(this.free.length<packet.beads || this.linkCount+packet.links.length>this.capacity*2){this.omitted++;this.onRejected(packet.id);return;}
    const bodies: RigidBody[]=[], slots:number[]=[], positions:{x:number;y:number;z:number}[]=[];
    const phase=packet.id*2.399963, spread=this.radius*(1+Math.sqrt(packet.beads)*0.34);
    for(let i=0;i<packet.beads;i++) {
      const slot=this.free.pop()!;slots.push(slot);this.generations[slot]=(this.generations[slot]!+1)%1_000_000;
      const angle=phase+i*2.399963;
      const pos={x:SPOUT.x+Math.cos(angle)*spread,y:SPOUT.y+i*this.radius*0.3,z:SPOUT.z+Math.sin(angle)*spread};positions.push(pos);
      const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x,pos.y,pos.z)
        .setLinvel(0.35+Math.cos(phase)*0.3,-1.1,Math.sin(phase)*0.35).setAngvel({x:1.2,y:Math.sin(angle),z:0.8})
        .setLinearDamping(0.22).setAngularDamping(0.35).setCanSleep(true).setCcdEnabled(true));
      this.world.createCollider(RAPIER.ColliderDesc.ball(this.radius).setDensity(1).setFriction(0.48).setRestitution(0.16),body);
      bodies.push(body);
    }
    for(const [a,b] of packet.links){const p=positions[a]!,q=positions[b]!;
      const length=Math.max(this.radius*2.6,Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)*1.04);
      this.world.createImpulseJoint(RAPIER.JointData.rope(length,{x:0,y:0,z:0},{x:0,y:0,z:0}),bodies[a]!,bodies[b]!,true).setContactsEnabled(true);
    }
    this.groups.set(packet.id,{id:packet.id,bodies,slots,links:packet.links});this.linkCount+=packet.links.length;this.accepted++;
    // Kind is packed with a generation, so reused slots never interpolate from old beads.
    for(const slot of slots)this.#kinds[slot]=packet.kind;
    this.onAccepted(packet.id,slots);
  }
  #kinds = new Uint8Array(4096);
  step(): void {
    const started=performance.now();
    let spawned=0;
    while(this.queue.length&&spawned<96){const packet=this.queue.shift()!;spawned+=packet.beads;this.#spawn(packet);}
    const next=approachRotation(this.rotation,this.target,2.4/60);
    const turning=Math.abs(next.x-this.rotation.x)+Math.abs(next.y-this.rotation.y)+Math.abs(next.z-this.rotation.z)+Math.abs(next.w-this.rotation.w)>0.00001;
    if(turning){this.rotation=next;this.box.setNextKinematicRotation(next);if(!this.#turning)for(const group of this.groups.values())for(const body of group.bodies)if(body.isSleeping())body.wakeUp();}
    this.#turning=turning;
    this.world.step();this.steps++;
    const removed:number[]=[];
    for(const group of this.groups.values()) {
      let escaped=true,invalid=false;
      for(const body of group.bodies){const p=body.translation();if(p.y>PIT_Y&&Math.abs(p.x)<16&&Math.abs(p.z)<16)escaped=false;if(![p.x,p.y,p.z].every(Number.isFinite))invalid=true;}
      if(escaped||invalid){this.#remove(group);removed.push(group.id);if(escaped)this.drained++;else this.omitted++;}
    }
    if(removed.length)this.onRemoved(removed);
    this.stepMs=performance.now()-started;this.maxStepMs=Math.max(this.maxStepMs,this.stepMs);
  }
  #remove(group: Group): void {
    for(let i=0;i<group.bodies.length;i++){this.world.removeRigidBody(group.bodies[i]!);this.free.push(group.slots[i]!);}
    this.linkCount-=group.links.length;this.groups.delete(group.id);
  }
  clear(): void {
    this.discardPending();const ids=[...this.groups.keys()];for(const group of this.groups.values())this.#remove(group);if(ids.length)this.onRemoved(ids);
  }
  snapshot(buffer: ArrayBuffer): Float32Array {
    const data=new Float32Array(buffer);if(data.length!==frameSize(this.capacity))throw new Error('Invalid frame buffer');data.fill(0);
    data[0]=this.count;data[1]=this.linkCount;data[2]=this.groups.size;data[4]=this.stepMs;data[5]=this.omitted;data[6]=this.drained;data[7]=this.accepted;
    data[8]=this.rotation.x;data[9]=this.rotation.y;data[10]=this.rotation.z;data[11]=this.rotation.w;data[12]=this.radius;data[13]=this.steps;data[14]=this.queue.length;
    let link=HEADER+this.capacity*4,sleeping=0;
    for(const group of this.groups.values()){
      for(let i=0;i<group.bodies.length;i++){const body=group.bodies[i]!,slot=group.slots[i]!,p=body.translation(),at=HEADER+slot*4;
        data[at]=p.x;data[at+1]=p.y;data[at+2]=p.z;data[at+3]=this.generations[slot]!*8+this.#kinds[slot]!+1;if(body.isSleeping())sleeping++;}
      for(const [a,b]of group.links){data[link++]=group.slots[a]!;data[link++]=group.slots[b]!;}
    }
    this.sleeping=sleeping;data[3]=sleeping;data[15]=this.maxStepMs;return data;
  }
  destroy(): void {this.queue.length=0;this.groups.clear();this.world.free();}
}
