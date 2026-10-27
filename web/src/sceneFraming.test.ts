import { expect,it } from 'vitest';
import { Box3,PerspectiveCamera,Vector3 } from 'three';
import { fitSceneCamera } from './sceneFraming';

it('enlarges a distant scene into usable space instead of only shrinking it',()=>{
  const camera=new PerspectiveCamera(38,1440/900,.05,200);
  camera.position.set(0,0,30);camera.lookAt(0,0,0);
  const box=new Box3(new Vector3(-3,-3,-1),new Vector3(3,3,1));
  fitSceneCamera(camera,[box],{width:1440,height:900,left:14,right:14,top:110,bottom:90});
  expect(camera.zoom).toBeGreaterThan(1);
  const top=new Vector3(0,3,1).project(camera),bottom=new Vector3(0,-3,1).project(camera);
  expect((top.y-bottom.y)*450).toBeGreaterThan(700*.85);
  expect((1-top.y)*450).toBeGreaterThanOrEqual(110);
  expect((1-bottom.y)*450).toBeLessThanOrEqual(810);
});

it('keeps the whole sculpture inside phone and short-screen chrome without moving the camera',()=>{
  const box=new Box3(new Vector3(-6.5,-.3,-4.5),new Vector3(6.5,5.3,4.5));
  for(const [width,height,top,bottom] of [[320,720,120,80],[568,320,70,80],[568,320,60,180],[1440,900,130,65]]){
    const camera=new PerspectiveCamera(42,width!/height!,.05,200);camera.position.set(11,10,15);camera.lookAt(0,2.25,0);
    const pose=camera.position.clone(),angle=camera.quaternion.clone();
    fitSceneCamera(camera,[box],{width:width!,height:height!,left:14,right:14,top:top!,bottom:bottom!});
    expect(camera.position.equals(pose)).toBe(true);expect(camera.quaternion.equals(angle)).toBe(true);
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const p=new Vector3(x,y,z).project(camera),px=(p.x+1)*width!/2,py=(1-p.y)*height!/2;
      expect(px).toBeGreaterThanOrEqual(14);expect(px).toBeLessThanOrEqual(width!-14);
      expect(py).toBeGreaterThanOrEqual(top!);expect(py).toBeLessThanOrEqual(height!-bottom!);
    }
  }
});
