// PREDICCIÓN Y ROLLBACK — la Fase 9.
//
// Hasta ahora el cliente dibujaba lo que el servidor le mandaba, con 100 ms de
// retraso. Se veía bien pero se sentía mal: apretabas y tu jugador arrancaba
// un RTT después.
//
// La solución NO es "predecí tu jugador e interpolá el resto". En un juego de
// fútbol eso se hunde, y con los números de este código se ve por qué:
// `tryPossession` pega el balón a los pies del que lo lleva con un toque de
// hasta 1.05 m. Si predecís tu cuerpo pero el balón lo interpolás desde
// instantáneas viejas, a velocidad de sprint (~9 m/s) y con medio RTT más el
// búfer, el balón se dibuja más de un metro por detrás de tus pies: ves a tu
// jugador corriendo SIN pelota. Y la disputa se decide por proximidad entre
// los 22, así que estarías peleando contra un mundo de hace 100 ms.
//
// Lo que se hace aquí es ROLLBACK DEL PARTIDO ENTERO:
//
//   1. El cliente simula el partido COMPLETO, igual que el servidor, y va por
//      delante de él lo justo para que sus entradas lleguen a tiempo.
//   2. Guarda cada comando que manda, con el tick en que lo aplicó.
//   3. Cuando llega el estado autoritativo, RESTAURA ese instante exacto
//      —incluido el estado del azar— y REPITE la historia desde ahí hasta su
//      presente, reaplicando sus comandos sin confirmar y repitiendo la última
//      entrada conocida de los demás.
//
// El balón va pegado a tus pies porque lo simulás vos también. El cambio
// automático de jugador al recuperar la pelota se predice, porque
// `asignarControl` forma parte del `stepSim` que estás repitiendo. Y todo esto
// sólo es posible porque la simulación es determinista y el estado del azar
// vive dentro del partido — por eso esas dos cosas se hicieron primero.
import { restaurar }      from '../core/instantanea.js';
import { encolarComando } from '../core/input.js';
import { DT }             from '../config/rules.js';

const MIN_ADELANTO = 3, MAX_ADELANTO = 20;
const TOLERANCIA   = 2;        // ticks de desfase que se dejan pasar sin tocar nada
const SUAVE_MAX    = 2.0;      // más de dos metros de error no se disimula: se acepta

