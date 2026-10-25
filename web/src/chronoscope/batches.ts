import * as THREE from 'three';

export interface Position3 { x:number; y:number; z:number }
const fragment = `
uniform float uLight,uPattern;in vec4 vInk;in float vAcross,vAlong,vHalo;out vec4 outColor;
void main(){if(vInk.a<.001)discard;if(uPattern>.5&&uPattern<1.5&&mod(vAlong,13.)>8.)discard;if(uPattern>1.5&&mod(vAlong,6.)>2.)discard;
if(vHalo>.5){outColor=vec4(pow(max(vInk.rgb,vec3(0)),vec3(1./2.2)),exp(-vAcross*vAcross*4.5)*vInk.a);return;}
float edge=1.-smoothstep(.78,1.,abs(vAcross));vec3 outline=uLight>.5?vec3(.95,.98,1.):vec3(.002,.009,.012);
vec3 ink=mix(outline,vInk.rgb,1.-smoothstep(.72,.92,abs(vAcross)));outColor=vec4(pow(max(ink,vec3(0)),vec3(1./2.2)),vInk.a*edge);}`;

/** Screen-width strokes have real world endpoints and avoid hardware line limits. */
export class SculptureStrokes {
  readonly geometry=new THREE.InstancedBufferGeometry();
  readonly mesh:THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>;
  readonly from:Float32Array;readonly to:Float32Array;readonly ink:Float32Array;readonly widths:Float32Array;readonly halos:Float32Array;
  count=0;
  constructor(readonly capacity:number,uniforms:Record<string,THREE.IUniform>){
    this.from=new Float32Array(capacity*3);this.to=new Float32Array(capacity*3);this.ink=new Float32Array(capacity*4);this.widths=new Float32Array(capacity);this.halos=new Float32Array(capacity);
    this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,-1,0,1,-1,0,1,1,0,0,-1,0,1,1,0,0,1,0],3));
    for(const [name,data,size] of [['aFrom',this.from,3],['aTo',this.to,3],['aInk',this.ink,4],['aWidth',this.widths,1],['aHalo',this.halos,1]] as const)this.geometry.setAttribute(name,new THREE.InstancedBufferAttribute(data,size).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount=0;
    const vertex=`in vec3 aFrom,aTo;in vec4 aInk;in float aWidth,aHalo;uniform vec2 uResolution;uniform float uDpr;out vec4 vInk;out float vAcross,vAlong,vHalo;
void main(){vec4 a=projectionMatrix*modelViewMatrix*vec4(aFrom,1.),b=projectionMatrix*modelViewMatrix*vec4(aTo,1.);vec2 d=(b.xy/max(.01,b.w)-a.xy/max(.01,a.w))*uResolution*.5;float len=length(d);vec2 n=len>.01?vec2(-d.y,d.x)/len:vec2(0,1);vec4 p=mix(a,b,position.x);p.xy+=n*position.y*aWidth*uDpr/uResolution*p.w;gl_Position=p;vInk=aInk;vAcross=position.y;vAlong=position.x*len/max(1.,uDpr);vHalo=aHalo;if(a.w<.05||b.w<.05)gl_Position=vec4(2,2,2,1);}`;
    this.mesh=new THREE.Mesh(this.geometry,new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,toneMapped:false}));this.mesh.frustumCulled=false;this.mesh.renderOrder=2;
  }
  add(a:Position3,b:Position3,color:THREE.Color,opacity:number,width:number,halo=false):void{
    if(this.count>=this.capacity)throw new Error('Sculpture stroke budget exceeded');const i=this.count++;
    const p=i*3,c=i*4;this.from[p]=a.x;this.from[p+1]=a.y;this.from[p+2]=a.z;this.to[p]=b.x;this.to[p+1]=b.y;this.to[p+2]=b.z;this.ink[c]=color.r;this.ink[c+1]=color.g;this.ink[c+2]=color.b;this.ink[c+3]=opacity;this.widths[i]=width;this.halos[i]=halo?1:0;
  }
  upload(){this.geometry.instanceCount=this.count;if(!this.count)return;for(const name of ['aFrom','aTo','aInk','aWidth','aHalo']){const attribute=this.geometry.getAttribute(name) as THREE.BufferAttribute;attribute.updateRanges.length=0;attribute.addUpdateRange(0,this.count*attribute.itemSize);attribute.needsUpdate=true;}}
  dispose(){this.geometry.dispose();this.mesh.material.dispose();}
}

export class SculptureDots {
  readonly geometry=new THREE.BufferGeometry();readonly mesh:THREE.Points<THREE.BufferGeometry,THREE.ShaderMaterial>;
  readonly positions:Float32Array;readonly ink:Float32Array;readonly sizes:Float32Array;count=0;
  constructor(readonly capacity:number,uniforms:Record<string,THREE.IUniform>){
    this.positions=new Float32Array(capacity*3);this.ink=new Float32Array(capacity*4);this.sizes=new Float32Array(capacity);
    this.geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));this.geometry.setAttribute('aInk',new THREE.BufferAttribute(this.ink,4).setUsage(THREE.DynamicDrawUsage));this.geometry.setAttribute('aSize',new THREE.BufferAttribute(this.sizes,1).setUsage(THREE.DynamicDrawUsage));this.geometry.setDrawRange(0,0);
    this.mesh=new THREE.Points(this.geometry,new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms,transparent:true,depthWrite:false,toneMapped:false,
      vertexShader:`in vec4 aInk;in float aSize;uniform float uDpr;out vec4 vInk;void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=aSize*uDpr;vInk=aInk;if(p.z>=-.05)gl_Position=vec4(2,2,2,1);}`,
      fragmentShader:`uniform float uLight;in vec4 vInk;out vec4 outColor;void main(){vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.||vInk.a<.001)discard;vec3 n=vec3(p.x,-p.y,sqrt(max(0.,1.-r)));float shade=.36+.64*max(0.,dot(n,normalize(vec3(-.4,.6,1.))));vec3 ink=vInk.rgb*shade;if(uLight<.5)ink+=vec3(pow(max(0.,1.-r),5.)*.55);float edge=1.-smoothstep(.72,1.,r);outColor=vec4(pow(max(ink,vec3(0)),vec3(1./2.2)),vInk.a*edge);}`
    }));this.mesh.frustumCulled=false;this.mesh.renderOrder=3;
  }
  add(p:Position3,color:THREE.Color,opacity:number,size:number){if(this.count>=this.capacity)throw new Error('Sculpture point budget exceeded');const i=this.count++,at=i*3,c=i*4;this.positions[at]=p.x;this.positions[at+1]=p.y;this.positions[at+2]=p.z;this.ink[c]=color.r;this.ink[c+1]=color.g;this.ink[c+2]=color.b;this.ink[c+3]=opacity;this.sizes[i]=size;}
  upload(){this.geometry.setDrawRange(0,this.count);if(!this.count)return;for(const name of ['position','aInk','aSize']){const attribute=this.geometry.getAttribute(name) as THREE.BufferAttribute;attribute.updateRanges.length=0;attribute.addUpdateRange(0,this.count*attribute.itemSize);attribute.needsUpdate=true;}}
  dispose(){this.geometry.dispose();this.mesh.material.dispose();}
}
