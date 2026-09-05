// INSTANTÁNEA del partido: el estado visible, en arrays planos y serializables.
//
// Este formato tiene dos usos que resultan ser el mismo:
//   · la repetición del gol lo usa como buffer para reproducir la jugada;
//   · un servidor lo usa como PAQUETE DE RED para difundir a la sala.
//
// Por eso no hay referencias a objetos: sólo números, indexados por playerId.
// Se puede pasar por JSON.stringify tal cual.

/** Captura el estado visible del partido. */
export function tomarSnapshot(teams, bola){
  const j = [];                       // [playerId, x, z, facing] por jugador
  for(const arr of teams) for(const p of arr){
    j.push(p.playerId, p.pos.x, p.pos.z, p.facing);
  }
  return { b: [bola.pos.x, bola.pos.y, bola.pos.z], j };
}

/**
 * Interpola dos instantáneas y devuelve las poses listas para dibujar.
 * `a` en 0, `b` en 1. Devuelve { bola:{x,y,z}, poses:Map(playerId -> {x,z,facing}) }.
 */
export function interpolarSnapshot(s1, s2, a){
  const m = (u, v) => u + (v - u) * a;
  const poses = new Map();
  for(let k = 0; k < s1.j.length; k += 4){
    const id = s1.j[k];
    // los jugadores pueden haber cambiado entre instantáneas (una expulsión):
    // se busca el mismo id en la segunda en vez de asumir el mismo orden
    let k2 = k;
    if(s2.j[k2] !== id){
      k2 = -1;
      for(let q = 0; q < s2.j.length; q += 4) if(s2.j[q] === id){ k2 = q; break; }
      if(k2 < 0) continue;
    }
    poses.set(id, {
      x: m(s1.j[k+1], s2.j[k2+1]),
      z: m(s1.j[k+2], s2.j[k2+2]),
      facing: s1.j[k+3],
    });
  }
  return {
    bola: { x: m(s1.b[0], s2.b[0]), y: m(s1.b[1], s2.b[1]), z: m(s1.b[2], s2.b[2]) },
    poses,
  };
}
