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
import { Vec3, Vec2 }                               from './core/math.js';
import { emitir, drenarEventos, limpiarEventos } from './core/events.js';
import { crearPresentador }                   from './ui/presenter.js';
import { crearReplayView }                    from './render/replayView.js';
import { tickTimers }                         from './core/systems/movement.js';
import { playerId, jugadorDeAsiento, esHumano, asignarControl as asignarControlSeat }
                                              from './core/systems/seats.js';
import { crearJugador }                       from './core/player.js';
import { construirMalla, ocultarMalla, limpiarMallas }
                                              from './render/playerMesh.js';
import { sincronizarAnillos }                 from './render/rings.js';
import { syncPlayerView, anotarEventos, reiniciarGestos, tickGestos }
                                                 from './render/playerView.js';
import { binds, guardarBinds, restaurarBinds, nombreTecla, ACCIONES }
                                              from './config/binds.js';
import { perfil, setApodo, contarPartido }    from './app/perfil.js';
import { G }                                  from './app/G.js';
import { crearPartido, reiniciarEstad }       from './core/match.js';
import { fijarActivo }                        from './core/activo.js';

// LA SIMULACIÓN VIVE EN core/sim.js. Este archivo es el CLIENTE: dibuja,
// suena, escucha el teclado y arma los menús. `m` es un binding vivo: cuando
// `usarPartido()` cambie de partido, aquí se ve el nuevo sin hacer nada.
import { BTN, crearComando, encolarComando } from './core/input.js';
import { aMundo }                             from './input/cameraSpace.js';
import { crearSesionOnline, botonesDe }       from './app/onlineSession.js';
import { crearPrediccion }                    from './net/prediccion.js';
import { leerSesion }                         from './app/cuenta.js';
import { m, usarPartido, partidoActual,
         hashEstado, spawnTeams, placeKickoff, asignarControl, cycleFormation,
         goalDirZ, teamName, startSetPiece, sendOff, showCard, callOffside,
         scoreGoal, crearHumanos, stepSim, etiquetasSlots }
                                              from './core/sim.js';
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

// Convierte lo que hay apretado AHORA en un ComandoInput por asiento y lo
// mete en su cola. Esto es exactamente lo que hará el cliente online: la
// única diferencia será que el comando, en vez de ir a la cola de al lado,
// viajará por un socket hasta la cola del servidor.
//
// Los flancos NO se calculan aquí: se mandan niveles y los deriva la
// simulación. Y el giro de cámara se aplica aquí, porque es cosa del cliente.
let _seqInput = 0;
function pollInput(){
  for(const h of m.S.humans){
    const r = leerDispositivo(h.device);
    const dir = aMundo(r.mx, r.my);
    let botones = 0;
    if(r.pass)   botones |= BTN.PASE;
    if(r.shoot)  botones |= BTN.TIRO;
    if(r.sprint) botones |= BTN.SPRINT;
    if(r.sw)     botones |= BTN.CAMBIAR;
    encolarComando(h, crearComando(_seqInput++, m.simTick, dir.x, dir.z, botones));
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


// SÓLO CLIENTE: crea los equipos (núcleo) y después les cuelga las mallas.
// El servidor llamará únicamente a spawnTeams(); nunca a esto.
function crearEquiposYMallas(){
  spawnTeams();
  [0,1].forEach(ti=>{
    const t = ti===0 ? m.S.homeTeam : m.S.awayTeam;
    for(const p of m.teams[ti]) construirMalla(p, {c1:t.c1, c2:t.c2}, G.scene);
  });
}





// ---------------------------------------------------------------------------
//  UTILIDADES DE JUEGO
// ---------------------------------------------------------------------------
// Scratch de SIMULACIÓN. Nunca deben compartirse con el render: si la cámara
// y la IA escriben en el mismo vector temporal, aparece un teletransporte
// intermitente imposible de reproducir.
// ---------------------------------------------------------------------------
//  JUGADORES HUMANOS (multijugador local: teclado y mandos)
// ---------------------------------------------------------------------------





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


// Conducción: el toque nunca debe superar el radio de captura, o el balón
// se escapa del control y sale despedido.



















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
  // `camSnap` lo enciende la simulación al colocar un saque; el salto de
  // cámara lo da la VISTA, que es quien sabe dónde está mirando.
  if(m.S.camSnap) camTarget.copy(m.bola.pos);
  else camTarget.lerp(m.bola.pos, Math.min(1,dt*2.6));
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
// Las barras son nodos del DOM: viven aquí, no dentro del asiento. Un asiento
// viaja por la red; no puede llevar un <div> dentro.
const barras = new Map();     // seatId -> nodo .bar2
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
    barras.set(h.seatId, row.querySelector('.bar2'));
  });
}
function updateStaminaUI(){
  for(const h of m.S.humans){
    const bar = barras.get(h.seatId);
    const p=jugadorDeAsiento(m.teams, h); if(!p||!bar) continue;
    const pct=Math.round(p.stamina*100);
    bar.firstElementChild.style.width = pct+'%';
    bar.className = 'bar2 ' + (pct<25?'low' : pct<55?'mid' : '');
  }
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
  ocultarJugador: ocultarMalla,
  cerrarPartido,
  etiquetaFormacion: nombre => { const t=document.getElementById('formTag'); if(t) t.textContent=nombre; },
});


