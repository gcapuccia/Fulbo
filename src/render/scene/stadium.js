// Tribunas, techo y público instanciado.
import * as THREE from 'three';
import { F, HALF_W, HALF_L } from '../../config/field.js';

const crowdMeshes = [];

export function buildStadium(scene){
  const g = new THREE.Group();
  const standMat = new THREE.MeshStandardMaterial({color:'#2c3a4f',roughness:.9});
  const roofMat = new THREE.MeshStandardMaterial({color:'#1a222e',roughness:.55,metalness:.35,side:THREE.DoubleSide});

  // Cuatro tribunas como gradas inclinadas
  const buildStand=(len, depth, pos, rotY)=>{
    const s = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(len, 1, depth), standMat);
    base.position.y=0.5; base.receiveShadow=true; s.add(base);
    const tiers=8;
    for(let i=0;i<tiers;i++){
      const t = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, depth/tiers),
        new THREE.MeshStandardMaterial({color: i%2?'#33425a':'#2a3750',roughness:.9}));
      t.position.set(0, 1+i*1.05, -depth/2 + (i+0.5)*(depth/tiers));
      t.position.y = 1 + i*1.15; t.position.z = -depth/2 + (i+0.5)*(depth/tiers);
      t.castShadow=false; s.add(t);
    }
    // techo
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len+4, 0.4, depth+3), roofMat);
    roof.position.set(0, tiers*1.15+3.5, 1.5); roof.rotation.x=-0.12; s.add(roof);
    // multitud instanciada
    s.add(buildCrowd(len, depth, tiers));
    s.position.copy(pos); s.rotation.y = rotY;
    return s;
  };
  const gap=8;
  g.add(buildStand(F.W+30, 26, new THREE.Vector3(0,0,-(HALF_L+gap+13)), 0));
  g.add(buildStand(F.W+30, 26, new THREE.Vector3(0,0, (HALF_L+gap+13)), Math.PI));
  // laterales más alejadas: dejan libre el pasillo donde vive la cámara de TV
  g.add(buildStand(F.L+20, 24, new THREE.Vector3(-(HALF_W+gap+30),0,0), Math.PI/2));
  g.add(buildStand(F.L+20, 24, new THREE.Vector3( (HALF_W+gap+30),0,0), -Math.PI/2));

  scene.add(g);
}

export function buildCrowd(len, depth, tiers){
  const cols = Math.floor(len/0.62), rows = tiers;   // gradas más llenas
  const total = cols*rows;
  const geo = new THREE.BoxGeometry(0.42,0.7,0.42);
  const mat = new THREE.MeshBasicMaterial({vertexColors:true});
  const inst = new THREE.InstancedMesh(geo, mat, total);
  inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total*3),3);
  const pal = ['#e74c3c','#3498db','#f1c40f','#ecf0f1','#2ecc71','#e67e22','#ffffff','#9b59b6','#1abc9c'];
  const dummy = new THREE.Object3D(); const col = new THREE.Color();
  let idx=0;
  crowdMeshes.push(inst);
  for(let r=0;r<rows;r++)for(let cItr=0;cItr<cols;cItr++){
    const x = -len/2 + (cItr+0.5)*(len/cols) + (Math.random()-0.5)*0.3;
    const y = 1.4 + r*1.15;
    const z = -depth/2 + (r+0.6)*(depth/rows);
    dummy.position.set(x,y,z);
    dummy.scale.setScalar(0.8+Math.random()*0.5);
    dummy.updateMatrix(); inst.setMatrixAt(idx, dummy.matrix);
    col.set(pal[(Math.random()*pal.length)|0]); inst.setColorAt(idx, col);
    inst.userData; idx++;
  }
  inst.instanceMatrix.needsUpdate=true;
  inst.userData.baseY = 1.4;
  return inst;
}
