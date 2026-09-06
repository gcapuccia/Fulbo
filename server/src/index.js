// EL SERVIDOR DE SALAS.
//
// Un proceso Node con un Map de salas y UN SOLO reloj a 60 Hz que las avanza
// a todas en orden. Un único temporizador y no uno por sala: así ningún tick
// se entrelaza con otro, que es justo lo que exige que `usarPartido()` no sea
// reentrante. Cada sala se procesa entera y después la siguiente.
//
// Vercel no puede alojar esto: es serverless y sin estado, y una sala es un
// proceso vivo simulando sesenta veces por segundo durante cuatro minutos.
// El cliente sigue siendo estático en Vercel; esto va a Fly.io / Railway /
// Render, o a tu propia máquina mientras lo probás.
import { createServer } from 'node:http';
import { randomUUID }   from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Sala } from './sala.js';
import { C, S, codigoSala } from './protocolo.js';
import { crearAutenticador } from './auth/index.js';
import { DT } from '../../src/config/rules.js';

const PUERTO = Number(process.env.PORT || 2567);
const HZ_ESTADO = 20;                       // snapshots por segundo
const CADA = Math.round(60 / HZ_ESTADO);    // uno cada 3 ticks

const auth = crearAutenticador();
const salas = new Map();                    // codigo -> Sala
const deCliente = new Map();                // ws -> { clienteId, codigo }

const http = createServer((req, res) => {
  if(req.url === '/salud'){
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({ ok:true, salas: salas.size,
      detalle: [...salas.values()].map(s => ({ codigo:s.codigo, fase:s.fase, gente:s.clientes.size })) }));
    return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server: http });

const enviar = (ws, t, datos = {}) => {
  if(ws.readyState === 1) ws.send(JSON.stringify({ t, ...datos }));
};
const difundir = (sala, t, datos) => {
  for(const [, c] of sala.clientes) enviar(c.ws, t, datos);
};
const estadoSala = sala => ({
  codigo: sala.codigo, fase: sala.fase,
  jugadores: [...sala.clientes.entries()].map(([id, c]) => ({
    clienteId: id, nombre: c.nombre, equipo: c.equipo ?? null,
    puesto: c.puesto ?? null, seatId: c.seatId,
  })),
});

