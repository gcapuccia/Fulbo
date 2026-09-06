// PARTIDO COMPLETO EN NODE, SIN NAVEGADOR.
//
// Ésta es la prueba de que el núcleo es headless de verdad: 90 segundos de
// IA contra IA, paso fijo de 60 Hz, sin canvas, sin DOM y sin WebGL. Si este
// script corre, una sala de servidor es posible; si no corre, no lo es, por
// muy bien que se vea el juego en el navegador.
//
//   node scripts/sim90.mjs            90 s con la semilla del golden
//   node scripts/sim90.mjs 200 7      200 s con la semilla 7
import { crearPartido, reiniciarEstad } from '../src/core/match.js';
import { usarPartido, spawnTeams, placeKickoff, stepSim, hashEstado } from '../src/core/sim.js';
import { DT } from '../src/config/rules.js';

const segundos = Number(process.argv[2] || 90);
const semilla  = Number(process.argv[3] || 12345);

const m = usarPartido(crearPartido({ semilla }));
m.S.humans = [];                       // IA pura: nadie maneja a nadie
spawnTeams();
reiniciarEstad(m);
placeKickoff(0);
m.S.phase = 'kickoff'; m.S.phaseT = 0;

const arranque = process.hrtime.bigint();
const total = Math.round(segundos / DT);
const hashes = [];
for(let i = 0; i < total; i++){
  stepSim(DT);
  if((i+1) % 60 === 0) hashes.push(hashEstado());
}
const ms = Number(process.hrtime.bigint() - arranque) / 1e6;

console.log(`FÚLBO — ${segundos} s de IA vs IA, semilla ${semilla}`);
console.log(`  ${m.S.homeTeam.nombre} ${m.S.score[0]} — ${m.S.score[1]} ${m.S.awayTeam.nombre}`);
console.log(`  tiros ${m.estad.tiros} · cabezazos ${m.estad.cabezazos} · atajadas ${m.estad.despejesPortero}`);
console.log(`  tarjetas: ${m.cards[0].a}A/${m.cards[0].r}R — ${m.cards[1].a}A/${m.cards[1].r}R`);
console.log(`  ${total} ticks en ${ms.toFixed(0)} ms  (${(ms/total*1000).toFixed(1)} µs por tick)`);
console.log(`  hash final: ${hashes[hashes.length-1]}`);
