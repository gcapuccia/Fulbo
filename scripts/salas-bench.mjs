// ¿CUÁNTAS SALAS ENTRAN EN UN NÚCLEO?
//
// ARQUITECTURA.md estimaba 0.2-0.5 ms por tick y sala, o sea 25-40 salas.
// Era una estimación a ojo. Esto lo mide: N salas simuladas a la vez, tick a
// tick como haría el servidor, contando el tiempo de CPU de verdad.
//
//   node scripts/salas-bench.mjs 10 600
import { crearPartido, reiniciarEstad } from '../src/core/match.js';
import { usarPartido, spawnTeams, placeKickoff, stepSim } from '../src/core/sim.js';
import { drenarEventos } from '../src/core/events.js';
import { DT } from '../src/config/rules.js';

const N     = Number(process.argv[2] || 10);
const TICKS = Number(process.argv[3] || 600);

const salas = [];
for(let i = 0; i < N; i++){
  const p = usarPartido(crearPartido({ semilla: 1000 + i }));
  p.S.humans = []; spawnTeams(); reiniciarEstad(p);
  placeKickoff(0); p.S.phase = 'kickoff'; p.S.phaseT = 0;
  salas.push(p);
}

const cpu0 = process.cpuUsage();
const t0 = process.hrtime.bigint();
for(let t = 0; t < TICKS; t++){
  for(const sala of salas){
    usarPartido(sala);
    stepSim(DT);
    drenarEventos(sala);          // el servidor los difundiría a la sala
  }
}
const ms  = Number(process.hrtime.bigint() - t0) / 1e6;
const cpu = process.cpuUsage(cpu0);
const cpuMs = (cpu.user + cpu.system) / 1000;

const porTickSala = ms / (TICKS * N);
const presupuesto = 1000 / 60;                    // 16.6 ms por tick a 60 Hz
console.log(`${N} salas x ${TICKS} ticks (${(TICKS*DT).toFixed(0)} s de partido en cada una)`);
console.log(`  reloj ${ms.toFixed(0)} ms · CPU ${cpuMs.toFixed(0)} ms`);
console.log(`  ${(porTickSala*1000).toFixed(1)} µs por tick y sala`);
console.log(`  las ${N} salas juntas consumen ${(porTickSala*N/presupuesto*100).toFixed(2)} % del presupuesto de 16.6 ms`);
console.log(`  techo teórico en este núcleo: ~${Math.floor(presupuesto/porTickSala)} salas (sin sockets ni serialización)`);
