// Cielo nocturno: cúpula con degradado y campo de estrellas.
import * as THREE from 'three';

export function buildSky(scene){
  const geo = new THREE.SphereGeometry(420, 32, 16);
  const c=document.createElement('canvas'); c.width=16; c.height=256; const g=c.getContext('2d');
  const grd=g.createLinearGradient(0,0,0,256);
  grd.addColorStop(0,'#050c1a'); grd.addColorStop(0.55,'#0e2947'); grd.addColorStop(0.8,'#1c4a6e'); grd.addColorStop(1,'#2a5f82');
  g.fillStyle=grd; g.fillRect(0,0,16,256);
  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace;
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({map:tex, side:THREE.BackSide, fog:false})));
  // estrellas
  const N=700, pos=new Float32Array(N*3);
  for(let i=0;i<N;i++){ const th=Math.random()*Math.PI*2, ph=Math.random()*0.55+0.02, r=400;
    pos[i*3]=r*Math.cos(th)*Math.cos(ph); pos[i*3+1]=r*Math.sin(ph)+30; pos[i*3+2]=r*Math.sin(th)*Math.cos(ph); }
  const sg=new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos,3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({color:'#eaf2ff', size:1.5, fog:false, transparent:true, opacity:.75})));
}
