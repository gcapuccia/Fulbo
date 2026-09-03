// Reglas del juego, dificultad y constantes de simulación.
export const DT = 1/60;              // paso fijo de simulación
export const MAX_PASOS = 5;          // tope por frame: evita la espiral de la muerte
export const DIFF = { facil:{ai:0.72,react:0.55}, normal:{ai:0.86,react:0.75}, dificil:{ai:1.0,react:0.95} };
export const SPRINT_MUL = 1.3;
export const TOQUE_MAX = 1.05;
export const CAPTURA   = 1.70;   // > TOQUE_MAX con margen
export const SP_LABEL = { banda:'SAQUE DE BANDA', corner:'CÓRNER', puerta:'SAQUE DE PUERTA',
                   falta:'TIRO LIBRE', penal:'PENAL' };
export const REPLAY_SEC = 4.5, REPLAY_HZ = 30, REPLAY_SPEED = 0.45;  // 0.45x = cámara lenta
export const COLORES_HUMANO = ['#ffd23f','#4fc3f7','#7bed7b','#ff8a65'];
export const DISPOSITIVOS = [
  {id:'teclado1', nombre:'Teclado 1 · WASD'},
  {id:'teclado2', nombre:'Teclado 2 · Flechas'},
  {id:'pad0', nombre:'Mando 1'}, {id:'pad1', nombre:'Mando 2'},
  {id:'pad2', nombre:'Mando 3'}, {id:'pad3', nombre:'Mando 4'},
];
