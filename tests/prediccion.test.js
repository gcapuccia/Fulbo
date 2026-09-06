// FASE 9 — la prueba que decide si la predicción es posible.
//
// Predecir es esto: guardar un instante, dejar que el partido siga, y poder
// volver a ese instante EXACTO y repetir la historia clavada. Si restaurar y
// resimular no reproduce el mismo hash, cualquier corrección del servidor
// haría saltar la pantalla, y el netcode entero se cae.
import { describe, it, expect } from 'vitest';
import { crearPartido, reiniciarEstad } from '../src/core/match.js';
import { usarPartido, spawnTeams, placeKickoff, stepSim, hashEstado,
         crearHumanos } from '../src/core/sim.js';
import { capturar, restaurar } from '../src/core/instantanea.js';
import { encolarComando, crearComando, consumirComando, estadoEntrada, BTN } from '../src/core/input.js';
import { DT } from '../src/config/rules.js';

function arrancar(semilla, humanos = 0){
  const p = usarPartido(crearPartido({ semilla }));
  p.S.humans = [];
  if(humanos){
    crearHumanos(humanos);
    p.S.humans.forEach((h, i) => { h.team = i % 2; h.slot = 9; });
  }
  spawnTeams();
  reiniciarEstad(p);
  placeKickoff(0);
  p.S.phase = 'kickoff'; p.S.phaseT = 0;
  if(humanos) for(const h of p.S.humans){
    const j = p.teams[h.team][h.slot];
    j.ownerSeat = h.seatId; h.playerId = j.playerId;
  }
  return p;
}
const correr = n => { for(let i = 0; i < n; i++) stepSim(DT); };

describe('instantánea completa', () => {
  it('capturar y restaurar deja el partido en el mismo sitio', () => {
    const m = arrancar(31);
    correr(300);
    const antes = hashEstado();
    const inst = capturar(m);
    correr(200);                       // el partido sigue…
    expect(hashEstado()).not.toBe(antes);
    restaurar(m, inst);                // …y se vuelve atrás
    expect(hashEstado()).toBe(antes);
    expect(m.simTick).toBe(inst.tick);
  });

  it('resimular desde una instantánea repite la historia CLAVADA', () => {
    const m = arrancar(77);
    correr(240);
    const inst = capturar(m);
    correr(180);
    const caminoA = hashEstado();

    restaurar(m, inst);
    correr(180);                       // el mismo trecho, otra vez
    expect(hashEstado()).toBe(caminoA);
  });

  it('sin el estado del azar la resimulación se despega', () => {
    const m = arrancar(5);
    correr(300);
    const inst = capturar(m);
    correr(400);
    const bueno = hashEstado();

    // se restaura TODO menos el azar, como haría un snapshot "de render"
    restaurar(m, { ...inst, azar: (inst.azar ^ 0x9e3779b9) | 0 });
    correr(400);
    expect(hashEstado()).not.toBe(bueno);   // por eso el azar va dentro
  });

  it('la instantánea es serializable: sobrevive a un viaje por JSON', () => {
    const m = arrancar(19);
    correr(260);
    const inst = capturar(m);
    const porElCable = JSON.parse(JSON.stringify(inst));
    correr(150);
    const destino = hashEstado();

    restaurar(m, porElCable);
    correr(150);
    expect(hashEstado()).toBe(destino);
  });

  it('conserva a los expulsados fuera del campo', () => {
    const m = arrancar(23);
    correr(120);
    const antes = m.teams[1].length;
    const fuera = m.teams[1][5];
    m.teams[1].splice(5, 1);           // como hace sendOff
    fuera.expelled = true;
    const inst = capturar(m);
    correr(60);
    restaurar(m, inst);
    expect(m.teams[1].length).toBe(antes - 1);
    expect(m.teams[1].some(p => p.playerId === fuera.playerId)).toBe(false);
  });

  it('un comando sellado para el tick 10 no se gasta en el 5', () => {
    const h = { entrada: estadoEntrada() };
    encolarComando(h, crearComando(0, 10, 1, 0, BTN.SPRINT));
    // ticks 5 a 9: todavía no le toca
    for(let t = 5; t < 10; t++){
      const r = consumirComando(h, t);
      expect(r.mx).toBe(0);
      expect(r.mantieneSprint).toBe(false);
    }
    const r = consumirComando(h, 10);         // ahora sí
    expect(r.mx).toBe(1);
    expect(r.mantieneSprint).toBe(true);
  });

  it('un comando que llegó tarde se usa igual, no se tira', () => {
    const h = { entrada: estadoEntrada() };
    encolarComando(h, crearComando(0, 3, 0.5, 0, BTN.PASE));   // debía ser el tick 3
    const r = consumirComando(h, 7);                            // y estamos en el 7
    expect(r.mx).toBe(0.5);
    expect(r.pulsaPase).toBe(true);           // más vale tarde que nunca
  });

  it('el jitter de la red no cambia el partido', () => {
    // ÉSTA es la propiedad que hace posible la predicción. El canal entrega en
    // orden (WebSocket), pero no a ritmo constante: un comando puede llegar
    // justo a tiempo o cuatro ticks antes, en ráfaga. Sellado con su tick, se
    // aplica en el mismo momento en los dos lados y el partido sale idéntico.
    const guion = Array.from({ length: 120 }, (_, i) =>
      crearComando(i, i, Math.sin(i / 9), Math.cos(i / 7), i % 40 === 20 ? BTN.TIRO : 0));

    const jugar = (adelanto) => {
      const m = arrancar(88, 1);
      const h = m.S.humans[0];
      for(let t = 0; t < 120; t++){
        // un comando sellado para el tick T llega `adelanto` ticks antes
        for(const c of guion)
          if(Math.max(0, c.tick - adelanto) === t) encolarComando(h, { ...c });
        stepSim(DT);
      }
      return hashEstado();
    };
    expect(jugar(4)).toBe(jugar(1));      // en ráfaga o justo a tiempo: lo mismo
  });

  it('resimular con las entradas de una persona da el mismo resultado', () => {
    const m = arrancar(41, 2);
    correr(120);
    const inst = capturar(m);

    // 90 ticks apretando "adelante" y un pase a mitad de camino
    const guion = [];
    for(let i = 0; i < 90; i++)
      guion.push(crearComando(i, 0, 0, 1, i === 45 ? BTN.PASE : 0));

    const jugar = () => {
      for(let i = 0; i < 90; i++){
        encolarComando(m.S.humans[0], { ...guion[i] });
        stepSim(DT);
      }
      return hashEstado();
    };
    const primera = jugar();
    restaurar(m, inst);
    const segunda = jugar();            // mismas entradas, mismo instante inicial
    expect(segunda).toBe(primera);
  });
});
