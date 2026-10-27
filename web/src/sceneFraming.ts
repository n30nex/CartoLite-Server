import { Box3, PerspectiveCamera, Vector3 } from 'three';

export interface SceneViewport { width:number; height:number; left:number; right:number; top:number; bottom:number }

/** Reserve permanent chrome, not temporary menus or inspectors. Read only on resize/Home. */
export function sceneViewport(stage:HTMLElement):SceneViewport {
  const bounds=stage.getBoundingClientRect(), width=stage.clientWidth, height=stage.clientHeight;
  const frame={width,height,left:14,right:14,top:14,bottom:14};
  for(const selector of ['#topbar','.chrono-caption','.firehose-caption']) {
    const node=document.querySelector<HTMLElement>(selector);
    if(node?.getClientRects().length)frame.top=Math.max(frame.top,node.getBoundingClientRect().bottom-bounds.top+14);
  }
  for(const selector of ['.controls','.pachinko-buckets']) {
    const node=document.querySelector<HTMLElement>(selector);
    if(node?.getClientRects().length)frame.bottom=Math.max(frame.bottom,bounds.bottom-node.getBoundingClientRect().top+14);
  }
  return frame;
}

/** Fit a Home view without changing its orientation, position, or control target. */
export function fitSceneCamera(camera:PerspectiveCamera, volumes:readonly Box3[], frame:SceneViewport):void {
  const {width,height,left,right,top,bottom}=frame;
  if(width<=0||height<=0||Math.max(left,right)>=width/2||Math.max(top,bottom)>=height/2||!volumes.length||volumes.some(volume=>volume.isEmpty()))return;
  const limits=[1-(left+right)/width,1-(top+bottom)/height];
  // Fit in both directions. Starting at 1 left small cabinets stranded in the
  // middle of wide screens even when most of the usable viewport was empty.
  const oldZoom=camera.zoom,oldView=camera.view?{...camera.view}:null,point=new Vector3();let zoom=4;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  camera.zoom=1;camera.clearViewOffset();camera.updateProjectionMatrix();camera.updateMatrixWorld();
  for(const volume of volumes)for(const x of [volume.min.x,volume.max.x])for(const y of [volume.min.y,volume.max.y])for(const z of [volume.min.z,volume.max.z]) {
    point.set(x,y,z).project(camera);
    if(!Number.isFinite(point.x+point.y+point.z)||point.z< -1||point.z>1){camera.zoom=oldZoom;camera.view=oldView;camera.updateProjectionMatrix();return;}
    minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);
  }
  if(maxX>minX)zoom=Math.min(zoom,2*limits[0]!/(maxX-minX));
  if(maxY>minY)zoom=Math.min(zoom,2*limits[1]!/(maxY-minY));
  // Center the projected silhouette as well as the usable viewport. Fitting
  // around the orbit target alone wastes space for tall, asymmetric machines.
  camera.zoom=Math.max(.04,zoom*.96);
  camera.setViewOffset(width,height,(right-left)/2+camera.zoom*(minX+maxX)*width/4,(bottom-top)/2-camera.zoom*(minY+maxY)*height/4,width,height);
}
