// Iluminación del estadio y torres de focos.
import * as THREE from 'three';
import { HALF_W, HALF_L } from '../../config/field.js';

export function buildLights(scene, calidad){
  // Luz más neutra: antes el tinte azul/cálido falseaba los colores de las camisetas
  // (el amarillo se veía naranja y el negro, azulado).
  const hemi = new THREE.HemisphereLight('#dfe9f5', '#41563f', 0.55);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight('#ffffff', 0.22));

  const sun = new THREE.DirectionalLight('#fffaf2', 1.25);
  sun.position.set(-60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(calidad==='alta'?2048:1024, calidad==='alta'?2048:1024);
  const d = 80;
  sun.shadow.camera.left=-d; sun.shadow.camera.right=d;
  sun.shadow.camera.top=d; sun.shadow.camera.bottom=-d;
  sun.shadow.camera.near=10; sun.shadow.camera.far=260;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // Torres de luz (4 esquinas) — sólo estético + un poco de relleno
  const cornerX = HALF_W+10, cornerZ = HALF_L+8;
  [[-cornerX,-cornerZ],[cornerX,-cornerZ],[-cornerX,cornerZ],[cornerX,cornerZ]].forEach(([x,z])=>{
    const fill = new THREE.PointLight('#dfeaff', 0.35, 220, 2.0);
    fill.position.set(x, 34, z);
    scene.add(fill);
    scene.add(buildFloodTower(x,z));
  });
}

export function buildFloodTower(x,z){
  const g = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.5,32,10),
    new THREE.MeshStandardMaterial({color:'#3a4655',metalness:.6,roughness:.5}));
  mast.position.y=16; mast.castShadow=true; g.add(mast);
  const rig = new THREE.Mesh(new THREE.BoxGeometry(7,3.4,1.2),
    new THREE.MeshStandardMaterial({color:'#2b333d',metalness:.5,roughness:.6}));
  rig.position.set(0,33,0); g.add(rig);
  const lampGeo = new THREE.BoxGeometry(1.5,1.4,0.4);
  const lampMat = new THREE.MeshStandardMaterial({color:'#fff8e6',emissive:'#fff2c8',emissiveIntensity:6.0});
  for(let i=-2;i<=2;i++)for(let j=-1;j<=1;j++){
    const l=new THREE.Mesh(lampGeo,lampMat); l.position.set(i*1.3,33+j*1.0,0.7); g.add(l);
  }
  g.position.set(x,0,z);
  g.lookAt(0,20,0);
  return g;
}
