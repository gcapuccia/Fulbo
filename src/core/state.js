// Estado compartido del partido.
//
// A diferencia de las globales de G.js, todo esto son objetos y arrays
// CONSTANTES que se mutan por dentro (S.clock = ..., teams[0] = [...]), así
// que sí se pueden importar directamente: el binding nunca se reasigna.
//
// En la Fase 4 esto se convierte en createWorld(): una instancia por partido,
// que es lo que permite que un servidor tenga varias salas a la vez.
import { TEAMS } from '../config/teams.js';
import { BALL_R } from '../config/field.js';
import { Vec3 } from './math.js';

export const S = {
  quality:'alta', difficulty:'normal', halfLen:120, // segundos por tiempo
  formation:['4-3-3','4-4-2'],   // [tu equipo, rival]
  kickTeam:0, kickoffTaken:true, faltaPendiente:null,
  numHumanos:1, humans:[],
  homeTeam:TEAMS[0], awayTeam:TEAMS[4],
  running:false, paused:false,
  score:[0,0], clock:0, half:1,
  phase:'menu',  // menu | kickoff | play | goal | half | full
  phaseT:0,
  possession:0,  // equipo con el balón (0 local / 1 visita) o -1
  controlled:null,
};

export const teams = [[],[]]; // arrays de Player
export const names=[[],[]];

export const cards = [{a:0,r:0},{a:0,r:0}];   // amarillas/rojas por equipo

// Contadores para afinar el balance con datos, no con impresiones.
export const estad = { tiros:0, cabezazos:0, despejesPortero:0, goles:0, ticksConDueno:0 };
export function resetEstad(){ for(const k in estad) estad[k]=0; }

// El balón, como DATOS. Antes su posición autoritativa era la de un THREE.Mesh,
// lo que hacía imposible simular un partido en Node. Ahora la malla es sólo
// una vista que sigue a este objeto.
export const bola = { pos:new Vec3(0,BALL_R,0), vel:new Vec3(), spin:new Vec3(),
                      r:BALL_R, kickLock:0 };
