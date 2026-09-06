// EL PROTOCOLO, en un solo archivo que leen el servidor y el cliente.
//
// Regla que no se negocia: el cliente manda COMANDOS, nunca posiciones ni
// resultados. Si un cliente pudiera decir "metí un gol", cualquiera con la
// consola abierta ganaría 9-0. El servidor es la única autoridad sobre el
// balón, la posesión, las faltas, las tarjetas, el reloj y hasta sobre quién
// controla a qué jugador.
//
// Hoy los mensajes van en JSON porque se leen y se depuran a ojo. Cuando
// aprieten los bytes, el snapshot pasa a ArrayBuffer cuantizado (x/z en
// centímetros como int16, facing como int8): ~190 B a 20 Hz, unos 3.8 KB/s.
// Los EVENTOS y los snapshots están separados a propósito desde ahora: los
// eventos (GOL, TARJETA) exigen orden y fiabilidad; los snapshots no, porque
// el siguiente corrige al anterior. Sobre WebSocket todo es fiable y da igual,
// pero si algún día esto pasa a un canal no fiable, mezclarlos hace que se
// pierda un gol en silencio y el marcador no suba.

// --- cliente -> servidor ---
export const C = {
  // Cuentas. Jugar solo o en una misma máquina NO pide cuenta; entrar a una
  // sala, sí. El registro aparece en el momento exacto en que hace falta.
  REGISTRO:'registro',   // { nombre, clave }
  ENTRAR:  'entrar',     // { nombre, clave }
  SESION:  'sesion',     // { token }                  reanudar sin reescribir la clave
  SALIR:   'salir',      // { }
  UNIR:     'unir',      // { codigo? }                codigo vacío = crear sala
  DEJAR:    'dejar',     // { }                        salir de la sala sin cerrar sesión
  SALAS:    'salas',     // { }                        pedir la lista de salas públicas
  ASIENTO:  'asiento',   // { equipo, puesto }         reclamar un puesto
  PREPARADO:'preparado', // { listo }                  decir "estoy listo"
  EMPEZAR:  'empezar',   // { }                        sólo el anfitrión
  ECHAR:    'echar',     // { userId }                 sólo el anfitrión
  CMD:      'cmd',       // { seq, tick, mx, mz, buttons }
  PING:     'ping',      // { t0 }
};

// --- servidor -> cliente ---
export const S = {
  SESION:     'sesion',     // { token, nombre, userId }
  BIENVENIDA: 'bienvenida', // { codigo, clienteId, semilla, local, visitante }
  SALA:       'sala',       // { codigo, fase, anfitrion, jugadores:[...] }
  LISTA:      'lista',      // { salas:[{codigo,gente,fase,anfitrion}] }
  EXPULSADO:  'expulsado',  // { motivo }
  ARRANQUE:   'arranque',   // { semilla, formaciones, asientos:[...] }
  ESTADO:     'estado',     // { tick, b:[...], j:[...], marcador, reloj, fase, ack:{seatId:seq} }
  EVENTOS:    'eventos',    // { lista:[{tipo,...}] }
  ERROR:      'error',      // { motivo }
  PONG:       'pong',       // { t0 }
};

/** Códigos de sala de 4 letras, sin vocales confundibles ni 0/O ni 1/I. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function codigoSala(azar){
  let s = '';
  for(let i = 0; i < 4; i++) s += ALFABETO[Math.floor(azar() * ALFABETO.length)];
  return s;
}
