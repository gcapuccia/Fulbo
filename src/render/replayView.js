// REPETICIÓN DE GOL — vista pura.
//
// Antes la repetición ESCRIBÍA el estado autoritativo: movía jugadores y balón
// de verdad, guardaba referencias vivas a los objetos Player, y era `endReplay`
// quien llamaba a `placeKickoff` — es decir, el avance del partido dependía de
// una animación. La simulación ya no sabe que esto existe.
//
// Ahora se guarda un buffer de INSTANTÁNEAS (arrays planos, el mismo formato
// que usará el paquete de red) y durante la celebración del gol se dibuja ESE
// estado paralelo, sin tocar el del partido.
import { tomarSnapshot, interpolarSnapshot } from '../core/snapshot.js';

export function crearReplayView({ segundos = 4.5, hz = 30, velocidad = 0.45 } = {}){
  const buffer = [];
  const maxFrames = Math.round(segundos * hz);
  let acc = 0;
  let reproduciendo = false;
  let t = 0;                 // posición de lectura, en fotogramas

  return {
    /** Muestrea el estado a `hz`. Sólo LEE: nunca modifica el partido. */
    grabar(teams, bola, dt){
      if(reproduciendo) return;
      acc += dt;
      if(acc < 1 / hz) return;
      acc = 0;
      buffer.push(tomarSnapshot(teams, bola));
      if(buffer.length > maxFrames) buffer.shift();
    },

    /** ¿Hay material suficiente para reproducir? */
    get listo(){ return buffer.length >= 8; },
    get activa(){ return reproduciendo; },
    get avance(){ return buffer.length ? t / buffer.length : 0; },

    iniciar(){
      if(buffer.length < 8) return false;
      reproduciendo = true; t = 0;
      return true;
    },

    detener(){
      reproduciendo = false;
      buffer.length = 0;
      acc = 0; t = 0;
    },

    /**
     * Avanza la reproducción y devuelve las poses a dibujar, o null si no hay
     * repetición activa (en cuyo caso se dibuja el estado vivo del partido).
     */
    poses(dt){
      if(!reproduciendo || buffer.length < 2) return null;
      t += dt * hz * velocidad;
      const i = Math.floor(t);
      if(i >= buffer.length - 1){ reproduciendo = false; return null; }
      return interpolarSnapshot(buffer[i], buffer[i + 1], t - i);
    },
  };
}
