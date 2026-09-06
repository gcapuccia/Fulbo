// SESIÓN ONLINE — el partido lo simula el servidor; aquí sólo se dibuja.
//
// La diferencia con jugar solo cabe en una frase: en local `stepSim()` decide
// dónde está todo; online, el servidor decide y esto lo dibuja. El resto del
// cliente (cámara, HUD, animaciones, minimapa) no se entera del cambio,
// porque sigue leyendo el mismo objeto partido.
//
// BÚFER DE INTERPOLACIÓN. Los snapshots llegan a 20 Hz y la pantalla va a 60 o
// más. Dibujar el último que llegó daría un tirón cada 50 ms. Se dibuja
// deliberadamente ~100 ms ATRASADO, interpolando entre los dos snapshots que
// rodean ese instante: se cambia latencia por suavidad, que es el trato que
// hacen todos los juegos en red. Cuando llegue la Fase 9 (predicción y
// rollback) tu propio jugador dejará de ir atrasado; los demás seguirán así.
import { crearTransporte }     from '../net/transport.js';
import { interpolarSnapshot }  from '../core/snapshot.js';
import { crearComando, BTN }   from '../core/input.js';
import { guardarSesion, leerSesion, olvidarSesion } from './cuenta.js';

const RETRASO = 0.10;          // segundos de búfer

