// ¿FUNCIONA LA PREDICCIÓN? Medida honesta, sin navegador.
//
// Monta un servidor y un cliente de verdad —dos partidos independientes en el
// mismo proceso— y les pone latencia entre medias. El cliente predice: aplica
// sus entradas al instante y, cuando le llega el estado autoritativo, vuelve a
// ese instante y repite la historia.
//
// Lo que se mide es EL ERROR DE PREDICCIÓN: cuánto se mueve tu jugador en el
// momento de aceptar la verdad del servidor. Si es pequeño no hay salto
// visible; si es grande, la pantalla pega tirones y el netcode no sirve.
//
//   node scripts/rollback-bench.mjs           120 ms de ida y vuelta
//   node scripts/rollback-bench.mjs 250 30    250 ms y 30 s de partido
import { crearPartido, reiniciarEstad } from '../src/core/match.js';
import { usarPartido, spawnTeams, placeKickoff, stepSim,
         crearHumanos, hashEstado }     from '../src/core/sim.js';
import { capturar, restaurar }          from '../src/core/instantanea.js';
import { encolarComando, BTN }          from '../src/core/input.js';
import { DT }                           from '../src/config/rules.js';

const RTT      = Number(process.argv[2] || 120);        // ms de ida y vuelta
const SEGUNDOS = Number(process.argv[3] || 20);
const SEMILLA  = 4242;
const HZ_ESTADO = 20;
const CADA      = 60 / HZ_ESTADO;                        // un estado cada 3 ticks
const RETARDO   = Math.max(1, Math.round((RTT / 2) / (DT * 1000)));  // en ticks, por sentido
const ADELANTO  = Math.max(3, Math.ceil((RTT / 2 + 60) / (DT * 1000)));

function nuevoPartido(){
  const p = usarPartido(crearPartido({ semilla: SEMILLA }));
  p.S.humans = [];
  crearHumanos(1);
  p.S.humans[0].team = 0; p.S.humans[0].slot = 9;
  spawnTeams();
  reiniciarEstad(p);
  placeKickoff(0);
  p.S.phase = 'kickoff'; p.S.phaseT = 0;
  const j = p.teams[0][9];
  j.ownerSeat = 0; p.S.humans[0].playerId = j.playerId;
  return p;
}

const servidor = nuevoPartido();
const cliente  = nuevoPartido();

// Guion de entradas: se mueve en zigzag y pega cada segundo, para que la
// predicción tenga que acertar cosas que consumen azar (el tiro dispersa).
function entradaDe(t){
  const s = Math.sin(t / 25);
  return { mx: Math.cos(t / 17) * 0.9, mz: s, buttons: (t % 60 === 30) ? BTN.TIRO : 0 };
}

const TOTAL = Math.round(SEGUNDOS / DT);
const enVuelo = [];          // comandos hacia el servidor
const estados = [];          // instantáneas hacia el cliente
const historial = [];        // comandos propios del cliente, sin confirmar
let remotas = {};
const errores = [];
let msResim = 0, pico = 0, resims = 0, pasosTotal = 0, cambiosDeJugador = 0;

let tickCliente = ADELANTO;  // el cliente arranca por delante

function pasoCliente(t){
  const h = cliente.S.humans[0];
  const mio = historial.find(c => c.tick === t);
  if(mio) encolarComando(h, mio);
  usarPartido(cliente);
  stepSim(DT);
}

for(let tick = 0; tick < TOTAL; tick++){
  // --- el cliente genera, aplica y manda su entrada ---
  const e = entradaDe(tickCliente);
  const cmd = { seq: tickCliente, tick: tickCliente, mx: e.mx, mz: e.mz, buttons: e.buttons };
  historial.push(cmd);
  enVuelo.push({ llega: tick + RETARDO, cmd });
  pasoCliente(tickCliente);
  tickCliente++;

  // --- el servidor recibe lo que le corresponde y avanza ---
  usarPartido(servidor);
  while(enVuelo.length && enVuelo[0].llega <= tick)
    encolarComando(servidor.S.humans[0], enVuelo.shift().cmd);
  stepSim(DT);

  // --- cada 3 ticks el servidor difunde su estado ---
  if(tick % CADA === 0){
    const h = servidor.S.humans[0];
    estados.push({ llega: tick + RETARDO,
                   inst: capturar(servidor),
                   entradas: { 0: [h.entrada.mx, h.entrada.mz, h.entrada.buttons,
                                   h.entrada.ultimoSeq] } });
  }

  // --- al cliente le llega la verdad: rollback y resimulación ---
  while(estados.length && estados[0].llega <= tick){
    const msg = estados.shift();
    usarPartido(cliente);
    const mio = cliente.teams.flat().find(p => p.ownerSeat === 0);
    const antes = mio ? { x: mio.pos.x, z: mio.pos.z, id: mio.playerId } : null;

    const t0 = process.hrtime.bigint();
    restaurar(cliente, msg.inst);
    remotas = msg.entradas;
    const ack = cliente.S.humans[0].entrada.ultimoSeq;
    while(historial.length && historial[0].seq <= ack) historial.shift();

    let t = msg.inst.tick, pasos = 0;
    while(t < tickCliente && pasos < 60){ pasoCliente(t); t++; pasos++; }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;

    resims++; pasosTotal += pasos; msResim += ms; if(ms > pico) pico = ms;
    const despues = cliente.teams.flat().find(p => p.ownerSeat === 0);
    if(antes && despues){
      // Si el control cambió de jugador, medir la distancia entre los dos NO
      // es un error de predicción: son dos personas distintas del campo. Se
      // cuentan aparte para no inventar picos que no existen.
      if(despues.playerId !== antes.id) cambiosDeJugador++;
      else errores.push(Math.hypot(despues.pos.x - antes.x, despues.pos.z - antes.z));
    }
  }
}

errores.sort((a, b) => a - b);
const pct = q => errores.length ? errores[Math.floor(errores.length * q)] : 0;
const media = errores.reduce((a, b) => a + b, 0) / Math.max(1, errores.length);

console.log(`FÚLBO — predicción con ${RTT} ms de ida y vuelta, ${SEGUNDOS} s de partido`);
console.log(`  el cliente va ${ADELANTO} ticks por delante · estados a ${HZ_ESTADO} Hz`);
console.log('');
console.log(`  correcciones medidas : ${errores.length}`);
console.log(`  error medio          : ${(media*100).toFixed(2)} cm`);
console.log(`  mediana              : ${(pct(0.50)*100).toFixed(2)} cm`);
console.log(`  percentil 95         : ${(pct(0.95)*100).toFixed(2)} cm`);
console.log(`  peor caso            : ${(errores.at(-1)*100).toFixed(2)} cm`);
console.log('');
console.log(`  cambios de jugador   : ${cambiosDeJugador} (no cuentan como error)`);
console.log(`  resimulaciones       : ${resims} (${(pasosTotal/resims).toFixed(1)} ticks cada una)`);
console.log(`  coste medio          : ${(msResim/resims).toFixed(3)} ms`);
console.log(`  coste pico           : ${pico.toFixed(3)} ms`);
console.log('');
console.log(`  umbral del plan      : 5 cm ${media < 0.05 ? '-> DENTRO' : '-> FUERA'}`);
