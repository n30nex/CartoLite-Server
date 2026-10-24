import { BOX, HEADER, MAX_PACKET_BEADS, MAX_PACKET_LINKS, MAX_PENDING, PIT_Y, SPOUT, UPRIGHT,
  approachRotation, frameSize, normalizedRotation, particleRadius, type PhysicalPacket, type Rotation } from './model';

interface Group { id:number; kind:number; slots:number[]; links:[number,number][]; lengths:number[]; landed:boolean; born:number }
const DT=1/60, HASH_SIZE=16384;
const walls=[
  [BOX.width/2+.09,.08,BOX.depth/2+.09,0,-BOX.height/2-.08,0],
  [.065,BOX.height/2,BOX.depth/2,-BOX.width/2-.065,0,0],
  [.065,BOX.height/2,BOX.depth/2,BOX.width/2+.065,0,0],
  [BOX.width/2+.13,BOX.height/2,.065,0,0,-BOX.depth/2-.065],
  [BOX.width/2+.13,BOX.height/2,.065,0,0,BOX.depth/2+.065],
] as const;
function matrix(m:Float64Array,q:Rotation){const {x,y,z,w}=q;
  m.set([1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]);
}
export const initializePhysics=()=>Promise.resolve();

/** Position-based spheres and maximum-length ropes. No invisible angular solver.
 * Sleeping particles still support contacts and wake on impact, strain or tilt.
 * All arrays, hash buckets and topology are bounded by the existing session cap. */