export function crearPrediccion({ partido, usar, paso }){
  let tickLocal = 0;
  let arrancado = false;
  let miSeat = null;
  let remotas = {};                       // seatId -> [mx, mz, buttons, seq]
  const historial = [];                   // comandos propios, con su tick

  const medidas = {
    resimulaciones: 0, pasosResimulados: 0, ultimosPasos: 0,
    msUltima: 0, msPico: 0, adelanto: 0, correccionM: 0, saltos: 0,
  };

  /** Mete en las colas lo que corresponde a ESTE tick y da un paso. */
  function unPaso(tick){
    if(miSeat != null){
      const mio = historial.find(c => c.tick === tick);
      const h = partido.S.humans.find(x => x.seatId === miSeat);
      if(h && mio) encolarComando(h, mio);
    }
    // Para los demás se repite su última entrada conocida: es la mejor apuesta
    // que hay. Si soltaron la tecla hace 80 ms, se corrige en el próximo
    // estado autoritativo y no se nota.
    for(const h of partido.S.humans){
      if(h.seatId === miSeat) continue;
      const r = remotas[h.seatId];
      if(r) encolarComando(h, { seq: r[3], tick, mx: r[0], mz: r[1], buttons: r[2] });
    }
    paso(DT);
    return tick + 1;
  }

  return {
    get tick(){ return tickLocal; },
    get listo(){ return arrancado; },
    medidas,

    fijarAsiento(seatId){ miSeat = seatId; },

    /** El cliente guarda cada comando que manda, para poder repetirlo. */
    registrar(cmd){
      historial.push({ ...cmd, tick: tickLocal });
      if(historial.length > 400) historial.shift();
      return tickLocal;
    },

    /** Avance normal, sin corrección: un tick de simulación local. */
    avanzar(){
      if(!arrancado) return false;
      usar(partido);
      tickLocal = unPaso(tickLocal);
      return true;
    },

    /**
     * Llega la verdad del servidor. Se vuelve al instante que manda y se
     * repite la historia hasta el presente del cliente.
     */
    aplicar(msg, ping){
      const inst = msg.inst;
      if(!inst) return;
      usar(partido);
      remotas = msg.entradas || {};

      // Dónde debería estar el cliente: por delante del servidor lo justo para
      // que sus comandos lleguen antes de que ese tick se simule allá.
      const adelanto = Math.max(MIN_ADELANTO, Math.min(MAX_ADELANTO,
        Math.ceil(((ping || 0) / 2 + 60) / (DT * 1000))));
      medidas.adelanto = adelanto;

      if(!arrancado){
        restaurar(partido, inst);
        tickLocal = inst.tick + adelanto;
        arrancado = true;
        // se corre de golpe hasta el presente estimado
        let t = inst.tick;
        while(t < tickLocal) t = unPaso(t);
        return;
      }

      // Dónde estaba mi jugador ANTES de aceptar la verdad: sirve para medir
      // cuánto se equivocó la predicción.
      const mio = miSeat != null
        ? partido.teams.flat().find(p => p.ownerSeat === miSeat) : null;
      const antes = mio ? { x: mio.pos.x, z: mio.pos.z } : null;

      // Dónde estaba dibujado CADA jugador antes de aceptar la verdad. La
      // resimulación acierta el 95 % de las veces al centímetro, pero cuando
      // falla lo hace de golpe: sin esto, esa corrección sería un salto de un
      // fotograma. Se guarda la diferencia y la vista la va cerrando en unas
      // décimas — el estado es el del servidor desde el primer instante; lo
      // único que se disimula es el dibujo.
      const dibujados = new Map();
      for(const arr of partido.teams) for(const p of arr)
        dibujados.set(p.playerId, [p.pos.x, p.pos.z]);

      const t0 = performance.now();
      restaurar(partido, inst);

      // Se olvidan los comandos que el servidor ya procesó.
      const yo = partido.S.humans.find(x => x.seatId === miSeat);
      const ack = yo ? yo.entrada.ultimoSeq : -1;
      while(historial.length && historial[0].seq <= ack) historial.shift();

      // Si el desfase se fue de madre, se reengancha en vez de resimular medio
      // segundo (lo que costaría más que el error que corrige).
      const objetivo = inst.tick + adelanto;
      if(Math.abs(tickLocal - objetivo) > TOLERANCIA){ tickLocal = objetivo; medidas.saltos++; }

      let t = inst.tick, pasos = 0;
      while(t < tickLocal && pasos < 40){ t = unPaso(t); pasos++; }
      tickLocal = t;

      // el desvío de cada uno pasa a ser un error VISUAL que se cierra solo
      for(const arr of partido.teams) for(const p of arr){
        const d = dibujados.get(p.playerId);
        if(!d) continue;
        const ex = d[0] - p.pos.x, ez = d[1] - p.pos.z;
        if(Math.hypot(ex, ez) > SUAVE_MAX){ p.errVis = null; continue; }
        p.errVis = { x: ex, z: ez };
      }

      const ms = performance.now() - t0;
      medidas.resimulaciones++;
      medidas.pasosResimulados += pasos;
      medidas.ultimosPasos = pasos;
      medidas.msUltima = ms;
      if(ms > medidas.msPico) medidas.msPico = ms;

      // Error de predicción: cuánto se movió mi jugador al aceptar la verdad.
      // Si es pequeño, no hay salto visible porque ya está resimulado.
      const despues = miSeat != null
        ? partido.teams.flat().find(p => p.ownerSeat === miSeat) : null;
      if(antes && despues)
        medidas.correccionM = Math.hypot(despues.pos.x - antes.x, despues.pos.z - antes.z);
    },

    reiniciar(){
      arrancado = false; tickLocal = 0; historial.length = 0; remotas = {};
      medidas.resimulaciones = 0; medidas.pasosResimulados = 0; medidas.saltos = 0;
      medidas.msPico = 0; medidas.correccionM = 0;
    },
  };
}
