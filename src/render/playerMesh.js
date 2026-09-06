// MALLA DEL JUGADOR — SÓLO VISTA.
//
// Antes esto era `Player.build()`, y el CONSTRUCTOR lo llamaba: crear un
// jugador exigía un contexto WebGL vivo y una escena global. Es decir, la
// función que arma los 22 jugadores de un partido no podía ejecutarse en un
// servidor. Ahora `crearJugador()` (src/core/player.js) devuelve datos puros y
// esta función les cuelga encima las mallas, sólo en el cliente.
//
// Todo lo que se escribe aquí sobre el jugador (mesh, cuerpo, torso, cabeza,
// brazos, piernas, anillo, runPhase) es material de dibujo: no entra en el
// hash de estado ni en el snapshot, y si faltara el partido daría el mismo
// marcador.
import * as THREE from 'three';
import { softShadowTexture, skinTex } from './textures.js';

/**
 * Cuelga la malla de un jugador ya creado y la mete en la escena.
 * @param p      jugador de datos devuelto por crearJugador()
 * @param kit    {c1, c2} colores del equipo
 * @param escena THREE.Scene
 */
// Registro playerId -> malla. Hace falta porque un expulsado se saca del
// array `teams` (sendOff hace splice): a partir de ahí el bucle de render ya
// no lo visita, y su cuerpo se quedaba plantado en el césped. Antes se
// resolvía con `p.mesh.visible=false` DENTRO de la regla de expulsión.
const mallas = new Map();

/** Esconde a un expulsado. La regla sólo emite el evento; esconder es vista. */
export function ocultarMalla(playerId){
  const g = mallas.get(playerId);
  if(g) g.visible = false;
}

/** Saca todas las mallas de la escena entre partido y partido. */
export function limpiarMallas(escena){
  for(const g of mallas.values()) escena.remove(g);
  mallas.clear();
}

