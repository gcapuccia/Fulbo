// Asignación de teclas, reconfigurable desde el menú de opciones.
// Se guarda en el navegador, así que cada persona conserva la suya.
export const ACCIONES = [
  { id:'arriba',  nombre:'Mover arriba' },
  { id:'abajo',   nombre:'Mover abajo' },
  { id:'izq',     nombre:'Mover izquierda' },
  { id:'der',     nombre:'Mover derecha' },
  { id:'pase',    nombre:'Pase / cabezazo' },
  { id:'tiro',    nombre:'Tiro / barrida' },
  { id:'sprint',  nombre:'Sprint' },
  { id:'cambiar', nombre:'Cambiar de jugador' },
];

export const BINDS_POR_DEFECTO = {
  teclado1: { arriba:'KeyW', abajo:'KeyS', izq:'KeyA', der:'KeyD',
              pase:'KeyJ', tiro:'KeyK', sprint:'KeyL', cambiar:'Space' },
  teclado2: { arriba:'ArrowUp', abajo:'ArrowDown', izq:'ArrowLeft', der:'ArrowRight',
              pase:'Comma', tiro:'Period', sprint:'Slash', cambiar:'Enter' },
};

const CLAVE = 'fulbo.binds.v1';

export const binds = cargarBinds();

function cargarBinds(){
  const base = JSON.parse(JSON.stringify(BINDS_POR_DEFECTO));
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    if(guardado) for(const dev in base) Object.assign(base[dev], guardado[dev] || {});
  } catch(e){ /* almacenamiento no disponible: se usan los valores por defecto */ }
  return base;
}

export function guardarBinds(){
  try { localStorage.setItem(CLAVE, JSON.stringify(binds)); } catch(e){}
}

export function restaurarBinds(){
  for(const dev in BINDS_POR_DEFECTO) Object.assign(binds[dev], BINDS_POR_DEFECTO[dev]);
  guardarBinds();
}

/** Nombre legible de un código de tecla ('KeyW' -> 'W', 'ArrowUp' -> '↑'). */
export function nombreTecla(code){
  if(!code) return '—';
  const especiales = { Space:'Espacio', Enter:'Enter', Comma:',', Period:'.', Slash:'/',
    ArrowUp:'↑', ArrowDown:'↓', ArrowLeft:'←', ArrowRight:'→',
    ShiftLeft:'Shift izq.', ShiftRight:'Shift der.', Backquote:'`', Minus:'-', Equal:'=' };
  if(especiales[code]) return especiales[code];
  if(code.startsWith('Key'))   return code.slice(3);
  if(code.startsWith('Digit')) return code.slice(5);
  if(code.startsWith('Numpad'))return 'Num '+code.slice(6);
  return code;
}
