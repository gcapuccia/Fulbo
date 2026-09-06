// LA FRONTERA DE IDENTIDAD.
//
// El resto del servidor sólo sabe hacer una cosa con una cuenta: pedir
// `verificar(token)` y recibir `{ userId, nombre }` o `null`. De dónde sale
// ese token —de un almacén local o de Supabase— no le importa a nadie más.
// Por eso cambiar de proveedor es cambiar este archivo y ninguno más.
//
// AUTH=local     (por defecto) almacén propio en datos/cuentas.json
// AUTH=supabase  valida el JWT que emite Supabase Auth
//
// ⚠️ EL NÚCLEO DE SIMULACIÓN NO SABE QUÉ ES UNA CUENTA, y no debe saberlo.
// Sólo conoce asientos. La cuenta se queda en el borde: decide quién puede
// ocupar un asiento, no cómo se juega.
import { crearAlmacen } from './almacen.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Adaptador de Supabase: valida la firma del JWT sin llamar a nadie. */
function supabase(secreto){
  const b64 = s => Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'), 'base64');
  return {
    modo: 'supabase',
    registrar: async () => ({ ok:false, motivo:'el registro lo maneja Supabase, no este servidor' }),
    entrar:    async () => ({ ok:false, motivo:'la entrada la maneja Supabase, no este servidor' }),
    verificar(token){
      try {
        const [cab, cuerpo, firma] = String(token).split('.');
        if(!cab || !cuerpo || !firma) return null;
        const esperada = createHmac('sha256', secreto).update(`${cab}.${cuerpo}`).digest();
        const dada = b64(firma);
        if(dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) return null;
        const c = JSON.parse(b64(cuerpo).toString('utf8'));
        if(c.exp && Date.now()/1000 > c.exp) return null;
        return { userId: c.sub, nombre: (c.user_metadata?.nombre || c.email || 'Jugador').slice(0,16) };
      } catch { return null; }
    },
    salir(){}, contarPartido(){},
  };
}

export function crearAutenticador(){
  const modo = (process.env.AUTH || 'local').toLowerCase();
  if(modo === 'supabase'){
    const secreto = process.env.SUPABASE_JWT_SECRET;
    if(!secreto){
      console.error('[cuentas] AUTH=supabase pero falta SUPABASE_JWT_SECRET; no se arranca así.');
      process.exit(1);
    }
    console.log('[cuentas] identidad delegada en Supabase');
    return supabase(secreto);
  }
  const alm = crearAlmacen(process.env.CUENTAS || 'datos/cuentas.json');
  console.log(`[cuentas] almacén local · ${alm.cuantas} cuenta(s)`);
  console.log('[cuentas] para abrirlo al público: AUTH=supabase + SUPABASE_JWT_SECRET');
  return { modo:'local', ...alm,
           registrar: alm.registrar.bind(alm), entrar: alm.entrar.bind(alm) };
}
