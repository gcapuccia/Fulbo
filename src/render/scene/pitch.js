// El terreno de juego: césped, líneas, suelo del recinto, arcos y vallas.
import * as THREE from 'three';
import { F } from '../../config/field.js';
import { makePitchTexture } from '../textures.js';
import { buildGoal, buildLedBoards } from './goals.js';

export function buildField(scene){
  const g = new THREE.Group();
  // suelo amplio del recinto: evita el "vacío" negro fuera del césped
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 360),
    new THREE.MeshStandardMaterial({color:'#20452c', roughness:1}));
  ground.rotation.x=-Math.PI/2; ground.position.y=-0.05;
  ground.receiveShadow=false;   // sin sombras: evita que la tribuna lo vuelva negro
  g.add(ground);
  const geo = new THREE.PlaneGeometry(F.W+16, F.L+16, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ map:makePitchTexture(), roughness:0.92, metalness:0.0 });
  const pitch = new THREE.Mesh(geo, mat);
  pitch.rotation.x = -Math.PI/2; pitch.receiveShadow = true;
  g.add(pitch);
  // borde publicitario / foso
  const surround = new THREE.Mesh(new THREE.RingGeometry(0,1,4),
    new THREE.MeshStandardMaterial({color:'#0c2a14'}));
  // arcos y vallas LED
  g.add(buildGoal(1), buildGoal(-1), buildLedBoards());
  scene.add(g);
}