function animate(){
  requestAnimationFrame(animate);
  const frameDt=Math.min(G.clock.getDelta(), 0.25);
  if(m.S.running && !m.S.paused){
    const enRed = online && online.fase === 'jugando';
    if(enRed){
      // ONLINE: el cliente SÍ simula, y el servidor lo corrige. El estado
      // autoritativo entra por prediccion.aplicar() cuando llega, no aquí.
      posesOnline = null;
      tickOnline(frameDt);
      presentar(anotarEventos(online.drenarEventos()));
    } else {
      posesOnline = null;
      m.acumulador += frameDt;
      let pasos=0;
      // Se muestrea UNA VEZ POR TICK, no por frame: así el juego se comporta
      // igual a 30 que a 240 Hz, y es lo mismo que hace el cliente online.
      while(m.acumulador >= DT && pasos < MAX_PASOS){
        pollInput(); stepSim(DT); m.acumulador -= DT; pasos++;
      }
      if(pasos === MAX_PASOS) m.acumulador = 0;   // se descarta el atraso en vez de acumularlo
      // --- presentación: a la tasa del monitor, no del simulador ---
      // los eventos del tick se vuelven imagen y sonido; de paso la vista se
      // entera de quién ha pegado para animar el golpeo
      presentar(anotarEventos(drenarEventos(m)));
    }

    // --- REPETICIÓN: sólo vista. Graba instantáneas y las dibuja aparte ---
    const enJuego = !enRed && (m.S.phase==='play' || m.S.phase==='kickoff' || m.S.phase==='falta');
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
      // La pose externa (repetición o red) también le da la CADENCIA de
      // carrera: sin ella, online los jugadores se deslizarían sin mover las
      // piernas, porque su velocidad la conoce el servidor y no este cliente.
      const pose = posesRepeticion ? posesRepeticion.poses.get(p.playerId)
                 : posesOnline     ? posesOnline.poses.get(p.playerId) : null;
      syncPlayerView(p, frameDt, pose,
        posesRepeticion ? posesRepeticion.bola : m.bola.pos);   // la cabeza mira al balón
    }
    syncBallView(frameDt, posesRepeticion ? posesRepeticion.bola : null);   // online ya escribió m.bola
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
  limpiarMallas(G.scene); m.teams[0]=[]; m.teams[1]=[];   // incluye a los expulsados, que ya no están en teams
  crearEquiposYMallas();
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
//  ONLINE — salas
// ---------------------------------------------------------------------------
// El partido lo simula el servidor. Aquí sólo se manda lo que apretás y se
// dibuja lo que contesta. Todo el render, la cámara, el HUD y las animaciones
// son EXACTAMENTE los mismos: leen el mismo objeto partido, sólo que lo llena
// la red en vez de stepSim().
// A dónde se conecta el juego. En desarrollo, al servidor de tu máquina; en
// producción, a lo que diga VITE_SERVIDOR al construir.
//
// El respaldo mira el protocolo de la página, y no es un detalle: una página
// servida por https NO puede abrir un WebSocket ws:// —el navegador lo bloquea
// por contenido mixto, sin avisar de forma clara— así que el juego publicado
// se quedaría "conectando…" para siempre. Si estás en https y nadie configuró
// VITE_SERVIDOR, eso es un despliegue a medias y conviene decirlo.
const URL_SERVIDOR = (() => {
  if(import.meta.env.VITE_SERVIDOR) return import.meta.env.VITE_SERVIDOR;
  const seguro = location.protocol === 'https:';
  if(seguro) console.warn('[FÚLBO] falta VITE_SERVIDOR: el modo online no va a conectar');
  return `${seguro ? 'wss' : 'ws'}://${location.hostname}:2567`;
})();
let online = null;              // sesión activa, o null si se juega local
let posesOnline = null;
// El cliente simula el partido entero y lo corrige con lo que manda el
// servidor. Ver net/prediccion.js: es lo que hace que el balón vaya pegado a
// tus pies en vez de ir un RTT por detrás.
const prediccion = crearPrediccion({ partido: m, usar: usarPartido, paso: stepSim });

const $on = id => document.getElementById(id);
function estadoOnline(txt){ const e=$on('onEstado'); if(e) e.textContent = txt; }

// Se muestra la caja de la cuenta o la de las salas, según haya sesión.
function pintarCuenta(){
  const dentro = !!(online && online.cuenta);
  $on('cajaCuenta').classList.toggle('hidden', dentro);
  $on('cajaSalas').classList.toggle('hidden', !dentro);
  if(dentro) $on('cuQuien').textContent = online.cuenta.nombre;
  else $on('onSala').classList.add('hidden');
}

async function abrirOnline(){
  $on('online').classList.remove('hidden');
  $on('menu').classList.add('hidden');
  const sel = $on('onPuesto');
  sel.innerHTML = etiquetasSlots(m.S.formation[0])
    .map((t,i)=> i===0 ? '' : `<option value="${i}">${t}</option>`).join('');
  sel.value = '9';
  const guardada = leerSesion();
  if(guardada?.nombre) $on('cuNombre').value = guardada.nombre;
  pintarCuenta();
  if(!online) await conectarOnline();     // conectar ya reanuda la sesión guardada
}
function cerrarOnline(){
  // se cierra el socket pero NO la sesión: al volver, sigue identificado
  if(online){ online.cerrar(); online = null; }
  $on('online').classList.add('hidden');
  $on('menu').classList.remove('hidden');
  $on('onSala').classList.add('hidden');
}

function pintarSala(){
  if(!online) return;
  $on('onSala').classList.toggle('hidden', !online.codigo);   // sólo si estás en una
  if(!online.codigo) return;
  $on('onCodSala').textContent = online.codigo || '····';
  $on('onPing').textContent = online.ping ? `${online.ping} ms` : '';
  const etiquetas = etiquetasSlots(m.S.formation[0]);
  const jefe = online.soyAnfitrion;
  $on('onLista').innerHTML = online.jugadores.map(j => {
    const yo = j.userId === online.cuenta?.userId;
    const donde = j.equipo == null ? '<span class="puesto">sin puesto</span>'
      : `<span class="puesto">${j.equipo===0?'Local':'Visitante'} · ${etiquetas[j.puesto]||j.puesto}</span>`;
    const marcas = [
      j.esAnfitrion ? '<span class="marca jefe">anfitrión</span>' : '',
      j.listo       ? '<span class="marca listo">listo</span>' : '',
      j.conectado   ? '' : '<span class="marca fuera">desconectado</span>',
      (jefe && !yo) ? `<button class="echar" data-echar="${j.userId}">echar</button>` : '',
    ].join('');
    return `<div class="salarow${yo?' yo':''}"><b>${j.nombre}${yo?' (vos)':''}</b>${donde}` +
           `<span class="marcas">${marcas}</span></div>`;
  }).join('') || '<div class="salarow"><b>Nadie más todavía</b></div>';

  for(const b of $on('onLista').querySelectorAll('[data-echar]'))
    b.onclick = () => online.echar(b.dataset.echar);

  // el botón de empezar es sólo del anfitrión
  const emp = $on('onEmpezar');
  emp.disabled = !jefe;
  emp.textContent = jefe ? '▶ Empezar partido' : 'Espera al anfitrión';
  const yoSoy = online.jugadores.find(j => j.userId === online.cuenta?.userId);
  const listo = !!yoSoy?.listo;
  $on('onListo').classList.toggle('si', listo);
  $on('onListo').textContent = listo ? '✓ Listo' : 'Estoy listo';
}

// Lista de salas abiertas: para entrar sin que nadie te pase un código.
function pintarPublicas(){
  if(!online) return;
  const c = $on('onPublicas');
  const salas = online.salasPublicas || [];
  if(!salas.length){ c.innerHTML = '<div class="salapub"><span style="opacity:.6">' +
      'No hay salas abiertas. Creá una.</span></div>'; return; }
  c.innerHTML = salas.map(x =>
    `<div class="salapub" data-sala="${x.codigo}"><b>${x.codigo}</b>` +
    `<span style="opacity:.75">${x.anfitrion}</span>` +
    `<span class="gente${x.fase==='jugando'?' jugando':''}">` +
    `${x.conectados}/4 · ${x.fase==='jugando'?'jugando':'esperando'}</span></div>`).join('');
  for(const el of c.querySelectorAll('[data-sala]'))
    el.onclick = () => online.unirseA(el.dataset.sala);
}

async function conectarOnline(){
  if(online) return true;
  estadoOnline('Conectando…');
  try {
    online = crearSesionOnline({ url: URL_SERVIDOR });
    // Los manejadores de la INTERFAZ se enganchan DESPUÉS de conectar, porque
    // conectar() engancha primero los de la sesión: si se hiciera al revés,
    // pintarCuenta() correría antes de que `online.cuenta` existiera y se
    // quedaría mostrando el formulario de entrada con la sesión ya iniciada.
    await online.conectar();
    online.bus.al('sesion', msg => { estadoOnline(`Sesión iniciada como ${msg.nombre}.`);
                                     setApodo(msg.nombre); pintarCuenta();
                                     online.pedirSalas(); })
              .al('sala', () => pintarSala())
              .al('bienvenida', () => { estadoOnline('En la sala.'); pintarSala(); })
              .al('error', msg => estadoOnline('⚠ ' + msg.motivo))
              .al('lista', () => pintarPublicas())
              .al('expulsado', msg => { estadoOnline('⚠ ' + msg.motivo); pintarSala();
                                        volverAlMenuDesdeRed(); })
              .al('arranque', msg => arrancarPartidoOnline(msg))
              .al('_cerrado', () => avisarCaida());
    estadoOnline('Conectado. Entrá con tu cuenta o creá una.');
    setInterval(() => {
      if(!online?.cuenta) return;
      online.medirPing();
      pintarSala();
      if(!online.codigo && !m.S.running) online.pedirSalas();   // el lobby se refresca solo
    }, 2000);
    return true;
  } catch(e){
    online = null;
    estadoOnline('No hay servidor en ' + URL_SERVIDOR + '. Levantalo con: npm run servidor');
    return false;
  }
}

// El registro y la entrada NUNCA guardan la contraseña: se manda, el servidor
// devuelve un token de sesión y el campo se vacía en el acto.
async function accionCuenta(crear){
  if(!await conectarOnline()) return;
  const nombre = $on('cuNombre').value.trim();
  const clave  = $on('cuClave').value;
  if(!nombre || !clave) return estadoOnline('Faltan el nombre o la contraseña.');
  estadoOnline(crear ? 'Creando cuenta…' : 'Entrando…');
  if(crear) online.registrar(nombre, clave); else online.identificarse(nombre, clave);
  $on('cuClave').value = '';
}

// Se cayó el socket. Ni se pausa el partido ni se echa a nadie al menú: el
// servidor guarda el asiento un minuto y la IA juega ese jugador mientras
// tanto. Aquí sólo se avisa y se reintenta.
function avisarCaida(){
  if(!online) return;
  const banner = $on('netcaida');
  const enPartido = m.S.running;
  if(enPartido) banner.classList.remove('hidden');
  online.intentarVolver(txt => {
    $on('netcaidaTxt').textContent = txt;
    estadoOnline(txt);
    if(/Reconectado/.test(txt)) banner.classList.add('hidden');
    if(/No se pudo/.test(txt)){ banner.classList.add('hidden'); volverAlMenuDesdeRed(); }
  });
}

function volverAlMenuDesdeRed(){
  m.S.running = false; posesOnline = null;
  $on('hud').style.display = 'none';
  $on('netcaida').classList.add('hidden');
  $on('menu').classList.add('hidden');
  $on('online').classList.remove('hidden');
  pintarCuenta();
}

// El cliente crea los mismos 22 jugadores con sus mallas, pero NO los simula:
// sus posiciones las va a escribir el servidor en cada snapshot.
function arrancarPartidoOnline(msg){
  ensureAudio();
  prediccion.reiniciar();
  limpiarMallas(G.scene); m.teams[0]=[]; m.teams[1]=[];
  crearEquiposYMallas();
  m.S.score=[0,0]; m.S.clock=0; m.S.half=1;
  m.cards[0]={a:0,r:0}; m.cards[1]={a:0,r:0}; m.S.setPiece=null; limpiarEventos(m);
  reiniciarGestos(); replayView.detener();
  crearHumanos(msg.asientos.length);
  msg.asientos.forEach((a,i) => {
    const h = m.S.humans[i];
    if(!h) return;
    h.team = a.equipo; h.slot = a.puesto; h.nombre = a.nombre;
  });
  setupHUDTeams(); updateCardsUI(); buildStaminaUI();
  m.S.phase='kickoff'; m.S.phaseT=0; m.S.running=true; m.S.paused=false;
  prediccion.fijarAsiento(online.seatId);
  online.alEstado = msg2 => prediccion.aplicar(msg2, online.ping);
  $on('online').classList.add('hidden');
  $on('menu').classList.add('hidden');
  $on('hud').style.display='block';
  playWhistle(1);
}

// UN comando por tick de simulación, no por frame. Y cada comando hace tres
// cosas a la vez: se manda al servidor, se guarda por si hay que repetirlo, y
// se aplica YA en la simulación local. Eso último es la predicción: tu
// jugador arranca en el mismo fotograma en que apretás, sin esperar respuesta.
let _accRed = 0;
function tickOnline(frameDt){
  _accRed += frameDt;
  let n = 0;
  while(_accRed >= DT && n < MAX_PASOS){
    const r = leerDispositivo(pad.connected ? 'pad0' : 'teclado1');
    const d = aMundo(r.mx, r.my);
    const cmd = online.enviarEntrada(d.x, d.z, botonesDe(r));
    if(cmd) prediccion.registrar(cmd);
    prediccion.avanzar();
    _accRed -= DT; n++;
  }
  if(n === MAX_PASOS) _accRed = 0;
}

// CAMINO DE ESPECTADOR: dibujar lo que manda el servidor sin simular nada,
// con el búfer de interpolación. Ya no lo usa quien juega —ese predice— pero
// es exactamente lo que hará falta para ver un partido ajeno.
function aplicarEstadoOnline(frameDt){
  posesOnline = online.poses(frameDt);
  const u = online.ultimo;
  if(u){
    m.S.score = u.marcador; m.S.clock = u.reloj; m.S.half = u.mitad; m.S.phase = u.fase;
    // quién controla a quién lo decide el servidor, también para los anillos
    const dueños = new Map(u.duenos);
    for(const arr of m.teams) for(const p of arr)
      p.ownerSeat = dueños.has(p.playerId) ? dueños.get(p.playerId) : null;
  }
  if(posesOnline){
    for(const arr of m.teams) for(const p of arr){
      const pose = posesOnline.poses.get(p.playerId);
      if(pose){ p.pos.x = pose.x; p.pos.z = pose.z; p.facing = pose.facing; }
    }
    m.bola.pos.set(posesOnline.bola.x, posesOnline.bola.y, posesOnline.bola.z);
  }
}

$on('playOnline').onclick = () => abrirOnline();
$on('onSalir').onclick    = () => cerrarOnline();
$on('cuCrear').onclick    = () => accionCuenta(true);
$on('cuEntrar').onclick   = () => accionCuenta(false);
$on('cuClave').onkeydown  = e => { if(e.key === 'Enter') accionCuenta(false); };
$on('cuSalir').onclick    = () => { if(online){ online.cerrarSesion(); pintarCuenta();
                                    estadoOnline('Sesión cerrada.'); } };
$on('onCrear').onclick    = () => { if(online?.cuenta) online.crearSala(); };
$on('onUnir').onclick     = () => { if(online?.cuenta) online.unirseA(($on('onCodigo').value||'').trim().toUpperCase()); };
$on('onRefrescar').onclick= () => { if(online?.cuenta) online.pedirSalas(); };
$on('onListo').onclick    = () => { if(!online) return;
                                    const yo = online.jugadores.find(j => j.userId === online.cuenta?.userId);
                                    online.preparado(!yo?.listo); };
$on('onDejar').onclick    = () => { if(online){ online.dejarSala(); pintarSala(); online.pedirSalas(); } };
$on('onTomar').onclick    = () => { if(online) online.pedirAsiento(+$on('onEquipo').value, +$on('onPuesto').value); };
$on('onEmpezar').onclick  = () => { if(online) online.empezar(); else estadoOnline('Primero creá o entrá a una sala.'); };
$on('onCopiar').onclick   = () => { if(online?.codigo) navigator.clipboard?.writeText(online.codigo); };

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
    get online(){return online;},          // sonda: sesión de red, si la hay
    get prediccion(){return prediccion;},  // sonda: medidas de rollback
    latencia(ms){ return online ? online.bus.simularLatencia(ms) : 'sin sesión'; },
    LIGA, simularJornada, clasificacion, mostrarTorneo,

    // --- determinismo ---
    seed: n => m.sembrar(n),
    hash: () => hashEstado(),
    rand: () => m.rng(),                       // sonda: comprueba el propio RNG
    stepN(n){ for(let i=0;i<n;i++) stepSim(DT); return hashEstado(); },
    resetGolden(semilla=12345){              // mismo reinicio que golden(), sin correr
      m.S.humans=[]; m.sembrar(semilla);
      limpiarMallas(G.scene);
      m.teams[0]=[]; m.teams[1]=[]; crearEquiposYMallas();
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
      limpiarMallas(G.scene);
      m.teams[0]=[]; m.teams[1]=[]; crearEquiposYMallas();
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
