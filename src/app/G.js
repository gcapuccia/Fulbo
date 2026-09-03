// Contenedor del estado mutable compartido entre módulos.
//
// ¿Por qué existe? Los bindings importados de ESM son de SÓLO LECTURA: si
// `renderer` viviera en un módulo y se importara, `renderer = new
// THREE.WebGLRenderer(...)` dentro de initThree() sería un error de
// compilación. Un único objeto contenedor permite `G.renderer = ...` desde
// cualquier archivo.
//
// Es feo a propósito y es TEMPORAL: desaparece en la Fase 4, cuando el estado
// del partido pase a createWorld() y el del render a su propio módulo.
export const G = {
  // --- render ---
  renderer: null, scene: null, camera: null, clock: null,
  composer: null, bloomPass: null,
  camCalls: 0, camLast: null, curView: 0,

  // --- entidades ---
  ball: null,

  // --- efectos ---
  confetti: null, flashes: null, crowdT: 0,

  // --- estado de partido que se reasigna desde varios sistemas ---
  lastTouch: -1,
  goalCooldown: 0,
  lastScorer: null,
  offsidePend: null,
  passReceiver: null,

  // --- bucle ---
  simTick: 0,
  acumulador: 0,
};
