// LA SIMULACIÓN. Aquí viven las reglas del fútbol y nada más.
//
// Este archivo NO importa three, no toca `document` ni `window`, no llama a
// `announce()` ni al silbato, no lee el reloj de pared y no usa Math.random.
// Por eso puede ejecutarse tal cual dentro de un proceso de Node: es lo que
// convierte una sala de Colyseus en posible. Hasta ahora estas 55 funciones
// vivían en main.js, entre el renderizador y el menú, y `import('./main.js')`
// en Node fallaba en la primera línea, que carga un CSS.
//
// PARTIDO ACTIVO. Las funciones trabajan sobre `m`, el partido en curso. No es
// reentrante a propósito: un servidor llama a `usarPartido(salaA)`, procesa el
// tick de A entero, y sólo entonces pasa a `usarPartido(salaB)`. Los vectores
// de usar y tirar `_v`/`_v2` son seguros por lo mismo — ningún tick cede el
// control a la mitad.
//
// Lo único que sale de aquí hacia el exterior son EVENTOS (`emitir`). Quien
// los recoge decide si son un cartel y un sonido (cliente) o un mensaje a la
// sala (servidor).
import { NOMBRES }                              from '../config/teams.js';
import { FORMACIONES, NOMBRES_FORM, FORMATION } from '../config/formations.js';
import { F, HALF_W, HALF_L, GOAL_W, GOAL_H, BALL_R, CIRCULO } from '../config/field.js';
import { DT, DIFF, SPRINT_MUL, TOQUE_MAX, CAPTURA, SP_LABEL,
         COLORES_HUMANO, DISPOSITIVOS, GOL_ESPERA }  from '../config/rules.js';
import { Vec3, Vec2 }                           from './math.js';
import { suavizado }                            from './rng.js';
import { emitir }                               from './events.js';
import { crearJugador }                         from './player.js';
import { estadoEntrada, consumirComando }       from './input.js';
import { tickTimers }                           from './systems/movement.js';
import { playerId, jugadorDeAsiento, esHumano,
         asignarControl as asignarControlSeat }  from './systems/seats.js';
import { crearPartido }                         from './match.js';
import { fijarActivo }                          from './activo.js';

