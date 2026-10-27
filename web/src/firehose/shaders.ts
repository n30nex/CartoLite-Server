// Shared pose interpolation; reused slots never streak from a previous packet.
export const positionFunctions=`
uniform sampler2D uPrevious,uCurrent,uBirth;uniform float uBlend,uClipTop;
ivec2 cell(float slot){return ivec2(int(slot)%128,int(slot)/128);}
vec4 bead(float slot){vec4 b=texelFetch(uCurrent,cell(slot),0),a=texelFetch(uPrevious,cell(slot),0);if(floor(a.w/8.0)!=floor(b.w/8.0))a=b;return vec4(mix(a.xyz,b.xyz,uBlend),b.w);}
vec3 movement(float slot){vec4 b=texelFetch(uCurrent,cell(slot),0),a=texelFetch(uPrevious,cell(slot),0);return floor(a.w/8.0)==floor(b.w/8.0)?b.xyz-a.xyz:vec3(0.0);}
float birth(float slot){return texelFetch(uBirth,cell(slot),0).r;}
`;
const colour=`
uniform vec3 uPalette[6],uDarkPalette[6];uniform float uLight,uFadeStart,uFadeEnd,uClipTop,uMachine;
vec3 ink(float kind,float y){int k=int(clamp(kind,0.0,5.0));return y<-.6?uDarkPalette[k]:uPalette[k];}
vec3 srgb(vec3 c){return pow(max(c,vec3(0.0)),vec3(1.0/2.2));}
`;
export const dotVertex=`
${positionFunctions}
in float aSlot,aSelected;uniform float uRadius,uHeight,uDpr,uCore,uTime;
out float vKind,vSelected,vY,vAge;
void main(){vec4 b=bead(aSlot);vKind=mod(b.w,8.0)-1.0;vSelected=aSelected;vY=b.y;vAge=max(0.0,uTime-birth(aSlot));
 vec4 eye=modelViewMatrix*vec4(b.xyz,1.0);gl_Position=projectionMatrix*eye;
 gl_PointSize=clamp(uRadius*uHeight*projectionMatrix[1][1]/max(.1,-eye.z)*.7*uCore,3.8*uDpr,32.0*uDpr);
 if(b.w<.5||eye.z>=-.05||b.y>uClipTop){gl_Position=vec4(2.0,2.0,2.0,1.0);gl_PointSize=0.0;}}
`;
export const dotFragment=`
${colour}
in float vKind,vSelected,vY,vAge;out vec4 outColor;
void main(){vec2 p=gl_PointCoord*2.0-1.0;float r=length(p);if(r>1.0||vKind<0.0)discard;
 vec3 c=ink(vKind,vY);bool light=uLight>.5&&vY>-.6;
 vec3 normal=vec3(p.x,-p.y,sqrt(max(0.0,1.0-r*r)));
 float facing=max(0.0,dot(normal,normalize(vec3(-.35,.55,1.0))));
 float fresh=1.0-smoothstep(.5,3.0,vAge),shine=pow(facing,22.0);
 vec3 lit=light?c*(.65+.35*facing):c*(.65+.65*facing+fresh*.25)+vec3(shine*.38);
 lit=mix(lit,light?vec3(.92,.96,.98):c*.2,smoothstep(.82,.98,r));
 if(vSelected>.5)lit=mix(lit,vec3(1.0,.72,.2),smoothstep(.55,.8,r));
 float edge=1.0-smoothstep(1.0-max(.02,fwidth(r)*1.3),1.0,r);
 lit*=1.0-smoothstep(uFadeStart,uFadeEnd,-vY);outColor=vec4(srgb(lit),edge);}
`;
export const beadVertex=`
${positionFunctions}
in float aSlot;uniform float uRadius,uHeight,uDpr,uTime,uGlow;
out float vKind,vAge,vY;
void main(){vec4 b=bead(aSlot);vKind=mod(b.w,8.0)-1.0;vAge=max(0.0,uTime-birth(aSlot));vY=b.y;
 vec4 eye=modelViewMatrix*vec4(b.xyz,1.0);gl_Position=projectionMatrix*eye;
 gl_PointSize=clamp(uRadius*uHeight*projectionMatrix[1][1]/max(.1,-eye.z)*1.5,7.0*uDpr,48.0*uDpr);
 if(b.w<.5||eye.z>=-.05||b.y>uClipTop||vAge>3.2||uGlow<.005){gl_Position=vec4(2.0,2.0,2.0,1.0);gl_PointSize=0.0;}}
`;
export const beadFragment=`
${colour}
uniform float uGlow;in float vKind,vAge,vY;out vec4 outColor;
void main(){vec2 p=gl_PointCoord*2.0-1.0;float r2=dot(p,p);if(r2>1.0||vKind<0.0)discard;
 float ring=exp(-pow((sqrt(r2)-.55)*12.0,2.0))*max(0.0,1.0-vAge/.7);
 float alpha=(exp(-r2*6.5)*.3+ring*.12)*max(0.0,1.0-vAge/3.2)*uGlow*(1.0-smoothstep(uFadeStart,uFadeEnd,-vY));
 if(alpha<.005)discard;outColor=vec4(srgb(ink(vKind,vY)),alpha);}
`;
export const trailVertex=`
${positionFunctions}
in float aSlot;uniform vec2 uResolution;uniform float uDpr,uTime,uTrail,uMotion;
out float vAcross,vAlong,vKind,vY,vStrength;
void main(){vec4 b=bead(aSlot);vec3 delta=movement(aSlot);vec4 head=projectionMatrix*modelViewMatrix*vec4(b.xyz,1.0);
 vec4 back=projectionMatrix*modelViewMatrix*vec4(b.xyz-delta,1.0);
 vec2 pixels=(head.xy/max(.01,head.w)-back.xy/max(.01,back.w))*uResolution*.5;float speed=length(pixels);
 vec2 direction=speed>.01?pixels/speed:vec2(0.0,1.0),normal=vec2(-direction.y,direction.x);
 float lengthPx=min(30.0*uDpr,speed*1.8*uTrail);vec4 p=head;
 p.xy+=(-direction*position.x*lengthPx+normal*position.y*1.6*uDpr)/uResolution*2.0*p.w;
 gl_Position=p;vAcross=position.y;vAlong=position.x;vKind=mod(b.w,8.0)-1.0;vY=b.y;vStrength=smoothstep(.5,2.0,speed)*uMotion;
 if(b.w<.5||head.w<.05||b.y>uClipTop||vStrength<.01)gl_Position=vec4(2.0,2.0,2.0,1.0);}
`;
export const trailFragment=`
${colour}
in float vAcross,vAlong,vKind,vY,vStrength;out vec4 outColor;
void main(){if(vKind<0.0)discard;float alpha=(1.0-smoothstep(.15,1.0,abs(vAcross)))*pow(1.0-vAlong,1.8)*vStrength*.85*(1.0-smoothstep(uFadeStart,uFadeEnd,-vY));
 if(alpha<.005)discard;outColor=vec4(srgb(ink(vKind,vY)*1.2),alpha);}
`;
export const linkVertex=`
${positionFunctions}
in vec2 aEnds;uniform vec2 uResolution;uniform float uWidth,uTime;
out float vAcross,vAlong,vKind,vY,vAge,vProgress;
void main(){vec4 a=bead(aEnds.x),b=bead(aEnds.y);vec4 pa=projectionMatrix*modelViewMatrix*vec4(a.xyz,1.0),pb=projectionMatrix*modelViewMatrix*vec4(b.xyz,1.0);
 vec2 delta=(pb.xy/max(.01,pb.w)-pa.xy/max(.01,pa.w))*uResolution;float len=length(delta)*.5;
 vec2 normal=len>.01?normalize(vec2(-delta.y,delta.x)):vec2(0.0,1.0);vec4 p=mix(pa,pb,position.x);p.xy+=normal*position.y*uWidth/uResolution*p.w;
 gl_Position=p;vAcross=position.y;vAlong=position.x*len;vProgress=position.x;vKind=mod(a.w,8.0)-1.0;vY=mix(a.y,b.y,position.x);vAge=max(0.0,uTime-birth(aEnds.x));
 if(a.w<.5||b.w<.5||pa.w<.05||pb.w<.05)gl_Position=vec4(2.0,2.0,2.0,1.0);}
`;
export const linkFragment=`
${colour}
uniform float uOpacity,uPattern,uMotion;in float vAcross,vAlong,vKind,vY,vAge,vProgress;out vec4 outColor;
void main(){if(vKind<0.0||vY>uClipTop)discard;
 if(uPattern>.5&&uPattern<1.5&&mod(vAlong,13.0)>8.0)discard;if(uPattern>1.5&&mod(vAlong,6.0)>2.0)discard;
 float fresh=1.0-smoothstep(.7,3.0,vAge),pulse=exp(-pow((vProgress-fract(vAge*.9))*9.0,2.0))*fresh*uMotion;
 float alpha=(1.0-smoothstep(.45,1.0,abs(vAcross)))*uOpacity*(.65+fresh*.25+pulse*.1)*(1.0-smoothstep(uFadeStart,uFadeEnd,-vY));
 vec3 c=ink(vKind,vY);if(uLight<.5||vY<-.6)c=c*(1.0+pulse)+vec3(pulse*.4);
 outColor=vec4(srgb(c),alpha);}
`;
export const rippleVertex=`
in vec4 aImpact;uniform float uTime,uMachine;out vec2 vUV,vLocal;out float vAge,vKind;
void main(){vAge=uTime-aImpact.z;vKind=aImpact.w;vUV=position.xy;float radius=.08+max(0.0,vAge)*(uMachine>.5?.36:1.1);
 vLocal=aImpact.xy+position.xy*radius;gl_Position=projectionMatrix*modelViewMatrix*(uMachine>.5?vec4(vLocal.x,vLocal.y,.34,1.0):vec4(vLocal.x,-.438,vLocal.y,1.0));
 if(vAge<0.0||vAge>1.15)gl_Position=vec4(2.0,2.0,2.0,1.0);}
`;
export const rippleFragment=`
${colour}
uniform float uMotion;in vec2 vUV,vLocal;in float vAge,vKind;out vec4 outColor;
void main(){if(uMachine>.5){if(abs(vLocal.x)>3.3||vLocal.y< -3.4||vLocal.y>4.6)discard;}else if(abs(vLocal.x)>2.4||abs(vLocal.y)>1.6)discard;float r=length(vUV),ring=1.0-smoothstep(.025,.075,abs(r-.88));
 float flash=exp(-r*r*18.0)*max(0.0,1.0-vAge/.22);
 float alpha=(ring*.7+flash)*pow(max(0.0,1.0-vAge/1.15),2.0)*uMotion;if(alpha<.005)discard;
 outColor=vec4(srgb(ink(vKind,0.0)*1.25),alpha);}
`;
export const wellVertex=`
out vec2 vUV;void main(){vUV=uv*2.0-1.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
export const wellFragment=`
uniform float uDrainEnergy,uTime,uMotion;in vec2 vUV;out vec4 outColor;
void main(){float r=length(vUV);float ring=0.0;if(uDrainEnergy>.001&&uMotion>.001)ring=pow(.5+.5*cos(r*46.0-uTime*4.0*uMotion),16.0);
 vec3 light=vec3(.015,.24,.32)*(pow(r,4.0)*.14+ring*uDrainEnergy*.24);
 outColor=vec4(pow(vec3(.001,.004,.008)+light,vec3(1.0/2.2)),1.0);}
`;
