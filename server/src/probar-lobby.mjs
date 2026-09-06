// FASE 8 de extremo a extremo: lobby, anfitrión, listo, echar y RECONEXIÓN.
//
// Lo que de verdad se comprueba aquí es lo último: que a alguien se le caiga
// la conexión en mitad de un partido, que la IA le juegue el jugador mientras
// tanto, y que al volver recupere SU puesto y el partido no se haya
// interrumpido ni un tick.
import WebSocket from 'ws';
import { C, S } from './protocolo.js';

const URL = process.env.URL || 'ws://localhost:2567';
const espera = ms => new Promise(r => setTimeout(r, ms));
let fallos = 0;
const ok = (c, t) => { console.log(`${c ? '  ok  ' : '  FALLA'} ${t}`); if(!c) fallos++; };

function cli(){
  const ws = new WebSocket(URL);
  const c = { ws, errores:[], token:null, codigo:null, sala:null, lista:null,
              estados:[], expulsado:null, arranque:null, reconexion:null };
  ws.on('message', b => { const m = JSON.parse(b);
    if(m.t === S.ERROR)      c.errores.push(m.motivo);
    if(m.t === S.SESION)     c.token = m.token;
    if(m.t === S.BIENVENIDA){ c.codigo = m.codigo; c.reconexion = m.reconexion; }
    if(m.t === S.SALA)       c.sala = m;
    if(m.t === S.LISTA)      c.lista = m.salas;
    if(m.t === S.ARRANQUE)   c.arranque = m;
    if(m.t === S.ESTADO)     c.estados.push(m);
    if(m.t === S.EXPULSADO)  c.expulsado = m.motivo; });
  c.env = (t, d={}) => { if(ws.readyState === 1) ws.send(JSON.stringify({t, ...d})); };
  c.listo = new Promise(r => ws.on('open', r));
  return c;
}

async function cuenta(nombre, clave){
  const c = cli(); await c.listo;
  c.env(C.REGISTRO, { nombre, clave }); await espera(400);
  return c;
}

const sufijo = Math.floor(Math.random()*100000);
const nA = 'ana' + sufijo, nB = 'beto' + sufijo, nC = 'caro' + sufijo;
const CLAVE = 'clave-de-prueba-larga';

console.log('\n--- lobby ---');
const a = await cuenta(nA, CLAVE);
a.env(C.UNIR, {}); await espera(400);
const codigo = a.codigo;
ok(!!codigo, `Ana crea la sala ${codigo}`);
ok(a.sala?.anfitrion && a.sala.jugadores[0].esAnfitrion, 'la creadora es la anfitriona');

const b = await cuenta(nB, CLAVE);
b.env(C.SALAS); await espera(300);
ok(b.lista?.some(s => s.codigo === codigo), 'la sala aparece en la lista pública');
ok(b.lista.find(s => s.codigo === codigo).anfitrion === nA, 'la lista dice quién es la anfitriona');

b.env(C.UNIR, { codigo }); await espera(400);
ok(b.sala?.jugadores.length === 2, 'Beto entra por el código');
ok(!b.sala.jugadores.find(j => j.nombre === nB).esAnfitrion, 'Beto NO es anfitrión');

console.log('\n--- puestos y listo ---');
a.env(C.ASIENTO, { equipo:0, puesto:9 });
b.env(C.ASIENTO, { equipo:1, puesto:9 }); await espera(400);
ok(a.sala.jugadores.every(j => j.equipo !== null), 'los dos tienen puesto');

b.env(C.EMPEZAR); await espera(300);
ok(b.errores.some(e => /anfitrión/.test(e)), 'Beto no puede empezar: no es anfitrión');

a.env(C.EMPEZAR); await espera(300);
ok(a.errores.some(e => /lista/.test(e)), 'ni la anfitriona empieza si falta gente por estar lista');

a.env(C.PREPARADO, { listo:true });
b.env(C.PREPARADO, { listo:true }); await espera(400);
ok(a.sala.jugadores.every(j => j.listo), 'los dos dicen que están listos');

a.env(C.ASIENTO, { equipo:0, puesto:8 }); await espera(300);
ok(!a.sala.jugadores.find(j => j.nombre === nA).listo, 'cambiar de puesto te des-lista');
a.env(C.PREPARADO, { listo:true }); await espera(300);

