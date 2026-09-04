// Perfil local del jugador.
//
// Jugar solo o con gente en la misma máquina NO pide cuenta: se crea un perfil
// anónimo la primera vez y listo. La cuenta sólo hará falta para jugar online
// (ver §7 de ARQUITECTURA.md), y cuando llegue ese momento este perfil se sube
// en lugar de perderse.
const CLAVE = 'fulbo.perfil.v1';

export const perfil = cargar();

function cargar(){
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    if(g && g.id) return g;
  } catch(e){ /* almacenamiento no disponible */ }
  const nuevo = { id: nuevoId(), apodo: '', creado: null, partidos: 0, online: false };
  guardarPerfil(nuevo);
  return nuevo;
}

// Identificador local. No es una identidad: sirve para reconocer este
// dispositivo, no para autenticar a nadie. El de verdad lo dará el servidor.
function nuevoId(){
  const a = new Uint8Array(8);
  (globalThis.crypto || {}).getRandomValues?.(a);
  return 'loc_' + Array.from(a, b => b.toString(16).padStart(2,'0')).join('');
}

export function guardarPerfil(p = perfil){
  try { localStorage.setItem(CLAVE, JSON.stringify(p)); } catch(e){}
}

export function setApodo(nombre){
  perfil.apodo = String(nombre || '').slice(0, 16).trim();
  guardarPerfil();
  return perfil.apodo;
}

/** Nombre a mostrar: el apodo si lo puso, o uno genérico. */
export function nombreVisible(){
  return perfil.apodo || 'Invitado';
}

export function contarPartido(){
  perfil.partidos = (perfil.partidos || 0) + 1;
  guardarPerfil();
}
