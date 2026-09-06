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
    this.clientes = new Map();      // clienteId -> ficha de ESTA conexión
    // Los ASIENTOS son de la CUENTA, no de la conexión. Por eso viven aparte:
    // una conexión se cae y vuelve con otro clienteId, pero el mismo userId
    // recupera su puesto. Esto es lo que hace posible la reconexión.
    this.asientos = new Map();      // userId -> { nombre, equipo, puesto, seatId, listo, desde }
    this.fase = 'lobby';            // lobby | jugando | terminada
    this.anfitrion = null;          // userId de quien manda en la sala
    this.publica = true;
    this.acumulador = 0;
    this.creadaEn = 0;              // lo pone el servidor, que sí puede mirar el reloj
    this.vaciaDesde = 0;            // para el margen de gracia antes de cerrarla
  }

  get llena(){ return this.asientos.size >= 4; }
  get vacia(){ return this.clientes.size === 0; }
  get conectados(){ return this.clientes.size; }

  /** Está esta cuenta conectada ahora mismo? */
  presente(userId){
    for(const [, c] of this.clientes) if(c.userId === userId) return true;
    return false;
  }

  /** Quién manda: el primero que entró y siga conectado. */
  revisarAnfitrion(){
    if(this.anfitrion && this.presente(this.anfitrion)) return;
    let mejor = null, desde = Infinity;
    for(const [uid, a] of this.asientos)
      if(this.presente(uid) && a.desde < desde){ desde = a.desde; mejor = uid; }
    this.anfitrion = mejor;
  }

  /** Todos los que tienen puesto y están conectados dijeron que sí. */
  get todosListos(){
    let conPuesto = 0;
    for(const [uid, a] of this.asientos){
      if(a.equipo == null) continue;
      conPuesto++;
      if(!a.listo && this.presente(uid)) return false;
    }
    return conPuesto > 0;
  }

  /**
   * Entra una cuenta. Si ya tenía asiento en esta sala lo RECUPERA: es una
   * reconexión, no una entrada nueva. Devuelve 'nuevo' o 'reconexion'.
   */
  entra(clienteId, ws, nombre, userId, ahora){
    this.clientes.set(clienteId, { ws, nombre, userId, ultimoSeq: -1 });
    const previo = this.asientos.get(userId);
    if(previo){
      previo.nombre = nombre;
      previo.ausenteDesde = 0;
      if(previo.seatId != null) this.devolverAsiento(previo.seatId);
      this.revisarAnfitrion();
      return 'reconexion';
    }
    this.asientos.set(userId, { nombre, equipo:null, puesto:null, seatId:null,
                                listo:false, desde: ahora, ausenteDesde: 0 });
    this.revisarAnfitrion();
    return 'nuevo';
  }

  /** El jugador vuelve a manos de su persona. */
  devolverAsiento(seatId){
    const h = this.m.S.humans.find(x => x.seatId === seatId);
    if(!h) return;
    h.ausente = false;
    // Se limpia primero: si por lo que sea este asiento ya figuraba como dueño
    // de alguien, asignarle otro dejaría DOS jugadores atados a una persona.
    for(const arr of this.m.teams) for(const p of arr) if(p.ownerSeat === seatId) p.ownerSeat = null;
    const arr = this.m.teams[h.team];
    const suyo = (arr[h.slot] && arr[h.slot].ownerSeat == null && !arr[h.slot].isGK)
               ? arr[h.slot]
               : arr.find(p => !p.isGK && !p.expelled && p.ownerSeat == null);
    if(suyo){ suyo.ownerSeat = seatId; h.playerId = suyo.playerId; }
  }

  /**
   * Se cae una conexión. El ASIENTO NO se borra: se marca ausente y la IA
   * retoma a ese jugador en el mismo tick. El partido no se interrumpe nunca
   * porque alguien cierre la pestaña, y quien vuelva dentro del margen
   * recupera su puesto exacto.
   */
  sale(clienteId, ahora){
    const c = this.clientes.get(clienteId);
    this.clientes.delete(clienteId);
    if(!c) return;
    const a = this.asientos.get(c.userId);
    if(a && a.seatId != null){
      const h = this.m.S.humans.find(x => x.seatId === a.seatId);
      if(h){
        // se sueltan TODOS los que figuren a su nombre, no sólo el primero
        for(const arr of this.m.teams) for(const p of arr)
          if(p.ownerSeat === h.seatId) p.ownerSeat = null;   // la IA los retoma en el acto
        h.playerId = null;
        h.ausente = true;                    // y no se le asigna ninguno más
      }
    }
    if(a) a.ausenteDesde = ahora;
    // en el lobby, irse es irse: el puesto queda libre para otro
    if(this.fase === 'lobby' && a) this.asientos.delete(c.userId);
    this.revisarAnfitrion();
    if(this.vacia) this.vaciaDesde = ahora;
  }

  /** Se olvidan los asientos de quien lleve demasiado sin volver. */
  caducar(ahora, margenMs){
    let cambios = 0;
    for(const [uid, a] of this.asientos){
      if(this.presente(uid)) continue;
      if(a.ausenteDesde && ahora - a.ausenteDesde > margenMs){ this.asientos.delete(uid); cambios++; }
    }
    if(cambios) this.revisarAnfitrion();
    return cambios;
  }

  /** Reclamar equipo y puesto. El servidor decide; el cliente sólo pide. */
  reclamarAsiento(clienteId, equipo, puesto){
    const c = this.clientes.get(clienteId);
    if(!c) return { ok: false, motivo: 'no estás en la sala' };
    if(this.fase !== 'lobby') return { ok: false, motivo: 'el partido ya empezó' };
    const mio = this.asientos.get(c.userId);
    if(!mio) return { ok: false, motivo: 'no tenés sitio en esta sala' };
    for(const [uid, o] of this.asientos)
      if(uid !== c.userId && o.equipo === equipo && o.puesto === puesto)
        return { ok: false, motivo: 'ese puesto ya está tomado' };
    mio.equipo = equipo; mio.puesto = puesto; mio.listo = false;   // cambiar de puesto des-lista
    return { ok: true };
  }

  /** Decir "estoy listo", o dejar de estarlo. */
  marcarListo(clienteId, listo){
    const c = this.clientes.get(clienteId);
    const a = c && this.asientos.get(c.userId);
    if(!a || a.equipo == null) return false;   // sin puesto no se puede estar listo
    a.listo = !!listo;
    return true;
  }

  /** El anfitrión puede echar a alguien de la sala. */
  echar(clienteId, userId){
    const c = this.clientes.get(clienteId);
    if(!c || c.userId !== this.anfitrion) return { ok:false, motivo:'sólo el anfitrión puede echar' };
    if(userId === this.anfitrion)            return { ok:false, motivo:'no podés echarte a vos' };
    if(!this.asientos.has(userId))           return { ok:false, motivo:'esa persona no está' };
    this.asientos.delete(userId);
    for(const [id, o] of this.clientes) if(o.userId === userId) return { ok:true, echado:id };
    return { ok:true, echado:null };
  }

  /** Arranca el partido: las cuentas con puesto se vuelven asientos del núcleo. */
  arrancar(clienteId){
    const quien = this.clientes.get(clienteId);
    if(!quien) return { ok:false, motivo:'no estás en la sala' };
    if(quien.userId !== this.anfitrion) return { ok:false, motivo:'sólo el anfitrión empieza el partido' };
    const conPuesto = [...this.asientos.entries()].filter(([, a]) => a.equipo != null);
    if(!conPuesto.length) return { ok:false, motivo:'nadie eligió puesto' };
    if(!this.todosListos) return { ok:false, motivo:'falta gente por decir que está lista' };

    usarPartido(this.m);
    this.m.S.homeTeam = TEAMS[0];
    this.m.S.awayTeam = TEAMS[4];
    this.m.S.humans = [];
    crearHumanos(conPuesto.length);
    conPuesto.forEach(([uid, a], i) => {
      const h = this.m.S.humans[i];
      h.team = a.equipo; h.slot = a.puesto; h.nombre = a.nombre;
      h.userId = uid;                    // el vínculo que sobrevive a la conexión
      h.ausente = !this.presente(uid);
      a.seatId = h.seatId;
    });
    spawnTeams();
    reiniciarEstad(this.m);
    placeKickoff(0);
    this.m.S.phase = 'kickoff'; this.m.S.phaseT = 0;
    this.m.S.running = true;
    this.fase = 'jugando';
    this.acumulador = 0;
    return { ok:true };
  }

  /** Un comando de un cliente va a la cola de SU asiento y de ningún otro. */
  comando(clienteId, cmd){
    const c = this.clientes.get(clienteId);
    if(!c || this.fase !== 'jugando') return;
    const a = this.asientos.get(c.userId);
    if(!a || a.seatId == null) return;
    const h = this.m.S.humans.find(x => x.seatId === a.seatId);
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
    for(const [, a] of this.asientos) if(a.seatId != null){
      const h = this.m.S.humans.find(x => x.seatId === a.seatId);
      ack[a.seatId] = h ? h.entrada.ultimoSeq : -1;
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
