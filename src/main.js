import './styles/base.css';
import * as THREE from 'three';
import { EffectComposer }   from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }       from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }       from 'three/addons/postprocessing/OutputPass.js';

// --- Configuración (datos puros, sin lógica) ---
import { TEAMS, NOMBRES }                     from './config/teams.js';
import { FORMACIONES, NOMBRES_FORM, FORMATION } from './config/formations.js';
import { F, HALF_W, HALF_L, GOAL_W, GOAL_H, GOAL_DEPTH, BALL_R, CIRCULO }
                                              from './config/field.js';
import { DT, MAX_PASOS, DIFF, SPRINT_MUL, TOQUE_MAX, CAPTURA, SP_LABEL,
         REPLAY_SEC, REPLAY_HZ, REPLAY_SPEED, COLORES_HUMANO, DISPOSITIVOS }
                                              from './config/rules.js';
// --- Núcleo ---
import { rng, sembrar, suavizado }            from './core/rng.js';
// --- Audio ---
import { initAudio, playKick, playWhistle, crowdCheer, ensureAudio } from './audio/audio.js';
// --- Render ---
import { softShadowTexture, skinTex, makePitchTexture, makeNetTexture, makeLedTexture }
                                              from './render/textures.js';
import { buildSky }                           from './render/scene/sky.js';
import { buildLights }                        from './render/scene/lights.js';
import { buildField }                         from './render/scene/pitch.js';
import { buildStadium }                       from './render/scene/stadium.js';

/* ============================================================================
   FÚLBO — Superliga Estelar
   Motor de fútbol arcade en Three.js — todo procedural, sin assets externos.
   ========================================================================== */

// ---------------------------------------------------------------------------
//  DATOS: Equipos y jugadores inventados
// ---------------------------------------------------------------------------


// Formaciones: coordenadas relativas (x lateral -1..1, z profundidad 0 propia .. 1 rival)

// ---------------------------------------------------------------------------
//  DIMENSIONES DEL CAMPO
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
//  DETERMINISMO — RNG sembrado, paso fijo y hash de estado (Fase 1)
// ---------------------------------------------------------------------------
// Sólo el azar que AFECTA A LAS REGLAS pasa por rng(). El azar cosmético
// (piel, pelo, césped, público, confeti, estrellas) sigue usando Math.random():
// esa separación es exactamente la frontera core/render.


// Contadores para afinar el balance con datos, no con impresiones.
const estad = { tiros:0, cabezazos:0, despejesPortero:0, goles:0, ticksConDueno:0 };
function resetEstad(){ for(const k in estad) estad[k]=0; }

// Suavizado independiente del dt: k es la fracción que se aplicaría a 60 Hz.
// El lerp(dt*k) de toda la vida NO es dt-correcto: la aceleración efectiva
// cambia con los fotogramas por segundo.

// Hash del estado autoritativo. Cuantizado a milésimas para no acusar ruido
// de coma flotante, pero sí cualquier divergencia real de simulación.
function hashEstado(){
  const q = v => Math.round(v*1000)/1000;
  let s = q(ball.position.x)+','+q(ball.position.y)+','+q(ball.position.z)+'|'
        + q(ball.userData.vel.x)+','+q(ball.userData.vel.y)+','+q(ball.userData.vel.z)+'|'
        + q(ball.userData.kickLock)+'|';
  for(let ti=0;ti<2;ti++) for(const p of teams[ti]){
    s += q(p.pos.x)+','+q(p.pos.z)+','+q(p.vel.x)+','+q(p.vel.z)+','+q(p.facing)+','
       + q(p.stamina)+','+q(p.stunTimer)+','+q(p.sliding)+','+(p.expelled?1:0)+';';
  }
  s += '|'+S.score[0]+'-'+S.score[1]+'|'+q(S.clock)+'|'+S.phase+'|'+S.possession
     + '|'+cards[0].a+','+cards[0].r+','+cards[1].a+','+cards[1].r;
  let h = 0x811c9dc5;                       // FNV-1a
  for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h,0x01000193)>>>0; }
  return h.toString(16).padStart(8,'0');
}

// sombra suave reutilizable (degradado radial) para jugadores y balón

// ---------------------------------------------------------------------------
//  ESTADO GLOBAL
// ---------------------------------------------------------------------------
const S = {
  quality:'alta', difficulty:'normal', halfLen:120, // segundos por tiempo
  formation:['4-3-3','4-4-2'],   // [tu equipo, rival]
  kickTeam:0, kickoffTaken:true,
  numHumanos:1, humans:[],
  homeTeam:TEAMS[0], awayTeam:TEAMS[4],
  running:false, paused:false,
  score:[0,0], clock:0, half:1,
  phase:'menu',  // menu | kickoff | play | goal | half | full
  phaseT:0,
  possession:0,  // equipo con el balón (0 local / 1 visita) o -1
  controlled:null,
};

// ---------------------------------------------------------------------------
//  THREE — Renderer, escena, cámara
// ---------------------------------------------------------------------------
let renderer, scene, camera, clock, composer, bloomPass;

function initThree(){
  renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, S.quality==='alta'?2:1.25));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // exposición contenida: con ACES, un amarillo saturado a plena luz vira a naranja
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.getElementById('app').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0e2138');
  scene.fog = new THREE.Fog('#123150', 150, 340);

  camera = new THREE.PerspectiveCamera(48, innerWidth/innerHeight, 0.1, 600);
  camera.position.set(0, 42, 66);
  camera.lookAt(0,0,0);

  clock = new THREE.Clock();

  // --- POST-PROCESADO: bloom en focos, vallas LED y reflejos ---
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    0.62,   // intensidad
    0.55,   // radio del halo
    0.82    // umbral: sólo lo muy brillante resplandece
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());   // aplica tonemapping + sRGB al final

  addEventListener('resize', ()=>{
    camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });
}

// ---------------------------------------------------------------------------
//  LUCES
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
//  CÉSPED con textura procedural (líneas + franjas de corte)
// ---------------------------------------------------------------------------


// malla de red: líneas blancas sobre fondo transparente (sirve de map y alphaMap)

// vallas LED publicitarias alrededor del campo


// ---------------------------------------------------------------------------
//  ESTADIO — gradas con multitud (instancias) + techo
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
//  BALÓN
// ---------------------------------------------------------------------------
let ball;
function buildBall(){
  const geo = new THREE.SphereGeometry(BALL_R, 22, 16);
  // textura tipo panel
  const c=document.createElement('canvas'); c.width=c.height=256; const x=c.getContext('2d');
  x.fillStyle='#fff'; x.fillRect(0,0,256,256);
  x.fillStyle='#111';
  for(let i=0;i<7;i++){ x.beginPath();
    x.arc(40+Math.random()*180,40+Math.random()*180,14+Math.random()*10,0,Math.PI*2); x.fill(); }
  const tex=new THREE.CanvasTexture(c);
  const mat = new THREE.MeshStandardMaterial({map:tex, roughness:0.42, metalness:0.02});
  ball = new THREE.Mesh(geo, mat);
  ball.castShadow = true;
  ball.position.set(0,BALL_R,0);
  ball.userData = { vel:new THREE.Vector3(), spin:new THREE.Vector3(), r:BALL_R };
  scene.add(ball);
  // sombra "blob" extra bajo el balón
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.55,0.55),
    new THREE.MeshBasicMaterial({map:softShadowTexture(),transparent:true,
      opacity:0.5,depthWrite:false}));
  sh.rotation.x=-Math.PI/2; sh.position.y=0.02; ball.userData.blob=sh; scene.add(sh);
}

// ---------------------------------------------------------------------------
//  JUGADORES — figura estilizada con rig procedural
// ---------------------------------------------------------------------------

class Player {
  constructor(team, role, num, kit){
    this.team=team; this.role=role; this.num=num;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.home = new THREE.Vector3(); // posición base según formación
    this.facing = 0;
    this.runPhase = Math.random()*10;
    this.stunTimer = 0;
    this.stamina = 1;        // energía 0..1
    this.sprinting = false;
    this.slideCd = 0; this.sliding = 0; this.heading = 0;
    this.yellow = 0; this.expelled = false;
    this.humanOwner = null;   // qué persona lo controla (null = IA)
    this.isGK = role==='POR';
    this.build(kit);
  }
  build(kit){
    const g = new THREE.Group();
    const PIELES=['#f0c8a0','#e8b88a','#c98c5a','#8d5a34','#6b4226'];
    const PELOS =['#1b1008','#2a1a10','#4a2c14','#7a5230','#c8a15a','#101010'];
    const piel = PIELES[(Math.random()*PIELES.length)|0];
    const skin = new THREE.MeshStandardMaterial({color:piel,roughness:.75});
    const shortMat = new THREE.MeshStandardMaterial({color:kit.c2,roughness:.85});
    const shirtMat = new THREE.MeshStandardMaterial({map:skinTex(kit.c1,kit.c2,this.num),roughness:.8});
    const sockMat = new THREE.MeshStandardMaterial({color:kit.c1,roughness:.9});
    const bootMat = new THREE.MeshStandardMaterial({color:'#111',roughness:.4,metalness:.15});

    // torso: hombros anchos que se estrechan en la cintura
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.40,0.70,5,12), shirtMat);
    torso.position.y=1.66; torso.scale.set(1.12,1,0.72); torso.castShadow=true; g.add(torso);
    const cadera = new THREE.Mesh(new THREE.CapsuleGeometry(0.33,0.20,4,10), shortMat);
    cadera.position.y=1.20; cadera.scale.set(1.1,1,0.78); cadera.castShadow=true; g.add(cadera);
    // cuello
    const cuello = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.15,0.18,8), skin);
    cuello.position.y=2.20; g.add(cuello);
    // cabeza
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26,16,14), skin);
    head.position.y=2.44; head.scale.set(0.92,1.06,0.98); head.castShadow=true; g.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.272,14,12,0,Math.PI*2,0,Math.PI*0.62),
      new THREE.MeshStandardMaterial({color:PELOS[(Math.random()*PELOS.length)|0],roughness:.95}));
    hair.position.y=2.47; hair.scale.set(0.95,1.08,1.0); g.add(hair);

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
    this.lArm=BL.hombro; this.rArm=BR.hombro; this.lCodo=BL.codo; this.rCodo=BR.codo;
    this.lArm.position.set(-0.50,2.06,0); this.rArm.position.set(0.50,2.06,0);
    this.lArm.rotation.z=0.12; this.rArm.rotation.z=-0.12;
    g.add(this.lArm,this.rArm);

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
    this.lLeg=L.hip; this.rLeg=R.hip; this.lKnee=L.knee; this.rKnee=R.knee;
    this.lLeg.position.set(-0.2,1.15,0); this.rLeg.position.set(0.2,1.15,0);
    g.add(this.lLeg,this.rLeg);

    // sombra blob
    const blob=new THREE.Mesh(new THREE.PlaneGeometry(1.5,1.5),
      new THREE.MeshBasicMaterial({map:softShadowTexture(),transparent:true,
        opacity:0.55,depthWrite:false}));
    blob.rotation.x=-Math.PI/2; blob.position.y=0.03; g.add(blob);

    // marcador de jugador controlado
    const ring=new THREE.Mesh(new THREE.RingGeometry(0.7,0.9,24),
      new THREE.MeshBasicMaterial({color:'#ffd23f',transparent:true,opacity:0.95,side:THREE.DoubleSide}));
    ring.rotation.x=-Math.PI/2; ring.position.y=0.05; ring.visible=false; g.add(ring);
    this.ring=ring;

    // el modelo mide ~2.70 unidades; escalarlo a 1.80 m de estatura real
    g.scale.setScalar(1.80/2.70);
    this.mesh=g; scene.add(g);
  }
  setKitVisible(v){}
  update(dt){
    // orientación
    const speed = this.vel.length();
    if(speed>0.2) this.facing = Math.atan2(this.vel.x, this.vel.z);
    this.mesh.rotation.y = this.facing;
    this.mesh.position.set(this.pos.x, 0, this.pos.z);

    // animación de carrera
    const cadence = Math.min(speed*1.1, 14);
    this.runPhase += dt*(4+cadence);
    const sw = Math.sin(this.runPhase)* Math.min(0.2+speed*0.05,0.9);
    this.lLeg.rotation.x = sw; this.rLeg.rotation.x = -sw;
    this.lKnee.rotation.x = Math.max(0,-sw)*1.2; this.rKnee.rotation.x = Math.max(0,sw)*1.2;
    this.lArm.rotation.x = -sw*0.8; this.rArm.rotation.x = sw*0.8;
    // codos siempre algo flexionados, más al correr
    const flex = 0.5 + Math.abs(sw)*0.7;
    this.lCodo.rotation.x = -flex; this.rCodo.rotation.x = -flex;
    // rebote vertical del cuerpo
    this.mesh.children[0].position.y = 1.66 + Math.abs(Math.sin(this.runPhase))*Math.min(speed*0.02,0.12);
    if(this.stunTimer>0) this.stunTimer-=dt;
    if(this.slideCd>0) this.slideCd-=dt;
    if(this.heading>0) this.heading-=dt;

    // pose: barrida (cuerpo al suelo), cabezazo (torso atrás) o caído por falta
    if(this.sliding>0){
      this.sliding-=dt;
      this.mesh.rotation.x = -1.15;          // deslizándose
      this.mesh.position.y = 0.28;
      this.lLeg.rotation.x = 0.9; this.rLeg.rotation.x = -0.35;
    } else if(this.stunTimer>0){
      this.mesh.rotation.x = -1.35;          // en el suelo tras la falta
      this.mesh.position.y = 0.22;
    } else {
      this.mesh.rotation.x = this.heading>0 ? -0.45 : 0;
      this.mesh.position.y = 0;
    }
  }
}

