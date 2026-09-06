// EL INPUT COMO FRONTERA DE RED.
//
// Un cliente NUNCA manda posiciones ni acciones: manda `ComandoInput`, que es
// lo único que cruza el cable. El servidor lo mete en la cola del asiento y la
// simulación decide qué pasa. Así el multijugador local y el online recorren
// EXACTAMENTE el mismo camino de código: en local el comando viaja de
// `pollInput` a la cola; online, de un WebSocket a la misma cola.
//
// Tres decisiones que parecen detalles y no lo son:
//
// 1. `seq` desde el primer día. Cuesta quince líneas. Sin él, la
//    reconciliación (el cliente re-simula desde el último estado confirmado)
//    es imposible sin rediseñar el protocolo entero.
//
// 2. Los botones viajan como MÁSCARA DE BITS y como NIVEL (apretado / no
//    apretado), nunca como "acaba de pulsar". El flanco lo deriva la
//    SIMULACIÓN comparando con `prevButtons` del asiento.
//
// 3. Y por eso mismo, el movimiento llega ya en coordenadas del MUNDO. El
//    servidor no sabe ni tiene por qué saber dónde está tu cámara.
//
// El porqué del punto 2, que es el que muerde: antes los flancos se calculaban
// en el muestreo, a frecuencia de PANTALLA (`i.pass = r.pass && !i._p`). Un
// frame lento que metía tres pasos de simulación veía `pass` en true los tres
// pasos y ejecutaba TRES pases con una sola pulsación. Derivado aquí, una
// pulsación es exactamente un pase, corra el frame a 30 o a 240 Hz — y una
// resimulación reproduce lo mismo, que es lo que exige el rollback.

export const BTN = { PASE: 1, TIRO: 2, SPRINT: 4, CAMBIAR: 8 };

/** Comando serializable. Es el futuro paquete de red: sólo números. */
export function crearComando(seq = 0, tick = 0, mx = 0, mz = 0, buttons = 0){
  return { seq, tick, mx, mz, buttons };
}

/** Estado de entrada de un asiento. Vive en el partido y viaja en el snapshot. */
export function estadoEntrada(){
  return {
    mx: 0, mz: 0,                 // dirección ya en coordenadas del mundo
    buttons: 0, prevButtons: 0,
    ultimoSeq: -1,                // el servidor lo devuelve en cada snapshot
    cola: [],                     // comandos pendientes de procesar
  };
}

/** El cliente (o el socket) deja un comando en la cola de ese asiento. */
export function encolarComando(h, cmd){
  h.entrada.cola.push(cmd);
  if(h.entrada.cola.length > 8) h.entrada.cola.shift();   // no acumular atraso
}

/**
 * Consume el comando QUE TOCA A ESTE TICK y deriva los flancos.
 *
 * Lo importante es "a este tick". Antes se consumía uno por llamada, en orden
 * de llegada: el cliente aplicaba su comando en el tick 500 y el servidor, si
 * le llegaba con jitter, lo aplicaba en el 502. Nadie se equivocaba, pero los
 * dos simulaban historias distintas, y la corrección tenía que arreglar esa
 * diferencia cada vez. Medido: 4.18 cm de error medio y picos de medio metro.
 *
 * Con el comando sellado con el tick del cliente y consumido en ESE tick,
 * cliente y servidor aplican exactamente la misma entrada en exactamente el
 * mismo momento, y lo único que queda por corregir es el redondeo.
 *
 * Si no llega el de este tick se repite el último nivel conocido —que es lo
 * correcto: si seguís apretando sprint, seguís esprintando— pero sin flancos,
 * para no disparar dos pases con una pulsación.
 */
export function consumirComando(h, tick){
  const e = h.entrada;
  let cmd = null;
  if(tick == null){
    cmd = e.cola.shift();                     // sin reloj común: uno por llamada
  } else {
    // los que llegaron tarde ya no sirven, pero se usan antes de tirarlos:
    // más vale una entrada de hace dos ticks que ninguna
    while(e.cola.length && e.cola[0].tick < tick) cmd = e.cola.shift();
    if(e.cola.length && e.cola[0].tick === tick) cmd = e.cola.shift();
  }
  if(cmd){
    e.mx = cmd.mx; e.mz = cmd.mz;
    e.prevButtons = e.buttons;
    e.buttons = cmd.buttons;
    e.ultimoSeq = cmd.seq;
  } else {
    e.prevButtons = e.buttons;        // sin comando nuevo: no hay flanco nuevo
  }
  const b = e.buttons, prev = e.prevButtons;
  return {
    mx: e.mx, mz: e.mz,
    pulsaPase:    !!(b & BTN.PASE)    && !(prev & BTN.PASE),
    pulsaTiro:    !!(b & BTN.TIRO)    && !(prev & BTN.TIRO),
    pulsaCambiar: !!(b & BTN.CAMBIAR) && !(prev & BTN.CAMBIAR),
    mantieneTiro:   !!(b & BTN.TIRO),
    mantieneSprint: !!(b & BTN.SPRINT),
  };
}
