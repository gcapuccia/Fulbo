// El núcleo tiene que poder correr SIN navegador: sin document, sin WebGL,
// sin Three. Es la condición que hace posible un servidor autoritativo con
// salas. Si este test falla, alguien volvió a soldar simulación y render.
import { describe, it, expect } from 'vitest';
import { Vec3 } from '../src/core/math.js';
import { rng, sembrar, suavizado } from '../src/core/rng.js';
import { S, teams, cards, bola } from '../src/core/state.js';

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