export function crearSesionOnline({ url, nombre }){
  const bus = crearTransporte(url);
  const buffer = [];           // snapshots recientes, en orden
  let reloj = 0;               // tiempo local del búfer, en segundos
  let eventos = [];
  let seq = 0;

  let reintento = 0, reconectando = false, quiereEstar = null;   // código al que volver

  const s = {
    bus, codigo: null, clienteId: null, seatId: null,
    cuenta: null,              // { userId, nombre } una vez identificado
    jugadores: [], salasPublicas: [], anfitrion: null,
    fase: 'lobby', ack: -1, ping: 0, caida: false,
    ultimo: null,              // último snapshot crudo (marcador, reloj, fase)

    async conectar(){
      await bus.conectar();
      bus.al('sesion', m => { s.cuenta = { userId: m.userId, nombre: m.nombre };
                              guardarSesion(m.token, m.nombre); })
         .al('bienvenida', m => { s.codigo = m.codigo; s.clienteId = m.clienteId;
                                  quiereEstar = m.codigo;              // a dónde volver si se cae
                                  if(m.fase) s.fase = m.fase; })
         .al('sala',       m => { s.jugadores = m.jugadores; s.fase = m.fase;
                                  s.anfitrion = m.anfitrion;
                                  const yo = m.jugadores.find(j => j.userId === s.cuenta?.userId);
                                  if(yo && yo.seatId != null) s.seatId = yo.seatId; })
         .al('lista',      m => { s.salasPublicas = m.salas; })
         .al('arranque',   m => { const yo = m.asientos.find(a => a.userId === s.cuenta?.userId);
                                  if(yo) s.seatId = yo.seatId;
                                  s.fase = 'jugando'; buffer.length = 0; reloj = 0; })
         .al('expulsado',  () => { s.codigo = null; quiereEstar = null; s.fase = 'lobby'; })
         .al('estado',     m => {
              s.ultimo = m;
              if(s.seatId != null && m.ack) s.ack = m.ack[s.seatId] ?? s.ack;
              buffer.push(m);
              if(buffer.length > 20) buffer.shift();
              // el reloj del búfer arranca en cuanto hay dos snapshots
              if(buffer.length === 2) reloj = 0;
           })
         .al('eventos',    m => { eventos.push(...m.lista); })
         .al('pong',       m => { s.ping = Math.round(performance.now() - m.t0); });
      // Al conectar NO se entra a ninguna sala: primero hay que identificarse.
      // Si había una sesión guardada, se reanuda sola.
      const guardada = leerSesion();
      if(guardada?.token) bus.enviar('sesion', { token: guardada.token });
      return s;
    },

    pedirSalas(){ bus.enviar('salas', {}); },
    preparado(listo){ bus.enviar('preparado', { listo }); },
    echar(userId){ bus.enviar('echar', { userId }); },
    dejarSala(){ bus.enviar('dejar', {}); s.codigo = null; quiereEstar = null; s.fase = 'lobby'; },
    get soyAnfitrion(){ return !!s.cuenta && s.anfitrion === s.cuenta.userId; },

    registrar(nombre, clave){ bus.enviar('registro', { nombre, clave }); },
    identificarse(nombre, clave){ bus.enviar('entrar', { nombre, clave }); },
    cerrarSesion(){
      const g = leerSesion();
      bus.enviar('salir', { token: g?.token });
      olvidarSesion(); s.cuenta = null;
    },

    crearSala(){ bus.enviar('unir', {}); },
    unirseA(codigo){ quiereEstar = codigo; bus.enviar('unir', { codigo }); },
    pedirAsiento(equipo, puesto){ bus.enviar('asiento', { equipo, puesto }); },
    empezar(){ bus.enviar('empezar', {}); },
    medirPing(){ bus.enviar('ping', { t0: performance.now() }); },

    /** Manda lo que el jugador está apretando. Igual que en local, pero por cable. */
    enviarEntrada(mx, mz, botones){
      bus.enviar('cmd', { seq: seq++, tick: s.ultimo ? s.ultimo.tick : 0, mx, mz, buttons: botones });
    },

    /**
     * Poses a dibujar AHORA. Devuelve null hasta tener dos snapshots.
     * Avanza el reloj del búfer con el dt real de la pantalla.
     */
    poses(dt){
      if(buffer.length < 2) return null;
      reloj += dt;
      const paso = 1 / 20;                       // los snapshots vienen a 20 Hz
      const objetivo = reloj - RETRASO;
      // índice del par que rodea al instante objetivo
      const i = Math.floor(objetivo / paso);
      const i0 = Math.max(0, Math.min(buffer.length - 2, i));
      const alfa = Math.max(0, Math.min(1, (objetivo - i0 * paso) / paso));
      // el búfer se recorta por delante para no crecer sin fin
      if(i0 > 4){ buffer.splice(0, i0 - 4); reloj -= (i0 - 4) * paso; }
      const a = buffer[Math.max(0, Math.min(buffer.length - 2, i0))];
      const b = buffer[Math.max(1, Math.min(buffer.length - 1, i0 + 1))];
      return interpolarSnapshot(a, b, alfa);
    },

    drenarEventos(){ const e = eventos; eventos = []; return e; },
    cerrar(){ quiereEstar = null; reconectando = false; bus.cerrar(); },

    /**
     * RECONEXIÓN. Se le cayó la conexión, no la partida: el servidor guarda el
     * asiento un minuto y mientras tanto la IA juega ese jugador, así que los
     * demás siguen jugando sin esperar a nadie. Al volver, basta con
     * identificarse y pedir la misma sala: el servidor reconoce la cuenta y
     * devuelve el puesto exacto.
     */
    async intentarVolver(alCambiar){
      if(reconectando) return;
      reconectando = true; s.caida = true;
      while(reconectando && reintento < 8){
        const espera = Math.min(1000 * 2 ** reintento, 10000);
        alCambiar?.(`Se cortó la conexión. Reintentando en ${Math.round(espera/1000)} s…`);
        await new Promise(r => setTimeout(r, espera));
        reintento++;
        try {
          await s.conectar();                    // reanuda la sesión guardada sola
          await new Promise(r => setTimeout(r, 400));
          if(quiereEstar) bus.enviar('unir', { codigo: quiereEstar });
          reconectando = false; reintento = 0; s.caida = false;
          alCambiar?.('Reconectado.');
          return true;
        } catch {}
      }
      reconectando = false;
      alCambiar?.('No se pudo reconectar.');
      return false;
    },
  };
  return s;
}

/** Traduce lo que hay apretado a la máscara del protocolo. */
export function botonesDe(r){
  let b = 0;
  if(r.pass)   b |= BTN.PASE;
  if(r.shoot)  b |= BTN.TIRO;
  if(r.sprint) b |= BTN.SPRINT;
  if(r.sw)     b |= BTN.CAMBIAR;
  return b;
}
