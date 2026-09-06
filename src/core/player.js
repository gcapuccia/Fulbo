// UN JUGADOR = DATOS. Sin mallas, sin materiales, sin escena.
//
// Antes esto era una clase cuyo constructor terminaba llamando a `build()`:
// crear un jugador construía cápsulas de Three y lo metía en `G.scene`. Con
// eso, `spawnTeams()` —la función que arma los 22 de un partido— era
// imposible de ejecutar en un servidor sin navegador, y era la soldadura más
// gorda entre la simulación y el render de todo el proyecto.
//
// Lo que se dibuja (mesh, cuerpo, torso, cabeza, brazos, piernas, anillo y la
// fase de zancada) se lo cuelga después `render/playerMesh.js`, sólo en el
// cliente. Aquí sólo hay lo que leen las reglas.
import { Vec3 } from './math.js';

export function crearJugador(team, role, num){
  return {
    team, role, num,
    pos: new Vec3(),
    vel: new Vec3(),
    home: new Vec3(),        // posición base según formación
    facing: 0,
    stunTimer: 0,
    stamina: 1,              // energía 0..1
    sprinting: false,
    slideCd: 0, sliding: 0, heading: 0,
    holdTimer: 0,            // portero reteniendo el balón
    yellow: 0, expelled: false,
    ownerSeat: null,         // seatId de la persona que lo maneja (null = IA)
    playerId: 0,             // identificador estable: 100*equipo + puesto
    formation: null,         // hueco de la formación que ocupa
    isGK: role === 'POR',
  };
}
