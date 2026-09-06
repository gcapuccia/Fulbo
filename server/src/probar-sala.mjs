// Dos clientes de prueba en la misma sala, sin navegador.
// Verifica lo que importa: que los dos vean EL MISMO partido.
import WebSocket from 'ws';
import { C, S } from './protocolo.js';
import { BTN } from '../../src/core/input.js';

const URL = process.env.URL || 'ws://localhost:2567';
const espera = ms => new Promise(r => setTimeout(r, ms));

function cliente(nombre){
  const ws = new WebSocket(URL);
  const c = { ws, nombre, codigo:null, id:null, estados:[], eventos:[], seq:0, seatId:null };
  ws.on('message', b => {
    const m = JSON.parse(b);
    if(m.t === S.SESION)     c.userId = m.userId;
    if(m.t === S.BIENVENIDA){ c.codigo = m.codigo; c.id = m.clienteId; }
    if(m.t === S.SALA){ const yo = m.jugadores.find(j=>j.userId===c.userId); if(yo) c.seatId = yo.seatId; }
    if(m.t === S.ARRANQUE){ const yo = m.asientos.find(a=>a.userId===c.userId); if(yo) c.seatId = yo.seatId; }
    if(m.t === S.ESTADO) c.estados.push(m);
    if(m.t === S.EVENTOS) c.eventos.push(...m.lista);
    if(m.t === S.ERROR) console.log(`  ! ${nombre}: ${m.motivo}`);
  });
  c.envia = (t, d={}) => ws.send(JSON.stringify({t, ...d}));
  c.listo = new Promise(r => ws.on('open', r));
  return c;
}

const a = cliente('Ana'), b = cliente('Beto');
await Promise.all([a.listo, b.listo]);

a.envia(C.REGISTRO, { nombre:'ana'+Math.floor(Math.random()*1e5), clave:'clave-de-prueba-larga' });
await espera(400);
a.envia(C.UNIR, {});
await espera(200);
console.log(`sala creada: ${a.codigo}`);
b.envia(C.REGISTRO, { nombre:'beto'+Math.floor(Math.random()*1e5), clave:'clave-de-prueba-larga' });
await espera(400);
b.envia(C.UNIR, { codigo:a.codigo });
await espera(200);

a.envia(C.ASIENTO, { equipo:0, puesto:9 });
b.envia(C.ASIENTO, { equipo:1, puesto:9 });
await espera(200);
console.log(`asientos: Ana=${a.seatId} Beto=${b.seatId}`);

// un puesto ya tomado tiene que ser rechazado
b.envia(C.ASIENTO, { equipo:0, puesto:9 });
await espera(200);

a.envia(C.PREPARADO, { listo:true });
b.envia(C.PREPARADO, { listo:true });
await espera(300);
a.envia(C.EMPEZAR);
await espera(300);

// Ana corre hacia adelante y pega un pase; Beto se queda quieto
for(let i=0;i<90;i++){
  a.envia(C.CMD, { seq:a.seq++, tick:0, mx:0, mz:1, buttons: i===40 ? BTN.PASE : 0 });
  await espera(16);
}
await espera(400);

const ua = a.estados.at(-1), ub = b.estados.at(-1);
const mismoTick = a.estados.filter(x => ub && x.tick === ub.tick)[0];
console.log(`\nAna recibió ${a.estados.length} snapshots · Beto ${b.estados.length}`);
console.log(`último tick: Ana ${ua.tick} · Beto ${ub.tick}`);
if(mismoTick){
  const iguales = JSON.stringify(mismoTick.j) === JSON.stringify(ub.j);
  console.log(`en el tick ${ub.tick} los 22 jugadores son ${iguales ? 'IDÉNTICOS' : 'DISTINTOS'}`);
}
console.log(`marcador ${ua.marcador.join('-')} · reloj ${ua.reloj}s · fase ${ua.fase}`);
console.log(`ack de Ana: seq ${ua.ack[a.seatId]} (mandó ${a.seq-1})`);
console.log(`eventos que vio Ana: ${[...new Set(a.eventos.map(e=>e.tipo))].join(', ') || '(ninguno)'}`);
console.log(`eventos que vio Beto: ${[...new Set(b.eventos.map(e=>e.tipo))].join(', ') || '(ninguno)'}`);
console.log(`dueños de jugador: ${JSON.stringify(ua.duenos)}`);
a.ws.close(); b.ws.close();
await espera(200);
process.exit(0);
