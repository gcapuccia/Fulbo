// ASIENTOS — el vínculo entre una persona y el jugador que maneja.
//
// Antes esto eran DOS referencias vivas cruzadas: `humano.controlled = jugador`
// y `jugador.humanOwner = humano`. Eso forma un ciclo, y un ciclo no se puede
// serializar: `JSON.stringify` lanza "Converting circular structure to JSON".
// Como el estado del partido tiene que viajar por la red para que existan las
// salas, el vínculo pasa a ser por IDENTIFICADOR en un solo sentido:
//
//     asiento.playerId  ->  jugador          (el asiento sabe a quién maneja)
//     jugador.ownerSeat ->  seatId | null    (el jugador sabe qué asiento lo lleva)
//
// Ambos son números. Nada de referencias, nada de ciclos, todo serializable.

/** Identificador estable de un jugador: 100·equipo + puesto. */
export function playerId(team, idx){ return team*100 + idx; }

/** Busca un jugador por su identificador. */
export function jugadorPorId(teams, id){
  for(const arr of teams) for(const p of arr) if(p.playerId === id) return p;
  return null;
}

/** El jugador que maneja un asiento (o null). */
export function jugadorDeAsiento(teams, asiento){
  return asiento && asiento.playerId != null ? jugadorPorId(teams, asiento.playerId) : null;
}

/** ¿Este jugador lo lleva alguna persona? */
export function esHumano(p){ return p != null && p.ownerSeat != null; }

/**
 * Da a un asiento el control de un jugador.
 *
 * NO roba: si el jugador ya lo lleva OTRA persona, la petición se ignora. Antes
 * `asignarControl` se lo quitaba al otro humano — en el sofá es una rareza; en
 * línea sería una forma de molestar al rival.
 *
 * Devuelve true si el control cambió (quien llame decide si repinta el anillo).
 */
export function asignarControl(teams, asiento, p){
  if(!asiento || !p) return false;
  if(p.ownerSeat != null && p.ownerSeat !== asiento.seatId) return false;   // ocupado
  if(asiento.playerId === p.playerId) return false;                          // ya lo lleva

  const anterior = jugadorDeAsiento(teams, asiento);
  if(anterior) anterior.ownerSeat = null;
  p.ownerSeat = asiento.seatId;
  asiento.playerId = p.playerId;
  return true;
}

/** Libera el jugador de un asiento (por expulsión, fin de partido, etc). */
export function liberarAsiento(teams, asiento){
  const p = jugadorDeAsiento(teams, asiento);
  if(p) p.ownerSeat = null;
  if(asiento) asiento.playerId = null;
}

/** Jugador de campo más cercano al balón que NO lleve ya otra persona. */
export function masCercanoLibre(teams, asiento, bola, distXZ){
  let best=null, bd=Infinity;
  for(const p of teams[asiento.team]){
    if(p.isGK || p.expelled) continue;
    if(p.ownerSeat != null && p.ownerSeat !== asiento.seatId) continue;
    const d = distXZ(p.pos, bola.pos);
    if(d < bd){ bd = d; best = p; }
  }
  return best;
}
