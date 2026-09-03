// Porterías con red de malla y vallas LED publicitarias.
import * as THREE from 'three';
import { F, HALF_W, HALF_L, GOAL_W, GOAL_H, GOAL_DEPTH } from '../../config/field.js';
import { makeNetTexture, makeLedTexture } from '../textures.js';

export function buildLedBoards(){
  const g=new THREE.Group(), H=1.15;
  const mk=(len, tex, rep)=>{
    tex.repeat.set(rep,1);
    const m=new THREE.MeshStandardMaterial({map:tex, emissive:'#ffffff', emissiveMap:tex,
      emissiveIntensity:0.55, roughness:0.55, metalness:0.05});
    return new THREE.Mesh(new THREE.BoxGeometry(len,H,0.22), m);
  };
  // bandas laterales (a lo largo del campo)
  for(const sx of [-1,1]){
    const b=mk(F.L+8, makeLedTexture('#0b2a5e','#123f8a','FÚLBO · SUPERLIGA ESTELAR'), 18);
    b.rotation.y=Math.PI/2; b.position.set(sx*(HALF_W+3.2), H/2, 0); g.add(b);
  }
  // detrás de cada arco
  for(const sz of [-1,1]){
    const b=mk(F.W+8, makeLedTexture('#5a1030','#8c1b46','COPA ESTELAR'), 12);
    b.position.set(0, H/2, sz*(HALF_L+3.2)); g.add(b);
  }
  return g;
}

export function buildGoal(side){
  const g = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({color:'#f4f7ff',metalness:.2,roughness:.35,emissive:'#20304a',emissiveIntensity:.1});
  const r=0.09;
  const post=(x)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,GOAL_H,12),postMat);m.position.set(x,GOAL_H/2,0);m.castShadow=true;return m;};
  const bar=new THREE.Mesh(new THREE.CylinderGeometry(r,r,GOAL_W,12),postMat);
  bar.rotation.z=Math.PI/2; bar.position.set(0,GOAL_H,0); bar.castShadow=true;
  g.add(post(-GOAL_W/2),post(GOAL_W/2),bar);
  // red con malla real (textura con alfa)
  const mkNet=(w,h,rep)=>{
    const t=makeNetTexture(); t.repeat.set(w*rep, h*rep);
    return new THREE.MeshStandardMaterial({map:t, alphaMap:t, transparent:true, opacity:0.9,
      side:THREE.DoubleSide, roughness:1, depthWrite:false, color:'#eef3ff'});
  };
  const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W,GOAL_H), mkNet(GOAL_W,GOAL_H,2.2));
  back.position.set(0,GOAL_H/2,-GOAL_DEPTH*side); g.add(back);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W,GOAL_DEPTH), mkNet(GOAL_W,GOAL_DEPTH,2.2));
  top.rotation.x=Math.PI/2; top.position.set(0,GOAL_H,-GOAL_DEPTH*side/2); g.add(top);
  [-1,1].forEach(sx=>{
    const sd=new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH,GOAL_H), mkNet(GOAL_DEPTH,GOAL_H,2.2));
    sd.rotation.y=Math.PI/2; sd.position.set(sx*GOAL_W/2,GOAL_H/2,-GOAL_DEPTH*side/2); g.add(sd);});
  g.position.set(0,0,side*HALF_L);
  return g;
}
