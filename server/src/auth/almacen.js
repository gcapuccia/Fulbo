// ALMACÉN DE CUENTAS LOCAL — para tu máquina y tus amigos.
//
// ⚠️ LEER ESTO ANTES DE ABRIRLO AL PÚBLICO. ARQUITECTURA.md §7 dice, con
// razón, "no escribas tu propia autenticación": guardar contraseñas bien
// (hash, sal, límite de intentos, recuperación, verificación, rotación de
// tokens) es un problema resuelto y fácil de hacer mal, y un fallo ahí no es
// un bug de juego, es una filtración de datos de tus jugadores.
//
// Esto hace bien la parte criptográfica —scrypt con sal por usuario,
// comparación en tiempo constante, límite de intentos— pero NO tiene:
//   · recuperación de contraseña (no se pide correo, así que no hay a dónde
//     mandarla: si alguien la olvida, hay que borrar su cuenta a mano);
//   · verificación de identidad;
//   · rotación ni revocación centralizada de sesiones;
//   · almacenamiento serio (es un JSON en disco, no una base de datos).
//
// Para jugar con conocidos es suficiente y honesto. Para abrirlo a
// desconocidos, poné AUTH=supabase y usá el adaptador de al lado: entonces
// las contraseñas no las custodiás vos.
//
// Deliberadamente NO se pide correo: menos datos personales que guardar y
// que se puedan filtrar.
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const derivar = promisify(scrypt);
const COSTE = { N: 16384, r: 8, p: 1 };     // ~100 ms por intento en un portátil
const LARGO = 32;
const SESION_MS = 7 * 24 * 60 * 60 * 1000;  // una semana
const MAX_FALLOS = 5;
const CASTIGO_MS = 15 * 60 * 1000;

export function crearAlmacen(ruta = 'datos/cuentas.json'){
  let db = { usuarios: {}, version: 1 };
  if(existsSync(ruta)){
    try { db = JSON.parse(readFileSync(ruta, 'utf8')); }
    catch { console.error('[cuentas] archivo ilegible; se empieza vacío'); }
  }
  const sesiones = new Map();               // token -> { userId, expira }
  const fallos   = new Map();               // clave normalizada -> { n, hasta }

  const guardar = () => {
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, JSON.stringify(db, null, 1));
  };
  const norm = n => String(n || '').trim().toLowerCase();

  async function hash(clave, sal){
    return Buffer.from(await derivar(clave, sal, LARGO, COSTE));
  }

  function nuevaSesion(userId){
    const token = randomBytes(32).toString('base64url');
    sesiones.set(token, { userId, expira: Date.now() + SESION_MS });
    return token;
  }

  return {
    get cuantas(){ return Object.keys(db.usuarios).length; },

    /** Alta. Devuelve {ok, token, nombre} o {ok:false, motivo}. */
    async registrar(nombre, clave){
      const n = norm(nombre);
      if(n.length < 3 || n.length > 16) return { ok:false, motivo:'el nombre va de 3 a 16 letras' };
      if(!/^[a-z0-9_.-]+$/.test(n))     return { ok:false, motivo:'sólo letras, números, . _ -' };
      if(String(clave || '').length < 8) return { ok:false, motivo:'la contraseña necesita 8 caracteres o más' };
      if(db.usuarios[n])                 return { ok:false, motivo:'ese nombre ya está tomado' };

      const sal = randomBytes(16);
      const h = await hash(clave, sal);
      db.usuarios[n] = {
        id: randomBytes(8).toString('hex'),
        nombre: String(nombre).trim().slice(0, 16),
        sal: sal.toString('base64'),
        hash: h.toString('base64'),
        creada: new Date().toISOString(),
        partidos: 0,
      };
      guardar();
      const u = db.usuarios[n];
      return { ok:true, token: nuevaSesion(u.id), nombre: u.nombre, userId: u.id };
    },

    /** Entrada. Mismo mensaje de error para usuario inexistente y contraseña
     *  mala: si se distinguieran, se podría averiguar quién tiene cuenta. */
    async entrar(nombre, clave){
      const n = norm(nombre);
      const castigo = fallos.get(n);
      if(castigo && castigo.n >= MAX_FALLOS && Date.now() < castigo.hasta){
        const min = Math.ceil((castigo.hasta - Date.now()) / 60000);
        return { ok:false, motivo:`demasiados intentos; probá en ${min} min` };
      }
      const u = db.usuarios[n];
      // Se calcula un hash igualmente aunque el usuario no exista, para que
      // responder tarde lo mismo en los dos casos y no se pueda deducir por
      // el tiempo de respuesta quién está registrado.
      const sal  = u ? Buffer.from(u.sal, 'base64') : randomBytes(16);
      const real = u ? Buffer.from(u.hash, 'base64') : randomBytes(LARGO);
      const dado = await hash(String(clave || ''), sal);
      const vale = u && dado.length === real.length && timingSafeEqual(dado, real);

      if(!vale){
        const f = fallos.get(n) || { n:0, hasta:0 };
        f.n++; f.hasta = Date.now() + CASTIGO_MS;
        fallos.set(n, f);
        return { ok:false, motivo:'nombre o contraseña incorrectos' };
      }
      fallos.delete(n);
      return { ok:true, token: nuevaSesion(u.id), nombre: u.nombre, userId: u.id };
    },

    /** Reanudar con el token guardado, sin volver a escribir la contraseña. */
    verificar(token){
      const s = sesiones.get(token);
      if(!s) return null;
      if(Date.now() > s.expira){ sesiones.delete(token); return null; }
      const u = Object.values(db.usuarios).find(x => x.id === s.userId);
      return u ? { userId: u.id, nombre: u.nombre } : null;
    },

    salir(token){ sesiones.delete(token); },

    contarPartido(userId){
      const u = Object.values(db.usuarios).find(x => x.id === userId);
      if(u){ u.partidos++; guardar(); }
    },
  };
}
