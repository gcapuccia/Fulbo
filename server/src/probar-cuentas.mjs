// Extremo a extremo: sin cuenta no se entra a una sala; con cuenta, sí.
import WebSocket from 'ws';
import { C, S } from './protocolo.js';
const URL = 'ws://localhost:2567';
const espera = ms => new Promise(r => setTimeout(r, ms));
let fallos = 0;
const ok = (c, t) => { console.log(`${c ? '  ok  ' : '  FALLA'} ${t}`); if(!c) fallos++; };

function cli(){
  const ws = new WebSocket(URL);
  const c = { ws, ultimo:null, errores:[], token:null, codigo:null };
  ws.on('message', b => { const m = JSON.parse(b);
    c.ultimo = m;
    if(m.t === S.ERROR) c.errores.push(m.motivo);
    if(m.t === S.SESION) c.token = m.token;
    if(m.t === S.BIENVENIDA) c.codigo = m.codigo; });
  c.env = (t, d={}) => ws.send(JSON.stringify({t, ...d}));
  c.listo = new Promise(r => ws.on('open', r));
  return c;
}

const nombre = 'probador' + Math.floor(Math.random()*100000);
const a = cli(); await a.listo;

a.env(C.UNIR, {}); await espera(300);
ok(a.errores.some(e=>/cuenta/.test(e)), 'sin cuenta NO se puede entrar a una sala');
ok(!a.codigo, 'y no se creó ninguna sala');

a.env(C.REGISTRO, { nombre, clave:'una-contraseña-larga' }); await espera(400);
ok(!!a.token, 'registro devuelve un token de sesión');

a.env(C.UNIR, {}); await espera(400);
ok(!!a.codigo, `con cuenta sí se entra (sala ${a.codigo})`);

// la misma cuenta no puede ocupar dos asientos en la misma sala
const b = cli(); await b.listo;
b.env(C.SESION, { token: a.token }); await espera(300);
ok(!!b.token, 'se puede reanudar la sesión con el token guardado');
b.env(C.UNIR, { codigo: a.codigo }); await espera(400);
ok(b.errores.some(e=>/ya está en la sala/.test(e)), 'la misma cuenta no entra dos veces a la sala');

// otra cuenta sí
const c2 = cli(); await c2.listo;
c2.env(C.REGISTRO, { nombre: nombre+'x', clave:'otra-contraseña-larga' }); await espera(400);
c2.env(C.UNIR, { codigo: a.codigo }); await espera(400);
ok(!!c2.codigo, 'otra cuenta distinta sí entra a la misma sala');

// token inventado
const d = cli(); await d.listo;
d.env(C.SESION, { token:'no-existe' }); await espera(300);
ok(d.errores.some(e=>/sesión/.test(e)), 'un token inventado no da sesión');
d.env(C.UNIR, {}); await espera(300);
ok(d.errores.some(e=>/cuenta/.test(e)), 'y sigue sin poder entrar');

[a,b,c2,d].forEach(x=>x.ws.close()); await espera(200);
console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
