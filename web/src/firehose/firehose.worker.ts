import { FirehosePhysics, initializePhysics } from './physics';
import { frameSize, type Input, type Output } from './model';

// No shared memory or unbounded snapshots: three transferable buffers circulate.
const port=self as unknown as {onmessage:((event:MessageEvent<Input>)=>void)|null;postMessage:(value:Output,transfer?:Transferable[])=>void};
let physics:FirehosePhysics|undefined, paused=false, disposed=false, initializing=false;
let timer:ReturnType<typeof setTimeout>|undefined, last=0, accumulator=0, lastFrame=0;
const pool:ArrayBuffer[]=[];
function post(value:Output,transfer:Transferable[]=[]){if(!disposed)port.postMessage(value,transfer);}
function fail(){if(timer)clearTimeout(timer);physics?.destroy();physics=undefined;post({type:'fatal'});disposed=true;}
function idle(){return Boolean(physics&&physics.sleeping===physics.count&&!physics.queue.length&&Math.abs(physics.rotation.x-physics.target.x)+Math.abs(physics.rotation.y-physics.target.y)+Math.abs(physics.rotation.z-physics.target.z)+Math.abs(physics.rotation.w-physics.target.w)<.0001);}
function schedule(){if(!paused&&!disposed&&physics&&timer===undefined)timer=setTimeout(tick,idle()?80:8);}
function publish(){if(physics&&pool.length){const buffer=pool.pop()!;physics.snapshot(buffer);post({type:'frame',buffer},[buffer]);lastFrame=performance.now();}}
function tick(){timer=undefined;if(!physics||paused||disposed)return;try{
  const now=performance.now();accumulator=Math.min(accumulator+(now-last)/1000,1/30);last=now;
  const started=performance.now();
  if(idle()){accumulator=0;}else while(accumulator>=1/60){physics.step();accumulator-=1/60;if(performance.now()-started>10)break;}
  if(pool.length&&now-lastFrame>=(idle()?500:1000/30))publish();
  schedule();
}catch{fail();}}
port.onmessage=event=>{const message=event.data;
  if(disposed)return;
  if(message.type==='init'){
    if(initializing||physics)return;initializing=true;
    void initializePhysics().then(()=>{if(disposed)return;physics=new FirehosePhysics(message.capacity);
      physics.onAccepted=(id,slots)=>post({type:'accepted',id,slots});physics.onRejected=id=>post({type:'rejected',id});physics.onRemoved=ids=>post({type:'removed',ids});
      physics.onImpact=(x,z,kind)=>post({type:'impact',x,z,kind});
      post({type:'ready',capacity:physics.capacity,radius:physics.radius});last=performance.now();schedule();
    }).catch(fail);return;
  }
  if(message.type==='recycle'){if(physics&&message.buffer.byteLength===frameSize(physics.capacity)*4&&pool.length<3){pool.push(message.buffer);if(lastFrame===0)publish();}return;}
  if(message.type==='pause'){paused=message.paused;physics?.discardPending();if(timer)clearTimeout(timer);timer=undefined;accumulator=0;last=performance.now();schedule();return;}
  if(message.type==='packet'){if(physics&&!paused)physics.enqueue(message.packet);else post({type:'rejected',id:message.packet.id});return;}
  if(message.type==='rotation'){physics?.setRotation(message.rotation);return;}
  if(message.type==='clear'){physics?.clear();publish();return;}
  if(message.type==='dispose'){disposed=true;if(timer)clearTimeout(timer);physics?.destroy();physics=undefined;pool.length=0;}
};
