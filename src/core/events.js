// BUZÓN DE EVENTOS (outbox) — UNO POR PARTIDO.
//
// El núcleo no llama a la presentación: deja constancia de lo que pasó y
// alguien lo recoge. Antes `scoreGoal` tocaba cuatro capas en nueve líneas
// (marcador, cartel, confeti, audio) y `startSetPiece` llamaba a `announce` y
// al silbato DESDE DENTRO de `updateBall`. Eso hace imposible correr la
// simulación en un servidor, donde no hay ni DOM ni altavoces.
//
// El buzón se vacía en cada tick: quien lo lee decide qué hacer con cada
// evento. En el cliente, pintar y sonar. En el servidor, difundirlo a la sala.
//
// ⚠️ El buzón vive DENTRO del partido (`m.eventos`), no en este módulo. Cuando
// era un array de módulo, dos salas en el mismo proceso Node compartían
// buzón: el gol de una sala le llegaba a la otra. Es exactamente el tipo de
// estado global que impide que un servidor tenga más de una partida.

/** Registra un evento del partido. Los datos deben ser serializables. */
export function emitir(m, tipo, datos = {}){
  m.eventos.push({ tipo, ...datos });
}

/** Devuelve y vacía el buzón de ese partido. */
export function drenarEventos(m){
  if(!m.eventos.length) return [];
  return m.eventos.splice(0, m.eventos.length);
}

export function limpiarEventos(m){ m.eventos.length = 0; }
