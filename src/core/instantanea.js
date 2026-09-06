// INSTANTÁNEA COMPLETA — la que sirve para RESIMULAR, no sólo para dibujar.
//
// `snapshot.js` guarda lo que se VE: dónde está cada jugador y el balón. Sirve
// para la repetición del gol y para que un espectador dibuje el partido, y no
// sirve para nada más.
//
// Esto guarda lo que `stepSim` LEE, que es bastante más: velocidades, energía,
// temporizadores de aturdimiento y barrida, quién controla a quién, el último
// que tocó, el fuera de juego pendiente, la fase y su reloj, las tarjetas, la
// cola de entradas de cada asiento y —lo que casi siempre se olvida— EL ESTADO
// DEL AZAR. Sin él, resimular un tiro con dispersión aleatoria daría un
// resultado distinto al del servidor y la corrección nunca convergería.
//
// Todo son números, cadenas y arrays: pasa por JSON.stringify tal cual.
//
// Al RESTAURAR se mutan los objetos que ya existen en vez de crear otros
// nuevos: en el cliente cada jugador lleva su malla de Three colgada, y
// reemplazarlo dejaría el campo lleno de cuerpos huérfanos.
import { FORMACIONES, FORMATION } from '../config/formations.js';

const idDe = p => (p && p.playerId != null) ? p.playerId : null;

function buscar(teams, playerId){
  if(playerId == null) return null;
  for(const arr of teams) for(const p of arr) if(p.playerId === playerId) return p;
  return null;
}

/** Copia todo lo que la simulación necesita para continuar desde aquí. */
export function capturar(m){
  const equipos = m.teams.map((arr, ti) => {
    const forma = FORMACIONES[m.S.formation[ti]] || FORMATION;
    return arr.map(p => [
      p.playerId, p.team, p.num, p.role, p.isGK ? 1 : 0,
      p.pos.x, p.pos.y, p.pos.z, p.vel.x, p.vel.y, p.vel.z,
      p.facing, p.stamina, p.stunTimer, p.slideCd, p.sliding, p.heading,
      p.holdTimer, p.yellow, p.expelled ? 1 : 0,
      p.ownerSeat == null ? -1 : p.ownerSeat,
      p.sprinting ? 1 : 0,
      forma.indexOf(p.formation),        // referencia -> índice
    ]);
  });

  const asientos = m.S.humans.map(h => ({
    seatId: h.seatId, team: h.team, slot: h.slot, playerId: h.playerId,
    ausente: !!h.ausente,
    buffer: h.buffer ? { accion: h.buffer.accion, t: h.buffer.t } : null,
    entrada: {
      mx: h.entrada.mx, mz: h.entrada.mz,
      buttons: h.entrada.buttons, prevButtons: h.entrada.prevButtons,
      ultimoSeq: h.entrada.ultimoSeq,
    },
  }));

  const sp = m.S.setPiece;
  return {
    tick: m.simTick,
    azar: m.azar,
    bola: [m.bola.pos.x, m.bola.pos.y, m.bola.pos.z,
           m.bola.vel.x, m.bola.vel.y, m.bola.vel.z,
           m.bola.spin.x, m.bola.spin.y, m.bola.spin.z, m.bola.kickLock],
    equipos,
    asientos,
    S: {
      score: m.S.score.slice(), clock: m.S.clock, half: m.S.half,
      phase: m.S.phase, phaseT: m.S.phaseT,
      possession: m.S.possession, owner: idDe(m.S._owner),
      kickTeam: m.S.kickTeam, kickoffTaken: !!m.S.kickoffTaken,
      formation: m.S.formation.slice(),
      camSnap: !!m.S.camSnap,
      setPiece: sp ? { type: sp.type, team: sp.team, taker: idDe(sp.taker),
                       x: sp.x, z: sp.z, taken: !!sp.taken } : null,
      faltaPendiente: m.S.faltaPendiente ? { ...m.S.faltaPendiente } : null,
    },
    cards: m.cards.map(c => ({ a: c.a, r: c.r })),
    lastTouch: m.lastTouch,
    goalCooldown: m.goalCooldown,
    lastScorer: m.lastScorer,
    offsidePend: idDe(m.offsidePend),
    passReceiver: idDe(m.passReceiver),
  };
}

