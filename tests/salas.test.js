// DOS SALAS EN UN MISMO PROCESO.
//
// Es EL invariante del servidor: si la sala A y la sala B se pisan aunque sea
// un byte, el modo online no existe. Se comprueba de la forma más dura
// posible: correr A entrelazada con B tick a tick, como haría un servidor, y
// exigir que A dé exactamente el mismo hash que si hubiera corrido sola.
//
// Además, este archivo importa la simulación en un entorno SIN document ni
// WebGL. Que el import no explote ya es media prueba.
import { describe, it, expect } from 'vitest';
import { crearPartido, reiniciarEstad } from '../src/core/match.js';
import { usarPartido, spawnTeams, placeKickoff, stepSim, hashEstado } from '../src/core/sim.js';
import { emitir, drenarEventos } from '../src/core/events.js';
import { DT } from '../src/config/rules.js';

function arrancar(semilla){
  const p = usarPartido(crearPartido({ semilla }));
  p.S.humans = [];
  spawnTeams();
  reiniciarEstad(p);
  placeKickoff(0);
  p.S.phase = 'kickoff'; p.S.phaseT = 0;
  return p;
}
function correrSola(semilla, ticks){
  const p = arrancar(semilla);
  for(let i = 0; i < ticks; i++) stepSim(DT);
  return { hash: hashEstado(), marcador: p.S.score.slice() };
}

describe('salas simultáneas', () => {
  it('la simulación se puede importar sin navegador', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof stepSim).toBe('function');
  });

  it('entrelazar dos salas no cambia el resultado de ninguna', () => {
    const TICKS = 900;                       // 15 s de partido en cada una
    const solaA = correrSola(11, TICKS);
    const solaB = correrSola(22, TICKS);

    const A = arrancar(11);
    const B = arrancar(22);
    for(let i = 0; i < TICKS; i++){
      usarPartido(A); stepSim(DT);          // el servidor procesa el tick de A entero…
      usarPartido(B); stepSim(DT);          // …y sólo entonces el de B
    }
    usarPartido(A); const hA = hashEstado();
    usarPartido(B); const hB = hashEstado();

    expect(hA).toBe(solaA.hash);            // A no se enteró de que existía B
    expect(hB).toBe(solaB.hash);
    expect(hA).not.toBe(hB);                // y no son la misma partida
  });

  it('dos salas con la misma semilla juegan el mismo partido', () => {
    const A = arrancar(7), B = arrancar(7);
    for(let i = 0; i < 600; i++){
      usarPartido(A); stepSim(DT);
      usarPartido(B); stepSim(DT);
    }
    usarPartido(A); const hA = hashEstado();
    usarPartido(B); const hB = hashEstado();
    expect(hA).toBe(hB);
  });

  it('cada sala tiene su propio buzón: el gol de una no llega a la otra', () => {
    const A = arrancar(3), B = arrancar(4);
    drenarEventos(A); drenarEventos(B);
    emitir(A, 'GOL', { team: 0 });
    for(let i = 0; i < 120; i++){ usarPartido(B); stepSim(DT); }
    expect(drenarEventos(A).map(e => e.tipo)).toEqual(['GOL']);
    expect(drenarEventos(B).some(e => e.tipo === 'GOL')).toBe(false);
  });

  it('un partido de 90 s da el hash del golden master', () => {
    expect(correrSola(12345, 5400).hash).toBe('f25882e0');
  });
});