wss.on('connection', ws => {
  const clienteId = randomUUID().slice(0, 8);
  deCliente.set(ws, { clienteId, codigo: null, cuenta: null });

  ws.on('message', async bruto => {
    let msg;
    try { msg = JSON.parse(bruto); } catch { return; }
    const info = deCliente.get(ws);
    if(!info) return;
    const sala = info.codigo ? salas.get(info.codigo) : null;

    switch(msg.t){
      // --- CUENTAS. Nada de esto se registra en el log: ni la contraseña, ni
      // el token. Lo único que se escribe es el nombre al entrar a una sala.
      case C.REGISTRO:
      case C.ENTRAR: {
        const fn = msg.t === C.REGISTRO ? auth.registrar : auth.entrar;
        const r = await fn(msg.nombre, msg.clave);
        if(!r.ok) return enviar(ws, S.ERROR, { motivo: r.motivo });
        info.cuenta = { userId: r.userId, nombre: r.nombre };
        enviar(ws, S.SESION, { token: r.token, nombre: r.nombre, userId: r.userId });
        break;
      }
      case C.SESION: {
        const u = auth.verificar(msg.token);
        if(!u) return enviar(ws, S.ERROR, { motivo:'la sesión caducó; entrá otra vez' });
        info.cuenta = u;
        enviar(ws, S.SESION, { token: msg.token, nombre: u.nombre, userId: u.userId });
        break;
      }
      case C.SALIR: {
        if(msg.token) auth.salir(msg.token);
        info.cuenta = null;
        break;
      }

      case C.UNIR: {
        // AQUÍ es donde la cuenta se vuelve obligatoria, y en ningún sitio antes.
        if(!info.cuenta) return enviar(ws, S.ERROR, { motivo:'para jugar online hace falta una cuenta' });
        let s = msg.codigo ? salas.get(String(msg.codigo).toUpperCase()) : null;
        if(msg.codigo && !s) return enviar(ws, S.ERROR, { motivo:'no existe esa sala' });
        if(!s){
          let cod; do { cod = codigoSala(Math.random); } while(salas.has(cod));
          s = new Sala(cod, (Math.random()*1e9)|0);
          s.creadaEn = Date.now();
          salas.set(cod, s);
          console.log(`[sala ${cod}] creada`);
        }
        if(s.llena) return enviar(ws, S.ERROR, { motivo:'la sala está llena' });
        // Una cuenta, un asiento por sala: en el sofá cuatro personas comparten
        // una cuenta, pero online cada asiento es una cuenta distinta.
        for(const [, o] of s.clientes)
          if(o.userId === info.cuenta.userId)
            return enviar(ws, S.ERROR, { motivo:'esa cuenta ya está en la sala' });
        s.entra(clienteId, ws, info.cuenta.nombre, info.cuenta.userId);
        info.codigo = s.codigo;
        enviar(ws, S.BIENVENIDA, { codigo:s.codigo, clienteId, semilla:s.semilla });
        difundir(s, S.SALA, estadoSala(s));
        break;
      }
      case C.ASIENTO: {
        if(!sala) return;
        const r = sala.reclamarAsiento(clienteId, msg.equipo|0, msg.puesto|0);
        if(!r.ok) return enviar(ws, S.ERROR, { motivo:r.motivo });
        difundir(sala, S.SALA, estadoSala(sala));
        break;
      }
      case C.LISTO: {
        if(!sala || sala.fase !== 'lobby') return;
        if(!sala.arrancar()) return enviar(ws, S.ERROR, { motivo:'nadie eligió puesto' });
        console.log(`[sala ${sala.codigo}] arranca con ${sala.clientes.size} jugador(es)`);
        for(const [, c] of sala.clientes) if(c.userId) auth.contarPartido(c.userId);
        difundir(sala, S.ARRANQUE, {
          semilla: sala.semilla,
          asientos: [...sala.clientes.entries()].map(([id, c]) => ({ clienteId:id, seatId:c.seatId,
                      nombre:c.nombre, equipo:c.equipo, puesto:c.puesto })),
        });
        break;
      }
      case C.CMD:
        if(sala) sala.comando(clienteId, msg);
        break;
      case C.PING:
        enviar(ws, S.PONG, { t0: msg.t0 });
        break;
    }
  });

  ws.on('close', () => {
    const info = deCliente.get(ws);
    deCliente.delete(ws);
    if(!info || !info.codigo) return;
    const sala = salas.get(info.codigo);
    if(!sala) return;
    sala.sale(info.clienteId);
    console.log(`[sala ${sala.codigo}] se fue alguien; quedan ${sala.clientes.size}`);
    if(sala.vacia){ salas.delete(sala.codigo); console.log(`[sala ${sala.codigo}] cerrada`); }
    else difundir(sala, S.SALA, estadoSala(sala));
  });
});

// --- EL RELOJ. Uno solo para todas las salas. ---
let anterior = process.hrtime.bigint();
let contador = 0;
setInterval(() => {
  const ahora = process.hrtime.bigint();
  const dtReal = Math.min(Number(ahora - anterior) / 1e9, 0.25);
  anterior = ahora;
  contador++;
  const difundeEstado = (contador % CADA) === 0;

  for(const sala of salas.values()){
    const pasos = sala.avanzar(dtReal);
    if(pasos === null) continue;
    const evs = sala.eventos();
    if(evs.length) difundir(sala, S.EVENTOS, { lista: evs });   // fiables y en orden
    if(difundeEstado) difundir(sala, S.ESTADO, sala.snapshot());
  }
}, 1000 / 60);

http.listen(PUERTO, () => {
  console.log(`FÚLBO — servidor de salas en ws://localhost:${PUERTO}`);
  console.log(`  estado: http://localhost:${PUERTO}/salud`);
  console.log(`  paso fijo ${(DT*1000).toFixed(2)} ms · snapshots a ${HZ_ESTADO} Hz`);
});
