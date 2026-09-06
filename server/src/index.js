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
// --- LÍMITES PARA INTERNET ---
// En tu máquina nada de esto hace falta. Abierto al mundo, sin esto cualquiera
// puede abrir diez mil sockets, crear cuentas sin fin desde un script, o
// conectarse desde otra web usando tu servidor de gratis.
const ORIGENES  = (process.env.ORIGENES || '').split(',').map(o => o.trim()).filter(Boolean);
const MAX_SALAS = Number(process.env.MAX_SALAS || 200);
const MAX_CONEX = Number(process.env.MAX_CONEX || 400);
const MAX_REGISTROS_IP = Number(process.env.MAX_REGISTROS_IP || 5);   // por hora
const VENTANA_IP = 60 * 60 * 1000;
const HZ_ESTADO = 20;                       // snapshots por segundo
const CADA = Math.round(60 / HZ_ESTADO);    // uno cada 3 ticks
// Margen para volver tras una caída sin perder el puesto. Mientras tanto la IA
// juega por vos, así que nadie se queda esperando a un jugador congelado.
const MARGEN_RECONEXION = 60_000;
// Una sala vacía no se borra en el acto: si a todos se les cayó internet a la
// vez, tienen este rato para volver y seguir el mismo partido.
const MARGEN_SALA_VACIA = 90_000;

const auth = crearAutenticador();
const salas = new Map();                    // codigo -> Sala
const deCliente = new Map();                // ws -> { clienteId, codigo }

