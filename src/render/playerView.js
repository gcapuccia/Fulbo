// Animación del jugador: SÓLO VISTA. Lee el estado y mueve las mallas.
//
// Nada de lo que hay aquí puede influir en el resultado del partido: si algo
// de esto desapareciera, la simulación daría exactamente el mismo marcador.
// `runPhase` vive en el jugador pero sólo lo toca este archivo (es la fase del
// ciclo de zancada) y por eso NO entra en el hash de estado ni en el snapshot.
// Lo mismo vale para el temporizador de patada, que ni siquiera vive en el
// jugador: se guarda aquí, en un mapa propio de la vista.

import { suavizado } from '../core/rng.js';

const DUR_PATADA = 0.36;              // lo que dura el gesto completo, en segundos
const patadas = new Map();            // playerId -> segundos que le quedan al gesto

/**
 * El bucle de render pasa por aquí los eventos del tick antes de presentarlos.
 * El núcleo ya emitía 'PATADA'; ahora dice además QUIÉN pegó, y con eso la
 * vista enciende el gesto. Si nadie llamara a esto, el partido sería idéntico.
 */
export function anotarPatadas(eventos){
  for(const e of eventos){
    if(e.tipo === 'PATADA' && e.playerId != null) patadas.set(e.playerId, DUR_PATADA);
  }
  return eventos;                     // se devuelve para encadenar con presentar()
}
export function reiniciarPatadas(){ patadas.clear(); }

// Curva de la pierna que golpea. `u` va de 0 (empieza) a 1 (termina) y el
// resultado es la rotación del muslo: negativo atrás, positivo adelante.
// Arma hacia atrás, cruza rápido en el impacto y acompaña al soltar.
function curvaPatada(u){
  if(u < 0.30) return -1.05 * (u / 0.30);                    // armado
  if(u < 0.52) return -1.05 + 2.45 * ((u - 0.30) / 0.22);    // golpeo
  return 1.40 * (1 - (u - 0.52) / 0.48);                     // acompañamiento
}

const lim = (v, a, b) => v < a ? a : (v > b ? b : v);

/**
 * Sincroniza las mallas de un jugador con su estado.
 * `pose` opcional: si viene (repetición de gol), se dibuja ESA posición en vez
 * de la del partido, sin tocar el estado autoritativo.
 * `mirarA` opcional: punto al que gira la cabeza (el balón).
 */
