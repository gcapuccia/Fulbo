// DE LA PANTALLA AL MUNDO — vive en el CLIENTE, y sólo en el cliente.
//
// La cámara de FÚLBO está en la banda (-X) mirando hacia +X, así que "arriba"
// en la pantalla es alejarse (+X) y "derecha" es el arco que ataca el local
// (+Z). Ese giro estaba DENTRO de la simulación (`_v.set(-move.y, 0, move.x)`),
// y no puede estar ahí: el servidor no sabe dónde está mirando tu cámara, ni
// debe. Dos personas en la misma sala pueden tener encuadres distintos y el
// balón tiene que responder igual para las dos.
export function aMundo(mx, my){
  return { x: -my, z: mx };
}