const http = createServer((req, res) => {
  if(req.url === '/salud'){
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({ ok:true, salas: salas.size, conexiones,
      limites: { salas: MAX_SALAS, conexiones: MAX_CONEX, origenes: ORIGENES.length || 'cualquiera' },
      detalle: [...salas.values()].map(s => ({ codigo:s.codigo, fase:s.fase, gente:s.clientes.size })) }));
    return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({
  server: http,
  // Un mensaje del juego no llega a 1 KB. Sin tope, alguien puede mandar 100
  // MB y tumbar el proceso sin ni siquiera tener cuenta.
  maxPayload: 16 * 1024,
  // Si se declara una lista de orígenes, sólo esas webs pueden conectarse.
  // Sin ella (desarrollo) se acepta cualquiera.
  verifyClient({ origin, req }, listo){
    if(conexiones >= MAX_CONEX) return listo(false, 503, 'servidor lleno');
    if(!ORIGENES.length) return listo(true);
    listo(ORIGENES.includes(origin), 403, 'origen no permitido');
  },
});

let conexiones = 0;
const registrosPorIP = new Map();      // ip -> { n, desde }

/** Detrás de un proxy (Fly, Railway) la IP real viene en la cabecera. */
const ipDe = req => (req.headers['fly-client-ip'] ||
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress || '?');

function puedeRegistrar(ip){
  const ahora = Date.now();
  const r = registrosPorIP.get(ip);
  if(!r || ahora - r.desde > VENTANA_IP){ registrosPorIP.set(ip, { n:1, desde:ahora }); return true; }
  if(r.n >= MAX_REGISTROS_IP) return false;
  r.n++; return true;
}

const enviar = (ws, t, datos = {}) => {
  if(ws.readyState === 1) ws.send(JSON.stringify({ t, ...datos }));
};
const difundir = (sala, t, datos) => {
  for(const [, c] of sala.clientes) enviar(c.ws, t, datos);
};
// La sala se describe desde los ASIENTOS (que son de la cuenta), no desde las
// conexiones: así alguien desconectado sigue apareciendo, marcado como
// ausente, y no parece que se haya ido para siempre.
const estadoSala = sala => ({
  codigo: sala.codigo, fase: sala.fase, anfitrion: sala.anfitrion,
  jugadores: [...sala.asientos.entries()].map(([uid, a]) => ({
    userId: uid, nombre: a.nombre, equipo: a.equipo, puesto: a.puesto,
    seatId: a.seatId, listo: a.listo,
    conectado: sala.presente(uid), esAnfitrion: uid === sala.anfitrion,
  })),
});

const listaSalas = () => ({
  // Las salas sin nadie conectado no se ofrecen: siguen vivas por el margen de
  // reconexión, pero enseñarlas sería invitar a entrar a un sitio desierto.
  salas: [...salas.values()]
    .filter(s => s.publica && s.fase !== 'terminada' && s.conectados > 0)
    .map(s => ({ codigo: s.codigo, gente: s.asientos.size, conectados: s.conectados,
                 fase: s.fase,
                 anfitrion: s.asientos.get(s.anfitrion)?.nombre || 'sin anfitrión' })),
});

wss.on('connection', (ws, req) => {
  conexiones++;
  const clienteId = randomUUID().slice(0, 8);
  deCliente.set(ws, { clienteId, codigo: null, cuenta: null, ip: ipDe(req) });

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
        if(msg.t === C.REGISTRO && !puedeRegistrar(info.ip))
          return enviar(ws, S.ERROR, { motivo:'demasiadas cuentas nuevas desde aquí; probá más tarde' });
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

      case C.SALAS:
        enviar(ws, S.LISTA, listaSalas());
        break;

      case C.DEJAR: {
        if(!sala) return;
        sala.sale(clienteId, Date.now());
        info.codigo = null;
        difundir(sala, S.SALA, estadoSala(sala));
        enviar(ws, S.LISTA, listaSalas());
        break;
      }

      case C.UNIR: {
        // AQUÍ es donde la cuenta se vuelve obligatoria, y en ningún sitio antes.
        if(!info.cuenta) return enviar(ws, S.ERROR, { motivo:'para jugar online hace falta una cuenta' });
        let s = msg.codigo ? salas.get(String(msg.codigo).toUpperCase()) : null;
        if(msg.codigo && !s) return enviar(ws, S.ERROR, { motivo:'no existe esa sala' });
        if(!s){
          if(salas.size >= MAX_SALAS)
            return enviar(ws, S.ERROR, { motivo:'no hay salas libres ahora mismo' });
          let cod; do { cod = codigoSala(Math.random); } while(salas.has(cod));
          s = new Sala(cod, (Math.random()*1e9)|0);
          s.creadaEn = Date.now();
          salas.set(cod, s);
          console.log(`[sala ${cod}] creada`);
        }
        // Si esa cuenta YA tiene asiento en la sala, esto es una reconexión y
        // se le devuelve el puesto. Si no lo tiene, es alguien nuevo y hay que
        // mirar si queda sitio.
        const vuelve = s.asientos.has(info.cuenta.userId);
        if(!vuelve && s.llena) return enviar(ws, S.ERROR, { motivo:'la sala está llena' });
        if(vuelve && s.presente(info.cuenta.userId))
          return enviar(ws, S.ERROR, { motivo:'esa cuenta ya está abierta en la sala' });
        const como = s.entra(clienteId, ws, info.cuenta.nombre, info.cuenta.userId, Date.now());
        info.codigo = s.codigo;
        enviar(ws, S.BIENVENIDA, { codigo:s.codigo, clienteId, semilla:s.semilla,
                                   reconexion: como === 'reconexion', fase: s.fase });
        if(como === 'reconexion') console.log(`[sala ${s.codigo}] vuelve ${info.cuenta.nombre}`);
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
      case C.PREPARADO: {
        if(!sala) return;
        if(!sala.marcarListo(clienteId, msg.listo))
          return enviar(ws, S.ERROR, { motivo:'primero elegí un puesto' });
        difundir(sala, S.SALA, estadoSala(sala));
        break;
      }

      case C.ECHAR: {
        if(!sala) return;
        const r = sala.echar(clienteId, msg.userId);
        if(!r.ok) return enviar(ws, S.ERROR, { motivo:r.motivo });
        if(r.echado){
          const c = sala.clientes.get(r.echado);
          if(c){ enviar(c.ws, S.EXPULSADO, { motivo:'el anfitrión te sacó de la sala' });
                 sala.clientes.delete(r.echado);
                 const i = deCliente.get(c.ws); if(i) i.codigo = null; }
        }
        difundir(sala, S.SALA, estadoSala(sala));
        break;
      }

      case C.EMPEZAR: {
        if(!sala || sala.fase !== 'lobby') return;
        const r = sala.arrancar(clienteId);
        if(!r.ok) return enviar(ws, S.ERROR, { motivo:r.motivo });
        console.log(`[sala ${sala.codigo}] arranca con ${sala.asientos.size} jugador(es)`);
        for(const [uid] of sala.asientos) auth.contarPartido(uid);
        difundir(sala, S.ARRANQUE, {
          semilla: sala.semilla,
          asientos: [...sala.asientos.entries()].map(([uid, a]) => ({ userId:uid, seatId:a.seatId,
                      nombre:a.nombre, equipo:a.equipo, puesto:a.puesto })),
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
    conexiones--;
    const info = deCliente.get(ws);
    deCliente.delete(ws);
    if(!info || !info.codigo) return;
    const sala = salas.get(info.codigo);
    if(!sala) return;
    // La sala NO se borra aunque quede vacía: se le da un margen por si a
    // todos se les cayó la conexión a la vez. El barrendero de más abajo la
    // cierra si nadie vuelve.
    sala.sale(info.clienteId, Date.now());
    console.log(`[sala ${sala.codigo}] se desconecta alguien; conectados ${sala.conectados}`);
    difundir(sala, S.SALA, estadoSala(sala));
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

  // barrendero: una vez por segundo, caducar asientos y cerrar salas muertas
  if(contador % 60 === 0){
    const ahora = Date.now();
    for(const sala of [...salas.values()]){
      if(sala.caducar(ahora, MARGEN_RECONEXION)) difundir(sala, S.SALA, estadoSala(sala));
      if(sala.vacia && sala.vaciaDesde && ahora - sala.vaciaDesde > MARGEN_SALA_VACIA){
        salas.delete(sala.codigo);
        console.log(`[sala ${sala.codigo}] cerrada por abandono`);
      }
    }
  }

  for(const sala of salas.values()){
    const pasos = sala.avanzar(dtReal);
    if(pasos === null) continue;
    const evs = sala.eventos();
    if(evs.length) difundir(sala, S.EVENTOS, { lista: evs });   // fiables y en orden
    if(difundeEstado){
      const { inst, entradas } = sala.instantanea();
      // El estado completo ya contiene el de dibujo: mandar los dos era
      // enviar las posiciones dos veces.
      difundir(sala, S.ESTADO, { tick: inst.tick, inst, entradas });
    }
  }
}, 1000 / 60);

http.listen(PUERTO, () => {
  console.log(`FÚLBO — servidor de salas en ws://localhost:${PUERTO}`);
  console.log(`  estado: http://localhost:${PUERTO}/salud`);
  console.log(`  paso fijo ${(DT*1000).toFixed(2)} ms · snapshots a ${HZ_ESTADO} Hz`);
});

// --- CIERRE ORDENADO ---
// Fly y Railway mandan SIGTERM y esperan unos segundos antes de matar el
// proceso. Sin esto, un despliegue corta las partidas de golpe y —peor— puede
// dejar el archivo de cuentas a medio escribir.
let cerrando = false;
function cerrar(senal){
  if(cerrando) return;
  cerrando = true;
  console.log(`[${senal}] cerrando: ${salas.size} sala(s), ${conexiones} conexión(es)`);
  for(const [, sala] of salas) difundir(sala, S.ERROR, { motivo:'el servidor se está reiniciando' });
  wss.clients.forEach(c => c.close(1001, 'servidor reiniciando'));
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on('SIGTERM', () => cerrar('SIGTERM'));
process.on('SIGINT',  () => cerrar('SIGINT'));