export function syncPlayerView(p, dt, pose, mirarA){
  const x = pose ? pose.x : p.pos.x;
  const z = pose ? pose.z : p.pos.z;
  const facing = pose ? pose.facing : p.facing;
  // en la repetición la cadencia sale del desplazamiento dibujado, no de p.vel
  const speed = pose
    ? Math.hypot(x - p.mesh.position.x, z - p.mesh.position.z) / Math.max(dt, 1e-4)
    : p.vel.length();
  p.mesh.rotation.y = facing;
  p.mesh.position.set(x, 0, z);

  // temporizador del gesto de patada: se consume aquí y en ningún otro sitio
  let patada = patadas.get(p.playerId) || 0;
  if(patada > 0){
    patada -= dt;
    if(patada > 0) patadas.set(p.playerId, patada);
    else { patadas.delete(p.playerId); patada = 0; }
  }

  // el cansancio acorta la zancada: un jugador fundido se nota al correr
  const fuelle = 0.80 + 0.20 * (p.stamina !== undefined ? p.stamina : 1);
  // 1 = parado, 0 = en movimiento. Sirve para la respiración y el balanceo.
  const quieto = Math.max(0, 1 - speed * 0.9);

  // ciclo de carrera: la cadencia sube con la velocidad
  const cadence = Math.min(speed*1.1, 14);
  p.runPhase += dt*(4+cadence);
  // parado la zancada es CERO: antes quedaba un resto de 0.2 y parecía que
  // marchaban en el sitio incluso esperando un córner.
  const sw = Math.sin(p.runPhase) * Math.min(speed*0.075, 0.9) * fuelle;
  const resp = Math.sin(p.runPhase*0.55) * quieto;       // respiración
  p.lLeg.rotation.x = sw;  p.rLeg.rotation.x = -sw;
  p.lKnee.rotation.x = Math.max(0,-sw)*1.2;  p.rKnee.rotation.x = Math.max(0,sw)*1.2;
  p.lArm.rotation.x = -sw*0.8;  p.rArm.rotation.x = sw*0.8;
  p.lArm.rotation.z = 0;  p.rArm.rotation.z = 0;
  const flex = 0.5 + Math.abs(sw)*0.7;       // codos algo flexionados siempre
  p.lCodo.rotation.x = -flex;  p.rCodo.rotation.x = -flex;
  p.torso.position.y = 1.66 + Math.abs(Math.sin(p.runPhase))*Math.min(speed*0.02, 0.12)
                     + resp*0.014;           // el pecho sube y baja al respirar
  p.torso.rotation.y = -sw*0.18;             // los hombros acompañan al braceo

  // --- GOLPEO: pisa el ciclo de carrera mientras dura ---
  let inclinaPatada = 0;
  if(patada > 0 && p.sliding <= 0 && p.stunTimer <= 0){
    const g = curvaPatada(1 - patada/DUR_PATADA);
    const zurdo = (p.num % 3) === 0;         // uno de cada tres pega con la izquierda
    const pie      = zurdo ? p.lLeg  : p.rLeg;
    const rodilla  = zurdo ? p.lKnee : p.rKnee;
    const apoyo    = zurdo ? p.rLeg  : p.lLeg;
    const rApoyo   = zurdo ? p.rKnee : p.lKnee;
    const brazoC   = zurdo ? p.rArm  : p.lArm;   // el brazo contrario equilibra
    const brazoM   = zurdo ? p.lArm  : p.rArm;
    pie.rotation.x = g;
    rodilla.rotation.x = Math.max(0, 0.95 - Math.max(0, g)*1.20);  // se estira al impactar
    apoyo.rotation.x = -0.18;  rApoyo.rotation.x = 0.32;           // pierna de apoyo flexionada
    brazoC.rotation.x = -g*0.55;  brazoC.rotation.z = (zurdo ? -1 : 1) * Math.abs(g)*0.40;
    brazoM.rotation.x =  g*0.28;
    p.torso.rotation.y = (zurdo ? 1 : -1) * g * 0.24;              // el torso rota con el disparo
    inclinaPatada = -g*0.10;                                        // se echa atrás al soltar
  }

  // pose según el estado (los temporizadores los baja el núcleo, aquí sólo se leen)
  if(p.sliding > 0){
    p.cuerpo.rotation.set(-1.42, 0, 0);      // tumbado SOBRE el césped
    p.cuerpo.position.set(0, 0.42, -0.30);
    p.lLeg.rotation.x = 0.85; p.rLeg.rotation.x = -0.30;
    p.lArm.rotation.x = -0.9; p.rArm.rotation.x = -0.5;
  } else if(p.stunTimer > 0){
    p.cuerpo.rotation.set(-1.52, 0, 0);      // en el suelo tras la falta
    p.cuerpo.position.set(0, 0.46, -0.34);
    p.lArm.rotation.x = -1.1; p.rArm.rotation.x = -0.8;
  } else {
    // al correr el cuerpo se echa hacia adelante; cuanto más rápido, más
    const inclina = Math.min(speed*0.030, 0.24) + inclinaPatada;
    p.cuerpo.rotation.set(p.heading > 0 ? -0.45 : inclina, 0, resp*0.022);
    p.cuerpo.position.set(0, 0, 0);
  }

  // la cabeza sigue al balón: es lo que más "despierta" a un jugador parado
  if(p.cabeza){
    let ry = 0, rx = 0;
    if(mirarA && p.stunTimer <= 0 && p.sliding <= 0){
      let a = Math.atan2(mirarA.x - x, mirarA.z - z) - facing;
      while(a >  Math.PI) a -= Math.PI*2;
      while(a < -Math.PI) a += Math.PI*2;
      ry = lim(a, -0.95, 0.95);
      const d = Math.max(Math.hypot(mirarA.x - x, mirarA.z - z), 2);
      rx = lim(-((mirarA.y || 0) - 1.7) / d, -0.45, 0.30);
    }
    const k = suavizado(0.22, dt);
    p.cabeza.rotation.y += (ry - p.cabeza.rotation.y) * k;
    p.cabeza.rotation.x += (rx - p.cabeza.rotation.x) * k;
  }
}
