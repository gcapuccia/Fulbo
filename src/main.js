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
         REPLAY_SEC, REPLAY_HZ, REPLAY_SPEED, COLORES_HUMANO, DISPOSITIVOS, GOL_ESPERA }
                                              from './config/rules.js';
// --- Núcleo ---
import { Vec3 }                               from './core/math.js';
import { emitir, drenarEventos, limpiarEventos } from './core/events.js';
import { crearPresentador }                   from './ui/presenter.js';
import { crearReplayView }                    from './render/replayView.js';
import { tickTimers }                         from './core/systems/movement.js';
import { playerId, jugadorDeAsiento, esHumano, asignarControl as asignarControlSeat }
                                              from './core/systems/seats.js';
import { crearJugador }                       from './core/player.js';
import { construirMalla }                     from './render/playerMesh.js';
import { sincronizarAnillos }                 from './render/rings.js';
import { syncPlayerView, anotarEventos, reiniciarGestos, tickGestos }
                                                 from './render/playerView.js';
import { binds, guardarBinds, restaurarBinds, nombreTecla, ACCIONES }
                                              from './config/binds.js';
import { perfil, setApodo, contarPartido }    from './app/perfil.js';
import { G }                                  from './app/G.js';
import { crearPartido, reiniciarEstad }       from './core/match.js';
import { fijarActivo }                        from './core/activo.js';

// PARTIDO ACTIVO. Las funciones del núcleo trabajan sobre él. Un servidor
// llamaría a usarPartido(salaX) antes de procesar el tick de esa sala.
let m = fijarActivo(crearPartido());
export function usarPartido(partido){ m = fijarActivo(partido); return m; }
export function partidoActual(){ return m; }
import { badgeCSS }                           from './ui/badge.js';
import { LIGA, crearLiga, registrar, simularJornada, clasificacion, partidoUsuario,
         mostrarTorneo }                      from './league/league.js';
import { buildConfetti, burstConfetti, updateConfetti, buildFlashes, updateCrowd }
                                              from './render/effects.js';
import { suavizado }                          from './core/rng.js';
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
// Sólo el azar que AFECTA A LAS REGLAS pasa por m.rng(). El azar cosmético
// (piel, pelo, césped, público, confeti, estrellas) sigue usando Math.random():
// esa separación es exactamente la frontera core/render.


// Contadores para afinar el balance con datos, no con impresiones.

// Suavizado independiente del dt: k es la fracción que se aplicaría a 60 Hz.
// El lerp(dt*k) de toda la vida NO es dt-correcto: la aceleración efectiva
// cambia con los fotogramas por segundo.

// Hash del estado autoritativo. Cuantizado a milésimas para no acusar ruido
// de coma flotante, pero sí cualquier divergencia real de simulación.
function hashEstado(){
  const q = v => Math.round(v*1000)/1000;
  let s = q(m.bola.pos.x)+','+q(m.bola.pos.y)+','+q(m.bola.pos.z)+'|'
        + q(m.bola.vel.x)+','+q(m.bola.vel.y)+','+q(m.bola.vel.z)+'|'
        + q(m.bola.kickLock)+'|';
  for(let ti=0;ti<2;ti++) for(const p of m.teams[ti]){
    s += q(p.pos.x)+','+q(p.pos.z)+','+q(p.vel.x)+','+q(p.vel.z)+','+q(p.facing)+','
       + q(p.stamina)+','+q(p.stunTimer)+','+q(p.sliding)+','+(p.expelled?1:0)+';';
  }
  s += '|'+m.S.score[0]+'-'+m.S.score[1]+'|'+q(m.S.clock)+'|'+m.S.phase+'|'+m.S.possession
     + '|'+m.cards[0].a+','+m.cards[0].r+','+m.cards[1].a+','+m.cards[1].r;
  let h = 0x811c9dc5;                       // FNV-1a
  for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h,0x01000193)>>>0; }
  return h.toString(16).padStart(8,'0');
}

// sombra suave reutilizable (degradado radial) para jugadores y balón

// ---------------------------------------------------------------------------
//  ESTADO GLOBAL
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
//  THREE — Renderer, escena, cámara
// ---------------------------------------------------------------------------

function initThree(){
  G.renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
  G.renderer.setSize(innerWidth, innerHeight);
  G.renderer.setPixelRatio(Math.min(devicePixelRatio, m.S.quality==='alta'?2:1.25));
  G.renderer.shadowMap.enabled = true;
  G.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  G.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // exposición contenida: con ACES, un amarillo saturado a plena luz vira a naranja
  G.renderer.toneMappingExposure = 0.92;
  G.renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.getElementById('app').appendChild(G.renderer.domElement);

  G.scene = new THREE.Scene();
  G.scene.background = new THREE.Color('#0e2138');
  G.scene.fog = new THREE.Fog('#123150', 150, 340);

  G.camera = new THREE.PerspectiveCamera(48, innerWidth/innerHeight, 0.1, 600);
  G.camera.position.set(0, 42, 66);
  G.camera.lookAt(0,0,0);

  G.clock = new THREE.Clock();

  // --- POST-PROCESADO: bloom en focos, vallas LED y reflejos ---
  G.composer = new EffectComposer(G.renderer);
  G.composer.addPass(new RenderPass(G.scene, G.camera));
  G.bloomPass = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    0.62,   // intensidad
    0.55,   // radio del halo
    0.82    // umbral: sólo lo muy brillante resplandece
  );
  G.composer.addPass(G.bloomPass);
  G.composer.addPass(new OutputPass());   // aplica tonemapping + sRGB al final

  addEventListener('resize', ()=>{
    G.camera.aspect = innerWidth/innerHeight; G.camera.updateProjectionMatrix();
    G.renderer.setSize(innerWidth, innerHeight);
    G.composer.setSize(innerWidth, innerHeight);
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
  G.ball = new THREE.Mesh(geo, mat);
  G.ball.castShadow = true;
  m.bola.pos.set(0,BALL_R,0);
  G.ball.userData = {};   // el estado vive en bola (core/state.js)
  G.scene.add(G.ball);
  // sombra "blob" extra bajo el balón
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.55,0.55),
    new THREE.MeshBasicMaterial({map:softShadowTexture(),transparent:true,
      opacity:0.5,depthWrite:false}));
  sh.rotation.x=-Math.PI/2; sh.position.y=0.02; G.ball.userData.blob=sh; G.scene.add(sh);
}


