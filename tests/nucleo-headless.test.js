// El núcleo tiene que poder correr SIN navegador: sin document, sin WebGL,
// sin Three. Es la condición que hace posible un servidor autoritativo con
// salas. Si este test falla, alguien volvió a soldar simulación y render.
import { describe, it, expect, beforeEach } from 'vitest';
import { Vec3 } from '../src/core/math.js';
import { rng, sembrar, suavizado } from '../src/core/rng.js';
import { S, teams, cards, bola } from '../src/core/state.js';
import { tickTimers } from '../src/core/systems/movement.js';
import { playerId, asignarControl, jugadorDeAsiento, esHumano, liberarAsiento }
  from '../src/core/systems/seats.js';
import { emitir, drenarEventos, limpiarEventos } from '../src/core/events.js';

describe('núcleo headless', () => {
  it('no existe document ni WebGL en este entorno', () => {
    expect(typeof document).toBe('undefined');
  });

  it('Vec3 se comporta como THREE.Vector3', () => {
    expect(new Vec3(3, 0, 4).length()).toBe(5);
    expect(new Vec3(1, 2, 3).clone().add(new Vec3(1, 1, 1)).toArray()).toEqual([2, 3, 4]);
    expect(new Vec3(0, 0, 2).setLength(6).z).toBe(6);
  });

  it('el azar es reproducible con la misma semilla', () => {
    sembrar(7); const a = [rng(), rng(), rng()];
    sembrar(7); const b = [rng(), rng(), rng()];
    expect(a).toEqual(b);
    sembrar(8); expect(rng()).not.toBe(a[0]);
  });

  it('el suavizado es independiente del dt', () => {
    // aplicar un paso de 1/30 equivale a dos de 1/60
    const unPaso = suavizado(0.1, 1 / 30);
    const dosPasos = 1 - (1 - suavizado(0.1, 1 / 60)) ** 2;
    expect(unPaso).toBeCloseTo(dosPasos, 12);
  });

  it('el balón es estado puro, no una malla de Three', () => {
    expect(bola.pos).toBeInstanceOf(Vec3);
    expect(bola.vel).toBeInstanceOf(Vec3);
    expect(bola.position).toBeUndefined();   // ya no es un THREE.Mesh
  });

  it('el estado del partido es serializable', () => {
    expect(() => JSON.stringify({ score: S.score, phase: S.phase, cards, bola })).not.toThrow();
    expect(teams).toHaveLength(2);
  });
});

  // Fase 4c: los temporizadores y la orientación son ESTADO, no animación.
  describe('tickTimers corre sin Three ni navegador', () => {
    const jugador = () => ({
      vel: new Vec3(), facing: 0,
      stunTimer: 0, slideCd: 0, heading: 0, sliding: 0,
    });

    it('orienta al jugador hacia donde se mueve', () => {
      const p = jugador();
      p.vel.set(0, 0, 5);            // hacia +Z
      tickTimers(p, 1/60);
      expect(p.facing).toBeCloseTo(0, 6);
      p.vel.set(5, 0, 0);            // hacia +X
      tickTimers(p, 1/60);
      expect(p.facing).toBeCloseTo(Math.PI/2, 6);
    });

    it('no reorienta si apenas se mueve (evita temblar parado)', () => {
      const p = jugador();
      p.facing = 1.23;
      p.vel.set(0.05, 0, 0);
      tickTimers(p, 1/60);
      expect(p.facing).toBe(1.23);
    });

    it('la barrida TERMINA — el fallo que rompería el servidor', () => {
      const p = jugador();
      p.sliding = 0.55;              // duración de una barrida
      for (let i = 0; i < 60; i++) tickTimers(p, 1/60);   // un segundo
      expect(p.sliding).toBeLessThanOrEqual(0);
    });

    it('los demás temporizadores bajan y no cruzan a negativo indefinido', () => {
      const p = jugador();
      p.stunTimer = 1.1; p.slideCd = 1.3; p.heading = 0.35;
      for (let i = 0; i < 120; i++) tickTimers(p, 1/60);  // dos segundos
      expect(p.stunTimer).toBeLessThanOrEqual(0);
      expect(p.slideCd).toBeLessThanOrEqual(0);
      expect(p.heading).toBeLessThanOrEqual(0);
    });
  });

