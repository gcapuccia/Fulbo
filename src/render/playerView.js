// Animación del jugador: SÓLO VISTA. Lee el estado y mueve las mallas.
//
// Nada de lo que hay aquí puede influir en el resultado del partido: si algo
// de esto desapareciera, la simulación daría exactamente el mismo marcador.
// `runPhase` vive en el jugador pero sólo lo toca este archivo (es la fase del
// ciclo de zancada) y por eso NO entra en el hash de estado ni en el snapshot.

/**
 * Sincroniza las mallas de un jugador con su estado.
 * `pose` opcional: si viene (repetición de gol), se dibuja ESA posición en vez
 * de la del partido, sin tocar el estado autoritativo.
 */
export function syncPlayerView(p, dt, pose){
  const x = pose ? pose.x : p.pos.x;
  const z = pose ? pose.z : p.pos.z;
  const facing = pose ? pose.facing : p.facing;
  // en la repetición la cadencia sale del desplazamiento dibujado, no de p.vel
  const speed = pose
    ? Math.hypot(x - p.mesh.position.x, z - p.mesh.position.z) / Math.max(dt, 1e-4)
    : p.vel.length();
  p.mesh.rotation.y = facing;
  p.mesh.position.set(x, 0, z);

  // ciclo de carrera: la cadencia sube con la velocidad
  const cadence = Math.min(speed*1.1, 14);
  p.runPhase += dt*(4+cadence);
  const sw = Math.sin(p.runPhase) * Math.min(0.2+speed*0.05, 0.9);
  p.lLeg.rotation.x = sw;  p.rLeg.rotation.x = -sw;
  p.lKnee.rotation.x = Math.max(0,-sw)*1.2;  p.rKnee.rotation.x = Math.max(0,sw)*1.2;
  p.lArm.rotation.x = -sw*0.8;  p.rArm.rotation.x = sw*0.8;
  const flex = 0.5 + Math.abs(sw)*0.7;       // codos algo flexionados siempre
  p.lCodo.rotation.x = -flex;  p.rCodo.rotation.x = -flex;
  p.torso.position.y = 1.66 + Math.abs(Math.sin(p.runPhase))*Math.min(speed*0.02, 0.12);

  // pose según el estado (los temporizadores los baja el núcleo, aquí sólo se leen)
  if(p.sliding > 0){
    p.cuerpo.rotation.x = -1.42;             // tumbado SOBRE el césped
    p.cuerpo.position.set(0, 0.42, -0.30);
    p.lLeg.rotation.x = 0.85; p.rLeg.rotation.x = -0.30;
    p.lArm.rotation.x = -0.9; p.rArm.rotation.x = -0.5;
  } else if(p.stunTimer > 0){
    p.cuerpo.rotation.x = -1.52;             // en el suelo tras la falta
    p.cuerpo.position.set(0, 0.46, -0.34);
    p.lArm.rotation.x = -1.1; p.rArm.rotation.x = -0.8;
  } else {
    p.cuerpo.rotation.x = p.heading > 0 ? -0.45 : 0;
    p.cuerpo.position.set(0, 0, 0);
  }
}