/** Deja el partido exactamente en el instante capturado. */
export function restaurar(m, inst){
  m.simTick = inst.tick;
  m.azar = inst.azar;

  const b = inst.bola;
  m.bola.pos.set(b[0], b[1], b[2]);
  m.bola.vel.set(b[3], b[4], b[5]);
  m.bola.spin.set(b[6], b[7], b[8]);
  m.bola.kickLock = b[9];

  // Índice de los jugadores que ya existen, por identificador: se reutilizan
  // para no perder las mallas que llevan colgadas.
  const porId = new Map();
  for(const arr of m.teams) for(const p of arr) porId.set(p.playerId, p);

  m.S.formation = inst.S.formation.slice();
  inst.equipos.forEach((lista, ti) => {
    const forma = FORMACIONES[m.S.formation[ti]] || FORMATION;
    const nuevos = [];
    for(const d of lista){
      const p = porId.get(d[0]);
      if(!p) continue;                       // no existe aquí: se ignora
      p.team = d[1]; p.num = d[2]; p.role = d[3]; p.isGK = !!d[4];
      p.pos.set(d[5], d[6], d[7]);
      p.vel.set(d[8], d[9], d[10]);
      p.facing = d[11]; p.stamina = d[12]; p.stunTimer = d[13];
      p.slideCd = d[14]; p.sliding = d[15]; p.heading = d[16];
      p.holdTimer = d[17]; p.yellow = d[18]; p.expelled = !!d[19];
      p.ownerSeat = d[20] < 0 ? null : d[20];
      p.sprinting = !!d[21];
      p.formation = forma[d[22]] || p.formation;
      nuevos.push(p);
    }
    // El ORDEN importa: `ordenPorCercania` desempata por posición en el array,
    // así que dos réplicas con los mismos jugadores en distinto orden podrían
    // elegir presionadores distintos y divergir.
    m.teams[ti].length = 0;
    m.teams[ti].push(...nuevos);
  });

  for(const a of inst.asientos){
    let h = m.S.humans.find(x => x.seatId === a.seatId);
    if(!h) continue;
    h.team = a.team; h.slot = a.slot; h.playerId = a.playerId;
    h.ausente = a.ausente;
    h.buffer = a.buffer ? { accion: a.buffer.accion, t: a.buffer.t } : null;
    h.entrada.mx = a.entrada.mx; h.entrada.mz = a.entrada.mz;
    h.entrada.buttons = a.entrada.buttons;
    h.entrada.prevButtons = a.entrada.prevButtons;
    h.entrada.ultimoSeq = a.entrada.ultimoSeq;
    h.entrada.cola.length = 0;              // la cola la vuelve a llenar quien predice
    h.mando = null;
  }

  const S = inst.S;
  m.S.score = S.score.slice(); m.S.clock = S.clock; m.S.half = S.half;
  m.S.phase = S.phase; m.S.phaseT = S.phaseT;
  m.S.possession = S.possession;
  m.S._owner = buscar(m.teams, S.owner);
  m.S.kickTeam = S.kickTeam; m.S.kickoffTaken = S.kickoffTaken;
  m.S.camSnap = S.camSnap;
  m.S.setPiece = S.setPiece
    ? { type: S.setPiece.type, team: S.setPiece.team, x: S.setPiece.x, z: S.setPiece.z,
        taken: S.setPiece.taken, taker: buscar(m.teams, S.setPiece.taker) }
    : null;
  m.S.faltaPendiente = S.faltaPendiente ? { ...S.faltaPendiente } : null;

  m.cards = inst.cards.map(c => ({ a: c.a, r: c.r }));
  m.lastTouch = inst.lastTouch;
  m.goalCooldown = inst.goalCooldown;
  m.lastScorer = inst.lastScorer;
  m.offsidePend = buscar(m.teams, inst.offsidePend);
  m.passReceiver = buscar(m.teams, inst.passReceiver);
  return m;
}
