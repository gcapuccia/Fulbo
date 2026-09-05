// Registro del PARTIDO ACTIVO.
//
// Las funciones del núcleo trabajan sobre el partido en curso. Este módulo es
// el único punto donde se dice cuál es, para que la interfaz y la liga puedan
// leerlo sin importar main.js (lo que crearía una dependencia circular).
//
// Un servidor con salas llamaría a fijarActivo(sala) antes de procesar el tick
// de esa sala. No es reentrante a propósito: se procesa una sala entera y
// después la siguiente, nunca entrelazadas.
let _activo = null;

export function fijarActivo(partido){ _activo = partido; return _activo; }
export function activo(){ return _activo; }
