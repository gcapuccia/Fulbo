// Anillo de control: SÓLO VISTA. Marca con un halo del color de cada persona
// al jugador que está manejando.
//
// Antes esto se llamaba `refreshRings()` y lo invocaba la SIMULACIÓN desde
// siete sitios distintos (al recuperar el balón, al pasar, al expulsar, al
// sacar de banda, al cambiar de jugador...). Eso ataba siete funciones de
// reglas a `p.ring.material.color`, es decir, a Three: un servidor no podría
// ejecutarlas. Y era innecesario, porque el anillo es una FUNCIÓN PURA de
// `p.ownerSeat`: basta recalcularlo una vez por frame y ninguna regla tiene
// que acordarse de avisar. Son 22 jugadores contra 4 asientos como mucho.
export function sincronizarAnillos(teams, humans){
  for(const arr of teams) for(const p of arr){
    if(!p.ring) continue;                       // todavía sin malla construida
    const asiento = p.ownerSeat != null ? humans.find(x => x.seatId === p.ownerSeat) : null;
    p.ring.visible = !!asiento;
    if(asiento) p.ring.material.color.set(asiento.color);
  }
}
