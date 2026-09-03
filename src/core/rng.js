// Azar determinista. Sólo el que AFECTA A LAS REGLAS pasa por aquí; el
// cosmético (piel, pelo, césped, público) sigue con Math.random(): esa
// separación es exactamente la frontera entre núcleo y render.
export function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

let _semilla = 12345;
let _gen = mulberry32(_semilla);

/** Fija la semilla y reinicia el generador. */
export function sembrar(n){ _semilla = n>>>0; _gen = mulberry32(_semilla); return _semilla; }
/** Siguiente pseudoaleatorio en [0,1). */
export function rng(){ return _gen(); }

// Suavizado independiente del dt: k es la fracción aplicada a 60 Hz.
export function suavizado(k, dt){ return 1 - Math.pow(1-k, dt*60); }
