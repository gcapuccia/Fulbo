// BUZÓN DE EVENTOS (outbox).
//
// El núcleo no llama a la presentación: deja constancia de lo que pasó y
// alguien lo recoge. Antes `scoreGoal` tocaba cuatro capas en nueve líneas
// (marcador, cartel, confeti, audio) y `startSetPiece` llamaba a `announce` y
// al silbato DESDE DENTRO de `updateBall`. Eso hace imposible correr la
// simulación en un servidor, donde no hay ni DOM ni altavoces.
//
// El buzón se vacía en cada tick: quien lo lee decide qué hacer con cada
// evento. En el cliente, pintar y sonar. En el servidor, difundirlo a la sala.
export const eventos = [];

/** Registra un evento del partido. Los datos deben ser serializables. */
export function emitir(tipo, datos = {}){
  eventos.push({ tipo, ...datos });
}

/** Devuelve y vacía el buzón. */
export function drenarEventos(){
  if(!eventos.length) return [];
  return eventos.splice(0, eventos.length);
}

export function limpiarEventos(){ eventos.length = 0; }
