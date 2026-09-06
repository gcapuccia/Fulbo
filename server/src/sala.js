// UNA SALA = UN MINI SERVIDOR.
//
// `class Sala { constructor(){ this.m = crearPartido(...) } }` — esa línea es
// toda la arquitectura de servidor de FÚLBO, y sólo fue posible después de
// que un partido pasara a ser un objeto independiente y el núcleo dejara de
// importar Three. Aquí no hay ni una regla de fútbol: están todas en
// ../../src/core/sim.js, exactamente las mismas que corren en tu navegador.
import { crearPartido, reiniciarEstad } from '../../src/core/match.js';
import { usarPartido, spawnTeams, placeKickoff, stepSim,
         crearHumanos, hashEstado }     from '../../src/core/sim.js';
import { drenarEventos }                from '../../src/core/events.js';
import { encolarComando }               from '../../src/core/input.js';
import { tomarSnapshot }                from '../../src/core/snapshot.js';
import { TEAMS }                        from '../../src/config/teams.js';
import { DT, MAX_PASOS }                from '../../src/config/rules.js';

export class Sala {
  constructor(codigo, semilla){
    this.codigo = codigo;
    this.semilla = semilla;
    this.m = crearPartido({ semilla });
    this.clientes = new Map();      // clienteId -> { ws, nombre, seatId, listo }
    this.fase = 'lobby';            // lobby | jugando | terminada
    this.acumulador = 0;
    this.ultimoTick = 0;
    this.creadaEn = 0;              // lo pone el servidor, que sí puede mirar el reloj
  }

  get llena(){ return this.clientes.size >= 4; }
  get vacia(){ return this.clientes.size === 0; }

  entra(clienteId, ws, nombre){
    this.clientes.set(clienteId, { ws, nombre, seatId: null, listo: false, ultimoSeq: -1 });
  }

  sale(clienteId){
    const c = this.clientes.get(clienteId);
    // Si estaba jugando, su jugador NO se congela: se le suelta el asiento y
    // la IA lo retoma en el mismo tick, sin que se note. El partido no se
    // interrumpe nunca porque alguien cierre la pestaña.
    if(c && c.seatId != null){
      const h = this.m.S.humans.find(x => x.seatId === c.seatId);
      if(h){
        const p = this.m.teams[h.team].find(j => j.ownerSeat === h.seatId);
        if(p) p.ownerSeat = null;
        h.playerId = null;
        h.libre = true;                      // reclamable si vuelve
      }
    }
    this.clientes.delete(clienteId);
  }

  /** Reclamar equipo y puesto. El servidor decide; el cliente sólo pide. */
  reclamarAsiento(clienteId, equipo, puesto){
    const c = this.clientes.get(clienteId);
    if(!c) return { ok: false, motivo: 'no estás en la sala' };
    if(this.fase !== 'lobby') return { ok: false, motivo: 'el partido ya empezó' };
    for(const [id, o] of this.clientes)
      if(id !== clienteId && o.equipo === equipo && o.puesto === puesto)
        return { ok: false, motivo: 'ese puesto ya está tomado' };
    c.equipo = equipo; c.puesto = puesto;
    return { ok: true };
  }

  /** Arranca el partido: los clientes con puesto se vuelven asientos. */
  arrancar(){
    const conPuesto = [...this.clientes.entries()].filter(([, c]) => c.equipo != null);
    if(!conPuesto.length) return false;

    usarPartido(this.m);
    this.m.S.homeTeam = TEAMS[0];
    this.m.S.awayTeam = TEAMS[4];
    this.m.S.humans = [];
    crearHumanos(conPuesto.length);
    conPuesto.forEach(([id, c], i) => {
      const h = this.m.S.humans[i];
      h.team = c.equipo; h.slot = c.puesto; h.nombre = c.nombre;
      h.controllerId = id;               // en local era el dispositivo; aquí, la persona
      c.seatId = h.seatId;
    });
    spawnTeams();
    reiniciarEstad(this.m);
    placeKickoff(0);
    this.m.S.phase = 'kickoff'; this.m.S.phaseT = 0;
    this.m.S.running = true;
    this.fase = 'jugando';
    this.acumulador = 0;
    return true;
  }

  /** Un comando de un cliente va a la cola de SU asiento y de ningún otro. */
  comando(clienteId, cmd){
    const c = this.clientes.get(clienteId);
    if(!c || c.seatId == null || this.fase !== 'jugando') return;
    const h = this.m.S.humans.find(x => x.seatId === c.seatId);
    if(!h) return;
    // Saneado: un cliente hostil puede mandar cualquier cosa.
    const mx = Math.max(-1, Math.min(1, +cmd.mx || 0));
    const mz = Math.max(-1, Math.min(1, +cmd.mz || 0));
    const len = Math.hypot(mx, mz);
    encolarComando(h, {
      seq: +cmd.seq || 0, tick: +cmd.tick || 0,
      mx: len > 1 ? mx/len : mx, mz: len > 1 ? mz/len : mz,
      buttons: (+cmd.buttons || 0) & 15,
    });
    c.ultimoSeq = +cmd.seq || 0;
  }

  /**
   * Avanza la sala con el tiempo REAL transcurrido. Es la trampa que señala
   * el plan: `setInterval(…, 1000/60)` en Node se desvía entre 1 y 16 ms, así
   * que pasar 1/60 fijo hace que la física del servidor se separe de la del
   * cliente desde el primer tick. Se acumula lo que pasó de verdad y se dan
   * pasos enteros de DT, igual que en el navegador.
   */
  avanzar(dtReal){
    if(this.fase !== 'jugando') return null;
    usarPartido(this.m);
    this.acumulador += dtReal;
    let pasos = 0;
    while(this.acumulador >= DT && pasos < MAX_PASOS){
      stepSim(DT); this.acumulador -= DT; pasos++;
    }
    if(pasos === MAX_PASOS) this.acumulador = 0;   // se descarta el atraso
    return pasos;
  }

  /** Lo que ven los clientes. Sólo números. */
  snapshot(){
    const s = tomarSnapshot(this.m.teams, this.m.bola);
    const ack = {};
    for(const [, c] of this.clientes) if(c.seatId != null){
      const h = this.m.S.humans.find(x => x.seatId === c.seatId);
      ack[c.seatId] = h ? h.entrada.ultimoSeq : -1;
    }
    return {
      tick: this.m.simTick, b: s.b, j: s.j, ack,
      marcador: this.m.S.score.slice(),
      reloj: Math.round(this.m.S.clock * 10) / 10,
      mitad: this.m.S.half,
      fase: this.m.S.phase,
      duenos: this.m.teams.flat().filter(p => p.ownerSeat != null)
                  .map(p => [p.playerId, p.ownerSeat]),
    };
  }

  eventos(){ return drenarEventos(this.m); }
  hash(){ usarPartido(this.m); return hashEstado(); }
}
