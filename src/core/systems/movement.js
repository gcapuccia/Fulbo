// Temporizadores y orientación: ESTADO AUTORITATIVO, no animación.
//
// Todo lo de aquí lo lee la simulación, así que tiene que correr también en el
// servidor. Cuidado especial con dos cosas que estaban camufladas dentro del
// código de dibujo:
//
//  · `facing` parecía cosmético (rotar la malla) pero lo leen tryPossession,
//    kickBall y slideTackle para decidir hacia dónde sale el balón. Si se
//    queda en la vista, en el servidor todos apuntarían a +Z.
//  · `sliding` se decrementaba DENTRO de la rama visual de la pose de barrida.
//    Si se queda en la vista, en el servidor las barridas no terminan nunca.
//
// Y debe ejecutarse en TODAS las fases del partido, no sólo en juego: así era
// antes (p.update corría fuera del if de fase) y de ello dependen los tiempos
// de recuperación tras una falta.

/** @param {{vel:{x:number,z:number,length:()=>number}}} p */
export function tickTimers(p, dt){
  // orientación: mira hacia donde se mueve, si se mueve lo suficiente
  const speed = p.vel.length();
  if(speed > 0.2) p.facing = Math.atan2(p.vel.x, p.vel.z);

  if(p.stunTimer > 0) p.stunTimer -= dt;   // aturdido tras recibir una falta
  if(p.slideCd   > 0) p.slideCd   -= dt;   // enfriamiento entre barridas
  if(p.heading   > 0) p.heading   -= dt;   // ventana del cabezazo
  if(p.sliding   > 0) p.sliding   -= dt;   // duración de la barrida en curso
}