export class FirehosePhysics {
  readonly radius:number;
  readonly groups=new Map<number,Group>();
  readonly free:number[];
  readonly generations:Uint32Array;
  readonly queue:PhysicalPacket[]=[];
  readonly positions:Float32Array;
  rotation:Rotation={...UPRIGHT};target:Rotation={...UPRIGHT};
  accepted=0;omitted=0;drained=0;steps=0;stepMs=0;maxStepMs=0;linkCount=0;sleeping=0;
  #before:Float32Array;#velocity:Float32Array;#sleep:Uint8Array;#quiet:Uint8Array;#contact:Uint8Array;
  #kinds:Uint8Array;#owners:(Group|undefined)[];#active:Int32Array;#activeCount=0;
  #heads=new Int32Array(HASH_SIZE);#next:Int32Array;#cell:Int32Array;
  #rotation=new Float64Array(9);#oldRotation=new Float64Array(9);#inletCredit=16;#turning=false;
  onAccepted=(_id:number,_slots:number[])=>{};onRejected=(_id:number)=>{};onRemoved=(_ids:number[])=>{};
  onImpact=(_x:number,_z:number,_kind:number)=>{};
  constructor(readonly capacity:number){
    if(!Number.isInteger(capacity)||capacity<128||capacity>4096||capacity%128)throw new Error('Invalid physical capacity');
    this.radius=particleRadius(capacity);this.free=Array.from({length:capacity},(_,i)=>capacity-1-i);this.generations=new Uint32Array(capacity);
    this.positions=new Float32Array(capacity*3);this.#before=new Float32Array(capacity*3);this.#velocity=new Float32Array(capacity*3);
    this.#sleep=new Uint8Array(capacity);this.#quiet=new Uint8Array(capacity);this.#contact=new Uint8Array(capacity);this.#kinds=new Uint8Array(capacity);
    this.#owners=new Array(capacity);this.#active=new Int32Array(capacity);this.#next=new Int32Array(capacity);this.#cell=new Int32Array(capacity*3);
    matrix(this.#rotation,this.rotation);
  }
  get count(){return this.capacity-this.free.length;}
  position(slot:number){const i=slot*3;return{x:this.positions[i]!,y:this.positions[i+1]!,z:this.positions[i+2]!};}
  enqueue(packet:PhysicalPacket):boolean{
    if(!Number.isSafeInteger(packet.id)||packet.id<1||this.groups.has(packet.id)||this.queue.some(p=>p.id===packet.id)
      ||!Number.isInteger(packet.beads)||packet.beads<1||packet.beads>MAX_PACKET_BEADS
      ||!Number.isInteger(packet.kind)||packet.kind<0||packet.kind>5||packet.links.length>MAX_PACKET_LINKS
      ||packet.links.some(([a,b])=>!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=packet.beads||b>=packet.beads||a===b)
      ||this.queue.length>=MAX_PENDING){this.omitted++;this.onRejected(packet.id);return false;}
    this.queue.push(packet);return true;
  }
  setRotation(value:Rotation){const target=normalizedRotation(value);if(target)this.target=target;}
  discardPending(){for(const packet of this.queue)this.onRejected(packet.id);this.omitted+=this.queue.length;this.queue.length=0;}
  #spawn(packet:PhysicalPacket){
    if(this.free.length<packet.beads||this.linkCount+packet.links.length>this.capacity*2){this.omitted++;this.onRejected(packet.id);return;}
    const noise=Math.sin(packet.id*12.9898)*43758.5453,phase=(noise-Math.floor(noise))*Math.PI*2,spread=this.radius*(1+Math.sqrt(packet.beads)*.34);
    const group:Group={id:packet.id,kind:packet.kind,slots:[],links:packet.links,lengths:[],landed:false,born:this.steps};
    for(let n=0;n<packet.beads;n++){
      const slot=this.free.pop()!,i=slot*3,angle=phase+n*2.399963;group.slots.push(slot);this.#owners[slot]=group;
      this.generations[slot]=(this.generations[slot]!+1)%1_000_000;this.#kinds[slot]=packet.kind;this.#sleep[slot]=this.#quiet[slot]=0;
      this.positions[i]=SPOUT.x+Math.cos(angle)*spread;this.positions[i+1]=SPOUT.y+n*this.radius*.3;this.positions[i+2]=SPOUT.z+Math.sin(angle)*spread;
      this.#velocity[i]=.35+Math.cos(phase)*.3;this.#velocity[i+1]=-5;this.#velocity[i+2]=Math.sin(phase)*.35;
    }
    for(const [a,b]of group.links){const i=group.slots[a]!*3,j=group.slots[b]!*3;
      group.lengths.push(Math.max(this.radius*2.6,Math.hypot(this.positions[i]!-this.positions[j]!,this.positions[i+1]!-this.positions[j+1]!,this.positions[i+2]!-this.positions[j+2]!)*1.04));}
    this.groups.set(group.id,group);this.linkCount+=group.links.length;this.accepted++;this.onAccepted(group.id,group.slots);
  }
  #wake(slot:number){this.#sleep[slot]=this.#quiet[slot]=0;}
  #hash(x:number,y:number,z:number){return(Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791))&(HASH_SIZE-1);}
  #contacts(){
    const p=this.positions,c=this.#cell,diam=this.radius*2,diam2=diam*diam;this.#heads.fill(-1);
    for(let n=0;n<this.#activeCount;n++){const s=this.#active[n]!,i=s*3;const x=Math.floor(p[i]!/diam),y=Math.floor(p[i+1]!/diam),z=Math.floor(p[i+2]!/diam);
      c[i]=x;c[i+1]=y;c[i+2]=z;const bucket=this.#hash(x,y,z);this.#next[s]=this.#heads[bucket]!;this.#heads[bucket]=s;}
    for(let n=0;n<this.#activeCount;n++){const a=this.#active[n]!;if(this.#sleep[a])continue;const i=a*3,cx=c[i]!,cy=c[i+1]!,cz=c[i+2]!;
      for(let x=cx-1;x<=cx+1;x++)for(let y=cy-1;y<=cy+1;y++)for(let z=cz-1;z<=cz+1;z++){
        for(let b=this.#heads[this.#hash(x,y,z)]!;b!==-1;b=this.#next[b]!){const j=b*3;
          if(b===a||(!this.#sleep[b]&&b<a)||c[j]!==x||c[j+1]!==y||c[j+2]!==z)continue;
          let dx=p[i]!-p[j]!,dy=p[i+1]!-p[j+1]!,dz=p[i+2]!-p[j+2]!,d2=dx*dx+dy*dy+dz*dz;
          if(d2>=diam2)continue;if(d2<1e-12){dx=.0001;dy=dz=0;d2=dx*dx;}
          const distance=Math.sqrt(d2),depth=diam-distance;if(this.#sleep[b]&&depth>this.radius*.25)this.#wake(b);
          const wb=this.#sleep[b]?0:1,scale=depth/(distance*(1+wb));dx*=scale;dy*=scale;dz*=scale;
          p[i]!+=dx;p[i+1]!+=dy;p[i+2]!+=dz;if(wb){p[j]!-=dx;p[j+1]!-=dy;p[j+2]!-=dz;}
          this.#contact[a]=1;this.#contact[b]=1;
        }
      }
    }
  }
  #ropes(){const p=this.positions;
    for(const group of this.groups.values())for(let edge=0;edge<group.links.length;edge++){
      const [na,nb]=group.links[edge]!,a=group.slots[na]!,b=group.slots[nb]!,i=a*3,j=b*3;
      if(this.#sleep[a]&&this.#sleep[b])continue;
      const dx=p[j]!-p[i]!,dy=p[j+1]!-p[i+1]!,dz=p[j+2]!-p[i+2]!,d2=dx*dx+dy*dy+dz*dz,limit=group.lengths[edge]!;
      if(d2<=limit*limit)continue;const d=Math.sqrt(d2);
      if(d-limit>this.radius*.1){this.#wake(a);this.#wake(b);}
      const wa=this.#sleep[a]?0:1,wb=this.#sleep[b]?0:1,scale=(d-limit)/(d*(wa+wb));
      if(wa){p[i]!+=dx*scale;p[i+1]!+=dy*scale;p[i+2]!+=dz*scale;}if(wb){p[j]!-=dx*scale;p[j+1]!-=dy*scale;p[j+2]!-=dz*scale;}
    }
  }
  #walls(slot:number){const i=slot*3,p=this.positions,m=this.#rotation,old=this.#oldRotation,r=this.radius;
    const wx=p[i]!,wy=p[i+1]!-BOX.centerY,wz=p[i+2]!;
    let x=m[0]!*wx+m[3]!*wy+m[6]!*wz,y=m[1]!*wx+m[4]!*wy+m[7]!*wz,z=m[2]!*wx+m[5]!*wy+m[8]!*wz;
    const bx=this.#before[i]!,by=this.#before[i+1]!-BOX.centerY,bz=this.#before[i+2]!;
    const px=old[0]!*bx+old[3]!*by+old[6]!*bz,py=old[1]!*bx+old[4]!*by+old[7]!*bz,pz=old[2]!*bx+old[5]!*by+old[8]!*bz;
    let hit=false;
    for(let wall=0;wall<walls.length;wall++){
      const [hx,hy,hz,cx,cy,cz]=walls[wall]!,lx=cx-hx,ux=cx+hx,ly=cy-hy,uy=cy+hy,lz=cz-hz,uz=cz+hz;
      let nx=x-Math.max(lx,Math.min(ux,x)),ny=y-Math.max(ly,Math.min(uy,y)),nz=z-Math.max(lz,Math.min(uz,z));
      const d2=nx*nx+ny*ny+nz*nz;if(d2>=r*r)continue;let depth:number;
      if(d2>1e-12){const d=Math.sqrt(d2);depth=r-d;nx/=d;ny/=d;nz/=d;}
      else{
        // Entering spheres leave through their entry face, not the underside
        // of a thin floor or rotating wall. This avoids false tunnelling.
        const prior=px<lx||px>ux||py<ly||py>uy||pz<lz||pz>uz;depth=Infinity;
        if((!prior||px<lx)&&x-lx+r<depth){depth=x-lx+r;nx=-1;ny=nz=0;}
        if((!prior||px>ux)&&ux-x+r<depth){depth=ux-x+r;nx=1;ny=nz=0;}
        if((!prior||py<ly)&&y-ly+r<depth){depth=y-ly+r;ny=-1;nx=nz=0;}
        if((!prior||py>uy)&&uy-y+r<depth){depth=uy-y+r;ny=1;nx=nz=0;}
        if((!prior||pz<lz)&&z-lz+r<depth){depth=z-lz+r;nz=-1;nx=ny=0;}
        if((!prior||pz>uz)&&uz-z+r<depth){depth=uz-z+r;nz=1;nx=ny=0;}
      }
      x+=nx*depth;y+=ny*depth;z+=nz*depth;hit=true;
      const group=this.#owners[slot];if(wall===0&&group&&!group.landed&&this.steps-group.born<300){group.landed=true;this.onImpact(x,z,group.kind);}
    }
    if(hit){p[i]=m[0]!*x+m[1]!*y+m[2]!*z;p[i+1]=m[3]!*x+m[4]!*y+m[5]!*z+BOX.centerY;p[i+2]=m[6]!*x+m[7]!*y+m[8]!*z;this.#contact[slot]=1;}
  }
  step(){const started=performance.now();this.#oldRotation.set(this.#rotation);
    this.#inletCredit=Math.min(MAX_PACKET_BEADS,this.#inletCredit+8);
    if(this.queue.length&&this.queue[0]!.beads<=this.#inletCredit){const packet=this.queue.shift()!;this.#inletCredit-=packet.beads;this.#spawn(packet);}
    const next=approachRotation(this.rotation,this.target,2.4*DT);
    const turning=Math.abs(next.x-this.rotation.x)+Math.abs(next.y-this.rotation.y)+Math.abs(next.z-this.rotation.z)+Math.abs(next.w-this.rotation.w)>.00001;
    if(turning){this.rotation=next;matrix(this.#rotation,next);if(!this.#turning)for(const group of this.groups.values())for(const s of group.slots)this.#wake(s);}this.#turning=turning;
    this.#activeCount=0;this.#contact.fill(0);const p=this.positions,v=this.#velocity;
    for(const group of this.groups.values())for(const s of group.slots){this.#active[this.#activeCount++]=s;const i=s*3;
      this.#before[i]=p[i]!;this.#before[i+1]=p[i+1]!;this.#before[i+2]=p[i+2]!;
      // Probe a small rotating slice of sleepers so removing a support cannot
      // leave a suspended pile. Supported particles go straight back to sleep.
      if(this.#sleep[s]&&(s&15)===(this.steps&15)){this.#sleep[s]=0;this.#quiet[s]=44;}
      if(this.#sleep[s])continue;
      v[i+1]!-=9.81*DT;for(let axis=0;axis<3;axis++)p[i+axis]!+=v[i+axis]!*DT;
    }
    for(let iteration=0;iteration<3;iteration++){
      this.#contacts();this.#ropes();for(let n=0;n<this.#activeCount;n++){const s=this.#active[n]!;if(!this.#sleep[s])this.#walls(s);}
    }
    this.sleeping=0;
    for(let n=0;n<this.#activeCount;n++){const s=this.#active[n]!,i=s*3;if(this.#sleep[s]){this.sleeping++;continue;}
      const friction=this.#contact[s] ? .82 : .996;
      let vx=(p[i]!-this.#before[i]!)/DT*friction,vy=(p[i+1]!-this.#before[i+1]!)/DT*friction,vz=(p[i+2]!-this.#before[i+2]!)/DT*friction;
      const speed=Math.hypot(vx,vy,vz);if(speed>10){const scale=10/speed;vx*=scale;vy*=scale;vz*=scale;}
      v[i]=vx;v[i+1]=vy;v[i+2]=vz;
      this.#quiet[s]=!turning&&this.#contact[s]&&speed<.12?Math.min(45,this.#quiet[s]!+1):0;
      if(this.#quiet[s]===45){this.#sleep[s]=1;v[i]=v[i+1]=v[i+2]=0;this.sleeping++;}
    }
    const removed:number[]=[];
    for(const group of this.groups.values()){
      let escaped=true,invalid=false;for(const s of group.slots){const i=s*3,x=p[i]!,y=p[i+1]!,z=p[i+2]!;if(y>PIT_Y&&Math.abs(x)<16&&Math.abs(z)<16)escaped=false;if(!Number.isFinite(x+y+z))invalid=true;}
      if(escaped||invalid){this.#remove(group);removed.push(group.id);if(escaped)this.drained++;else this.omitted++;}
    }
    if(removed.length)this.onRemoved(removed);this.steps++;this.stepMs=performance.now()-started;this.maxStepMs=Math.max(this.maxStepMs,this.stepMs);
  }
  #remove(group:Group){for(const s of group.slots){if(this.#sleep[s])this.sleeping--;this.#owners[s]=undefined;this.free.push(s);}this.linkCount-=group.links.length;this.groups.delete(group.id);}
  clear(){this.discardPending();const ids=[...this.groups.keys()];for(const g of this.groups.values())this.#remove(g);this.sleeping=0;if(ids.length)this.onRemoved(ids);}
  snapshot(buffer:ArrayBuffer){const data=new Float32Array(buffer);if(data.length!==frameSize(this.capacity))throw new Error('Invalid frame buffer');data.fill(0);
    data.set([this.count,this.linkCount,this.groups.size,this.sleeping,this.stepMs,this.omitted,this.drained,this.accepted,this.rotation.x,this.rotation.y,this.rotation.z,this.rotation.w,this.radius,this.steps,this.queue.length,this.maxStepMs]);
    let link=HEADER+this.capacity*4;
    for(const g of this.groups.values()){
      for(const s of g.slots){const i=s*3,at=HEADER+s*4;data[at]=this.positions[i]!;data[at+1]=this.positions[i+1]!;data[at+2]=this.positions[i+2]!;data[at+3]=this.generations[s]!*8+this.#kinds[s]!+1;}
      for(const [a,b]of g.links){data[link++]=g.slots[a]!;data[link++]=g.slots[b]!;}
    }return data;
  }
  destroy(){this.queue.length=0;this.groups.clear();this.#owners.fill(undefined);}
}
