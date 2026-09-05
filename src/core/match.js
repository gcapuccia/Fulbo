// UN PARTIDO = UN OBJETO.
//
// Hasta ahora el estado del partido eran variables sueltas de módulo: había
// exactamente UN partido posible por proceso. Un servidor con salas necesita
// varios a la vez, cada uno con su marcador, sus jugadores y su azar.
//
// `crearPartido()` devuelve todo eso en un objeto independiente. Las funciones
// del núcleo trabajan sobre el partido ACTIVO, que se fija con `usarPartido()`
// antes de cada tick. No es reentrante a propósito: un servidor procesa el tick
// de la sala A entero y después el de la B, nunca entrelazados.
import { Vec3 } from './math.js';
import { mulberry32 } from './rng.js';
import { BALL_R } from '../config/field.js';
import { TEAMS } from '../config/teams.js';

export function crearPartido({ semilla = 12345, local = TEAMS[0], visitante = TEAMS[4],
                               dificultad = 'normal', duracion = 120,
                               formaciones = ['4-3-3','4-4-2'], calidad = 'alta' } = {}){
  return {
    // --- configuración y marcha del partido ---
    S: {
      quality: calidad, difficulty: dificultad, halfLen: duracion,
      formation: [...formaciones],
      kickTeam: 0, kickoffTaken: true, faltaPendiente: null,
      numHumanos: 1, humans: [],
      homeTeam: local, awayTeam: visitante,
      running: false, paused: false,
      score: [0, 0], clock: 0, half: 1,
      phase: 'menu', phaseT: 0,
      possession: 0, _owner: null,
      setPiece: null, camSnap: false,
    },

    // --- entidades ---
    teams: [[], []],
    names: [[], []],
    bola: { pos: new Vec3(0, BALL_R, 0), vel: new Vec3(), spin: new Vec3(),
            r: BALL_R, kickLock: 0 },
    cards: [{ a: 0, r: 0 }, { a: 0, r: 0 }],

    // --- estado suelto que antes vivía en globales ---
    lastTouch: -1,
    goalCooldown: 0,
    lastScorer: null,
    offsidePend: null,
    passReceiver: null,

    // --- bucle ---
    simTick: 0,
    acumulador: 0,

    // --- azar PROPIO: dos partidos con la misma semilla son idénticos,
    //     y dos partidos distintos no se pisan la secuencia ---
    semilla,
    _gen: mulberry32(semilla),
    rng(){ return this._gen(); },
    sembrar(n){ this.semilla = n >>> 0; this._gen = mulberry32(this.semilla); return this.semilla; },

    // --- estadísticas para afinar el balance ---
    estad: { tiros: 0, cabezazos: 0, despejesPortero: 0, goles: 0, ticksConDueno: 0 },
  };
}

export function reiniciarEstad(m){ for(const k in m.estad) m.estad[k] = 0; }