console.log('\n--- arranque ---');
a.env(C.EMPEZAR); await espera(800);
ok(!!a.arranque && !!b.arranque, 'el partido arranca para los dos');
const miAsiento = b.arranque.asientos.find(x => x.nombre === nB);
ok(miAsiento && miAsiento.seatId != null, `Beto juega en el asiento ${miAsiento?.seatId}`);
await espera(800);
ok(b.estados.length > 5, `Beto recibe snapshots (${b.estados.length})`);

console.log('\n--- reconexión ---');
const tickAntes = b.estados.at(-1).tick;
const dueñosAntes = b.estados.at(-1).inst.duenos.length;
b.ws.close();                                  // se le cae la conexión a Beto
await espera(900);
const tras = a.estados.at(-1);
ok(tras.tick > tickAntes, `el partido SIGUE sin Beto (tick ${tickAntes} -> ${tras.tick})`);
ok(tras.inst.duenos.length === dueñosAntes - 1, 'su jugador pasa a la IA en el acto');
ok(a.sala.jugadores.find(j => j.nombre === nB)?.conectado === false,
   'la sala lo muestra ausente, no desaparecido');

const b2 = cli(); await b2.listo;
b2.env(C.SESION, { token: b.token }); await espera(400);
b2.env(C.UNIR, { codigo }); await espera(700);
ok(b2.reconexion === true, 'volver con la misma cuenta se reconoce como reconexión');
ok(b2.codigo === codigo, 'vuelve a la MISMA sala');
await espera(600);
const trasVolver = b2.estados.at(-1) || a.estados.at(-1);
ok(trasVolver.inst.duenos.length === dueñosAntes, 'y recupera su jugador');
ok(trasVolver.tick > tras.tick, 'el partido nunca se detuvo');

console.log('\n--- el asiento ausente NO se congela ---');
// Se corta otra vez y se mira un rato largo: mientras no está, la cantidad de
// jugadores con dueño tiene que QUEDARSE abajo y no volver a subir. Antes
// subía, porque la simulación le reasignaba un jugador al asiento vacío en
// cuanto su equipo recuperaba el balón, y ese jugador se quedaba plantado en
// el césped en vez de que lo jugara la IA.
const antesDelCorte = a.estados.at(-1).inst.duenos.length;
const marca = a.estados.length;
b2.ws.close();
await espera(2500);
// Se descartan los primeros 10 snapshots (medio segundo): son los que el
// servidor ya tenía en vuelo cuando se cortó, y todavía cuentan a Beto.
const durante = a.estados.slice(marca + 10).map(e => e.inst.duenos.length);
ok(durante.length > 15 && Math.max(...durante) <= antesDelCorte - 1,
   `mientras falta, nadie ocupa su asiento (${durante.length} muestras, máximo ${Math.max(...durante)} de ${antesDelCorte})`);

const b3 = cli(); await b3.listo;
b3.env(C.SESION, { token: b.token }); await espera(400);
b3.env(C.UNIR, { codigo }); await espera(1200);
const despues = a.estados.at(-1).inst.duenos.length;
ok(despues === antesDelCorte,
   `al volver hay exactamente ${antesDelCorte} jugadores con dueño (hay ${despues})`);

console.log('\n--- echar ---');
const c = await cuenta(nC, CLAVE);
c.env(C.UNIR, { codigo }); await espera(500);
ok(a.sala.jugadores.length === 3, 'entra una tercera persona');
c.env(C.ECHAR, { userId: a.sala.jugadores[0].userId }); await espera(300);
ok(c.errores.some(e => /anfitrión/.test(e)), 'quien no es anfitrión no puede echar');
const idCaro = a.sala.jugadores.find(j => j.nombre === nC).userId;
a.env(C.ECHAR, { userId: idCaro }); await espera(500);
ok(c.expulsado, 'la anfitriona sí puede echar');
ok(!a.sala.jugadores.some(j => j.nombre === nC), 'y deja de estar en la sala');

[a, b3, c].forEach(x => x.ws.close());
await espera(300);
console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
