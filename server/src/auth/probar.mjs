// Comprobaciones del almacén de cuentas. `node src/auth/probar.mjs`
import { crearAlmacen } from './almacen.js';
import { unlinkSync, existsSync } from 'node:fs';

const RUTA = 'datos/prueba-cuentas.json';
if(existsSync(RUTA)) unlinkSync(RUTA);
const a = crearAlmacen(RUTA);
let fallos = 0;
const ok = (cond, txt) => { console.log(`${cond ? '  ok  ' : '  FALLA'} ${txt}`); if(!cond) fallos++; };

const r1 = await a.registrar('Guido', 'contraseña-larga');
ok(r1.ok && r1.token, 'se puede registrar una cuenta');

const r2 = await a.registrar('guido', 'otra-contraseña');
ok(!r2.ok && /tomado/.test(r2.motivo), 'el nombre no se puede repetir (ni cambiando mayúsculas)');

ok(!(await a.registrar('Ana', 'corta')).ok, 'rechaza contraseñas de menos de 8');
ok(!(await a.registrar('a', 'contraseña-larga')).ok, 'rechaza nombres de menos de 3');
ok(!(await a.registrar('mal nombre!', 'contraseña-larga')).ok, 'rechaza caracteres raros');

const e1 = await a.entrar('Guido', 'contraseña-larga');
ok(e1.ok && e1.token !== r1.token, 'entrar da una sesión nueva');

const e2 = await a.entrar('Guido', 'contraseña-MALA');
ok(!e2.ok, 'no entra con la contraseña equivocada');
const e3 = await a.entrar('NoExiste', 'contraseña-larga');
ok(!e3.ok && e3.motivo === e2.motivo, 'mismo error para usuario inexistente que para clave mala');

ok(a.verificar(r1.token)?.nombre === 'Guido', 'el token identifica al dueño');
ok(a.verificar('inventado') === null, 'un token inventado no vale');
a.salir(r1.token);
ok(a.verificar(r1.token) === null, 'al salir, el token deja de valer');

// límite de intentos
for(let i = 0; i < 5; i++) await a.entrar('Guido', 'nope');
const bloqueado = await a.entrar('Guido', 'contraseña-larga');
ok(!bloqueado.ok && /intentos/.test(bloqueado.motivo), 'tras 5 fallos se bloquea aunque la clave sea buena');

// la contraseña no está en el archivo
const crudo = (await import('node:fs')).readFileSync(RUTA, 'utf8');
ok(!crudo.includes('contraseña-larga'), 'la contraseña NO aparece en el archivo');
ok(crudo.includes('"sal"') && crudo.includes('"hash"'), 'sí aparecen sal y hash');

unlinkSync(RUTA);
console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
