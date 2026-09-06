// LA CUENTA, del lado del cliente.
//
// Guarda el token de sesión —NUNCA la contraseña— para no tener que
// reescribirla cada vez. Vive en localStorage, que es lo habitual y lo que
// permite seguir conectado al recargar; el precio conocido es que un fallo de
// XSS en la página lo dejaría leer. Por eso el token caduca a la semana y se
// puede cerrar sesión desde el juego.
//
// Jugar solo, con amigos en el sofá o el torneo NO pasa por aquí: eso sigue
// funcionando con el perfil anónimo de perfil.js, sin cuenta y sin red.
const LLAVE = 'fulbo.sesion.v1';

export function guardarSesion(token, nombre){
  try { localStorage.setItem(LLAVE, JSON.stringify({ token, nombre })); } catch {}
}
export function leerSesion(){
  try { return JSON.parse(localStorage.getItem(LLAVE) || 'null'); } catch { return null; }
}
export function olvidarSesion(){
  try { localStorage.removeItem(LLAVE); } catch {}
}
