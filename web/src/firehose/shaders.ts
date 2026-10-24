// Positions interpolate on the GPU; a frame updates two small float textures.
export const positionFunctions = `
uniform sampler2D uPrevious;
uniform sampler2D uCurrent;
uniform float uBlend;
vec4 bead(float slot) {
  ivec2 cell=ivec2(int(slot)%128,int(slot)/128);
  vec4 b=texelFetch(uCurrent,cell,0),a=texelFetch(uPrevious,cell,0);
  if(floor(a.w/8.0)!=floor(b.w/8.0))a=b;
  return vec4(mix(a.xyz,b.xyz,uBlend),b.w);
}
`;
export const beadVertex = `
${positionFunctions}
in float aSlot;in float aBorn;in float aSelected;
uniform float uRadius;uniform float uHeight;uniform float uDpr;uniform float uHalo;uniform float uTime;uniform float uGlow;
out vec3 vCenter;out float vKind;out float vBorn;out float vSelected;out float vWorldY;
void main(){
 vec4 b=bead(aSlot);vKind=mod(b.w,8.0)-1.0;vBorn=aBorn;vSelected=aSelected;vWorldY=b.y;
 vec4 eye=modelViewMatrix*vec4(b.xyz,1.0);vCenter=eye.xyz;gl_Position=projectionMatrix*eye;
 float pixels=uRadius*uHeight*projectionMatrix[1][1]/max(0.1,-eye.z);
 gl_PointSize=clamp(pixels,2.5*uDpr,48.0*uDpr)*(uHalo>0.5?1.8:1.0);
 if(b.w<0.5||eye.z>=-0.05||(uHalo>.5&&(uTime-aBorn>2.8||uGlow<.005))){gl_Position=vec4(2.0,2.0,2.0,1.0);gl_PointSize=0.0;}
}
`;
export const beadFragment = `
uniform mat4 projectionMatrix;
uniform vec3 uPalette[6];uniform float uRadius;uniform float uTime;uniform float uHalo;
uniform float uGlow;uniform float uLight;uniform float uCore;
in vec3 vCenter;in float vKind;in float vBorn;in float vSelected;in float vWorldY;
out vec4 outColor;
void main(){
 vec2 p=gl_PointCoord*2.0-1.0;p.y=-p.y;float r2=dot(p,p);if(r2>1.0||vKind<0.0)discard;gl_FragDepth=gl_FragCoord.z;
 vec3 color=uPalette[int(clamp(vKind,0.0,5.0))];
 float fade=1.0-smoothstep(2.7,4.7,-vWorldY);
 if(uHalo>0.5){float age=max(0.0,uTime-vBorn);float alpha=exp(-r2*4.5)*max(0.0,1.0-age/2.8)*uGlow*.23*fade;
   if(alpha<.005)discard;outColor=vec4(pow(color,vec3(1.0/2.2)),alpha);return;}
 vec3 normal=vec3(p,sqrt(max(0.0,1.0-r2)));
 float diffuse=.3+.7*max(0.0,dot(normal,normalize(vec3(-.4,.7,1.0))));
 float core=1.0-smoothstep(.08*uCore,.5*uCore,sqrt(r2));
 float specular=pow(max(0.0,dot(normal,normalize(vec3(-.3,.55,1.0)))),28.0);
 vec3 shaded=color*(diffuse*.78+core*.55)+vec3(specular*.8+vSelected*.45*(1.0-smoothstep(.7,.93,sqrt(r2))));
 if(uLight>.5)shaded=mix(color*.35,color,diffuse)*(1.0-core*.2)+vec3(specular*.32);
 if(vSelected>.5)shaded=mix(shaded,vec3(1.0,.9,.55),smoothstep(.72,.9,sqrt(r2)));
 vec4 clip=projectionMatrix*vec4(vCenter+normal*uRadius,1.0);gl_FragDepth=clip.z/clip.w*.5+.5;
 outColor=vec4(pow(max(shaded,vec3(0.0)),vec3(1.0/2.2)),fade);
}
`;
// Opaque instanced spheres allow early depth rejection through a dense pile.
// Writing per-fragment sphere depth on thousands of overlapping sprites defeats it.
export const solidVertex = `
${positionFunctions}
in float aSlot;in float aSelected;uniform float uRadius;
out vec3 vNormal;out float vKind;out float vSelected;out float vWorldY;
void main(){
 vec4 b=bead(aSlot);vKind=mod(b.w,8.0)-1.0;vSelected=aSelected;vWorldY=b.y;
 vNormal=normalMatrix*normalize(position);
 gl_Position=projectionMatrix*modelViewMatrix*vec4(b.xyz+position*uRadius,1.0);
 if(b.w<.5)gl_Position=vec4(2.0,2.0,2.0,1.0);
}
`;
export const solidFragment = `
uniform vec3 uPalette[6];uniform vec3 uDarkPalette[6];uniform float uLight;uniform float uCore;
in vec3 vNormal;in float vKind;in float vSelected;in float vWorldY;out vec4 outColor;
void main(){
 if(vKind<0.0)discard;int kind=int(clamp(vKind,0.0,5.0));
 vec3 color=vWorldY< -1.3?uDarkPalette[kind]:uPalette[kind];
 vec3 n=normalize(vNormal);float diffuse=.35+.65*max(0.0,dot(n,normalize(vec3(-.4,.7,1.0))));
 float spec=pow(max(0.0,dot(n,normalize(vec3(-.3,.55,1.0)))),24.0);
 float core=pow(max(0.0,n.z),5.0/max(.5,uCore));
 bool light=uLight>.5&&vWorldY> -1.3;
 vec3 shade=light?color*(.4+diffuse*.6)+vec3(spec*.25):color*(diffuse*.85+core*.3)+vec3(spec*.65);
 if(vSelected>.5)shade=mix(shade,vec3(1.0,.9,.55),smoothstep(.6,1.0,1.0-n.z));
 shade*=1.0-smoothstep(3.6,4.7,-vWorldY);
 outColor=vec4(pow(max(shade,vec3(0.0)),vec3(1.0/2.2)),1.0);
}
`;
export const linkVertex = `
${positionFunctions}
in vec2 aEnds;uniform vec2 uResolution;uniform float uWidth;
out float vAcross;out float vAlong;out float vKind;out float vWorldY;
void main(){
 vec4 a=bead(aEnds.x),b=bead(aEnds.y);
 vec4 pa=projectionMatrix*modelViewMatrix*vec4(a.xyz,1.0),pb=projectionMatrix*modelViewMatrix*vec4(b.xyz,1.0);
 vec2 delta=(pb.xy/max(.01,pb.w)-pa.xy/max(.01,pa.w))*uResolution;
 float lengthPx=length(delta)*.5;vec2 perpendicular=lengthPx>.01?normalize(vec2(-delta.y,delta.x)):vec2(0.0,1.0);
 vec4 point=mix(pa,pb,position.x);point.xy+=perpendicular*position.y*uWidth/uResolution*point.w;
 gl_Position=point;vAcross=position.y;vAlong=position.x*lengthPx;vKind=mod(a.w,8.0)-1.0;vWorldY=mix(a.y,b.y,position.x);
 if(a.w<.5||b.w<.5||pa.w<.05||pb.w<.05)gl_Position=vec4(2.0,2.0,2.0,1.0);
}
`;
export const linkFragment = `
uniform vec3 uPalette[6];uniform float uOpacity;uniform float uPattern;uniform float uLight;
in float vAcross;in float vAlong;in float vKind;in float vWorldY;out vec4 outColor;
void main(){
 if(vKind<0.0)discard;
 if(uPattern>.5&&uPattern<1.5&&mod(vAlong,13.0)>8.0)discard;
 if(uPattern>1.5&&mod(vAlong,6.0)>2.0)discard;
 float alpha=(1.0-smoothstep(.35,1.0,abs(vAcross)))*uOpacity*(1.0-smoothstep(2.7,4.7,-vWorldY));
 vec3 color=uPalette[int(clamp(vKind,0.0,5.0))];
 outColor=vec4(pow(color*(uLight>.5?.7:1.05),vec3(1.0/2.2)),alpha);
}
`;