// El partido sobre el que trabajan todas las funciones de este archivo.
//
// ⚠️ TRAMPA AL DEPURAR. Esta línea corre al IMPORTAR el módulo, y registra su
// partido como "el activo". Si desde la consola del navegador hacés
// `await import('/src/core/sim.js')`, el servidor de desarrollo puede
// entregarte una SEGUNDA instancia del módulo: esa instancia crea otro partido
// y le roba el puesto de activo al que estás jugando. A partir de ahí league.js
// escribe en un partido fantasma y el torneo parece roto sin estarlo.
//
// Para inspeccionar el partido en marcha usá `__dbg`, que está atado a la
// instancia de verdad. En producción esto no puede pasar: hay un solo módulo.
export let m = fijarActivo(crearPartido());
export function usarPartido(partido){ m = fijarActivo(partido); return m; }
export function partidoActual(){ return m; }

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
function spawnTeams(){
  [0,1].forEach(ti=>{
    m.teams[ti]=[]; m.names[ti]=[];
    const forma = FORMACIONES[m.S.formation[ti]] || FORMATION;
    forma.forEach((f,i)=>{
      const p = crearJugador(ti, f.r, i===0?1:i+1);   // datos puros: corre en Node
      p.playerId = playerId(ti, i);      // identificador estable para la red
      p.formation = f;
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
  m.S.camSnap=true;        // la vista colocará la cámara de golpe en el próximo frame
  m.S.possession = kickTeam;
  asignarPosicionesIniciales();
}
const _v = new Vec3(), _v2 = new Vec3();
function nearestToBall(ti){
  let best=null, bd=1e9;
  m.teams[ti].forEach(p=>{ if(p.isGK) return;
    const d=p.pos.distanceToSquared(m.bola.pos); if(d<bd){bd=d;best=p;} });
  return best;
}
// asigna a un humano el control de un jugador (liberando el anterior)
function asignarControl(h, p){
  // UN ASIENTO AUSENTE NO RECIBE JUGADOR. Si a alguien se le cae la conexión,
  // su asiento sigue existiendo (para que pueda volver a él), pero nadie está
  // mandando entradas: darle un jugador lo dejaría plantado en el césped en
  // vez de que lo juegue la IA. Sin esta guarda, el cambio automático de
  // jugador al recuperar el balón se lo asignaba igual.
  if(!h || h.ausente) return;
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
  if(ti===0) emitir(m, 'FORMACION', { nombre });
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
  p.expelled=true;
  emitir(m, 'EXPULSION', { playerId: p.playerId, team: p.team });
  const arr=m.teams[p.team]; const i=arr.indexOf(p); if(i>=0) arr.splice(i,1);
  if(p.ownerSeat!=null){ const h=m.S.humans.find(x=>x.seatId===p.ownerSeat); p.ownerSeat=null;
    if(h) h.playerId=null;
    asignarControl(h, masCercanoLibre(h.team, h)); }
}
function showCard(card){
  if(!card){ emitir(m, 'FALTA'); return; }
  emitir(m, 'TARJETA', { card });
}
// ---------------------------------------------------------------------------
//  DISPARO / PASE / REGATE
// ---------------------------------------------------------------------------
function distXZ(a,b){ return Math.hypot(a.x-b.x, a.z-b.z); }
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
  // Los flancos ya vienen derivados por stepSim, una sola vez por tick.
  const input = h.mando;
  if(!input) return;

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
  // La dirección llega ya en coordenadas del mundo: el giro de cámara lo hace
  // el cliente (input/cameraSpace.js). El servidor no sabe dónde mirás.
  const mv=_v.set(input.mx, 0, input.mz);

  // --- Sprint con energía (stamina) ---
  const moving = mv.lengthSq()>0.01;
  const wantSprint = input.mantieneSprint && p.stamina>0.06 && moving;
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

  if(input.pulsaCambiar && !hasBall){ // cambiar de jugador
    asignarControl(h, masCercanoLibre(h.team, h));
  }
  if(input.pulsaPase){
    if(hasBall) doPass(p);
    else if(canHead(p)) header(p, false);          // cabezazo de despeje/pase
    else if(cerca) h.buffer = { accion:'pase', t:0.30 };   // aún no es mío: lo dejo pedido
    else asignarControl(h, masCercanoLibre(h.team, h));
  }
  if(input.pulsaTiro){
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
//  GOLES, RELOJ Y FASES
// ---------------------------------------------------------------------------
function scoreGoal(team){
  m.estad.goles++;
  m.S.score[team]++; m.lastScorer=team;
  m.goalCooldown=3.2;
  m.S.phase='goal'; m.S.phaseT=0;
  emitir(m, 'GOL', { team, scorerIdx: 7 + (m.rng()*3|0) });
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
    // 5 s medidos en ticks, no en reloj de pared. La simulación sólo avisa:
    // apagar el HUD y avanzar la liga es cosa de la app, no de las reglas.
    if(m.S.phaseT > 5){ m.S.phase='cierre'; m.S.phaseT=0; emitir(m, 'CIERRE'); }
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
function stepSim(dt){
  // UN comando por asiento y por tick, SIEMPRE, corra la fase que corra. Si
  // sólo se consumieran durante el juego, la cola de un asiento crecería
  // mientras se cobra una falta y después se vaciaría de golpe.
  // El tick va como argumento: es el reloj común que alinea al cliente con el
  // servidor. Sin él, cada uno aplica la misma entrada en un momento distinto.
  for(const h of m.S.humans) h.mando = consumirComando(h, m.simTick);
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
      if(h && h.mando && (h.mando.pulsaPase || h.mando.pulsaTiro)) takeSetPiece();
    }
  }
  // temporizadores y orientación: estado autoritativo, en todas las fases
  for(let ti=0;ti<2;ti++)for(const p of m.teams[ti]) tickTimers(p, dt);
  if(m.goalCooldown>0) m.goalCooldown-=dt;
  m.simTick++;
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
      controlled:null,
      // Sólo números y una cola de comandos: un asiento tiene que poder
      // viajar por la red y volver idéntico.
      entrada: estadoEntrada(), mando: null
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

export {
  hashEstado, spawnTeams, homePos, separarJugadores, placeKickoff,
  nearestToBall, asignarControl, masCercanoLibre, asignarPosicionesIniciales, humanoDe,
  setFormation, cycleFormation, goalDirZ, updateBall, handleGoalCheck,
  teamName, startSetPiece, positionForSetPiece, takeSetPiece, inPenaltyBox,
  commitFoul, sendOff, showCard, distXZ, tryPossession,
  kickBall, doPass, isOffside, callOffside, nearestOpponentDist,
  doShoot, updateAI, enforceKickoffRule, ordenPorCercania, asignarMarcas,
  posicionDeMarca, posicionDeBloque, baseSpeed, steer, clampToField,
  aiWithBall, goalkeeper, distribuirPortero, updateHumans, updateHuman,
  canHead, header, slideTackle, scoreGoal, equipoTieneHumano,
  updatePhase, endMatch, crearHumanos, stepSim, etiquetasSlots,
};