// ---------------------------------------------------------------------------
//  ENTRADAS: Teclado + Gamepad
// ---------------------------------------------------------------------------
const keys = {};
addEventListener('keydown', e=>{ keys[e.code]=true;
  if(['Space','KeyJ','KeyK','KeyL','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  if(e.code==='Escape') togglePause();
  if(e.code==='KeyF' && S.running) cycleFormation();
});
addEventListener('keyup', e=>{ keys[e.code]=false; });

const pad = { connected:false, index:null };
addEventListener('gamepadconnected', e=>{ pad.connected=true; pad.index=e.gamepad.index; updatePadUI(); });
addEventListener('gamepaddisconnected', e=>{ if(e.gamepad.index===pad.index){pad.connected=false; updatePadUI();} });

// (el input ahora es por jugador humano: ver S.humans / leerDispositivo)

// lee el estado bruto de un dispositivo concreto
function leerDispositivo(dev){
  let mx=0,my=0,pass=false,shoot=false,sprint=false,sw=false;
  if(dev==='teclado1'){
    if(keys['KeyW'])my-=1; if(keys['KeyS'])my+=1;
    if(keys['KeyA'])mx-=1; if(keys['KeyD'])mx+=1;
    pass=!!keys['KeyJ']; shoot=!!keys['KeyK'];
    sprint=!!(keys['KeyL']||keys['ShiftLeft']); sw=!!keys['Space'];
  } else if(dev==='teclado2'){
    if(keys['ArrowUp'])my-=1; if(keys['ArrowDown'])my+=1;
    if(keys['ArrowLeft'])mx-=1; if(keys['ArrowRight'])mx+=1;
    pass=!!keys['Comma']; shoot=!!keys['Period'];
    sprint=!!(keys['Slash']||keys['ShiftRight']); sw=!!keys['Enter'];
  } else if(dev.startsWith('pad')){
    const gp = navigator.getGamepads()[+dev.slice(3)];
    if(gp){
      const ax0=gp.axes[0]||0, ax1=gp.axes[1]||0;
      if(Math.abs(ax0)>0.18) mx+=ax0;
      if(Math.abs(ax1)>0.18) my+=ax1;
      const b=gp.buttons;
      pass  = !!b[0]?.pressed;                       // A
      shoot = !!(b[1]?.pressed || b[2]?.pressed);    // B / X
      sprint= !!(b[7]?.pressed || b[5]?.pressed);    // RT / RB
      sw    = !!b[3]?.pressed;                       // Y
      if(!pad._any && b.some(x=>x?.pressed)){ pad._any=true; updatePadUI(); }
    }
  }
  const len=Math.hypot(mx,my);
  if(len>1){ mx/=len; my/=len; }
  return {mx,my,pass,shoot,sprint,sw};
}

// actualiza el input de cada humano, con detección de flanco por jugador
function pollInput(){
  for(const h of S.humans){
    const r = leerDispositivo(h.device);
    const i = h.input;
    i.move.set(r.mx, r.my);
    i.pass   = r.pass  && !i._p; i._p = r.pass;
    i.shoot  = r.shoot && !i._s; i._s = r.shoot;
    i.switch = r.sw    && !i._w; i._w = r.sw;
    i.shootHold = r.shoot; i.sprint = r.sprint;
  }
}

function updatePadUI(){
  const el=document.getElementById('padstate');
  el.classList.toggle('on', pad.connected);
  document.getElementById('padtxt').textContent = pad.connected? 'Joystick' : 'Teclado';
}

// ---------------------------------------------------------------------------
//  PARTIDO — creación de equipos
// ---------------------------------------------------------------------------
const teams = [[],[]]; // arrays de Player
let names=[[],[]];

function spawnTeams(){
  [0,1].forEach(ti=>{
    const t = ti===0? S.homeTeam : S.awayTeam;
    const kit = {c1:t.c1, c2:t.c2};
    teams[ti]=[]; names[ti]=[];
    const forma = FORMACIONES[S.formation[ti]] || FORMATION;
    forma.forEach((f,i)=>{
      const p = new Player(ti, f.r, i===0?1:i+1, kit);
      p.formation = f;
      teams[ti].push(p);
      names[ti].push(NOMBRES[(i + ti*7)%NOMBRES.length]);
    });
  });
}

// posición base de un jugador según formación y lado (dir: +1 ataca hacia +z / -1 hacia -z)
function homePos(ti, f, out){
  const dir = ti===0? 1 : -1;   // local ataca hacia +z
  out.set(f.x*HALF_W*0.92, 0, -dir*(0.5 - f.z)*F.L);
  return out;
}


// separa jugadores que hayan quedado encimados
function separarJugadores(minDist){
  const todos=[...teams[0],...teams[1]];
  for(let it=0; it<4; it++){
    for(let i=0;i<todos.length;i++) for(let j=i+1;j<todos.length;j++){
      const a=todos[i], b=todos[j];
      let dx=b.pos.x-a.pos.x, dz=b.pos.z-a.pos.z;
      let d=Math.hypot(dx,dz);
      if(d<1e-4){ dx=rng()-0.5; dz=rng()-0.5; d=Math.hypot(dx,dz); }
      if(d<minDist){
        const push=(minDist-d)/2/d;
        a.pos.x-=dx*push; a.pos.z-=dz*push;
        b.pos.x+=dx*push; b.pos.z+=dz*push;
      }
    }
  }
  todos.forEach(p=>clampToField(p.pos));
}

function placeKickoff(kickTeam){
  S.kickTeam = kickTeam;
  S.kickoffTaken = false;          // el rival no entra al círculo hasta el primer toque
  const kd = kickTeam===0?1:-1;    // dirección de ataque del que saca

  [0,1].forEach(ti=>{
    const dir = ti===0?1:-1;
    teams[ti].forEach(p=>{
      homePos(ti, p.formation, p.home);
      // Formación COMPRIMIDA en su propio campo: en el saque nadie pisa campo rival.
      const f=p.formation;
      p.pos.set(f.x*HALF_W*0.92, 0, -dir*(0.5 - f.z*0.55)*F.L);
      p.vel.set(0,0,0);
      if(ti!==kickTeam){
        // el que NO saca debe estar fuera del círculo central
        const d=Math.hypot(p.pos.x,p.pos.z);
        if(d < CIRCULO+0.8){
          const k=(CIRCULO+0.8)/Math.max(d,0.001);
          p.pos.x*=k; p.pos.z*=k;
          if(p.pos.z*dir > -0.5) p.pos.z = -0.5*dir;   // y en su campo
        }
      }
    });
  });

  // los dos hombres de punta del que saca, junto al balón
  const punta = teams[kickTeam].filter(p=>!p.isGK)
    .sort((a,b)=>b.formation.z-a.formation.z);
  if(punta[0]) punta[0].pos.set(-0.75, 0, -0.85*kd);   // ejecutor
  if(punta[1]) punta[1].pos.set( 2.60, 0, -1.70*kd);   // receptor del primer pase
  separarJugadores(1.5);                                // sin jugadores encimados
  ball.position.set(0,BALL_R,0); ball.userData.vel.set(0,0,0);
  ball.userData.kickLock=0;        // si no, el saque hereda el bloqueo de re-toque anterior
  camTarget.copy(ball.position); S.camSnap=true;   // cámara ya colocada en el saque
  S.possession = kickTeam;
  asignarPosicionesIniciales();
}

// ---------------------------------------------------------------------------
//  UTILIDADES DE JUEGO
// ---------------------------------------------------------------------------
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
function nearestToBall(ti){
  let best=null, bd=1e9;
  teams[ti].forEach(p=>{ if(p.isGK) return;
    const d=p.pos.distanceToSquared(ball.position); if(d<bd){bd=d;best=p;} });
  return best;
}
// ---------------------------------------------------------------------------
//  JUGADORES HUMANOS (multijugador local: teclado y mandos)
// ---------------------------------------------------------------------------

function refreshRings(){
  for(const arr of teams) for(const p of arr){
    const h = p.humanOwner;
    p.ring.visible = !!h;
    if(h) p.ring.material.color.set(h.color);
  }
}
// asigna a un humano el control de un jugador (liberando el anterior)
function asignarControl(h, p){
  if(!p || p.humanOwner===h) { if(p) h.controlled=p; return; }
  if(h.controlled) h.controlled.humanOwner=null;
  if(p.humanOwner) p.humanOwner.controlled=null;   // se lo quita a otro humano
  h.controlled=p; p.humanOwner=h;
}
// jugador del equipo más cercano al balón que no lleve ya otro humano
function masCercanoLibre(team, h){
  let best=null, bd=1e9;
  for(const p of teams[team]){
    if(p.isGK) continue;
    if(p.humanOwner && p.humanOwner!==h) continue;
    const d=p.pos.distanceToSquared(ball.position);
    if(d<bd){bd=d;best=p;}
  }
  return best;
}
// reparte el control inicial según la posición elegida por cada humano
function asignarPosicionesIniciales(){
  for(const h of S.humans){
    const arr=teams[h.team];
    const p = arr[h.slot] || arr[9] || arr[1];
    asignarControl(h, p);
  }
  refreshRings();
}
function humanoDe(p){ return p ? p.humanOwner : null; }

// cambio de formación en caliente (tecla F)
function setFormation(ti, nombre){
  if(!FORMACIONES[nombre]) return;
  S.formation[ti]=nombre;
  const forma=FORMACIONES[nombre];
  teams[ti].forEach((p,i)=>{ const f=forma[i]; if(f){ p.formation=f; p.role=f.r; } });
  if(ti===0){ announce('FORMACIÓN', nombre); document.getElementById('formTag').textContent=nombre; }
}
function cycleFormation(){
  const i=NOMBRES_FORM.indexOf(S.formation[0]);
  setFormation(0, NOMBRES_FORM[(i+1)%NOMBRES_FORM.length]);
}

function goalDirZ(ti){ return ti===0? HALF_L : -HALF_L; } // z de la portería rival

// ---------------------------------------------------------------------------
//  ACTUALIZACIÓN DE BALÓN
// ---------------------------------------------------------------------------
let lastTouch = -1;
function updateBall(dt){
  const b=ball, u=b.userData;
  if(u.kickLock>0) u.kickLock-=dt;
  u.vel.y -= 22*dt; // gravedad
  b.position.addScaledVector(u.vel, dt);
  // rozamiento suelo
  if(b.position.y<=u.r+0.001){
    b.position.y=u.r;
    if(u.vel.y<0) u.vel.y = -u.vel.y*0.45; // rebote
    u.vel.x*=Math.pow(0.12,dt); u.vel.z*=Math.pow(0.12,dt); // fricción césped
    if(Math.abs(u.vel.y)<0.6) u.vel.y=0;
  } else {
    u.vel.x*=Math.pow(0.75,dt); u.vel.z*=Math.pow(0.75,dt); // arrastre aire
  }
  // detección de gol (antes que el fuera de juego de fondo)
  handleGoalCheck();
  // --- BALÓN FUERA: saque de banda / córner / saque de puerta ---
  if(S.phase==='play'){
    if(Math.abs(b.position.x) > HALF_W){
      // fuera por la banda -> saque de banda del equipo contrario al último que tocó
      const eq = lastTouch===0?1:0;
      startSetPiece('banda', eq, Math.sign(b.position.x)*HALF_W, b.position.z);
    } else if(Math.abs(b.position.z) > HALF_L){
      const fondo = Math.sign(b.position.z);          // +1 = arco del visitante
      const defensor = fondo>0 ? 1 : 0;               // equipo que defiende ese fondo
      if(lastTouch===defensor){
        // la sacó el defensor -> CÓRNER para el atacante
        startSetPiece('corner', 1-defensor, Math.sign(b.position.x||1)*(HALF_W-0.4), fondo*(HALF_L-0.4));
      } else {
        // la sacó el atacante -> SAQUE DE PUERTA del defensor
        startSetPiece('puerta', defensor, 0, fondo*(HALF_L-5.5));
      }
    }
  }
  // rotación visual
  const sp=_v.copy(u.vel); sp.y=0;
  b.rotation.x += u.vel.z*dt*0.9; b.rotation.z -= u.vel.x*dt*0.9;
  // sombra
  u.blob.position.set(b.position.x, 0.02, b.position.z);
  const h=Math.max(0,b.position.y-u.r);
  u.blob.scale.setScalar(1+ h*0.25); u.blob.material.opacity=Math.max(0.05,0.3- h*0.03);
}

let goalCooldown=0;
function handleGoalCheck(){
  if(S.phase!=='play' || goalCooldown>0) return;
  const b=ball.position;
  if(Math.abs(b.x)<GOAL_W/2 && b.y<GOAL_H){
    if(b.z> HALF_L-0.1){ scoreGoal(0); }       // gol de local en portería +z
    else if(b.z< -HALF_L+0.1){ scoreGoal(1); } // gol de visita en portería -z
  }
}

// ---------------------------------------------------------------------------
//  JUGADAS A BALÓN PARADO (banda / córner / saque de puerta / falta / penal)
// ---------------------------------------------------------------------------
function teamName(t){ return t===0?S.homeTeam.nombre:S.awayTeam.nombre; }

function startSetPiece(type, team, x, z){
  S.phase='setpiece'; S.phaseT=0;
  ball.userData.vel.set(0,0,0); ball.userData.kickLock=0;
  ball.position.set(x, BALL_R, z);
  if(S._owner){ S._owner.hasBall=false; S._owner=null; }
  // ejecutor: el portero en saque de puerta y penal-atajador aparte; si no, el más cercano
  let taker;
  if(type==='puerta'){ taker = teams[team][0]; }
  else {
    taker=null; let bd=1e9;
    for(const p of teams[team]){ if(p.isGK) continue;
      const d=distXZ(p.pos, ball.position); if(d<bd){bd=d;taker=p;} }
  }
  S.setPiece = { type, team, taker, x, z, taken:false };
  positionForSetPiece(type, team, x, z, taker);
  // si hay un humano en el equipo que saca, le damos el ejecutor
  if(taker){ const h=S.humans.find(x=>x.team===team); if(h){ asignarControl(h,taker); refreshRings(); } }
  announce(SP_LABEL[type], teamName(team));
  playWhistle(1);
}

// coloca a los 22 jugadores de forma coherente con la jugada
function positionForSetPiece(type, team, x, z, taker){
  const rival = 1-team;
  for(let ti=0;ti<2;ti++) for(const p of teams[ti]){
    p.vel.set(0,0,0);
    if(p===taker) continue;
    if(p.isGK){ // porteros a su línea
      const gz = ti===0? -HALF_L+2.2 : HALF_L-2.2;
      p.pos.set(0,0,gz); continue;
    }
    homePos(ti, p.formation, _v);
    if(type==='corner'){
      // córner: ambos equipos cargan el área para el cabezazo
      const boxZ = z*0.90, side = Math.sign(x);
      const meto = (p.role==='DEF'&&ti===team) ? 0.45 : 1;   // algún defensa se queda
      p.pos.set( (rng()-0.5)*24*meto - side*2,
                 0,
                 boxZ - Math.sign(z)*(4 + rng()*11) );
    } else if(type==='penal'){
      // todos fuera del área salvo ejecutor y portero
      const outZ = z + (z>0? -18 : 18);
      p.pos.set((rng()-0.5)*36, 0, outZ + (rng()-0.5)*10);
    } else {
      // banda / puerta / falta: formación normal, con el rival a distancia
      p.pos.copy(_v);
      if(ti===rival && distXZ(p.pos, ball.position)<9){
        const away=_v2.copy(p.pos).sub(ball.position); away.y=0;
        if(away.lengthSq()<0.01) away.set(1,0,0);
        away.setLength(9.5); p.pos.copy(ball.position).add(away); p.pos.y=0;
      }
    }
    clampToField(p.pos);
  }
  if(taker){ // el ejecutor, junto al balón
    const off = type==='corner'? 1.0 : 1.2;
    taker.pos.set(x - Math.sign(x||1)*off*(type==='banda'?1:0.4), 0, z - (type==='banda'?0:off));
    if(type==='puerta') taker.pos.set(x, 0, z);
    if(type==='penal')  taker.pos.set(x, 0, z + (z>0?-2.2:2.2));
    taker.vel.set(0,0,0);
  }
}

// ejecuta el saque (IA automática, o el humano tras un margen)
function takeSetPiece(){
  const sp=S.setPiece; if(!sp||sp.taken) return;
  const t=sp.taker; if(!t){ S.phase='play'; return; }
  sp.taken=true;
  const gz = goalDirZ(sp.team);
  if(sp.type==='corner'){
    // centro alto al punto de penal para rematar de cabeza
    const target=_v.set((rng()-0.5)*6, 0, gz - Math.sign(gz)*10);
    kickBall(t, target.sub(t.pos), 17, 7.5);
  } else if(sp.type==='puerta'){
    const target=_v.set((rng()-0.5)*30, 0, sp.z + Math.sign(gz)*45);
    kickBall(t, target.sub(t.pos), 25, 6.5);
  } else if(sp.type==='penal'){
    doShoot(t, 1.0);
  } else if(sp.type==='falta'){
    const dg=Math.abs(gz-t.pos.z);
    if(dg<30) doShoot(t, 0.95); else doPass(t);
  } else { // banda
    doPass(t);
  }
  S.phase='play'; S.phaseT=0; S.setPiece=null;
}

// ---------------------------------------------------------------------------
//  FALTAS, TARJETAS Y PENALES
// ---------------------------------------------------------------------------
const cards = [{a:0,r:0},{a:0,r:0}];   // amarillas/rojas por equipo
function inPenaltyBox(pos, defTeam){
  const gz = defTeam===0? -HALF_L : HALF_L;
  return Math.abs(pos.x) < 20.15 && Math.abs(pos.z-gz) < 16.5;
}
function commitFoul(offender, victim){
  const eq = victim.team;                    // equipo beneficiado
  const defTeam = offender.team;
  const penal = inPenaltyBox(victim.pos, defTeam);
  // severidad -> tarjeta
  const sev = rng();
  let card='';
  if(sev>0.90){ card='roja'; cards[offender.team].r++; sendOff(offender); }
  else if(sev>0.62){ card='amarilla'; cards[offender.team].a++;
    offender.yellow=(offender.yellow||0)+1;
    if(offender.yellow>=2){ card='roja (doble amarilla)'; cards[offender.team].r++; sendOff(offender); }
  }
  offender.stunTimer=1.1;
  showCard(card);
  if(penal){
    const gz = defTeam===0? -HALF_L : HALF_L;
    startSetPiece('penal', eq, 0, gz + (defTeam===0? 11 : -11));
  } else {
    startSetPiece('falta', eq, victim.pos.x, victim.pos.z);
  }
}
function sendOff(p){
  p.expelled=true; p.mesh.visible=false;
  const arr=teams[p.team]; const i=arr.indexOf(p); if(i>=0) arr.splice(i,1);
  if(p.humanOwner){ const h=p.humanOwner; p.humanOwner=null; h.controlled=null;
    asignarControl(h, masCercanoLibre(h.team, h)); refreshRings(); }
}
function showCard(card){
  if(!card) { announce('FALTA',''); return; }
  const el=document.getElementById('cardFx');
  el.className = card.startsWith('roja')? 'show roja':'show amarilla';
  clearTimeout(showCard._t);
  showCard._t=setTimeout(()=>el.className='', 2200);
  announce(card.startsWith('roja')?'¡TARJETA ROJA!':'TARJETA AMARILLA','');
  updateCardsUI();
}
function updateCardsUI(){
  document.getElementById('cardsH').textContent = `🟨${cards[0].a} 🟥${cards[0].r}`;
  document.getElementById('cardsA').textContent = `🟨${cards[1].a} 🟥${cards[1].r}`;
}

// ---------------------------------------------------------------------------
//  DISPARO / PASE / REGATE
// ---------------------------------------------------------------------------
function distXZ(a,b){ return Math.hypot(a.x-b.x, a.z-b.z); }

// Conducción: el toque nunca debe superar el radio de captura, o el balón
// se escapa del control y sale despedido.

function tryPossession(dt){
  // ¿quién toca el balón?
  let owner=null, od=1e9;
  for(let ti=0;ti<2;ti++)for(const p of teams[ti]){
    const d=distXZ(p.pos, ball.position);
    if(d<od){od=d; owner=p;}
  }
  const b=ball.userData;
  // El radio de captura debe ser MAYOR que el toque de conducción; si no, el balón
  // se sale del radio, se pierde la posesión y sale disparado como una patada.
  if(owner && od<CAPTURA && ball.position.y<1.4 && owner.stunTimer<=0 && b.kickLock<=0){
    S.possession = owner.team;
    lastTouch = owner.team;
    // REGATE: el toque se alarga con la velocidad. Al trotar el balón va pegado al pie;
    // al esprintar se escapa hacia adelante y cuesta más controlarlo.
    const dir = new THREE.Vector3(Math.sin(owner.facing),0,Math.cos(owner.facing));
    const sp = owner.vel.length();
    // toque SIEMPRE dentro del radio de captura (ver TOQUE_MAX)
    const toque = Math.min(0.50 + sp*0.055 + (owner.sprinting?0.18:0), TOQUE_MAX);
    const target = _v.copy(owner.pos).addScaledVector(dir, toque); target.y=BALL_R;
    // a más velocidad, menos adherencia (control más suelto)
    const adher = (owner.humanOwner?12:8) * (owner.sprinting?0.6:1.0);
    const relV = b.vel.length();
    if(relV<22){
      ball.position.lerp(target, Math.min(1, dt*adher));
      ball.position.y = Math.max(ball.position.y, BALL_R);
      // el balón ACOMPAÑA al jugador; nada de fuerzas de muelle acumuladas
      b.vel.set(owner.vel.x, Math.min(b.vel.y,0), owner.vel.z);
    }
    owner.hasBall=true;
    // guardar el poseedor
    S._owner = owner; estad.ticksConDueno++;
    // ¿el receptor estaba en posición adelantada?
    if(offsidePend){
      if(owner===offsidePend){ callOffside(owner); return; }
      offsidePend=null;              // la tocó otro: se anula la sanción
    }
  } else {
    if(S._owner) S._owner.hasBall=false;
    S._owner=null;
  }
}

function kickBall(from, dirVec, power, lift){
  const u=ball.userData;
  const d=_v.copy(dirVec); d.y=0; if(d.lengthSq()<1e-4) d.set(Math.sin(from.facing),0,Math.cos(from.facing));
  d.normalize();
  u.vel.set(d.x*power, lift, d.z*power);
  ball.position.y=Math.max(ball.position.y,0.36);
  lastTouch = from.team;
  u.kickLock = 0.3;              // evita que el mismo pie re-capture el balón
  if(S._owner){ S._owner.hasBall=false; S._owner=null; }
  // el saque de centro se considera ejecutado en cuanto se toca el balón
  if(S.phase==='kickoff'){ S.kickoffTaken=true; S.phase='play'; S.phaseT=0; }
  playKick();
}

// pase al compañero mejor ubicado hacia el ataque
function doPass(p){
  const mates = teams[p.team].filter(m=>m!==p && !m.isGK);
  const attackZ = goalDirZ(p.team);
  let best=null, bs=-1e9;
  const dirToGoal = Math.sign(attackZ - p.pos.z);
  for(const m of mates){
    const d=distXZ(p.pos,m.pos); if(d<3||d>42) continue;
    const forward = (m.pos.z-p.pos.z)*dirToGoal; // premia avanzar
    const openness = -nearestOpponentDist(m); // menos rival cerca mejor (negativo)
    const score = forward*1.6 - d*0.15 - openness*0.0; // ponderación simple
    let s = forward*1.5 - d*0.12 + nearestOpponentDist(m)*0.8;
    if(s>bs){bs=s;best=m;}
  }
  if(!best) best = mates.sort((a,b)=>distXZ(p.pos,a.pos)-distXZ(p.pos,b.pos))[0];
  if(!best) return;
  offsidePend = isOffside(best, p) ? best : null;   // se sanciona al recibir
  const dir=_v2.copy(best.pos).sub(p.pos); const dist=dir.length();
  const power=Math.min(6+dist*0.7, 30);
  kickBall(p, dir, power, Math.min(dist*0.12,3));
  // si el pasador lo lleva un humano, ese humano pasa a controlar al receptor
  if(p.humanOwner){ asignarControl(p.humanOwner, best); refreshRings(); passReceiver=best; }
}
// --- FUERA DE JUEGO ---
// Se evalúa en el instante del pase: el receptor está adelantado si supera al
// penúltimo defensor rival, está en campo contrario y por delante del balón.
let offsidePend = null;
function isOffside(receptor, pasador){
  const ti = receptor.team, dir = ti===0? 1 : -1;
  const rz = receptor.pos.z*dir;
  if(rz <= 0) return false;                              // en su propio campo, nunca
  if(rz <= ball.position.z*dir) return false;            // no está por delante del balón
  const zs = teams[1-ti].map(o=>o.pos.z*dir).sort((a,b)=>b-a);
  const penultimo = zs.length>1 ? zs[1] : -1e9;          // portero + último defensa
  return rz > penultimo + 0.5;
}
function callOffside(receptor){
  offsidePend = null;
  announce('FUERA DE JUEGO', teamName(1-receptor.team));
  startSetPiece('falta', 1-receptor.team, receptor.pos.x, receptor.pos.z);
}

function nearestOpponentDist(p){
  const opp = teams[1-p.team]; let d=1e9;
  for(const o of opp){ const dd=distXZ(p.pos,o.pos); if(dd<d)d=dd; }
  return d;
}
let passReceiver=null;

function doShoot(p, power){
  estad.tiros++;
  const gz = goalDirZ(p.team);
  const aimX = (rng()-0.5)*GOAL_W*0.98;   // dispersión: aún pueden errar, pero menos
  const target=_v.set(aimX,1.0,gz);
  const dir=_v2.copy(target).sub(p.pos);
  const dist=dir.length();
  const pw = Math.min(24 + power*14, 42);
  kickBall(p, dir, pw, 1.4 + Math.min(dist*0.015,1.8)); // remates más rasos, atajables
}

// ---------------------------------------------------------------------------
//  IA de jugadores
// ---------------------------------------------------------------------------
function updateAI(dt){
  const diff = DIFF[S.difficulty];
  for(let ti=0;ti<2;ti++){
    const isHuman = ti===0;
    for(const p of teams[ti]){
      if(p.humanOwner){ continue; }   // lo mueve una persona, no la IA
      if(p.stunTimer>0){ p.vel.multiplyScalar(0.8); continue; }

      const targetsBall = shouldChase(p);
      let desired = _v.set(0,0,0);

      if(p.isGK){ goalkeeper(p, dt); continue; }

      // cabezazo en balones altos (centros y córners)
      if(canHead(p) && rng()<0.30*60*DT){        // por segundo, no por frame
        header(p, Math.abs(goalDirZ(p.team)-p.pos.z) < 30);
        continue;
      }
      // entrada/barrida de la IA sobre el rival con balón
      if(targetsBall && S._owner && S._owner.team!==p.team && p.slideCd<=0
         && distXZ(p.pos, S._owner.pos)<2.3 && rng()<0.02*diff.react*60*DT){
        slideTackle(p);
        continue;
      }

      if(S._owner===p){
        // tiene el balón: avanzar a portería / decidir
        aiWithBall(p, diff, dt);
        continue;
      }

      // la IA también se cansa: perseguir desgasta, posicionarse recupera
      if(targetsBall) p.stamina = Math.max(0, p.stamina - dt*0.09);
      else            p.stamina = Math.min(1, p.stamina + dt*0.06);

      if(targetsBall){
        desired.copy(ball.position).sub(p.pos);
      } else {
        // volver a posición de formación desplazada por el balón
        homePos(ti, p.formation, _v2);
        const ballBias = ball.position.z * 0.18;
        _v2.z += ballBias;
        _v2.x = _v2.x*0.7 + ball.position.x*0.25;
        desired.copy(_v2).sub(p.pos);
      }
      const maxSpd = baseSpeed(p) * (targetsBall?diff.ai:0.9);
      steer(p, desired, maxSpd, dt);
    }
  }
}

// En el saque de centro, el equipo que NO saca debe esperar fuera del círculo
// hasta que el balón se ponga en juego.
function enforceKickoffRule(){
  if(S.phase!=='kickoff' || S.kickoffTaken) return;
  const R = CIRCULO + 0.5;
  for(const p of teams[1-S.kickTeam]){
    const d = Math.hypot(p.pos.x, p.pos.z);
    if(d < R){
      const k = R/Math.max(d, 0.001);
      p.pos.x*=k; p.pos.z*=k; p.vel.set(0,0,0);
    }
  }
}

function shouldChase(p){
  // el más cercano al balón (que no sea portero) presiona; si ése es el humano
  // controlado, el 2º más cercano de la IA sale a presionar también.
  const mine = teams[p.team];
  let c1=null,d1=1e9,c2=null,d2=1e9;
  for(const m of mine){ if(m.isGK) continue; const d=distXZ(m.pos,ball.position);
    if(d<d1){ d2=d1;c2=c1; d1=d;c1=m; } else if(d<d2){ d2=d;c2=m; } }
  // si al más cercano lo lleva una persona, presiona el segundo (la IA no se queda quieta)
  if(c1 && c1.humanOwner) return p===c2;
  return p===c1;
}

// Velocidades realistas (m/s): correr ~6.5-7, sprint ~9 (≈100 m en 11 s).
// Cruzar el campo (105 m) cuesta unos 12 s a tope, no 1 segundo.
function baseSpeed(p){
  const rSpeed = p.role==='DEL'?7.0 : p.role==='MED'?6.8 : p.role==='DEF'?6.6 : 6.2;
  // el cansancio también afecta a la IA
  return rSpeed * (0.78 + 0.22*(p.stamina!==undefined?p.stamina:1));
}

function steer(p, desired, maxSpd, dt){
  desired.y=0;
  const len=desired.length();
  if(len>0.05){ desired.multiplyScalar(maxSpd/len); }
  p.vel.lerp(desired, suavizado(0.1, dt));   // antes dt*6: no era dt-correcto
  if(p.vel.length()>maxSpd) p.vel.setLength(maxSpd);
  p.pos.addScaledVector(p.vel, dt);
  clampToField(p.pos);
}
function clampToField(pos){
  pos.x=Math.max(-HALF_W-4,Math.min(HALF_W+4,pos.x));
  pos.z=Math.max(-HALF_L-4,Math.min(HALF_L+4,pos.z));
}

function aiWithBall(p, diff, dt){
  const gz=goalDirZ(p.team);
  const distGoal=Math.abs(gz-p.pos.z);
  const pressure = nearestOpponentDist(p);
  // decisiones
  if(distGoal<26 && Math.abs(p.pos.x)<22 && rng()<(0.010+diff.react*0.014)*60*DT){
    doShoot(p, 0.6+rng()*0.4); return;
  }
  if(pressure<2.6 && rng()<0.015*60*DT){
    doPass(p); return;
  }
  // conducir hacia portería con leve zigzag evitando al rival
  const dir=_v.set((rng()-0.5)*0.2, 0, Math.sign(gz-p.pos.z));
  // sesgar hacia el centro del arco
  dir.x += (-p.pos.x*0.02);
  steer(p, dir, baseSpeed(p)*0.92*diff.ai, dt);   // dt real: antes iba fijo a 1/60
}

function goalkeeper(p, dt){
  const gz = p.team===0? -HALF_L : HALF_L; // su propia portería
  // posición predicha del balón (anticipación de la atajada)
  const bp = _v2.copy(ball.position).addScaledVector(ball.userData.vel, 0.22);
  const targetX = Math.max(-GOAL_W/2-1.2, Math.min(GOAL_W/2+1.2, bp.x*0.9));
  const line = gz + (p.team===0? 2.2 : -2.2);
  _v.set(targetX,0,line).sub(p.pos);
  // si el balón se acerca a su zona, sale a achicar hacia el punto predicho
  if(distXZ(p.pos,ball.position)<15 && Math.abs(ball.position.z-gz)<22){
    _v.copy(bp).sub(p.pos); _v.y=0;
  }
  steer(p, _v, 7.2, dt);
  // atajar y despejar
  if(distXZ(p.pos,ball.position)<1.9 && ball.position.y<2.4){
    estad.despejesPortero++;
    const out=_v2.set((rng()-0.5)*22, 0, p.team===0?22:-22);
    kickBall(p, out, 26, 4);
  }
}

// ---------------------------------------------------------------------------
//  CONTROL DEL JUGADOR HUMANO
// ---------------------------------------------------------------------------
function updateHumans(dt){
  for(const h of S.humans) updateHuman(dt, h);
}
function updateHuman(dt, h){
  const p=h.controlled; if(!p || p.expelled) return;
  const input = h.input;
  // Mapeo relativo a la CÁMARA LATERAL: la cámara está en -X mirando hacia +X,
  // así que "arriba" en pantalla = +X (alejarse) y "derecha" = +Z (arco rival del local).
  const mv=_v.set(-input.move.y, 0, input.move.x);

  // --- Sprint con energía (stamina) ---
  const moving = mv.lengthSq()>0.01;
  const wantSprint = input.sprint && p.stamina>0.06 && moving;
  if(wantSprint) p.stamina = Math.max(0, p.stamina - dt*0.085);  // ~12 s de sprint continuo
  else           p.stamina = Math.min(1, p.stamina + dt*(moving?0.05:0.12));
  // cansado = menos punta de velocidad
  const fatiga = 0.74 + 0.26*p.stamina;
  const spd = baseSpeed(p) * (wantSprint?SPRINT_MUL:1.0) * fatiga;

  // aceleración/frenado progresivos (nada de arranques instantáneos)
  const accel = wantSprint? 7.0 : 8.5;
  if(moving){
    mv.normalize().multiplyScalar(spd);
    p.vel.lerp(mv, suavizado(accel/60, dt));
  } else {
    p.vel.multiplyScalar(Math.pow(0.015,dt));
  }
  if(p.vel.length()>spd) p.vel.setLength(spd);
  p.pos.addScaledVector(p.vel,dt);
  clampToField(p.pos);
  p.sprinting = wantSprint;

  const hasBall = S._owner===p;
  if(input.switch && !hasBall){ // cambiar de jugador
    asignarControl(h, masCercanoLibre(h.team, h)); refreshRings();
  }
  if(input.pass){
    if(hasBall) doPass(p);
    else if(canHead(p)) header(p, false);          // cabezazo de despeje/pase
    else { asignarControl(h, masCercanoLibre(h.team, h)); refreshRings(); }
  }
  if(input.shoot){
    if(hasBall) doShoot(p, 0.8);
    else if(canHead(p)) header(p, true);           // cabezazo a puerta
    else slideTackle(p);                            // barrida
  }
}

// --- CABEZAZO: sólo si el balón viene alto y cerca ---
function canHead(p){
  const b=ball.position;
  return b.y>1.1 && b.y<3.6 && distXZ(p.pos,b)<2.5 && p.stunTimer<=0;
}
function header(p, aPuerta){
  estad.cabezazos++;
  const gz=goalDirZ(p.team);
  let dir;
  if(aPuerta){
    dir=_v.set((rng()-0.5)*GOAL_W*0.8, 0, gz).sub(p.pos);
    kickBall(p, dir, 19, 1.0);
  } else {
    dir=_v.set((rng()-0.5)*16, 0, gz).sub(p.pos);
    kickBall(p, dir, 14, 3.0);
  }
  p.heading=0.35;   // animación
  lastTouch=p.team;
}

// --- BARRIDA: limpia si llega al balón, falta si arrolla al rival ---
function slideTackle(p){
  if(p.slideCd>0 || p.stunTimer>0) return;
  p.slideCd=1.3; p.sliding=0.55;
  const dir=new THREE.Vector3(Math.sin(p.facing),0,Math.cos(p.facing));
  p.vel.copy(dir).multiplyScalar(baseSpeed(p)*1.55);
  const db=distXZ(p.pos, ball.position);
  const victim = (S._owner && S._owner.team!==p.team) ? S._owner : null;
  const dv = victim? distXZ(p.pos, victim.pos) : 99;
  if(db<2.7 && db<=dv+0.35){
    // llega primero al balón: entrada legal
    ball.userData.vel.set(dir.x*11, 1.3, dir.z*11);
    ball.userData.kickLock=0.28; lastTouch=p.team;
    if(S._owner){ S._owner.hasBall=false; S._owner=null; }
    S.possession=p.team; playKick();
  } else if(victim && dv<2.5){
    commitFoul(p, victim);   // se lleva al rival por delante -> falta
  }
}

// ---------------------------------------------------------------------------
//  REPETICIÓN DE GOL (buffer circular + cámara lenta)
// ---------------------------------------------------------------------------
const replay = { frames:[], max:Math.round(REPLAY_SEC*REPLAY_HZ), acc:0, idx:0, t:0 };

function recordReplay(dt){
  replay.acc += dt;
  if(replay.acc < 1/REPLAY_HZ) return;
  replay.acc = 0;
  const f = { b:[ball.position.x, ball.position.y, ball.position.z], l:[] };
  for(const arr of teams) for(const pl of arr) f.l.push({pl, x:pl.pos.x, z:pl.pos.z, fa:pl.facing});
  replay.frames.push(f);
  if(replay.frames.length > replay.max) replay.frames.shift();
}
function startReplay(){
  if(replay.frames.length < 8){ endReplay(); return; }
  S.phase='replay'; S.phaseT=0; replay.idx=0; replay.t=0;
  document.getElementById('replayFx').classList.add('show');
}
// devuelve false cuando termina
function playReplay(dt){
  const fr=replay.frames;
  replay.t += dt*REPLAY_HZ*REPLAY_SPEED;
  const i = Math.floor(replay.t);
  if(i >= fr.length-1) return false;
  const f=fr[i], g=fr[i+1], a=replay.t-i;      // interpolación entre fotogramas
  ball.position.set(f.b[0]+(g.b[0]-f.b[0])*a, f.b[1]+(g.b[1]-f.b[1])*a, f.b[2]+(g.b[2]-f.b[2])*a);
  ball.userData.blob.position.set(ball.position.x,0.02,ball.position.z);
  const dtE = Math.max(dt,1e-4);
  for(let k=0;k<f.l.length;k++){
    const e=f.l[k], e2=g.l[k]; if(!e||!e2||e.pl!==e2.pl) continue;
    const nx=e.x+(e2.x-e.x)*a, nz=e.z+(e2.z-e.z)*a;
    e.pl.vel.set((nx-e.pl.pos.x)/dtE, 0, (nz-e.pl.pos.z)/dtE);  // para la animación de carrera
    e.pl.pos.set(nx,0,nz); e.pl.facing=e.fa;
  }
  return true;
}
function endReplay(){
  document.getElementById('replayFx').classList.remove('show');
  replay.frames.length=0;
  placeKickoff( lastScorer!=null ? 1-lastScorer : (S.score[0]>S.score[1]?1:0) );
  S.phase='kickoff'; S.phaseT=0;
}
// cámara cinematográfica de repetición: baja, detrás del arco, en travelling
function replayCamera(dt){
  const gz = (lastScorer===0? HALF_L : -HALF_L);
  const s = Math.sign(gz);
  const t = replay.t/REPLAY_HZ;
  const ang = -0.5 + t*0.30;
  camera.position.lerp(_v.set(Math.sin(ang)*22, 4.5+t*0.8, gz + s*(14 - t*1.2)), Math.min(1,dt*3));
  if(Math.abs(camera.fov-34)>0.02){ camera.fov=34; camera.updateProjectionMatrix(); }
  camera.lookAt(ball.position.x*0.7, 1.3, ball.position.z*0.95);
}

// ---------------------------------------------------------------------------
//  CÁMARA de transmisión
// ---------------------------------------------------------------------------
const camTarget = new THREE.Vector3();
// En 16:9, encuadrar TODO el ancho del campo (68 m, escorzado) obliga a mostrar
// ~70 m de largo. Con menos, la pantalla se llena sólo de césped.
const VIEW_LEN = 70;
// distancia lateral necesaria para encuadrar VIEW_LEN metros según el aspecto
// La cámara vive DENTRO del cuenco del estadio: distancia lateral fija (nunca se mete
// en la grada) y FOV dinámico para encuadrar siempre VIEW_LEN metros sea cual sea el aspecto.
// Más lejos y más alta que antes: así el ancho del campo cabe en el encuadre
// también en pantallas panorámicas, con aire para las vallas y las tribunas.
const CAM_DIST = HALF_W + 20;   // 54 m desde el centro
const CAM_H    = 30;
// Punto de mira: bisectriz angular entre la línea de banda cercana y la lejana.
const AIM_X = (()=>{
  const thNear = Math.atan(CAM_H/(CAM_DIST-HALF_W));   // línea cercana
  const thFar  = Math.atan(CAM_H/(CAM_DIST+HALF_W));   // línea lejana
  // +6 m hacia el fondo: sacrifica un poco de la banda cercana (poco interesante)
  // a cambio de que entren las gradas y las luces del fondo.
  return -CAM_DIST + CAM_H/Math.tan((thNear+thFar)/2) + 6;
})();
let __camCalls=0, __camLast=null;
let curView = VIEW_LEN;
function updateCamera(dt){
  __camCalls++;
  if(S.phase==='replay'){ replayCamera(dt); return; }   // cámara cinematográfica
  camTarget.lerp(ball.position, Math.min(1,dt*2.6));
  // encuadre más cerrado en saques y jugadas paradas (dramatismo)
  const objetivo = (S.phase==='kickoff'||S.phase==='setpiece') ? 50 : VIEW_LEN;
  if(S.camSnap) curView = objetivo;
  else curView += (objetivo-curView)*Math.min(1,dt*2.6);
  const hFov = 2*Math.atan((curView/2)/CAM_DIST);
  const vFovDeg = 2*Math.atan(Math.tan(hFov/2)/camera.aspect) * 180/Math.PI;
  const fovDeg = Math.max(24, Math.min(72, vFovDeg));
  __camLast = fovDeg;
  if(Math.abs(camera.fov-fovDeg)>0.02){ camera.fov=fovDeg; camera.updateProjectionMatrix(); }
  // CÁMARA LATERAL: en la banda (-X), sigue el juego a lo largo del campo (Z).
  // Así las porterías quedan a izquierda y derecha, y el local ataca hacia la derecha.
  const desired = _v.set(
    -CAM_DIST + camTarget.x*0.10,
    CAM_H + Math.abs(camTarget.x)*0.04,
    camTarget.z*0.86
  );
  if(S.camSnap){ camera.position.copy(desired); S.camSnap=false; }   // colocación instantánea
  else camera.position.lerp(desired, Math.min(1,dt*2.3));
  // Apunta al MEDIO ANGULAR del ancho del campo (no al centro geométrico): así la
  // banda visible queda centrada en el terreno y no se pierde la línea cercana.
  _v2.set(AIM_X + camTarget.x*0.30, 1.0, camTarget.z*0.92);
  camera.lookAt(_v2);
}

// ---------------------------------------------------------------------------
//  GOLES, RELOJ Y FASES
// ---------------------------------------------------------------------------
function scoreGoal(team){
  estad.goles++;
  S.score[team]++; lastScorer=team;
  goalCooldown=3.2;
  S.phase='goal'; S.phaseT=0;
  updateScorebug();
  const scorer = names[team][ (7+ (rng()*3|0)) ];
  announce('¡GOOOL!', `${team===0?S.homeTeam.nombre:S.awayTeam.nombre} — ${scorer}`);
  burstConfetti(team);
  playWhistle(2); crowdCheer();
}

function announce(big, small){
  const a=document.getElementById('announce');
  document.getElementById('annBig').textContent=big;
  document.getElementById('annSmall').textContent=small||'';
  a.classList.add('show');
  clearTimeout(announce._t);
  announce._t=setTimeout(()=>a.classList.remove('show'), 2600);
}

function updateScorebug(){
  document.getElementById('hscore').textContent=S.score[0];
  document.getElementById('ascore').textContent=S.score[1];
}
function updateClock(){
  const total=S.halfLen;
  const shown = Math.floor((S.half===1?0:45) + (S.clock/total)*45);
  const mm=String(Math.min(90,shown)).padStart(2,'0');
  document.getElementById('clock').textContent = `${mm}'`;
  document.getElementById('half').textContent = S.half===1?'1er TIEMPO':'2do TIEMPO';
}

// una barra de energía por jugador humano
function buildStaminaUI(){
  const w=document.getElementById('stamwrap');
  w.innerHTML='';
  S.humans.forEach((h,i)=>{
    const row=document.createElement('div'); row.className='stamrow';
    row.innerHTML=`<div class="lbl"><b style="color:${h.color}">${h.nombre}</b>
      · ${h.team===0?S.homeTeam.nombre:S.awayTeam.nombre}
      ${i===0?'· <b id="formTag" style="color:var(--acento)">'+S.formation[0]+'</b>':''}</div>
      <div class="bar2"><i></i></div>`;
    w.appendChild(row);
    h._bar = row.querySelector('.bar2');
  });
}
function updateStaminaUI(){
  for(const h of S.humans){
    const p=h.controlled; if(!p||!h._bar) continue;
    const pct=Math.round(p.stamina*100);
    h._bar.firstElementChild.style.width = pct+'%';
    h._bar.className = 'bar2 ' + (pct<25?'low' : pct<55?'mid' : '');
  }
}

// ¿este equipo lo lleva alguna persona? (antes se asumía que el humano era siempre
// el equipo 0, lo que rompía los saques del Jugador 2 al jugar en el equipo visitante)
function equipoTieneHumano(t){ return S.humans.some(h => h.team===t); }

function updatePhase(dt){
  S.phaseT+=dt;
  if(S.phase==='kickoff'){
    // si saca la IA, pone el balón en juego sola
    if(!equipoTieneHumano(S.kickTeam) && S.phaseT>1.1 && !S.kickoffTaken){
      const t=teams[S.kickTeam].find(p=>!p.isGK && distXZ(p.pos,ball.position)<3.5);
      if(t) doPass(t); else { S.kickoffTaken=true; S.phase='play'; S.phaseT=0; }
    }
    // si saca una persona, el juego espera a su primer pase (con tope de seguridad)
    if(equipoTieneHumano(S.kickTeam) && S.phaseT>20){ S.kickoffTaken=true; S.phase='play'; S.phaseT=0; }
  } else if(S.phase==='setpiece'){
    const sp=S.setPiece;
    // el humano dispone de unos segundos para ejecutar; la IA saca sola
    const auto = (sp && equipoTieneHumano(sp.team)) ? 4.5 : 1.3;
    if(S.phaseT>auto) takeSetPiece();
  } else if(S.phase==='goal'){
    if(S.phaseT>2.6) startReplay();          // celebración -> repetición
  } else if(S.phase==='replay'){
    if(!playReplay(dt)) endReplay();          // al terminar -> saque de centro
  } else if(S.phase==='play'){
    S.clock+=dt;
    if(S.clock>=S.halfLen){
      if(S.half===1){ S.half=2; S.clock=0; announce('DESCANSO','2do tiempo'); placeKickoff(1); S.phase='kickoff'; S.phaseT=0; playWhistle(1);}
      else { endMatch(); }
    }
  }
}
let lastScorer=null;

function endMatch(){
  S.phase='full'; S.running=false;
  const r = S.score[0]===S.score[1]?'EMPATE': (S.score[0]>S.score[1]? `Gana ${S.homeTeam.nombre}`:`Gana ${S.awayTeam.nombre}`);
  announce('FINAL', `${S.homeTeam.nombre} ${S.score[0]} — ${S.score[1]} ${S.awayTeam.nombre} · ${r}`);
  playWhistle(3);
  setTimeout(()=>{
    document.getElementById('hud').style.display='none';
    if(LIGA.activa){
      // se registra el partido jugado y se simula el resto de la jornada
      const par=partidoUsuario();
      LIGA.ultimos=[];
      if(par){
        const local = par[0]===S.homeTeam.id;
        if(local) registrar(S.homeTeam.id, S.awayTeam.id, S.score[0], S.score[1]);
        else      registrar(S.awayTeam.id, S.homeTeam.id, S.score[1], S.score[0]);
        simularJornada(par);
      }
      LIGA.jornada++;
      S.phase='menu';
      mostrarTorneo();
    } else {
      document.getElementById('menu').classList.remove('hidden');
      S.phase='menu';
    }
  }, 5000);
}

// ---------------------------------------------------------------------------
//  CONFETI de gol
// ---------------------------------------------------------------------------
let confetti=null;
function buildConfetti(){
  const N=300; const geo=new THREE.BufferGeometry();
  const pos=new Float32Array(N*3), col=new Float32Array(N*3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geo.setAttribute('color', new THREE.BufferAttribute(col,3));
  const mat=new THREE.PointsMaterial({size:0.5,vertexColors:true,transparent:true});
  confetti=new THREE.Points(geo,mat); confetti.visible=false;
  confetti.userData={vel:new Float32Array(N*3),life:0,N};
  scene.add(confetti);
}
function burstConfetti(team){
  const z = team===0? HALF_L : -HALF_L;
  const pos=confetti.geometry.attributes.position.array;
  const col=confetti.geometry.attributes.color.array;
  const vel=confetti.userData.vel; const c=new THREE.Color();
  const t = team===0?S.homeTeam:S.awayTeam;
  for(let i=0;i<confetti.userData.N;i++){
    pos[i*3]= (Math.random()-0.5)*14; pos[i*3+1]=2+Math.random()*4; pos[i*3+2]= z*0.9 + (Math.random()-0.5)*8;
    vel[i*3]=(Math.random()-0.5)*6; vel[i*3+1]=6+Math.random()*8; vel[i*3+2]=(Math.random()-0.5)*6;
    c.set(Math.random()<0.5?t.c1:t.c2); col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;
  }
  confetti.geometry.attributes.position.needsUpdate=true;
  confetti.geometry.attributes.color.needsUpdate=true;
  confetti.visible=true; confetti.userData.life=2.2;
}
function updateConfetti(dt){
  if(!confetti||!confetti.visible) return;
  const pos=confetti.geometry.attributes.position.array, vel=confetti.userData.vel;
  for(let i=0;i<confetti.userData.N;i++){
    vel[i*3+1]-=14*dt;
    pos[i*3]+=vel[i*3]*dt; pos[i*3+1]+=vel[i*3+1]*dt; pos[i*3+2]+=vel[i*3+2]*dt;
  }
  confetti.geometry.attributes.position.needsUpdate=true;
  confetti.userData.life-=dt;
  if(confetti.userData.life<=0) confetti.visible=false;
}

// ---------------------------------------------------------------------------
//  MULTITUD animada (olas sutiles)
// ---------------------------------------------------------------------------
let crowdT=0;
function updateCrowd(dt){
  crowdT+=dt;
  // destellos de cámaras fotográficas en las gradas
  if(flashes){
    const pos=flashes.geometry.attributes.position.array;
    const N=flashes.userData.N, ph=flashes.userData.phase;
    const op=flashes.geometry.attributes.alpha;
    for(let i=0;i<N;i++){
      ph[i]-=dt;
      if(ph[i]<=0){ ph[i]=1.5+Math.random()*7; op.array[i]=1; }
      else op.array[i]=Math.max(0, op.array[i]-dt*7);
    }
    op.needsUpdate=true;
  }
}
// puntos blancos que parpadean en las gradas (flashes del público)
let flashes=null;
function buildFlashes(){
  const N=260, pos=new Float32Array(N*3), alpha=new Float32Array(N), phase=new Float32Array(N);
  for(let i=0;i<N;i++){
    const lado=(Math.random()*4)|0;
    let x,z;
    if(lado<2){ x=(Math.random()<0.5?-1:1)*(HALF_W+30+Math.random()*18); z=(Math.random()-0.5)*(F.L+20); }
    else      { z=(Math.random()<0.5?-1:1)*(HALF_L+18+Math.random()*20); x=(Math.random()-0.5)*(F.W+26); }
    pos[i*3]=x; pos[i*3+1]=3+Math.random()*11; pos[i*3+2]=z;
    alpha[i]=0; phase[i]=Math.random()*8;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('alpha', new THREE.BufferAttribute(alpha,1));
  const m=new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
    vertexShader:`attribute float alpha; varying float vA;
      void main(){ vA=alpha; vec4 mv=modelViewMatrix*vec4(position,1.0);
      gl_PointSize=7.0*(60.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader:`varying float vA;
      void main(){ vec2 d=gl_PointCoord-vec2(0.5); float r=length(d);
      if(r>0.5) discard; gl_FragColor=vec4(1.0,0.97,0.9, vA*(1.0-r*2.0)); }`
  });
  flashes=new THREE.Points(g,m);
  flashes.userData={N, phase};
  scene.add(flashes);
}

// ---------------------------------------------------------------------------
//  AUDIO procedural (WebAudio) — silbato, patada, ambiente
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
//  MINIMAPA
// ---------------------------------------------------------------------------
const mm = document.getElementById('minimap'), mmx = mm.getContext('2d');
function drawMinimap(){
  const W=mm.width,H=mm.height;
  mmx.clearRect(0,0,W,H);
  mmx.fillStyle='#0a3d1a'; mmx.fillRect(0,0,W,H);
  mmx.strokeStyle='#ffffff55'; mmx.lineWidth=1;
  mmx.strokeRect(4,4,W-8,H-8);
  mmx.beginPath(); mmx.moveTo(W/2,4); mmx.lineTo(W/2,H-4); mmx.stroke();
  const toX=(z)=> 4 + (z+HALF_L)/(F.L)*(W-8);
  const toY=(x)=> 4 + (x+HALF_W)/(F.W)*(H-8);
  for(let ti=0;ti<2;ti++){
    mmx.fillStyle= ti===0?S.homeTeam.c1:S.awayTeam.c1;
    for(const p of teams[ti]){ mmx.beginPath(); mmx.arc(toX(p.pos.z),toY(p.pos.x),2.4,0,7); mmx.fill(); }
  }
  mmx.fillStyle='#fff'; mmx.beginPath(); mmx.arc(toX(ball.position.z),toY(ball.position.x),2,0,7); mmx.fill();
}

// ---------------------------------------------------------------------------
//  BUCLE PRINCIPAL
// ---------------------------------------------------------------------------
// UN TICK de simulación, siempre con el mismo dt. Todo lo que decide el
// resultado del partido vive aquí dentro; el render va aparte, a la tasa
// del monitor. Sin esto no hay servidor autoritativo posible.
let simTick = 0;
function stepSim(dt){
  updatePhase(dt);
  if(S.phase==='play'||S.phase==='kickoff'){
    updateHumans(dt);
    updateAI(dt);
    enforceKickoffRule();
    tryPossession(dt);
    updateBall(dt);
    recordReplay(dt);
  } else if(S.phase==='setpiece'){
    // cualquier humano del equipo que saca puede ejecutar antes con pase/tiro
    if(S.setPiece){
      const h=S.humans.find(x=>x.team===S.setPiece.team);
      if(h && (h.input.pass||h.input.shoot)) takeSetPiece();
    }
  }
  for(let ti=0;ti<2;ti++)for(const p of teams[ti]) p.update(dt);
  if(goalCooldown>0) goalCooldown-=dt;
  simTick++;
}

let acumulador = 0;
function animate(){
  requestAnimationFrame(animate);
  const frameDt=Math.min(clock.getDelta(), 0.25);
  if(S.running && !S.paused){
    pollInput();                       // los dispositivos se muestrean una vez por frame
    acumulador += frameDt;
    let pasos=0;
    while(acumulador >= DT && pasos < MAX_PASOS){ stepSim(DT); acumulador -= DT; pasos++; }
    if(pasos === MAX_PASOS) acumulador = 0;   // se descarta el atraso en vez de acumularlo
    // --- presentación: a la tasa del monitor, no del simulador ---
    updateConfetti(frameDt);
    updateCrowd(frameDt);
    updateCamera(frameDt);
    updateClock();
    updateStaminaUI();
    drawMinimap();
  }
  // con calidad "media" se salta el post-procesado para ganar rendimiento
  if(S.quality==='alta' && composer) composer.render();
  else renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
//  PAUSA
// ---------------------------------------------------------------------------
function togglePause(){
  if(!S.running) return;
  S.paused=!S.paused;
  document.getElementById('pause').style.display=S.paused?'flex':'none';
}

// ---------------------------------------------------------------------------
//  MODO TORNEO — liga de todos contra todos
// ---------------------------------------------------------------------------
const LIGA = { activa:false, jornada:0, calendario:[], tabla:null, ultimos:[] };

function generarCalendario(ids){
  const n=ids.length, arr=[...ids], rondas=[];
  for(let r=0;r<n-1;r++){
    const jornada=[];
    for(let i=0;i<n/2;i++) jornada.push([arr[i], arr[n-1-i]]);
    rondas.push(jornada);
    arr.splice(1,0,arr.pop());        // método del círculo: rota todos menos el primero
  }
  return rondas;
}
function crearLiga(){
  LIGA.tabla={};
  TEAMS.forEach(t=>LIGA.tabla[t.id]={id:t.id,pj:0,g:0,e:0,p:0,gf:0,gc:0,pts:0});
  LIGA.calendario=generarCalendario(TEAMS.map(t=>t.id));
  LIGA.jornada=0; LIGA.activa=true; LIGA.ultimos=[];
}
function registrar(idL, idV, gl, gv){
  const L=LIGA.tabla[idL], V=LIGA.tabla[idV];
  L.pj++; V.pj++; L.gf+=gl; L.gc+=gv; V.gf+=gv; V.gc+=gl;
  if(gl>gv){ L.g++; V.p++; L.pts+=3; }
  else if(gl<gv){ V.g++; L.p++; V.pts+=3; }
  else { L.e++; V.e++; L.pts++; V.pts++; }
  LIGA.ultimos.push({idL,idV,gl,gv});
}
// marcador simulado por fuerza de plantilla (Poisson)
function golesSimulados(fuerza, rival){
  const lam=Math.max(0.18, 1.15 + (fuerza-rival)*0.05);
  let k=0, p=1, L=Math.exp(-lam);
  do { k++; p*=Math.random(); } while(p>L);
  return k-1;
}
function simularJornada(saltar){
  const j=LIGA.calendario[LIGA.jornada]; if(!j) return;
  for(const [a,b] of j){
    if(saltar && (a===saltar[0]&&b===saltar[1] || a===saltar[1]&&b===saltar[0])) continue;
    const A=TEAMS.find(t=>t.id===a), B=TEAMS.find(t=>t.id===b);
    registrar(a,b, golesSimulados(A.ov+3,B.ov), golesSimulados(B.ov,A.ov+3));
  }
}
function clasificacion(){
  return Object.values(LIGA.tabla).sort((x,y)=>
    y.pts-x.pts || (y.gf-y.gc)-(x.gf-x.gc) || y.gf-x.gf);
}
// el partido del usuario en la jornada actual
function partidoUsuario(){
  const j=LIGA.calendario[LIGA.jornada]; if(!j) return null;
  return j.find(([a,b])=>a===S.homeTeam.id||b===S.homeTeam.id) || null;
}

function mostrarTorneo(){
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').style.display='none';
  const el=document.getElementById('torneo');
  el.classList.remove('hidden');
  const cuerpo=document.getElementById('tablaBody');
  cuerpo.innerHTML = clasificacion().map((r,i)=>{
    const t=TEAMS.find(x=>x.id===r.id);
    const yo = r.id===S.homeTeam.id;
    return `<tr class="${yo?'yo':''}">
      <td>${i+1}</td>
      <td><span class="bd" style="background:${badgeCSS(t)}"></span>${t.nombre}</td>
      <td>${r.pj}</td><td>${r.g}</td><td>${r.e}</td><td>${r.p}</td>
      <td>${r.gf}</td><td>${r.gc}</td><td>${r.gf-r.gc>0?'+':''}${r.gf-r.gc}</td>
      <td><b>${r.pts}</b></td></tr>`;
  }).join('');

  // resultados de la jornada anterior
  const res=document.getElementById('ultimos');
  res.innerHTML = LIGA.ultimos.length
    ? '<h4>Última jornada</h4>' + LIGA.ultimos.map(u=>{
        const A=TEAMS.find(t=>t.id===u.idL), B=TEAMS.find(t=>t.id===u.idV);
        return `<div class="res"><span>${A.nombre}</span><b>${u.gl} - ${u.gv}</b><span>${B.nombre}</span></div>`;
      }).join('') : '';

  const prox=partidoUsuario();
  const btn=document.getElementById('jugarJornada');
  const info=document.getElementById('proxInfo');
  if(prox && LIGA.jornada < LIGA.calendario.length){
    const rivalId = prox[0]===S.homeTeam.id? prox[1] : prox[0];
    const rival=TEAMS.find(t=>t.id===rivalId);
    const local = prox[0]===S.homeTeam.id;
    S.awayTeam = rival;
    info.innerHTML=`Jornada ${LIGA.jornada+1} de ${LIGA.calendario.length} ·
      <b>${S.homeTeam.nombre}</b> vs <b>${rival.nombre}</b> ${local?'(local)':'(visitante)'}`;
    btn.style.display=''; btn.textContent='▶ Jugar jornada '+(LIGA.jornada+1);
  } else {
    const campeon=clasificacion()[0];
    info.innerHTML=`<b>Torneo finalizado</b> · Campeón: ${TEAMS.find(t=>t.id===campeon.id).nombre}`;
    btn.style.display='none';
  }
}

// ---------------------------------------------------------------------------
//  MENÚ / UI
// ---------------------------------------------------------------------------
function badgeCSS(t){ return `linear-gradient(135deg,${t.c1} 0 50%, ${t.c2} 50% 100%)`; }

function buildMenu(){
  const hl=document.getElementById('homeList'), al=document.getElementById('awayList');
  const mk=(t, side)=>{
    const el=document.createElement('div'); el.className='team-opt';
    el.innerHTML=`<span class="badge" style="background:${badgeCSS(t)}"></span>
      <div><div class="nm">${t.nombre}</div><div class="ci">${t.ciudad}</div></div>
      <div class="ov">${t.ov}</div>`;
    el.onclick=()=>{
      if(side==='home'){ S.homeTeam=t; if(S.awayTeam===t) S.awayTeam=TEAMS.find(x=>x!==t); }
      else { S.awayTeam=t; if(S.homeTeam===t) S.homeTeam=TEAMS.find(x=>x!==t); }
      renderSel(); renderPlayersCfg();
    };
    el._team=t; el._side=side; return el;
  };
  TEAMS.forEach(t=>{ hl.appendChild(mk(t,'home')); al.appendChild(mk(t,'away')); });

  // opciones
  const chips=(cont, arr, cur, cb)=>{
    cont.innerHTML='';
    arr.forEach(([lbl,val])=>{ const c=document.createElement('span'); c.className='chip'+(val===cur()?' on':'');
      c.textContent=lbl; c.onclick=()=>{cb(val); chips(cont,arr,cur,cb);}; cont.appendChild(c); });
  };
  chips(document.getElementById('numOpts'), [['1',1],['2',2],['3',3],['4',4]],
    ()=>S.numHumanos, v=>{ S.numHumanos=v; crearHumanos(v); renderPlayersCfg(); });
  chips(document.getElementById('durOpts'), [['4 min',120],['6 min',180],['10 min',300]], ()=>S.halfLen, v=>S.halfLen=v);
  chips(document.getElementById('diffOpts'), [['Fácil','facil'],['Normal','normal'],['Difícil','dificil']], ()=>S.difficulty, v=>S.difficulty=v);
  chips(document.getElementById('qualOpts'), [['Alta','alta'],['Media','media']], ()=>S.quality, v=>{S.quality=v;});

  document.getElementById('play').onclick=()=>{ LIGA.activa=false; startMatch(); };
  document.getElementById('playLiga').onclick=()=>{ crearLiga(); mostrarTorneo(); };
  document.getElementById('jugarJornada').onclick=()=>{
    document.getElementById('torneo').classList.add('hidden'); startMatch();
  };
  document.getElementById('salirTorneo').onclick=()=>{
    LIGA.activa=false;
    document.getElementById('torneo').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
  };
  crearHumanos(S.numHumanos);
  renderPlayersCfg();
  renderSel();
}
// crea/ajusta la lista de jugadores humanos
function crearHumanos(n){
  const prev=S.humans;
  S.humans=[];
  const slotsPorDefecto=[9,10,8,7];
  for(let i=0;i<n;i++){
    const anterior=prev[i];
    S.humans.push(anterior || {
      idx:i, nombre:'Jugador '+(i+1),
      team: i%2,                       // 1º local, 2º visitante, 3º local...
      device: DISPOSITIVOS[i].id,
      slot: slotsPorDefecto[i],
      color: COLORES_HUMANO[i],
      controlled:null, _bar:null,
      input:{ move:new THREE.Vector2(), pass:false, shoot:false, sprint:false,
              switch:false, shootHold:false, _p:false, _s:false, _w:false }
    });
  }
  S.humans.forEach((h,i)=>{ h.idx=i; h.color=COLORES_HUMANO[i]; h.nombre='Jugador '+(i+1); });
}

// etiquetas de las 11 posiciones de una formación
function etiquetasSlots(nombreForm){
  const f=FORMACIONES[nombreForm]||FORMATION;
  const cuenta={};
  return f.map((s,i)=>{
    cuenta[s.r]=(cuenta[s.r]||0)+1;
    const lado = s.x<-0.15?'izq' : s.x>0.15?'der' : 'centro';
    return `${s.r} ${cuenta[s.r]} (${lado})`;
  });
}

function renderPlayersCfg(){
  const cont=document.getElementById('playersCfg');
  cont.innerHTML='';
  S.humans.forEach(h=>{
    const card=document.createElement('div');
    card.className='pcard'; card.style.borderLeftColor=h.color;
    const eqNombre = t=> t===0? S.homeTeam.nombre : S.awayTeam.nombre;
    const slots = etiquetasSlots(S.formation[h.team]);
    card.innerHTML=`
      <div class="ptitle" style="color:${h.color}">${h.nombre}</div>
      <label><span>Equipo</span>
        <select data-k="team">
          <option value="0" ${h.team===0?'selected':''}>${eqNombre(0)} (local)</option>
          <option value="1" ${h.team===1?'selected':''}>${eqNombre(1)} (visitante)</option>
        </select></label>
      <label><span>Puesto</span>
        <select data-k="slot">
          ${slots.map((s,i)=>`<option value="${i}" ${h.slot===i?'selected':''}>${s}</option>`).join('')}
        </select></label>
      <label><span>Control</span>
        <select data-k="device">
          ${DISPOSITIVOS.map(d=>`<option value="${d.id}" ${h.device===d.id?'selected':''}>${d.nombre}</option>`).join('')}
        </select></label>`;
    card.querySelectorAll('select').forEach(sel=>{
      sel.onchange=()=>{
        const k=sel.dataset.k;
        h[k] = (k==='device') ? sel.value : parseInt(sel.value,10);
        renderPlayersCfg();
      };
    });
    // aviso si dos personas comparten mando o puesto
    const dup=S.humans.filter(o=>o!==h && o.device===h.device).length;
    const dupSlot=S.humans.filter(o=>o!==h && o.team===h.team && o.slot===h.slot).length;
    if(dup||dupSlot){
      const w=document.createElement('div'); w.className='pwarn';
      w.textContent = dup? '⚠ Control repetido con otro jugador'
                         : '⚠ Mismo puesto que otro jugador del equipo';
      card.appendChild(w);
    }
    cont.appendChild(card);
  });
}

function renderSel(){
  document.querySelectorAll('#homeList .team-opt').forEach(el=>el.classList.toggle('sel', el._team===S.homeTeam));
  document.querySelectorAll('#awayList .team-opt').forEach(el=>el.classList.toggle('sel', el._team===S.awayTeam));
  document.getElementById('homeOv').textContent=S.homeTeam.nombre;
  document.getElementById('awayOv').textContent=S.awayTeam.nombre;
}

function setupHUDTeams(){
  document.getElementById('hname').textContent=S.homeTeam.nombre.toUpperCase();
  document.getElementById('aname').textContent=S.awayTeam.nombre.toUpperCase();
  document.getElementById('hbadge').style.background=badgeCSS(S.homeTeam);
  document.getElementById('abadge').style.background=badgeCSS(S.awayTeam);
  updateScorebug();
  document.getElementById('controlsHint').innerHTML =
    `<b>CONTROLES</b><br>Mover <span class="k">W</span><span class="k">A</span><span class="k">S</span><span class="k">D</span> / Flechas<br>`+
    `Pase <span class="k">J</span> · Tiro <span class="k">K</span><br>Sprint <span class="k">L</span> · Cambiar <span class="k">␣</span><br>`+
    `<span style="opacity:.75">Sin balón: <span class="k">K</span> barrida · <span class="k">J/K</span> cabezazo</span><br>`+
    `Formación <span class="k">F</span> · Pausa <span class="k">Esc</span><br>`+
    `<span style="opacity:.6">Joystick: A pase · B tiro · RT sprint · Y cambiar</span>`;
}

function startMatch(){
  ensureAudio();
  // limpiar equipos previos
  teams.forEach(arr=>arr.forEach(p=>scene.remove(p.mesh))); teams[0]=[]; teams[1]=[];
  spawnTeams();
  S.score=[0,0]; S.clock=0; S.half=1; lastScorer=null;
  cards[0]={a:0,r:0}; cards[1]={a:0,r:0}; S.setPiece=null;
  replay.frames.length=0;   // el buffer guarda referencias a los Player del partido anterior
  if(!S.humans.length) crearHumanos(S.numHumanos);
  S.humans.forEach(h=>h.controlled=null);
  setupHUDTeams(); updateCardsUI(); buildStaminaUI();
  placeKickoff(0);
  S.phase='kickoff'; S.phaseT=0; S.running=true; S.paused=false;
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').style.display='block';
  document.getElementById('pause').style.display='none';
  playWhistle(1);
}

// pausa botones
document.getElementById('resume').onclick=togglePause;
document.getElementById('toMenu').onclick=()=>{
  S.running=false; S.paused=false;
  document.getElementById('pause').style.display='none';
  document.getElementById('hud').style.display='none';
  document.getElementById('menu').classList.remove('hidden');
  S.phase='menu';
};

// ---------------------------------------------------------------------------
//  ARRANQUE
// ---------------------------------------------------------------------------
function boot(){
  initThree();
  buildSky(scene);
  buildLights(scene, S.quality);
  buildField(scene);
  buildStadium(scene);
  buildFlashes();
  buildBall();
  buildConfetti();
  buildMenu();
  updatePadUI();
  window.__dbg = {
    // --- lectura ---
    get cam(){return camera.position;}, get ball(){return ball.position;}, S, teams,
    get camera(){return camera;}, get scene(){return scene;},
    get camCalls(){return __camCalls;}, get camDist(){return __camLast;},
    get canvases(){return document.querySelectorAll('canvas').length;},
    get tick(){return simTick;},
    LIGA, simularJornada, clasificacion, mostrarTorneo,

    // --- determinismo ---
    seed: n => sembrar(n),
    hash: () => hashEstado(),
    rand: () => rng(),                       // sonda: comprueba el propio RNG
    stepN(n){ for(let i=0;i<n;i++) stepSim(DT); return hashEstado(); },
    resetGolden(semilla=12345){              // mismo reinicio que golden(), sin correr
      S.humans=[]; sembrar(semilla);
      teams.forEach(arr=>arr.forEach(pl=>scene.remove(pl.mesh)));
      teams[0]=[]; teams[1]=[]; spawnTeams();
      S.score=[0,0]; S.clock=0; S.half=1; lastScorer=null;
      cards[0]={a:0,r:0}; cards[1]={a:0,r:0}; S.setPiece=null;
      replay.frames.length=0; replay.acc=0; replay.t=0; replay.idx=0;
      goalCooldown=0; acumulador=0; simTick=0;
      lastTouch=-1; offsidePend=null; passReceiver=null;
      S._owner=null; S.possession=0;
      placeKickoff(0); S.phase='kickoff'; S.phaseT=0;
      return hashEstado();
    },

    // --- comandos de forzado: convierten la prueba de humo en 90 s deterministas ---
    teleportBall(x, y=BALL_R, z=0){
      ball.position.set(x,y,z); ball.userData.vel.set(0,0,0); ball.userData.kickLock=0;
      if(S._owner){ S._owner.hasBall=false; S._owner=null; }
      return [x,y,z];
    },
    setClock(seg){ S.clock=seg; return S.clock; },
    goal(team=0){ lastTouch=team; scoreGoal(team); return S.score.slice(); },
    forceSetPiece(tipo='penal', team=0){
      const gz = goalDirZ(team);              // portería que ataca ese equipo
      const pos = {
        penal:  [0, gz - Math.sign(gz)*11],
        corner: [Math.sign(gz)*(HALF_W-0.4), gz],
        banda:  [HALF_W, 0],
        puerta: [0, -gz + Math.sign(gz)*5.5],
        falta:  [ball.position.x, ball.position.z],
      }[tipo];
      if(!pos) return 'tipo inválido: penal|corner|banda|puerta|falta';
      startSetPiece(tipo, team, pos[0], pos[1]);
      return {tipo, team, pos};
    },
    card(tipo='amarilla', team=1, idx=5){
      const p = teams[team][idx]; if(!p) return 'jugador inexistente';
      if(tipo==='roja'){ cards[team].r++; sendOff(p); } else { cards[team].a++; p.yellow++; }
      showCard(tipo); return {tipo, team, num:p.num, cards:cards.map(c=>({...c}))};
    },
    forceOffside(){
      // adelanta a un punta por detrás del último defensa y le mete el pase
      const atac = teams[0].filter(p=>!p.isGK).sort((a,b)=>b.formation.z-a.formation.z)[0];
      const zs = teams[1].map(o=>o.pos.z).sort((a,b)=>b-a);
      atac.pos.z = Math.max(zs[1] + 4, 6);
      const pasador = teams[0].find(p=>p!==atac && !p.isGK);
      ball.position.set(pasador.pos.x, BALL_R, pasador.pos.z);
      offsidePend = atac; S._owner = pasador;
      callOffside(atac);
      return {adelantado:atac.num, z:+atac.pos.z.toFixed(1)};
    },

    // --- GOLDEN MASTER: N segundos de IA vs IA, semilla fija, hash por segundo ---
    golden(segundos=90, semilla=12345){
      const humanosAntes = S.humans;
      S.humans = [];                                   // IA pura: sin entradas humanas
      for(const arr of teams) for(const p of arr) p.humanOwner = null;
      sembrar(semilla);
      // Mundo COMPLETAMENTE limpio. Reutilizar los jugadores no sirve: arrastran
      // energía gastada y temporizadores, y sendOff() los saca del array, así que
      // tras una roja la siguiente corrida empezaría con menos jugadores.
      teams.forEach(arr=>arr.forEach(pl=>scene.remove(pl.mesh)));
      teams[0]=[]; teams[1]=[]; spawnTeams();
      S.score=[0,0]; S.clock=0; S.half=1; lastScorer=null;
      cards[0]={a:0,r:0}; cards[1]={a:0,r:0}; S.setPiece=null;
      replay.frames.length=0; replay.acc=0; replay.t=0; replay.idx=0;
      goalCooldown=0; acumulador=0; simTick=0;
      lastTouch=-1; offsidePend=null; passReceiver=null;
      S._owner=null; S.possession=0; resetEstad();
      placeKickoff(0); S.phase='kickoff'; S.phaseT=0;
      const hashes=[];
      const total=Math.round(segundos/DT);
      for(let i=0;i<total;i++){
        stepSim(DT);
        if((i+1) % 60 === 0) hashes.push(hashEstado());
      }
      const resumen={ semilla, segundos, ticks:total, marcador:S.score.slice(),
                      estad:{...estad}, hashes, final:hashes[hashes.length-1] };
      S.humans = humanosAntes;
      return resumen;
    },
  };
  animate();
  setTimeout(()=>document.getElementById('loader').style.display='none', 500);
}
boot();

// resumir audio en primer gesto
addEventListener('pointerdown', ()=>ensureAudio(), {once:true});
