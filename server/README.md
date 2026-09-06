# Servidor de salas de FÚLBO

Simula los partidos y difunde el estado. Las reglas **no están aquí**: están
en `../src/core/sim.js`, exactamente las mismas que corren en el navegador.
Este paquete sólo pone salas, sockets y un reloj.

```bash
cd server
npm install
npm run dev          # ws://localhost:2567
```

`GET /salud` devuelve las salas abiertas.

## Cómo está montado

- **Una sala = un objeto partido.** `new Sala(codigo, semilla)` hace
  `crearPartido()` y nada más. Los 22 jugadores, la IA, el árbitro y el balón
  son los mismos de siempre.
- **Un solo reloj a 60 Hz para todas las salas.** No uno por sala: así ningún
  tick se entrelaza con otro, que es lo que exige que `usarPartido()` no sea
  reentrante. Cada sala se procesa entera y después la siguiente.
- **Acumulador con el tiempo REAL.** `setInterval` en Node se desvía entre 1 y
  16 ms; pasar `1/60` fijo separaría la física del servidor de la del cliente
  desde el primer tick.
- **Snapshots a 20 Hz, eventos al instante.** Van por caminos distintos a
  propósito: un snapshot viejo lo corrige el siguiente, pero un GOL perdido no
  se recupera nunca.
- **El cliente manda comandos, jamás posiciones.** El servidor decide el
  balón, la posesión, las faltas, las tarjetas, el reloj y hasta quién
  controla a qué jugador.
- **Desconectarse no interrumpe el partido**: se suelta el asiento y la IA
  retoma a ese jugador en el mismo tick.

## Dónde alojarlo

En Vercel **no**: es serverless y sin estado, y una sala es un proceso vivo
simulando 60 veces por segundo durante cuatro minutos. Va a Fly.io, Railway o
Render (~5-10 USD/mes). El cliente sigue siendo estático y gratis en Vercel,
apuntando aquí con `VITE_SERVIDOR`.

## Por qué `ws` y no Colyseus

El plan original decía Colyseus. Su plato fuerte es `@colyseus/schema`, que
sincroniza el estado solo — y aquí no se usa, porque el servidor manda sus
propios snapshots cuantizados de un núcleo determinista. Con `ws` el cliente
se queda con **cero dependencias nuevas** (WebSocket nativo del navegador),
que importa porque el cliente es un bundle estático. Todo pasa por
`src/net/transport.js`, así que cambiar de transporte es un archivo.