// ---------------------------------------------------------------------------
//  ENTRADAS: Teclado + Gamepad
// ---------------------------------------------------------------------------
const keys = {};
addEventListener('keydown', e=>{ keys[e.code]=true;
  if(['Space','KeyJ','KeyK','KeyL','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  if(e.code==='Escape') togglePause();
  if(e.code==='KeyF' && m.S.running) cycleFormation();
});
addEventListener('keyup', e=>{ keys[e.code]=false; });

const pad = { connected:false, index:null };
addEventListener('gamepadconnected', e=>{ pad.connected=true; pad.index=e.gamepad.index; updatePadUI(); });
addEventListener('gamepaddisconnected', e=>{ if(e.gamepad.index===pad.index){pad.connected=false; updatePadUI();} });

// (el input ahora es por jugador humano: ver S.humans / leerDispositivo)

// lee el estado bruto de un dispositivo concreto
function leerDispositivo(dev){
  let mx=0,my=0,pass=false,shoot=false,sprint=false,sw=false;
  if(dev==='teclado1' || dev==='teclado2'){
    const b = binds[dev];
    if(keys[b.arriba]) my-=1;
    if(keys[b.abajo])  my+=1;
    if(keys[b.izq])    mx-=1;
    if(keys[b.der])    mx+=1;
    pass   = !!keys[b.pase];
    shoot  = !!keys[b.tiro];
    sprint = !!keys[b.sprint];
    sw     = !!keys[b.cambiar];
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
  for(const h of m.S.humans){
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

function spawnTeams(){
  [0,1].forEach(ti=>{
    const t = ti===0? m.S.homeTeam : m.S.awayTeam;
    const kit = {c1:t.c1, c2:t.c2};
    m.teams[ti]=[]; m.names[ti]=[];
    const forma = FORMACIONES[m.S.formation[ti]] || FORMATION;
    forma.forEach((f,i)=>{
      const p = crearJugador(ti, f.r, i===0?1:i+1);   // datos puros: corre en Node
      p.playerId = playerId(ti, i);      // identificador estable para la red
      p.formation = f;
      construirMalla(p, kit, G.scene);   // y aquí, sólo en el cliente, la malla
      m.teams[ti].push(p);
      m.names[ti].push(NOMBRES[(i + ti*7)%NOMBRES.length]);
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
  const todos=[...m.teams[0],...m.teams[1]];
  for(let it=0; it<4; it++){
    for(let i=0;i<todos.length;i++) for(let j=i+1;j<todos.length;j++){
      const a=todos[i], b=todos[j];
      let dx=b.pos.x-a.pos.x, dz=b.pos.z-a.pos.z;
      let d=Math.hypot(dx,dz);
      if(d<1e-4){ dx=m.rng()-0.5; dz=m.rng()-0.5; d=Math.hypot(dx,dz); }
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
  m.S.kickTeam = kickTeam;
  m.S.kickoffTaken = false;          // el rival no entra al círculo hasta el primer toque
  const kd = kickTeam===0?1:-1;    // dirección de ataque del que saca

  [0,1].forEach(ti=>{
    const dir = ti===0?1:-1;
    m.teams[ti].forEach(p=>{
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
  const punta = m.teams[kickTeam].filter(p=>!p.isGK)
    .sort((a,b)=>b.formation.z-a.formation.z);
  if(punta[0]) punta[0].pos.set(-0.75, 0, -0.85*kd);   // ejecutor
  if(punta[1]) punta[1].pos.set( 2.60, 0, -1.70*kd);   // receptor del primer pase
  separarJugadores(1.5);                                // sin jugadores encimados
  m.bola.pos.set(0,BALL_R,0); m.bola.vel.set(0,0,0);
  m.bola.kickLock=0;        // si no, el saque hereda el bloqueo de re-toque anterior
  camTarget.copy(m.bola.pos); m.S.camSnap=true;   // cámara ya colocada en el saque
  m.S.possession = kickTeam;
  asignarPosicionesIniciales();
}

// ---------------------------------------------------------------------------
//  UTILIDADES DE JUEGO
// ---------------------------------------------------------------------------
// Scratch de SIMULACIÓN. Nunca deben compartirse con el render: si la cámara
// y la IA escriben en el mismo vector temporal, aparece un teletransporte
// intermitente imposible de reproducir.
const _v = new Vec3(), _v2 = new Vec3();
function nearestToBall(ti){
  let best=null, bd=1e9;
  m.teams[ti].forEach(p=>{ if(p.isGK) return;
    const d=p.pos.distanceToSquared(m.bola.pos); if(d<bd){bd=d;best=p;} });
  return best;
}
// ---------------------------------------------------------------------------
//  JUGADORES HUMANOS (multijugador local: teclado y mandos)
// ---------------------------------------------------------------------------

// asigna a un humano el control de un jugador (liberando el anterior)
function asignarControl(h, p){
  asignarControlSeat(m.teams, h, p);
}
// jugador del equipo más cercano al balón que no lleve ya otro humano
function masCercanoLibre(team, h){
  let best=null, bd=1e9;
  for(const p of m.teams[team]){
    if(p.isGK) continue;
    if(p.ownerSeat != null && p.ownerSeat !== h.seatId) continue;
    const d=p.pos.distanceToSquared(m.bola.pos);
    if(d<bd){bd=d;best=p;}
  }
  return best;
}
// reparte el control inicial según la posición elegida por cada humano
function asignarPosicionesIniciales(){
  for(const h of m.S.humans){
    const arr=m.teams[h.team];
    const p = arr[h.slot] || arr[9] || arr[1];
    if(p){ p.ownerSeat = null; asignarControl(h, p); }
  }
}
function humanoDe(p){ return p && p.ownerSeat!=null ? m.S.humans.find(x=>x.seatId===p.ownerSeat) : null; }

// cambio de formación en caliente (tecla F)
function setFormation(ti, nombre){
  if(!FORMACIONES[nombre]) return;
  m.S.formation[ti]=nombre;
  const forma=FORMACIONES[nombre];
  m.teams[ti].forEach((p,i)=>{ const f=forma[i]; if(f){ p.formation=f; p.role=f.r; } });
  if(ti===0){ emitir(m, 'FORMACION', { nombre }); const t=document.getElementById('formTag'); if(t) t.textContent=nombre; }
}
function cycleFormation(){
  const i=NOMBRES_FORM.indexOf(m.S.formation[0]);
  setFormation(0, NOMBRES_FORM[(i+1)%NOMBRES_FORM.length]);
}

function goalDirZ(ti){ return ti===0? HALF_L : -HALF_L; } // z de la portería rival

// ---------------------------------------------------------------------------
//  ACTUALIZACIÓN DE BALÓN
// ---------------------------------------------------------------------------
function updateBall(dt){
  const b=m.bola, u=m.bola;
  if(u.kickLock>0) u.kickLock-=dt;
  u.vel.y -= 22*dt; // gravedad
  b.pos.addScaledVector(u.vel, dt);
  // rozamiento suelo
  if(b.pos.y<=u.r+0.001){
    b.pos.y=u.r;
    if(u.vel.y<0) u.vel.y = -u.vel.y*0.45; // rebote
    u.vel.x*=Math.pow(0.12,dt); u.vel.z*=Math.pow(0.12,dt); // fricción césped
    if(Math.abs(u.vel.y)<0.6) u.vel.y=0;
  } else {
    u.vel.x*=Math.pow(0.75,dt); u.vel.z*=Math.pow(0.75,dt); // arrastre aire
  }
  // detección de gol (antes que el fuera de juego de fondo)
  handleGoalCheck();
  // --- BALÓN FUERA: saque de banda / córner / saque de puerta ---
  if(m.S.phase==='play'){
    if(Math.abs(b.pos.x) > HALF_W){
      // fuera por la banda -> saque de banda del equipo contrario al último que tocó
      const eq = m.lastTouch===0?1:0;
      startSetPiece('banda', eq, Math.sign(b.pos.x)*HALF_W, b.pos.z);
    } else if(Math.abs(b.pos.z) > HALF_L){
      const fondo = Math.sign(b.pos.z);          // +1 = arco del visitante
      const defensor = fondo>0 ? 1 : 0;               // equipo que defiende ese fondo
      if(m.lastTouch===defensor){
        // la sacó el defensor -> CÓRNER para el atacante
        startSetPiece('corner', 1-defensor, Math.sign(b.pos.x||1)*(HALF_W-0.4), fondo*(HALF_L-0.4));
      } else {
        // la sacó el atacante -> SAQUE DE PUERTA del defensor
        startSetPiece('puerta', defensor, 0, fondo*(HALF_L-5.5));
      }
    }
  }
}

// La malla del balón sigue al estado. Es VISTA: rotación, sombra proyectada
// y opacidad según la altura. El núcleo no sabe que existe.
function syncBallView(dt, pose){
  const malla=G.ball; if(!malla) return;
  const b = pose || m.bola.pos;
  malla.position.set(b.x, b.y, b.z);
  malla.rotation.x += m.bola.vel.z*dt*0.9;
  malla.rotation.z -= m.bola.vel.x*dt*0.9;
  const blob=malla.userData.blob;
  blob.position.set(b.x, 0.02, b.z);
  const h=Math.max(0, b.y-m.bola.r);
  blob.scale.setScalar(1+h*0.25);
  blob.material.opacity=Math.max(0.05, 0.3-h*0.03);
}

function handleGoalCheck(){
  if(m.S.phase!=='play' || m.goalCooldown>0) return;
  const b=m.bola.pos;
  if(Math.abs(b.x)<GOAL_W/2 && b.y<GOAL_H){
    if(b.z> HALF_L-0.1){ scoreGoal(0); }       // gol de local en portería +z
    else if(b.z< -HALF_L+0.1){ scoreGoal(1); } // gol de visita en portería -z
  }
}

// ---------------------------------------------------------------------------
//  JUGADAS A BALÓN PARADO (banda / córner / saque de puerta / falta / penal)
// ---------------------------------------------------------------------------
function teamName(t){ return t===0?m.S.homeTeam.nombre:m.S.awayTeam.nombre; }

function startSetPiece(type, team, x, z){
  m.S.phase='setpiece'; m.S.phaseT=0;
  m.bola.vel.set(0,0,0); m.bola.kickLock=0;
  m.bola.pos.set(x, BALL_R, z);
  if(m.S._owner){ m.S._owner.hasBall=false; m.S._owner=null; }
  // ejecutor: el portero en saque de puerta y penal-atajador aparte; si no, el más cercano
  let taker;
  if(type==='puerta'){ taker = m.teams[team][0]; }
  else {
    taker=null; let bd=1e9;
    for(const p of m.teams[team]){ if(p.isGK) continue;
      const d=distXZ(p.pos, m.bola.pos); if(d<bd){bd=d;taker=p;} }
  }
  m.S.setPiece = { type, team, taker, x, z, taken:false };
  positionForSetPiece(type, team, x, z, taker);
  // si hay un humano en el equipo que saca, le damos el ejecutor
  if(taker){ const h=m.S.humans.find(x=>x.team===team); if(h) asignarControl(h,taker); }
  emitir(m, 'SAQUE', { etiqueta: SP_LABEL[type], team });
}

// coloca a los 22 jugadores de forma coherente con la jugada
function positionForSetPiece(type, team, x, z, taker){
  const rival = 1-team;
  for(let ti=0;ti<2;ti++) for(const p of m.teams[ti]){
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
      p.pos.set( (m.rng()-0.5)*24*meto - side*2,
                 0,
                 boxZ - Math.sign(z)*(4 + m.rng()*11) );
    } else if(type==='penal'){
      // todos fuera del área salvo ejecutor y portero
      const outZ = z + (z>0? -18 : 18);
      p.pos.set((m.rng()-0.5)*36, 0, outZ + (m.rng()-0.5)*10);
    } else {
      // banda / puerta / falta: formación normal, con el rival a distancia
      p.pos.copy(_v);
      if(ti===rival && distXZ(p.pos, m.bola.pos)<9){
        const away=_v2.copy(p.pos).sub(m.bola.pos); away.y=0;
        if(away.lengthSq()<0.01) away.set(1,0,0);
        away.setLength(9.5); p.pos.copy(m.bola.pos).add(away); p.pos.y=0;
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
  const sp=m.S.setPiece; if(!sp||sp.taken) return;
  const t=sp.taker; if(!t){ m.S.phase='play'; return; }
  sp.taken=true;
  const gz = goalDirZ(sp.team);
  if(sp.type==='corner'){
    // centro alto al punto de penal para rematar de cabeza
    const target=_v.set((m.rng()-0.5)*6, 0, gz - Math.sign(gz)*10);
    kickBall(t, target.sub(t.pos), 17, 7.5);
  } else if(sp.type==='puerta'){
    const target=_v.set((m.rng()-0.5)*30, 0, sp.z + Math.sign(gz)*45);
    kickBall(t, target.sub(t.pos), 25, 6.5);
  } else if(sp.type==='penal'){
    doShoot(t, 1.0);
  } else if(sp.type==='falta'){
    const dg=Math.abs(gz-t.pos.z);
    if(dg<30) doShoot(t, 0.95); else doPass(t);
  } else { // banda
    doPass(t);
  }
  m.S.phase='play'; m.S.phaseT=0; m.S.setPiece=null;
}

// ---------------------------------------------------------------------------
//  FALTAS, TARJETAS Y PENALES
// ---------------------------------------------------------------------------
function inPenaltyBox(pos, defTeam){
  const gz = defTeam===0? -HALF_L : HALF_L;
  return Math.abs(pos.x) < 20.15 && Math.abs(pos.z-gz) < 16.5;
}
function commitFoul(offender, victim){
  const eq = victim.team;                    // equipo beneficiado
  const defTeam = offender.team;
  const penal = inPenaltyBox(victim.pos, defTeam);
  // severidad -> tarjeta
  const sev = m.rng();
  let card='';
  if(sev>0.90){ card='roja'; m.cards[offender.team].r++; sendOff(offender); }
  else if(sev>0.62){ card='amarilla'; m.cards[offender.team].a++;
    offender.yellow=(offender.yellow||0)+1;
    if(offender.yellow>=2){ card='roja (doble amarilla)'; m.cards[offender.team].r++; sendOff(offender); }
  }
  offender.stunTimer = 0.9;      // el que barrió queda en el suelo
  victim.stunTimer  = 1.3;       // y el derribado, más tiempo

  // NO se cobra al instante. Antes la falta se resolvía en el mismo fotograma:
  // saltaba el cartel y todos aparecían ya colocados sin que se viera qué pasó.
  // Ahora se entra en una fase corta donde la jugada sigue a la vista —el que
  // barrió en el suelo, el derribado cayendo— y recién después suena el silbato.
  const gz = defTeam===0? -HALF_L : HALF_L;
  if(m.S._owner){ m.S._owner.hasBall=false; m.S._owner=null; }   // el balón queda suelto
  m.S.faltaPendiente = penal
    ? { tipo:'penal', eq, x:0, z: gz + (defTeam===0? 11 : -11), card }
    : { tipo:'falta', eq, x: victim.pos.x, z: victim.pos.z, card };
  m.S.phase='falta'; m.S.phaseT=0;
}
function sendOff(p){
  p.expelled=true; p.mesh.visible=false;
  const arr=m.teams[p.team]; const i=arr.indexOf(p); if(i>=0) arr.splice(i,1);
  if(p.ownerSeat!=null){ const h=m.S.humans.find(x=>x.seatId===p.ownerSeat); p.ownerSeat=null;
    if(h) h.playerId=null;
    asignarControl(h, masCercanoLibre(h.team, h)); }
}
function showCard(card){
  if(!card){ emitir(m, 'FALTA'); return; }
  emitir(m, 'TARJETA', { card });
}

// Pintar la tarjeta es cosa de la vista; el temporizador de 2,2 s es de reloj
// de pared a propósito: es una animación de interfaz, no del partido.
function mostrarTarjeta(card){
  const el=document.getElementById('cardFx');
  el.className = card.startsWith('roja') ? 'show roja' : 'show amarilla';
  clearTimeout(mostrarTarjeta._t);
  mostrarTarjeta._t = setTimeout(()=>el.className='', 2200);
}
function updateCardsUI(){
  document.getElementById('cardsH').textContent = `🟨${m.cards[0].a} 🟥${m.cards[0].r}`;
  document.getElementById('cardsA').textContent = `🟨${m.cards[1].a} 🟥${m.cards[1].r}`;
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
  for(let ti=0;ti<2;ti++)for(const p of m.teams[ti]){
    const d=distXZ(p.pos, m.bola.pos);
    if(d<od){od=d; owner=p;}
  }
  const b=m.bola;
  // El radio de captura debe ser MAYOR que el toque de conducción; si no, el balón
  // se sale del radio, se pierde la posesión y sale disparado como una patada.
  if(owner && od<CAPTURA && m.bola.pos.y<1.4 && owner.stunTimer<=0 && b.kickLock<=0){
    m.S.possession = owner.team;
    m.lastTouch = owner.team;
    // REGATE: el toque se alarga con la velocidad. Al trotar el balón va pegado al pie;
    // al esprintar se escapa hacia adelante y cuesta más controlarlo.
    const dir = new Vec3(Math.sin(owner.facing),0,Math.cos(owner.facing));
    const sp = owner.vel.length();
    // toque SIEMPRE dentro del radio de captura (ver TOQUE_MAX)
    const toque = Math.min(0.50 + sp*0.055 + (owner.sprinting?0.18:0), TOQUE_MAX);
    const target = _v.copy(owner.pos).addScaledVector(dir, toque); target.y=BALL_R;
    // a más velocidad, menos adherencia (control más suelto)
    const adher = (esHumano(owner)?12:8) * (owner.sprinting?0.6:1.0);
    const relV = b.vel.length();
    if(relV<22){
      m.bola.pos.lerp(target, Math.min(1, dt*adher));
      m.bola.pos.y = Math.max(m.bola.pos.y, BALL_R);
      // el balón ACOMPAÑA al jugador; nada de fuerzas de muelle acumuladas
      b.vel.set(owner.vel.x, Math.min(b.vel.y,0), owner.vel.z);
    }
    owner.hasBall=true;
    // guardar el poseedor
    m.S._owner = owner; m.estad.ticksConDueno++;
    // Si mi equipo recupera el balón, paso a manejar YO a quien lo tiene: si no,
    // seguías controlando a un jugador lejano mientras la jugada iba por otro lado.
    if(owner.ownerSeat==null && !owner.isGK){
      const h = m.S.humans.find(x => x.team === owner.team);
      if(h && h.playerId !== owner.playerId){
        asignarControl(h, owner);
      }
    }
    // ¿el receptor estaba en posición adelantada?
    if(m.offsidePend){
      if(owner===m.offsidePend){ callOffside(owner); return; }
      m.offsidePend=null;              // la tocó otro: se anula la sanción
    }
  } else {
    if(m.S._owner) m.S._owner.hasBall=false;
    m.S._owner=null;
  }
}

function kickBall(from, dirVec, power, lift){
  const u=m.bola;
  const d=_v.copy(dirVec); d.y=0; if(d.lengthSq()<1e-4) d.set(Math.sin(from.facing),0,Math.cos(from.facing));
  d.normalize();
  u.vel.set(d.x*power, lift, d.z*power);
  m.bola.pos.y=Math.max(m.bola.pos.y,0.36);
  m.lastTouch = from.team;
  u.kickLock = 0.3;              // evita que el mismo pie re-capture el balón
  if(m.S._owner){ m.S._owner.hasBall=false; m.S._owner=null; }
  // el saque de centro se considera ejecutado en cuanto se toca el balón
  if(m.S.phase==='kickoff'){ m.S.kickoffTaken=true; m.S.phase='play'; m.S.phaseT=0; }
  emitir(m, 'PATADA', { playerId: from.playerId });
}

// pase al compañero mejor ubicado hacia el ataque
function doPass(p){
  const mates = m.teams[p.team].filter(m=>m!==p && !m.isGK);
  const attackZ = goalDirZ(p.team);
  let best=null, bs=-1e9;
  const dirToGoal = Math.sign(attackZ - p.pos.z);
  for(const mate of mates){
    const d=distXZ(p.pos,mate.pos); if(d<3||d>42) continue;
    const forward = (mate.pos.z-p.pos.z)*dirToGoal; // premia avanzar
    const openness = -nearestOpponentDist(mate); // menos rival cerca mejor (negativo)
    const score = forward*1.6 - d*0.15 - openness*0.0; // ponderación simple
    let s = forward*1.5 - d*0.12 + nearestOpponentDist(mate)*0.8;
    if(s>bs){bs=s;best=mate;}
  }
  if(!best) best = mates.sort((a,b)=>distXZ(p.pos,a.pos)-distXZ(p.pos,b.pos))[0];
  if(!best) return;
  m.offsidePend = isOffside(best, p) ? best : null;   // se sanciona al recibir
  const dir=_v2.copy(best.pos).sub(p.pos); const dist=dir.length();
  const power=Math.min(6+dist*0.7, 30);
  kickBall(p, dir, power, Math.min(dist*0.12,3));
  // si el pasador lo lleva un humano, ese humano pasa a controlar al receptor
  const hp = humanoDe(p);
  if(hp){ asignarControl(hp, best); m.passReceiver=best; }
}
// --- FUERA DE JUEGO ---
// Se evalúa en el instante del pase: el receptor está adelantado si supera al
// penúltimo defensor rival, está en campo contrario y por delante del balón.
function isOffside(receptor, pasador){
  const ti = receptor.team, dir = ti===0? 1 : -1;
  const rz = receptor.pos.z*dir;
  if(rz <= 0) return false;                              // en su propio campo, nunca
  if(rz <= m.bola.pos.z*dir) return false;            // no está por delante del balón
  const zs = m.teams[1-ti].map(o=>o.pos.z*dir).sort((a,b)=>b-a);
  const penultimo = zs.length>1 ? zs[1] : -1e9;          // portero + último defensa
  return rz > penultimo + 0.5;
}
function callOffside(receptor){
  m.offsidePend = null;
  emitir(m, 'FUERA_DE_JUEGO', { contra: 1-receptor.team });
  startSetPiece('falta', 1-receptor.team, receptor.pos.x, receptor.pos.z);
}

function nearestOpponentDist(p){
  const opp = m.teams[1-p.team]; let d=1e9;
  for(const o of opp){ const dd=distXZ(p.pos,o.pos); if(dd<d)d=dd; }
  return d;
}

function doShoot(p, power){
  m.estad.tiros++;
  const gz = goalDirZ(p.team);
  const aimX = (m.rng()-0.5)*GOAL_W*0.98;   // dispersión: aún pueden errar, pero menos
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
  const diff = DIFF[m.S.difficulty];
  for(let ti=0;ti<2;ti++){
    // Se calcula UNA vez por equipo y tick: quién presiona y quién apoya.
    const orden = ordenPorCercania(ti);
    // Si el balón ya es NUESTRO, nadie del equipo va a por él: se acompaña la
    // jugada. Antes los compañeros corrían a quitársela a su propio jugador.
    const nuestra  = m.S._owner && m.S._owner.team === ti;
    const presiona = nuestra ? null : (orden[0] || null);   // va al balón
    const apoya    = nuestra ? null : (orden[1] || null);   // cubre y corta el pase
    const acompana = nuestra ? (orden[0] || null) : null;   // se ofrece para el pase
    // Sólo se marca cuando de verdad se defiende: con el balón en nuestro
    // campo. En la mitad de arriba el bloque zonal basta y deja jugar.
    const defendiendo = !nuestra && Math.abs(m.bola.pos.z - (ti===0 ? -HALF_L : HALF_L)) < 42;
    const marcas = defendiendo ? asignarMarcas(ti, presiona, apoya) : null;

    for(const p of m.teams[ti]){
      if(p.ownerSeat!=null){ continue; }   // lo mueve una persona, no la IA
      if(p.stunTimer>0){ p.vel.multiplyScalar(0.8); continue; }
      if(p.isGK){ goalkeeper(p, dt); continue; }

      const targetsBall = (p === presiona);

      // cabezazo en balones altos (centros y córners)
      if(canHead(p) && m.rng()<0.30*60*DT){
        header(p, Math.abs(goalDirZ(p.team)-p.pos.z) < 30);
        continue;
      }
      // entrada/barrida sobre el rival con balón
      if(targetsBall && m.S._owner && m.S._owner.team!==p.team && p.slideCd<=0
         && distXZ(p.pos, m.S._owner.pos)<2.3 && m.rng()<0.02*diff.react*60*DT){
        slideTackle(p);
        continue;
      }

      if(m.S._owner===p){
        aiWithBall(p, diff, dt);
        continue;
      }

      // perseguir desgasta; posicionarse recupera
      if(targetsBall) p.stamina = Math.max(0, p.stamina - dt*0.09);
      else            p.stamina = Math.min(1, p.stamina + dt*0.06);

      const desired = _v.set(0,0,0);
      let maxSpd;
      if(targetsBall){
        desired.copy(m.bola.pos).sub(p.pos);
        maxSpd = baseSpeed(p) * diff.ai;
      } else if(p === apoya){
        // apoyo: se coloca entre el balón y su propia portería, a unos metros
        const dir = ti===0 ? 1 : -1;
        _v2.copy(m.bola.pos); _v2.z -= dir*6; _v2.y = 0;
        clampToField(_v2);
        desired.copy(_v2).sub(p.pos);
        maxSpd = baseSpeed(p) * diff.ai * 0.95;
      } else if(p === acompana){
        // acompañar: se ofrece por delante y abierto, sin pisarle el balón
        const dir = ti===0 ? 1 : -1;
        const lado = p.pos.x >= (m.S._owner ? m.S._owner.pos.x : 0) ? 1 : -1;
        _v2.set(m.bola.pos.x + lado*9, 0, m.bola.pos.z + dir*7);
        clampToField(_v2);
        desired.copy(_v2).sub(p.pos);
        maxSpd = baseSpeed(p) * 0.92;
      } else if(marcas && marcas.has(p.playerId)){
        // marcaje individual: pegado a su rival, del lado de su propia portería
        posicionDeMarca(p, marcas.get(p.playerId), _v2);
        desired.copy(_v2).sub(p.pos);
        maxSpd = baseSpeed(p) * diff.ai * 0.94;
      } else {
        posicionDeBloque(p, _v2);
        desired.copy(_v2).sub(p.pos);
        // si está lejos de su sitio, va más rápido: así el bloque no se descuelga
        maxSpd = baseSpeed(p) * (desired.length() > 12 ? 0.98 : 0.82);
      }
      steer(p, desired, maxSpd, dt);
    }
  }
}

// En el saque de centro, el equipo que NO saca debe esperar fuera del círculo
// hasta que el balón se ponga en juego.
function enforceKickoffRule(){
  if(m.S.phase!=='kickoff' || m.S.kickoffTaken) return;
  const R = CIRCULO + 0.5;
  for(const p of m.teams[1-m.S.kickTeam]){
    const d = Math.hypot(p.pos.x, p.pos.z);
    if(d < R){
      const k = R/Math.max(d, 0.001);
      p.pos.x*=k; p.pos.z*=k; p.vel.set(0,0,0);
    }
  }
}

// Jugadores de campo de un equipo ordenados por cercanía al balón.
// Los que lleva una persona no cuentan para los roles de presión: la IA
// no debe quedarse quieta esperando a que el humano haga todo.
function ordenPorCercania(ti){
  const arr = m.teams[ti].filter(j => !j.isGK && j.ownerSeat==null && j.stunTimer<=0);
  arr.sort((a,b) => distXZ(a.pos,m.bola.pos) - distXZ(b.pos,m.bola.pos));
  return arr;
}

// MARCAJE INDIVIDUAL.
// Antes sólo había presión por cercanía y bloque zonal: los rivales SIN balón
// quedaban sueltos y bastaba un pase para dejar a todo el equipo atrás. Ahora,
// defendiendo en campo propio, dos defensas se reparten a los dos rivales más
// adelantados y se colocan entre ellos y su propia portería.
// El reparto se hace UNA vez por equipo y tick, y sólo mira posiciones: es
// determinista, así que el golden master sigue valiendo como oráculo.
function asignarMarcas(ti, presiona, apoya){
  const dir = ti===0 ? 1 : -1;                 // hacia dónde ataca ESTE equipo
  const propiaZ = -dir * HALF_L;               // nuestra propia portería
  const marcas = new Map();
  // Sólo es peligro quien ya está metido en nuestro campo.
  const rivales = m.teams[1-ti]
    .filter(o => !o.isGK && !o.expelled && Math.abs(o.pos.z - propiaZ) < 46)
    .sort((a,b) => (a.pos.z*dir) - (b.pos.z*dir));
  // Marcan los defensas. Si los medios marcan también, el equipo se descuelga
  // entero detrás de rivales y el partido se muere (medido abajo).
  // El que presiona y el que apoya ya tienen tarea: no se les asigna marca.
  const mios = m.teams[ti].filter(p =>
    !p.isGK && !p.expelled && p.ownerSeat==null && p!==presiona && p!==apoya
    && p.role==='DEF');

  // BALANCE MEDIDO (12 semillas x 200 s de IA vs IA, más una sonda que mira
  // cuánto cubren a los dos rivales más adelantados):
  //             goles  tiros  % punta suelto (>10 m)  dist. media  % por delante
  //   sin marca  2.42  10.33         15.2 %              4.91 m       53.9 %
  //   3 marcas   1.50   9.50          —                    —            —
  //   2 a 4.6 m  2.33   9.92         25.2 %              5.86 m       49.0 %
  //   2 a 2.8 m  2.00   9.83         10.7 %              3.87 m       58.7 %  <-
  // Marcar a tres deja al equipo entero corriendo detrás de rivales y el
  // partido acaba 0-0. Y marcar de lejos (4.6 m) es PEOR que no marcar: saca a
  // los defensas del bloque sin llegar a tapar a nadie.
  const tomados = new Set();
  for(const r of rivales){
    let mejor=null, bd=Infinity;
    for(const p of mios){
      if(tomados.has(p.playerId)) continue;
      const d = distXZ(p.pos, r.pos);
      if(d < bd){ bd = d; mejor = p; }
    }
    if(mejor && bd < 26){ marcas.set(mejor.playerId, r); tomados.add(mejor.playerId); }
    if(marcas.size >= 2) break;              // sólo dos marcadores: ver nota de balance
  }
  return marcas.size ? marcas : null;
}

// Dónde se pone un marcador: entre su rival y su propia portería, y algo
// hacia el lado del balón para poder cortar el pase.
function posicionDeMarca(p, rival, out){
  const dir = p.team===0 ? 1 : -1;
  out.set(rival.pos.x, 0, rival.pos.z);
  out.z -= dir * 2.8;                          // casi tres metros, del lado del arco
  out.x += (m.bola.pos.x - rival.pos.x) * 0.22;
  clampToField(out);
  return out;
}

// Posición objetivo de un jugador SIN balón.
// Antes todos se quedaban clavados en su hueco de formación con un
// desplazamiento del 18% hacia el balón: por eso parecía que miraban pasar
// la jugada. Ahora el bloque entero se mueve con el balón, sube al atacar y
// se repliega al defender, y los delanteros pisan el área.
function posicionDeBloque(p, out){
  const ti = p.team, dir = ti===0 ? 1 : -1;   // hacia dónde ataca
  homePos(ti, p.formation, out);
  const atacamos = m.S.possession === ti;

  // desplazamiento lateral: el equipo bascula hacia el lado del balón
  out.x = out.x*0.55 + m.bola.pos.x*0.45;
  // compacidad: cada uno cierra un 32% de su distancia al balón en profundidad
  out.z += (m.bola.pos.z - out.z) * 0.32;
  // subir en ataque, replegar en defensa
  out.z += dir * (atacamos ? 9 : -5);

  if(p.role === 'DEL' && atacamos) out.z += dir * 7;   // desmarque al área
  if(p.role === 'DEF'){                                 // la línea no se descuelga
    const propio = -dir * HALF_L;
    out.z = dir > 0 ? Math.max(out.z, propio + 8) : Math.min(out.z, propio - 8);
  }
  clampToField(out);
  return out;
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
  if(distGoal<26 && Math.abs(p.pos.x)<22 && m.rng()<(0.010+diff.react*0.014)*60*DT){
    doShoot(p, 0.6+m.rng()*0.4); return;
  }
  if(pressure<2.6 && m.rng()<0.015*60*DT){
    doPass(p); return;
  }
  // conducir hacia portería con leve zigzag evitando al rival
  const dir=_v.set((m.rng()-0.5)*0.2, 0, Math.sign(gz-p.pos.z));
  // sesgar hacia el centro del arco
  dir.x += (-p.pos.x*0.02);
  steer(p, dir, baseSpeed(p)*0.92*diff.ai, dt);   // dt real: antes iba fijo a 1/60
}

function goalkeeper(p, dt){
  const gz = p.team===0? -HALF_L : HALF_L; // su propia portería
  // posición predicha del balón (anticipación de la atajada)
  const bp = _v2.copy(m.bola.pos).addScaledVector(m.bola.vel, 0.22);
  const targetX = Math.max(-GOAL_W/2-1.2, Math.min(GOAL_W/2+1.2, bp.x*0.9));
  const line = gz + (p.team===0? 2.2 : -2.2);
  _v.set(targetX,0,line).sub(p.pos);
  // si el balón se acerca a su zona, sale a achicar hacia el punto predicho
  if(distXZ(p.pos,m.bola.pos)<15 && Math.abs(m.bola.pos.z-gz)<22){
    _v.copy(bp).sub(p.pos); _v.y=0;
  }
  // mientras retiene el balón se queda quieto con él en las manos
  if(p.holdTimer > 0){
    p.holdTimer -= dt;
    p.vel.multiplyScalar(0.6);
    m.bola.pos.set(p.pos.x, 0.9, p.pos.z + (p.team===0 ? 0.5 : -0.5));
    m.bola.vel.set(0,0,0);
    m.bola.kickLock = 0.1;
    if(p.holdTimer <= 0) distribuirPortero(p);
    return;
  }
  steer(p, _v, 7.2, dt);
  // atajada: la retiene un momento en vez de reventarla de primera
  if(distXZ(p.pos,m.bola.pos)<1.9 && m.bola.pos.y<2.4 && m.bola.kickLock<=0){
    m.estad.despejesPortero++;
    p.holdTimer = 0.9;          // un segundo largo con la pelota controlada
    m.S._owner = null;
    // la vista dibuja la palomita hacia el lado del que venía el balón
    emitir(m, 'ATAJADA', { playerId: p.playerId, lado: Math.sign(m.bola.pos.x - p.pos.x) || 1 });
  }
}

// Saque del portero: busca a un compañero desmarcado y se la juega corta;
// sólo revienta el balón si no encuentra a nadie. Antes SIEMPRE despejaba.
function distribuirPortero(p){
  const dir = p.team===0 ? 1 : -1;
  let mejor=null, mejorPuntos=-1e9;
  for(const comp of m.teams[p.team]){
    if(comp===p || comp.isGK || comp.expelled) continue;
    const d = distXZ(p.pos, comp.pos);
    if(d < 8 || d > 42) continue;                  // ni encima ni imposible
    const libre = nearestOpponentDist(comp);
    if(libre < 6) continue;                        // marcado: no se la damos
    const avance = (comp.pos.z - p.pos.z) * dir;
    const puntos = libre*1.4 + avance*0.5 - d*0.10;
    if(puntos > mejorPuntos){ mejorPuntos=puntos; mejor=comp; }
  }
  if(mejor){
    const v = _v2.copy(mejor.pos).sub(p.pos);
    const dist = v.length();
    kickBall(p, v, Math.min(9 + dist*0.62, 26), Math.min(dist*0.10, 2.4));
  } else {
    const out=_v2.set((m.rng()-0.5)*26, 0, dir*30);  // sin opción: despeje largo
    kickBall(p, out, 27, 5);
  }
}

// ---------------------------------------------------------------------------
//  CONTROL DEL JUGADOR HUMANO
// ---------------------------------------------------------------------------
function updateHumans(dt){
  for(const h of m.S.humans) updateHuman(dt, h);
}
function updateHuman(dt, h){
  const p=jugadorDeAsiento(m.teams, h); if(!p || p.expelled) return;
  const input = h.input;

  // EN EL SUELO NO SE MANEJA. Sin esto, seguir apretando una dirección mientras
  // el jugador estaba derribado lo hacía "correr acostado" por el campo.
  // La IA ya tenía esta guarda; el camino del humano no.
  if(p.stunTimer > 0){
    p.vel.multiplyScalar(0.80);   // derribado: se queda donde cayó
    p.sprinting = false;
    h.buffer = null;              // no se guardan acciones pedidas desde el suelo
    return;
  }
  if(p.sliding > 0){
    // La barrida ya lanzó al jugador: conserva su inercia y NO se puede dirigir
    // a mitad de deslizamiento, igual que en el fútbol de verdad.
    p.vel.multiplyScalar(0.94);
    p.pos.addScaledVector(p.vel, dt);
    clampToField(p.pos);
    p.sprinting = false;
    return;
  }
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

  // ¿Lleva el balón? S._owner se calcula DESPUÉS de mover a los humanos, así que
  // va un tick atrasado: con la comprobación estricta, pulsar tiro justo al ganar
  // la pelota hacía una barrida en vez de disparar. Se admite también "el balón
  // está a mi alcance y a ras de suelo".
  const cerca = distXZ(p.pos, m.bola.pos) < CAPTURA*1.25 && m.bola.pos.y < 1.5;
  const hasBall = m.S._owner===p || (cerca && (!m.S._owner || m.S._owner===p));

  if(input.switch && !hasBall){ // cambiar de jugador
    asignarControl(h, masCercanoLibre(h.team, h));
  }
  if(input.pass){
    if(hasBall) doPass(p);
    else if(canHead(p)) header(p, false);          // cabezazo de despeje/pase
    else if(cerca) h.buffer = { accion:'pase', t:0.30 };   // aún no es mío: lo dejo pedido
    else asignarControl(h, masCercanoLibre(h.team, h));
  }
  if(input.shoot){
    if(hasBall) doShoot(p, 0.8);
    else if(canHead(p)) header(p, true);           // cabezazo a puerta
    else if(cerca) h.buffer = { accion:'tiro', t:0.30 };
    else slideTackle(p);                            // barrida
  }

  // Búfer de entrada: si pediste tiro o pase un instante antes de tener el
  // balón, la acción se ejecuta en cuanto lo tengas. Es lo que hace que el
  // control se sienta receptivo en vez de "a veces no responde".
  if(h.buffer){
    h.buffer.t -= dt;
    if(m.S._owner===p){
      if(h.buffer.accion==='tiro') doShoot(p, 0.8); else doPass(p);
      h.buffer = null;
    } else if(h.buffer.t <= 0) h.buffer = null;
  }
}

// --- CABEZAZO: sólo si el balón viene alto y cerca ---
function canHead(p){
  const b=m.bola.pos;
  return b.y>1.1 && b.y<3.6 && distXZ(p.pos,b)<2.5 && p.stunTimer<=0;
}
function header(p, aPuerta){
  m.estad.cabezazos++;
  const gz=goalDirZ(p.team);
  let dir;
  if(aPuerta){
    dir=_v.set((m.rng()-0.5)*GOAL_W*0.8, 0, gz).sub(p.pos);
    kickBall(p, dir, 19, 1.0);
  } else {
    dir=_v.set((m.rng()-0.5)*16, 0, gz).sub(p.pos);
    kickBall(p, dir, 14, 3.0);
  }
  p.heading=0.35;   // animación
  m.lastTouch=p.team;
}

// --- BARRIDA: limpia si llega al balón, falta si arrolla al rival ---
function slideTackle(p){
  if(p.slideCd>0 || p.stunTimer>0) return;
  p.slideCd=1.3; p.sliding=0.55;
  const dir=new Vec3(Math.sin(p.facing),0,Math.cos(p.facing));
  p.vel.copy(dir).multiplyScalar(baseSpeed(p)*1.55);
  const db=distXZ(p.pos, m.bola.pos);
  const victim = (m.S._owner && m.S._owner.team!==p.team) ? m.S._owner : null;
  const dv = victim? distXZ(p.pos, victim.pos) : 99;
  if(db<2.7 && db<=dv+0.35){
    // llega primero al balón: entrada legal
    m.bola.vel.set(dir.x*11, 1.3, dir.z*11);
    m.bola.kickLock=0.28; m.lastTouch=p.team;
    if(m.S._owner){ m.S._owner.hasBall=false; m.S._owner=null; }
    m.S.possession=p.team; emitir(m, 'PATADA', { playerId: p.playerId });
  } else if(victim && dv<2.5){
    commitFoul(p, victim);   // se lleva al rival por delante -> falta
  }
}

// ---------------------------------------------------------------------------
//  REPETICIÓN DE GOL (buffer circular + cámara lenta)
// ---------------------------------------------------------------------------
// La repetición vive ahora en render/replayView.js: guarda instantáneas y las
// dibuja aparte. La simulación NO sabe que existe.
const replayView = crearReplayView({ segundos: REPLAY_SEC, hz: REPLAY_HZ, velocidad: REPLAY_SPEED });
let posesRepeticion = null;      // poses a dibujar mientras dura la repetición

// cámara cinematográfica de repetición: baja, detrás del arco, en travelling
function replayCamera(dt){
  const gz = (m.lastScorer===0? HALF_L : -HALF_L);
  const s = Math.sign(gz);
  const t = replayView.avance * REPLAY_SEC;
  const ang = -0.5 + t*0.30;
  G.camera.position.lerp(_vc.set(Math.sin(ang)*22, 4.5+t*0.8, gz + s*(14 - t*1.2)), Math.min(1,dt*3));
  if(Math.abs(G.camera.fov-34)>0.02){ G.camera.fov=34; G.camera.updateProjectionMatrix(); }
  const b = posesRepeticion ? posesRepeticion.bola : m.bola.pos;
  G.camera.lookAt(b.x*0.7, 1.3, b.z*0.95);
}

// ---------------------------------------------------------------------------
//  CÁMARA de transmisión
// ---------------------------------------------------------------------------
const camTarget = new THREE.Vector3();
const _vc = new THREE.Vector3(), _vc2 = new THREE.Vector3();   // scratch propio del render
// En 16:9, encuadrar TODO el ancho del campo (68 m, escorzado) obliga a mostrar
// ~70 m de largo. Con menos, la pantalla se llena sólo de césped.
const VIEW_LEN = 70;
G.curView = VIEW_LEN;   // encuadre inicial (antes era el valor del let)
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
function updateCamera(dt){
  G.camCalls++;
  if(posesRepeticion){ replayCamera(dt); return; }       // cámara cinematográfica
  camTarget.lerp(m.bola.pos, Math.min(1,dt*2.6));
  // encuadre más cerrado en saques y jugadas paradas (dramatismo)
  const objetivo = (m.S.phase==='kickoff'||m.S.phase==='setpiece') ? 50 : VIEW_LEN;
  if(m.S.camSnap) G.curView = objetivo;
  else G.curView += (objetivo-G.curView)*Math.min(1,dt*2.6);
  const hFov = 2*Math.atan((G.curView/2)/CAM_DIST);
  const vFovDeg = 2*Math.atan(Math.tan(hFov/2)/G.camera.aspect) * 180/Math.PI;
  const fovDeg = Math.max(24, Math.min(72, vFovDeg));
  G.camLast = fovDeg;
  if(Math.abs(G.camera.fov-fovDeg)>0.02){ G.camera.fov=fovDeg; G.camera.updateProjectionMatrix(); }
  // CÁMARA LATERAL: en la banda (-X), sigue el juego a lo largo del campo (Z).
  // Así las porterías quedan a izquierda y derecha, y el local ataca hacia la derecha.
  const desired = _vc.set(
    -CAM_DIST + camTarget.x*0.10,
    CAM_H + Math.abs(camTarget.x)*0.04,
    camTarget.z*0.86
  );
  if(m.S.camSnap){ G.camera.position.copy(desired); m.S.camSnap=false; }   // colocación instantánea
  else G.camera.position.lerp(desired, Math.min(1,dt*2.3));
  // Apunta al MEDIO ANGULAR del ancho del campo (no al centro geométrico): así la
  // banda visible queda centrada en el terreno y no se pierde la línea cercana.
  _vc2.set(AIM_X + camTarget.x*0.30, 1.0, camTarget.z*0.92);
  G.camera.lookAt(_vc2);
}

// ---------------------------------------------------------------------------
//  GOLES, RELOJ Y FASES
// ---------------------------------------------------------------------------
function scoreGoal(team){
  m.estad.goles++;
  m.S.score[team]++; m.lastScorer=team;
  m.goalCooldown=3.2;
  m.S.phase='goal'; m.S.phaseT=0;
  emitir(m, 'GOL', { team, scorerIdx: 7 + (m.rng()*3|0) });
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
  document.getElementById('hscore').textContent=m.S.score[0];
  document.getElementById('ascore').textContent=m.S.score[1];
}
function updateClock(){
  const total=m.S.halfLen;
  const shown = Math.floor((m.S.half===1?0:45) + (m.S.clock/total)*45);
  const mm=String(Math.min(90,shown)).padStart(2,'0');
  document.getElementById('clock').textContent = `${mm}'`;
  document.getElementById('half').textContent = m.S.half===1?'1er TIEMPO':'2do TIEMPO';
}

// una barra de energía por jugador humano
function buildStaminaUI(){
  const w=document.getElementById('stamwrap');
  w.innerHTML='';
  m.S.humans.forEach((h,i)=>{
    const row=document.createElement('div'); row.className='stamrow';
    row.innerHTML=`<div class="lbl"><b style="color:${h.color}">${h.nombre}</b>
      · ${h.team===0?m.S.homeTeam.nombre:m.S.awayTeam.nombre}
      ${i===0?'· <b id="formTag" style="color:var(--acento)">'+m.S.formation[0]+'</b>':''}</div>
      <div class="bar2"><i></i></div>`;
    w.appendChild(row);
    h._bar = row.querySelector('.bar2');
  });
}
function updateStaminaUI(){
  for(const h of m.S.humans){
    const p=jugadorDeAsiento(m.teams, h); if(!p||!h._bar) continue;
    const pct=Math.round(p.stamina*100);
    h._bar.firstElementChild.style.width = pct+'%';
    h._bar.className = 'bar2 ' + (pct<25?'low' : pct<55?'mid' : '');
  }
}

// ¿este equipo lo lleva alguna persona? (antes se asumía que el humano era siempre
// el equipo 0, lo que rompía los saques del Jugador 2 al jugar en el equipo visitante)
function equipoTieneHumano(t){ return m.S.humans.some(h => h.team===t); }

function updatePhase(dt){
  m.S.phaseT+=dt;
  if(m.S.phase==='kickoff'){
    // si saca la IA, pone el balón en juego sola
    if(!equipoTieneHumano(m.S.kickTeam) && m.S.phaseT>1.1 && !m.S.kickoffTaken){
      const t=m.teams[m.S.kickTeam].find(p=>!p.isGK && distXZ(p.pos,m.bola.pos)<3.5);
      if(t) doPass(t); else { m.S.kickoffTaken=true; m.S.phase='play'; m.S.phaseT=0; }
    }
    // si saca una persona, el juego espera a su primer pase (con tope de seguridad)
    if(equipoTieneHumano(m.S.kickTeam) && m.S.phaseT>20){ m.S.kickoffTaken=true; m.S.phase='play'; m.S.phaseT=0; }
  } else if(m.S.phase==='setpiece'){
    const sp=m.S.setPiece;
    // el humano dispone de unos segundos para ejecutar; la IA saca sola
    const auto = (sp && equipoTieneHumano(sp.team)) ? 4.5 : 1.3;
    if(m.S.phaseT>auto) takeSetPiece();
  } else if(m.S.phase==='falta'){
    if(m.S.phaseT > 1.3){                       // se deja ver la infracción
      const f = m.S.faltaPendiente; m.S.faltaPendiente = null;
      if(f){ showCard(f.card); startSetPiece(f.tipo, f.eq, f.x, f.z); }
      else { m.S.phase='play'; m.S.phaseT=0; }
    }
  } else if(m.S.phase==='full'){
    if(m.S.phaseT > 5) cerrarPartido();      // 5 s medidos en ticks, no en reloj de pared
  } else if(m.S.phase==='goal'){
    // La simulación sólo ESPERA. Qué se muestra durante esa espera (celebración,
    // repetición) es cosa de la vista: el partido ya no depende de una animación.
    if(m.S.phaseT > GOL_ESPERA){
      placeKickoff( m.lastScorer!=null ? 1-m.lastScorer : (m.S.score[0]>m.S.score[1]?1:0) );
      m.S.phase='kickoff'; m.S.phaseT=0;
    }
  } else if(m.S.phase==='play'){
    m.S.clock+=dt;
    if(m.S.clock>=m.S.halfLen){
      if(m.S.half===1){ m.S.half=2; m.S.clock=0; emitir(m, 'DESCANSO'); placeKickoff(1); m.S.phase='kickoff'; m.S.phaseT=0; }
      else { endMatch(); }
    }
  }
}

function endMatch(){
  // El partido NO se detiene aquí: pasa a fase 'full' y sigue contando phaseT.
  // Antes esperaba 5000 ms con setTimeout, que es RELOJ DE PARED: si el
  // navegador pasa a segundo plano, requestAnimationFrame se frena pero
  // setTimeout no, así que la pantalla final llegaba desincronizada. Y un
  // servidor no puede depender del reloj de pared para el flujo del partido.
  m.S.phase='full'; m.S.phaseT=0;
  const r = m.S.score[0]===m.S.score[1]?'EMPATE': (m.S.score[0]>m.S.score[1]? `Gana ${m.S.homeTeam.nombre}`:`Gana ${m.S.awayTeam.nombre}`);
  emitir(m, 'FINAL', { texto: `${m.S.homeTeam.nombre} ${m.S.score[0]} — ${m.S.score[1]} ${m.S.awayTeam.nombre} · ${r}` });
}

// Se ejecuta cuando la fase 'full' cumple su tiempo, medido en ticks.
function cerrarPartido(){
  m.S.running=false;
  {
    document.getElementById('hud').style.display='none';
    if(LIGA.activa){
      // se registra el partido jugado y se simula el resto de la jornada
      const par=partidoUsuario();
      LIGA.ultimos=[];
      if(par){
        const local = par[0]===m.S.homeTeam.id;
        if(local) registrar(m.S.homeTeam.id, m.S.awayTeam.id, m.S.score[0], m.S.score[1]);
        else      registrar(m.S.awayTeam.id, m.S.homeTeam.id, m.S.score[1], m.S.score[0]);
        simularJornada(par);
      }
      LIGA.jornada++;
      m.S.phase='menu';
      mostrarTorneo();
    } else {
      document.getElementById('menu').classList.remove('hidden');
      m.S.phase='menu';
    }
  }
}

// ---------------------------------------------------------------------------
//  CONFETI de gol
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
//  MULTITUD animada (olas sutiles)
// ---------------------------------------------------------------------------
// puntos blancos que parpadean en las gradas (flashes del público)

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
    mmx.fillStyle= ti===0?m.S.homeTeam.c1:m.S.awayTeam.c1;
    for(const p of m.teams[ti]){ mmx.beginPath(); mmx.arc(toX(p.pos.z),toY(p.pos.x),2.4,0,7); mmx.fill(); }
  }
  mmx.fillStyle='#fff'; mmx.beginPath(); mmx.arc(toX(m.bola.pos.z),toY(m.bola.pos.x),2,0,7); mmx.fill();
}

// ---------------------------------------------------------------------------
//  BUCLE PRINCIPAL
// ---------------------------------------------------------------------------
// UN TICK de simulación, siempre con el mismo dt. Todo lo que decide el
// resultado del partido vive aquí dentro; el render va aparte, a la tasa
// del monitor. Sin esto no hay servidor autoritativo posible.
// El presentador es lo ÚNICO que traduce eventos del partido en interfaz.
const presentar = crearPresentador({
  announce, updateScorebug, updateCardsUI, burstConfetti,
  playWhistle, playKick, crowdCheer, mostrarTarjeta, teamName,
  nombreGoleador: (team, idx) => m.names[team][idx] || 'Anónimo',
});

function stepSim(dt){
  updatePhase(dt);
  if(m.S.phase==='play'||m.S.phase==='kickoff'){
    updateHumans(dt);
    updateAI(dt);
    enforceKickoffRule();
    tryPossession(dt);
    updateBall(dt);
  } else if(m.S.phase==='falta'){
    // la jugada se sigue viendo, pero nadie toma el balón: queda suelto
    updateHumans(dt);
    updateAI(dt);
    updateBall(dt);
  } else if(m.S.phase==='setpiece'){
    // cualquier humano del equipo que saca puede ejecutar antes con pase/tiro
    if(m.S.setPiece){
      const h=m.S.humans.find(x=>x.team===m.S.setPiece.team);
      if(h && (h.input.pass||h.input.shoot)) takeSetPiece();
    }
  }
  // temporizadores y orientación: estado autoritativo, en todas las fases
  for(let ti=0;ti<2;ti++)for(const p of m.teams[ti]) tickTimers(p, dt);
  if(m.goalCooldown>0) m.goalCooldown-=dt;
  m.simTick++;
}

function animate(){
  requestAnimationFrame(animate);
  const frameDt=Math.min(G.clock.getDelta(), 0.25);
  if(m.S.running && !m.S.paused){
    pollInput();                       // los dispositivos se muestrean una vez por frame
    m.acumulador += frameDt;
    let pasos=0;
    while(m.acumulador >= DT && pasos < MAX_PASOS){ stepSim(DT); m.acumulador -= DT; pasos++; }
    if(pasos === MAX_PASOS) m.acumulador = 0;   // se descarta el atraso en vez de acumularlo
    // --- presentación: a la tasa del monitor, no del simulador ---
    // los eventos del tick se vuelven imagen y sonido; de paso la vista se
    // entera de quién ha pegado para animar el golpeo
    presentar(anotarEventos(drenarEventos(m)));

    // --- REPETICIÓN: sólo vista. Graba instantáneas y las dibuja aparte ---
    const enJuego = m.S.phase==='play' || m.S.phase==='kickoff' || m.S.phase==='falta';
    if(enJuego) replayView.grabar(m.teams, m.bola, frameDt);
    if(m.S.phase==='goal' && m.S.phaseT > 2.6 && !replayView.activa && replayView.listo){
      if(replayView.iniciar()) document.getElementById('replayFx').classList.add('show');
    }
    posesRepeticion = replayView.activa ? replayView.poses(frameDt) : null;
    if(!posesRepeticion && !replayView.activa){
      document.getElementById('replayFx').classList.remove('show');
      if(enJuego === false && m.S.phase!=='goal') replayView.detener();
    }

    tickGestos(frameDt);               // el reloj del festejo corre una sola vez
    sincronizarAnillos(m.teams, m.S.humans);   // derivado de ownerSeat, no avisado
    for(let ti=0;ti<2;ti++)for(const p of m.teams[ti]){
      syncPlayerView(p, frameDt,
        posesRepeticion ? posesRepeticion.poses.get(p.playerId) : null,
        posesRepeticion ? posesRepeticion.bola : m.bola.pos);   // la cabeza mira al balón
    }
    syncBallView(frameDt, posesRepeticion ? posesRepeticion.bola : null);
    updateConfetti(frameDt);
    updateCrowd(frameDt);
    updateCamera(frameDt);
    updateClock();
    updateStaminaUI();
    drawMinimap();
  }
  // con calidad "media" se salta el post-procesado para ganar rendimiento
  if(m.S.quality==='alta' && G.composer) G.composer.render();
  else G.renderer.render(G.scene, G.camera);
}

// ---------------------------------------------------------------------------
//  PAUSA
// ---------------------------------------------------------------------------
function togglePause(){
  if(!m.S.running) return;
  m.S.paused=!m.S.paused;
  document.getElementById('pause').style.display=m.S.paused?'flex':'none';
}

// ---------------------------------------------------------------------------
//  MODO TORNEO — liga de todos contra todos
// ---------------------------------------------------------------------------

// marcador simulado por fuerza de plantilla (Poisson)
// el partido del usuario en la jornada actual


// ---------------------------------------------------------------------------
//  MENÚ / UI
// ---------------------------------------------------------------------------

function buildMenu(){
  const hl=document.getElementById('homeList'), al=document.getElementById('awayList');
  const mk=(t, side)=>{
    const el=document.createElement('div'); el.className='team-opt';
    el.innerHTML=`<span class="badge" style="background:${badgeCSS(t)}"></span>
      <div><div class="nm">${t.nombre}</div><div class="ci">${t.ciudad}</div></div>
      <div class="ov">${t.ov}</div>`;
    el.onclick=()=>{
      if(side==='home'){ m.S.homeTeam=t; if(m.S.awayTeam===t) m.S.awayTeam=TEAMS.find(x=>x!==t); }
      else { m.S.awayTeam=t; if(m.S.homeTeam===t) m.S.homeTeam=TEAMS.find(x=>x!==t); }
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
    ()=>m.S.numHumanos, v=>{ m.S.numHumanos=v; crearHumanos(v); renderPlayersCfg(); });
  chips(document.getElementById('durOpts'), [['4 min',120],['6 min',180],['10 min',300]], ()=>m.S.halfLen, v=>m.S.halfLen=v);
  chips(document.getElementById('diffOpts'), [['Fácil','facil'],['Normal','normal'],['Difícil','dificil']], ()=>m.S.difficulty, v=>m.S.difficulty=v);
  chips(document.getElementById('qualOpts'), [['Alta','alta'],['Media','media']], ()=>m.S.quality, v=>{m.S.quality=v;});

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
  crearHumanos(m.S.numHumanos);
  renderPlayersCfg();
  renderSel();
}
// crea/ajusta la lista de jugadores humanos
function crearHumanos(n){
  const prev=m.S.humans;
  m.S.humans=[];
  const slotsPorDefecto=[9,10,8,7];
  for(let i=0;i<n;i++){
    const anterior=prev[i];
    m.S.humans.push(anterior || {
      seatId:i, playerId:null,          // vínculo por identificador, no por referencia
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
  m.S.humans.forEach((h,i)=>{ h.idx=i; h.seatId=i; h.color=COLORES_HUMANO[i]; h.nombre='Jugador '+(i+1); });
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
  m.S.humans.forEach(h=>{
    const card=document.createElement('div');
    card.className='pcard'; card.style.borderLeftColor=h.color;
    const eqNombre = t=> t===0? m.S.homeTeam.nombre : m.S.awayTeam.nombre;
    const slots = etiquetasSlots(m.S.formation[h.team]);
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
    const dup=m.S.humans.filter(o=>o!==h && o.device===h.device).length;
    const dupSlot=m.S.humans.filter(o=>o!==h && o.team===h.team && o.slot===h.slot).length;
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
  document.querySelectorAll('#homeList .team-opt').forEach(el=>el.classList.toggle('sel', el._team===m.S.homeTeam));
  document.querySelectorAll('#awayList .team-opt').forEach(el=>el.classList.toggle('sel', el._team===m.S.awayTeam));
  document.getElementById('homeOv').textContent=m.S.homeTeam.nombre;
  document.getElementById('awayOv').textContent=m.S.awayTeam.nombre;
}

function setupHUDTeams(){
  document.getElementById('hname').textContent=m.S.homeTeam.nombre.toUpperCase();
  document.getElementById('aname').textContent=m.S.awayTeam.nombre.toUpperCase();
  document.getElementById('hbadge').style.background=badgeCSS(m.S.homeTeam);
  document.getElementById('abadge').style.background=badgeCSS(m.S.awayTeam);
  updateScorebug();
  const t = a => `<span class="k">${nombreTecla(binds.teclado1[a])}</span>`;
  document.getElementById('controlsHint').innerHTML =
    `<b>CONTROLES</b><br>Mover ${t('arriba')}${t('izq')}${t('abajo')}${t('der')}<br>`+
    `Pase ${t('pase')} · Tiro ${t('tiro')}<br>`+
    `Sprint ${t('sprint')} · Cambiar ${t('cambiar')}<br>`+
    `<span style="opacity:.75">Sin balón: ${t('tiro')} barrida · cabezazo con ${t('pase')}/${t('tiro')}</span><br>`+
    `Formación <span class="k">F</span> · Pausa <span class="k">Esc</span><br>`+
    `<span style="opacity:.6">Joystick: A pase · B tiro · RT sprint · Y cambiar</span>`;
}

function startMatch(){
  ensureAudio();
  // limpiar equipos previos
  m.teams.forEach(arr=>arr.forEach(p=>G.scene.remove(p.mesh))); m.teams[0]=[]; m.teams[1]=[];
  spawnTeams();
  m.S.score=[0,0]; m.S.clock=0; m.S.half=1; m.lastScorer=null;
  m.cards[0]={a:0,r:0}; m.cards[1]={a:0,r:0}; m.S.setPiece=null; limpiarEventos(m);
  reiniciarGestos();           // sin golpeos ni festejos heredados del partido anterior
  replayView.detener();     // el buffer de repetición no debe cruzar partidos
  if(!m.S.humans.length) crearHumanos(m.S.numHumanos);
  m.S.humans.forEach(h=>{ h.playerId=null; });
  setupHUDTeams(); updateCardsUI(); buildStaminaUI();
  placeKickoff(0);
  m.S.phase='kickoff'; m.S.phaseT=0; m.S.running=true; m.S.paused=false;
  contarPartido();
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').style.display='block';
  document.getElementById('pause').style.display='none';
  playWhistle(1);
}

// pausa botones
document.getElementById('resume').onclick=togglePause;
document.getElementById('toMenu').onclick=()=>{
  m.S.running=false; m.S.paused=false;
  document.getElementById('pause').style.display='none';
  document.getElementById('hud').style.display='none';
  document.getElementById('menu').classList.remove('hidden');
  m.S.phase='menu';
};

// ---------------------------------------------------------------------------
//  ARRANQUE
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
//  OPCIONES — reasignar controles
// ---------------------------------------------------------------------------
let devEditando = 'teclado1';
let esperandoTecla = null;      // acción pendiente de asignar

function renderBinds(){
  const cont=document.getElementById('listaBinds');
  cont.innerHTML = ACCIONES.map(a=>`
    <div class="bindrow">
      <span class="acc">${a.nombre}</span>
      <button data-acc="${a.id}">${nombreTecla(binds[devEditando][a.id])}</button>
    </div>`).join('');
  cont.querySelectorAll('button').forEach(b=>{
    b.onclick=()=>{
      cont.querySelectorAll('button').forEach(x=>x.classList.remove('esperando'));
      b.classList.add('esperando'); b.textContent='pulsa una tecla…';
      esperandoTecla = b.dataset.acc;
    };
  });
  document.querySelectorAll('.otab').forEach(t=>{
    t.classList.toggle('on', t.dataset.dev===devEditando);
    t.onclick=()=>{ devEditando=t.dataset.dev; esperandoTecla=null; renderBinds(); };
  });
}

function abrirOpciones(){
  esperandoTecla=null; renderBinds();
  const inp=document.getElementById('apodo');
  inp.value = perfil.apodo || '';
  inp.oninput = ()=> setApodo(inp.value);
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('opciones').classList.remove('hidden');
}
function cerrarOpciones(){
  document.getElementById('opciones').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
  if(m.S.running) setupHUDTeams();          // refrescar la ayuda con las teclas nuevas
}

// Captura de tecla para reasignar. Va en captura para adelantarse al
// manejador normal del juego y no disparar una acción mientras se configura.
addEventListener('keydown', e=>{
  if(!esperandoTecla) return;
  e.preventDefault(); e.stopPropagation();
  if(e.code!=='Escape'){
    // si la tecla ya estaba usada en este mismo dispositivo, se libera
    const mapa = binds[devEditando];
    for(const k in mapa) if(mapa[k]===e.code) mapa[k]='';
    mapa[esperandoTecla] = e.code;
    guardarBinds();
  }
  esperandoTecla=null; renderBinds();
}, true);

function boot(){
  initThree();
  buildSky(G.scene);
  buildLights(G.scene, m.S.quality);
  buildField(G.scene);
  buildStadium(G.scene);
  buildFlashes();
  buildBall();
  buildConfetti();
  buildMenu();
  updatePadUI();

  // panel de controles ocultable + botón de ayuda
  const hint=document.getElementById('controlsHint');
  const esMovil = matchMedia('(max-width: 820px)').matches;
  if(esMovil) hint.classList.add('oculto');     // en el móvil estorba: arranca oculto
  document.getElementById('btnAyuda').onclick=()=>hint.classList.toggle('oculto');

  document.getElementById('playOpciones').onclick=abrirOpciones;
  document.getElementById('cerrarOpciones').onclick=cerrarOpciones;
  document.getElementById('resetBinds').onclick=()=>{ restaurarBinds(); renderBinds(); };
  window.__dbg = {
    // --- lectura ---
    get cam(){return G.camera.position;}, get ball(){return m.bola.pos;}, get S(){return m.S;}, get teams(){return m.teams;},
    get camera(){return G.camera;}, get scene(){return G.scene;},
    get camCalls(){return G.camCalls;}, get camDist(){return G.camLast;},
    get canvases(){return document.querySelectorAll('canvas').length;},
    get tick(){return m.simTick;},
    LIGA, simularJornada, clasificacion, mostrarTorneo,

    // --- determinismo ---
    seed: n => m.sembrar(n),
    hash: () => hashEstado(),
    rand: () => m.rng(),                       // sonda: comprueba el propio RNG
    stepN(n){ for(let i=0;i<n;i++) stepSim(DT); return hashEstado(); },
    resetGolden(semilla=12345){              // mismo reinicio que golden(), sin correr
      m.S.humans=[]; m.sembrar(semilla);
      m.teams.forEach(arr=>arr.forEach(pl=>G.scene.remove(pl.mesh)));
      m.teams[0]=[]; m.teams[1]=[]; spawnTeams();
      m.S.score=[0,0]; m.S.clock=0; m.S.half=1; m.lastScorer=null;
      m.cards[0]={a:0,r:0}; m.cards[1]={a:0,r:0}; m.S.setPiece=null;
      replayView.detener();
      m.goalCooldown=0; m.acumulador=0; m.simTick=0;
      m.lastTouch=-1; m.offsidePend=null; m.passReceiver=null;
      m.S._owner=null; m.S.possession=0;
      placeKickoff(0); m.S.phase='kickoff'; m.S.phaseT=0;
      return hashEstado();
    },

    // --- comandos de forzado: convierten la prueba de humo en 90 s deterministas ---
    teleportBall(x, y=BALL_R, z=0){
      m.bola.pos.set(x,y,z); m.bola.vel.set(0,0,0); m.bola.kickLock=0;
      if(m.S._owner){ m.S._owner.hasBall=false; m.S._owner=null; }
      return [x,y,z];
    },
    setClock(seg){ m.S.clock=seg; return m.S.clock; },
    goal(team=0){ m.lastTouch=team; scoreGoal(team); return m.S.score.slice(); },
    forceSetPiece(tipo='penal', team=0){
      const gz = goalDirZ(team);              // portería que ataca ese equipo
      const pos = {
        penal:  [0, gz - Math.sign(gz)*11],
        corner: [Math.sign(gz)*(HALF_W-0.4), gz],
        banda:  [HALF_W, 0],
        puerta: [0, -gz + Math.sign(gz)*5.5],
        falta:  [m.bola.pos.x, m.bola.pos.z],
      }[tipo];
      if(!pos) return 'tipo inválido: penal|corner|banda|puerta|falta';
      startSetPiece(tipo, team, pos[0], pos[1]);
      return {tipo, team, pos};
    },
    card(tipo='amarilla', team=1, idx=5){
      const p = m.teams[team][idx]; if(!p) return 'jugador inexistente';
      if(tipo==='roja'){ m.cards[team].r++; sendOff(p); } else { m.cards[team].a++; p.yellow++; }
      showCard(tipo); return {tipo, team, num:p.num, cards:m.cards.map(c=>({...c}))};
    },
    forceOffside(){
      // adelanta a un punta por detrás del último defensa y le mete el pase
      const atac = m.teams[0].filter(p=>!p.isGK).sort((a,b)=>b.formation.z-a.formation.z)[0];
      const zs = m.teams[1].map(o=>o.pos.z).sort((a,b)=>b-a);
      atac.pos.z = Math.max(zs[1] + 4, 6);
      const pasador = m.teams[0].find(p=>p!==atac && !p.isGK);
      m.bola.pos.set(pasador.pos.x, BALL_R, pasador.pos.z);
      m.offsidePend = atac; m.S._owner = pasador;
      callOffside(atac);
      return {adelantado:atac.num, z:+atac.pos.z.toFixed(1)};
    },

    // --- GOLDEN MASTER: N segundos de IA vs IA, semilla fija, hash por segundo ---
    golden(segundos=90, semilla=12345){
      const humanosAntes = m.S.humans;
      m.S.humans = [];                                   // IA pura: sin entradas humanas
      for(const arr of m.teams) for(const p of arr) p.ownerSeat = null;
      m.sembrar(semilla);
      // Mundo COMPLETAMENTE limpio. Reutilizar los jugadores no sirve: arrastran
      // energía gastada y temporizadores, y sendOff() los saca del array, así que
      // tras una roja la siguiente corrida empezaría con menos jugadores.
      m.teams.forEach(arr=>arr.forEach(pl=>G.scene.remove(pl.mesh)));
      m.teams[0]=[]; m.teams[1]=[]; spawnTeams();
      m.S.score=[0,0]; m.S.clock=0; m.S.half=1; m.lastScorer=null;
      m.cards[0]={a:0,r:0}; m.cards[1]={a:0,r:0}; m.S.setPiece=null;
      replayView.detener();
      m.goalCooldown=0; m.acumulador=0; m.simTick=0;
      m.lastTouch=-1; m.offsidePend=null; m.passReceiver=null;
      m.S._owner=null; m.S.possession=0; reiniciarEstad(m);
      placeKickoff(0); m.S.phase='kickoff'; m.S.phaseT=0;
      const hashes=[];
      const total=Math.round(segundos/DT);
      for(let i=0;i<total;i++){
        stepSim(DT);
        if((i+1) % 60 === 0) hashes.push(hashEstado());
      }
      const resumen={ semilla, segundos, ticks:total, marcador:m.S.score.slice(),
                      estad:{...m.estad}, hashes, final:hashes[hashes.length-1] };
      m.S.humans = humanosAntes;
      return resumen;
    },
  };
  animate();
  setTimeout(()=>document.getElementById('loader').style.display='none', 500);
}
boot();

// resumir audio en primer gesto
addEventListener('pointerdown', ()=>ensureAudio(), {once:true});