// Fase 4d: el vínculo persona-jugador es estado SERIALIZABLE, no referencias.
describe('asientos', () => {
  const mundo = () => {
    const mk = (team, i) => ({ playerId: playerId(team, i), ownerSeat: null,
      isGK: i === 0, expelled: false, num: i + 1 });
    const teams = [
      Array.from({ length: 11 }, (_, i) => mk(0, i)),
      Array.from({ length: 11 }, (_, i) => mk(1, i)),
    ];
    return { teams, a: { seatId: 0, team: 0, playerId: null },
                    b: { seatId: 1, team: 0, playerId: null } };
  };

  it('los identificadores son estables y no chocan entre equipos', () => {
    expect(playerId(0, 9)).toBe(9);
    expect(playerId(1, 9)).toBe(109);
    expect(playerId(0, 9)).not.toBe(playerId(1, 9));
  });

  it('asignar control enlaza en los dos sentidos por ID', () => {
    const { teams, a } = mundo();
    const p = teams[0][9];
    expect(asignarControl(teams, a, p)).toBe(true);
    expect(a.playerId).toBe(p.playerId);
    expect(p.ownerSeat).toBe(a.seatId);
    expect(jugadorDeAsiento(teams, a)).toBe(p);
    expect(esHumano(p)).toBe(true);
  });

  it('cambiar de jugador libera al anterior', () => {
    const { teams, a } = mundo();
    const p1 = teams[0][9], p2 = teams[0][8];
    asignarControl(teams, a, p1);
    asignarControl(teams, a, p2);
    expect(p1.ownerSeat).toBeNull();
    expect(p2.ownerSeat).toBe(a.seatId);
  });

  it('NO se le puede robar el jugador a otra persona', () => {
    const { teams, a, b } = mundo();
    const p = teams[0][9];
    asignarControl(teams, a, p);
    expect(asignarControl(teams, b, p)).toBe(false);   // b intenta quedárselo
    expect(p.ownerSeat).toBe(a.seatId);                // sigue siendo de a
    expect(b.playerId).toBeNull();
  });

  it('el estado es SERIALIZABLE — antes el ciclo rompía JSON.stringify', () => {
    const { teams, a } = mundo();
    asignarControl(teams, a, teams[0][9]);
    expect(() => JSON.stringify(a)).not.toThrow();
    expect(() => JSON.stringify(teams)).not.toThrow();
  });

  it('liberar el asiento deja al jugador para la IA', () => {
    const { teams, a } = mundo();
    const p = teams[0][9];
    asignarControl(teams, a, p);
    liberarAsiento(teams, a);
    expect(p.ownerSeat).toBeNull();
    expect(a.playerId).toBeNull();
    expect(esHumano(p)).toBe(false);
  });
});

// Fase 4e: el núcleo no pinta ni suena — deja constancia y otro lo recoge.
describe('buzón de eventos', () => {
  beforeEach(() => limpiarEventos());

  it('drenar devuelve lo emitido y deja el buzón vacío', () => {
    emitir('GOL', { team: 0, scorerIdx: 8 });
    emitir('PATADA');
    const primera = drenarEventos();
    expect(primera).toHaveLength(2);
    expect(primera[0]).toEqual({ tipo: 'GOL', team: 0, scorerIdx: 8 });
    expect(drenarEventos()).toHaveLength(0);      // ya se vació
  });

  it('los eventos son SERIALIZABLES: pueden viajar a una sala', () => {
    emitir('SAQUE', { etiqueta: 'CÓRNER', team: 1 });
    emitir('TARJETA', { card: 'amarilla' });
    const paquete = drenarEventos();
    expect(() => JSON.stringify(paquete)).not.toThrow();
    expect(JSON.parse(JSON.stringify(paquete))).toEqual(paquete);
  });

  it('un tick sin novedades no genera basura', () => {
    expect(drenarEventos()).toEqual([]);
  });
});