export function construirMalla(p, kit, escena){
  // fase de zancada inicial: que no arranquen los 22 con el mismo paso.
  // Vive aquí, en la vista, porque no la lee ninguna regla.
  p.runPhase = Math.random()*10;

  const g = new THREE.Group();
  const PIELES=['#f0c8a0','#e8b88a','#c98c5a','#8d5a34','#6b4226'];
  const PELOS =['#1b1008','#2a1a10','#4a2c14','#7a5230','#c8a15a','#101010'];
  const piel = PIELES[(Math.random()*PIELES.length)|0];
  const skin = new THREE.MeshStandardMaterial({color:piel,roughness:.75});
  const shortMat = new THREE.MeshStandardMaterial({color:kit.c2,roughness:.85});
  const shirtMat = new THREE.MeshStandardMaterial({map:skinTex(kit.c1,kit.c2,p.num),roughness:.8});
  const sockMat = new THREE.MeshStandardMaterial({color:kit.c1,roughness:.9});
  const bootMat = new THREE.MeshStandardMaterial({color:'#111',roughness:.4,metalness:.15});

  // torso: hombros anchos que se estrechan en la cintura
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.40,0.70,5,12), shirtMat);
  torso.position.y=1.66; torso.scale.set(1.12,1,0.72); torso.castShadow=true; g.add(torso);
  p.torso = torso;
  const cadera = new THREE.Mesh(new THREE.CapsuleGeometry(0.33,0.20,4,10), shortMat);
  cadera.position.y=1.20; cadera.scale.set(1.1,1,0.78); cadera.castShadow=true; g.add(cadera);
  // cuello
  const cuello = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.15,0.18,8), skin);
  cuello.position.y=2.20; g.add(cuello);
  // cabeza: va en su propio grupo, con el pivote en el cuello, para que la
  // vista pueda girarla hacia el balón sin mover el resto del cuerpo
  const CUELLO_Y = 2.26;
  const cabeza = new THREE.Group(); cabeza.position.y = CUELLO_Y;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26,16,14), skin);
  head.position.y=2.44-CUELLO_Y; head.scale.set(0.92,1.06,0.98); head.castShadow=true;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.272,14,12,0,Math.PI*2,0,Math.PI*0.62),
    new THREE.MeshStandardMaterial({color:PELOS[(Math.random()*PELOS.length)|0],roughness:.95}));
  hair.position.y=2.47-CUELLO_Y; hair.scale.set(0.95,1.08,1.0);
  cabeza.add(head, hair); g.add(cabeza);
  p.cabeza = cabeza;

  // brazos con antebrazo y mano
  const brazoGeo = new THREE.CapsuleGeometry(0.115,0.34,3,8);
  const anteGeo  = new THREE.CapsuleGeometry(0.095,0.32,3,8);
  const mkBrazo=()=>{
    const hombro=new THREE.Group();
    const sup=new THREE.Mesh(brazoGeo,shirtMat); sup.position.y=-0.24; sup.castShadow=true;
    const codo=new THREE.Group(); codo.position.y=-0.46;
    const inf=new THREE.Mesh(anteGeo,skin); inf.position.y=-0.22; inf.castShadow=true;
    const mano=new THREE.Mesh(new THREE.SphereGeometry(0.10,8,7),skin);
    mano.position.y=-0.44; mano.scale.set(1,1.15,0.7);
    codo.add(inf,mano); hombro.add(sup,codo);
    return {hombro,codo};
  };
  const BL=mkBrazo(), BR=mkBrazo();
  p.lArm=BL.hombro; p.rArm=BR.hombro; p.lCodo=BL.codo; p.rCodo=BR.codo;
  p.lArm.position.set(-0.50,2.06,0); p.rArm.position.set(0.50,2.06,0);
  p.lArm.rotation.z=0.12; p.rArm.rotation.z=-0.12;
  g.add(p.lArm,p.rArm);

  // piernas (pivotes en cadera)
  const thighGeo=new THREE.CapsuleGeometry(0.165,0.50,4,10);
  const shinGeo=new THREE.CapsuleGeometry(0.125,0.46,4,9);
  const mkLeg=()=>{
    const hip=new THREE.Group();
    const thigh=new THREE.Mesh(thighGeo,shortMat); thigh.position.y=-0.33; thigh.castShadow=true;
    const knee=new THREE.Group(); knee.position.y=-0.66;
    const shin=new THREE.Mesh(shinGeo,sockMat); shin.position.y=-0.29; shin.castShadow=true;
    // botín: suela + empeine
    const boot=new THREE.Mesh(new THREE.BoxGeometry(0.20,0.11,0.40),bootMat);
    boot.position.set(0,-0.57,0.09); boot.castShadow=true;
    const punta=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.07,0.12),bootMat);
    punta.position.set(0,-0.60,0.28);
    knee.add(shin,boot,punta); hip.add(thigh,knee);
    return {hip,knee};
  };
  const L=mkLeg(), R=mkLeg();
  p.lLeg=L.hip; p.rLeg=R.hip; p.lKnee=L.knee; p.rKnee=R.knee;
  p.lLeg.position.set(-0.2,1.15,0); p.rLeg.position.set(0.2,1.15,0);
  g.add(p.lLeg,p.rLeg);

  // El CUERPO va en su propio subgrupo. Antes las poses de barrida y de
  // caída rotaban el grupo entero, así que la sombra y el marcador se
  // ponían de canto y el jugador parecía hundirse en el césped.
  const cuerpo = new THREE.Group();
  while(g.children.length) cuerpo.add(g.children[0]);
  g.add(cuerpo);
  p.cuerpo = cuerpo;

  // sombra blob
  const blob=new THREE.Mesh(new THREE.PlaneGeometry(1.5,1.5),
    new THREE.MeshBasicMaterial({map:softShadowTexture(),transparent:true,
      opacity:0.55,depthWrite:false}));
  blob.rotation.x=-Math.PI/2; blob.position.y=0.03; g.add(blob);   // fuera del cuerpo: siempre plana

  // marcador de jugador controlado
  const ring=new THREE.Mesh(new THREE.RingGeometry(0.7,0.9,24),
    new THREE.MeshBasicMaterial({color:'#ffd23f',transparent:true,opacity:0.95,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2; ring.position.y=0.05; ring.visible=false; g.add(ring);
  p.ring=ring;

  // el modelo mide ~2.70 unidades; escalarlo a 1.80 m de estatura real
  g.scale.setScalar(1.80/2.70);
  p.mesh=g; escena.add(g); mallas.set(p.playerId, g);
  return p;
}
