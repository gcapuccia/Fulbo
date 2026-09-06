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
- **Estado completo a 20 Hz, eventos al instante.** Van por caminos distintos
  a propósito: un estado viejo lo corrige el siguiente, pero un GOL perdido no
  se recupera nunca.
- **El estado que se manda sirve para RESIMULAR, no sólo para dibujar.** Lleva
  velocidades, energía, temporizadores, quién controla a quién y —lo que casi
  siempre se olvida— el estado del azar. Sin eso el cliente no puede predecir.
  Son 2 KB por mensaje, 41 KB/s por cliente: unas diez veces el objetivo del
  plan, que asumía codificación binaria cuantizada. Pasar de JSON a
  `ArrayBuffer` es mecánico y está pendiente.
- **El cliente manda comandos, jamás posiciones.** El servidor decide el
  balón, la posesión, las faltas, las tarjetas, el reloj y hasta quién
  controla a qué jugador.
- **Desconectarse no interrumpe el partido**: se suelta el asiento y la IA
  retoma a ese jugador en el mismo tick.

## Lobby, anfitrión y reconexión

**La sala es una máquina de estados del servidor**, no del cliente. Todo lo
que en el juego local decidía el DOM —quién juega, en qué puesto, cuándo se
empieza— aquí lo decide el servidor, porque es lo único en lo que se puede
confiar.

- **Lista de salas abiertas** (`salas`): se puede entrar sin que nadie te pase
  un código. Las salas sin nadie conectado no se ofrecen.
- **Anfitrión**: quien creó la sala. Sólo el anfitrión empieza el partido y
  sólo el anfitrión puede echar a alguien. Si se va, el mando pasa al
  siguiente que siga conectado.
- **Listo**: nadie empieza hasta que todos los que tienen puesto dicen que sí.
  Cambiar de puesto te des-lista, para que nadie arranque con la formación de
  otro.

### Reconexión

Los **asientos son de la cuenta, no de la conexión** — por eso viven en un Map
aparte indexado por `userId`. Cuando se cae una conexión:

1. El asiento **no** se borra: se marca ausente y se le sueltan los jugadores.
2. La IA los retoma **en el mismo tick**. Nadie espera a un jugador congelado.
3. Durante un minuto, quien vuelva con esa cuenta recupera su puesto exacto.
4. Una sala vacía tampoco se cierra en el acto: aguanta minuto y medio por si
   a todos se les cayó internet a la vez.

El cliente reintenta solo, con espera creciente (1, 2, 4… hasta 10 s), y
enseña un cartel que dice justamente eso: que el partido no se detiene.

> Un detalle que costó encontrar: un asiento ausente **volvía a recibir
> jugador** desde la simulación, porque el cambio automático de jugador al
> recuperar el balón no miraba si esa persona seguía ahí. El resultado era un
> jugador plantado en el césped en vez de uno llevado por la IA. La guarda
> está en `asignarControl` del núcleo, y se comprobó quitándola: sin ella, en
> el tick 1187 el asiento vacío recuperaba al jugador 105.

## Cuentas

Jugar solo, el torneo o cuatro personas en la misma máquina **no** piden
cuenta. Entrar a una sala, **sí** — y el registro aparece en el momento exacto
en que hace falta, no en la pantalla de carga.

```bash
npm run probar      # 14 comprobaciones del almacén + 9 de extremo a extremo
```

Dos adaptadores detrás de la misma frontera (`src/auth/index.js`), que sólo
sabe hacer `verificar(token) -> {userId, nombre}`:

| `AUTH` | qué hace | para qué sirve |
|---|---|---|
| `local` (por defecto) | almacén propio en `datos/cuentas.json` | tu máquina y tus amigos |
| `supabase` | valida el JWT que emite Supabase Auth | abrirlo al público |

### El almacén local, con sus límites dichos

Hace bien la parte criptográfica: **scrypt** con sal por usuario, comparación
en **tiempo constante**, y un hash calculado igualmente cuando el usuario no
existe para que responder tarde lo mismo en los dos casos (si no, se podría
averiguar quién tiene cuenta midiendo el tiempo). Cinco intentos fallidos
bloquean quince minutos. La contraseña no se escribe en ningún log ni en el
archivo: sólo la sal y el hash. `datos/` está fuera de git.

Lo que **no** tiene, y por eso no es para desconocidos:

- **No hay recuperación de contraseña.** No se pide correo —menos datos
  personales que custodiar— así que si alguien la olvida hay que borrar su
  cuenta a mano.
- No hay verificación de identidad ni rotación centralizada de sesiones.
- Es un JSON en disco, no una base de datos.

`ARQUITECTURA.md` §7 dice, con razón, "no escribas tu propia autenticación".
Esto la escribe igual, para que el modo online funcione hoy sin depender de
darte de alta en ningún servicio. Para abrirlo al público:

```bash
AUTH=supabase SUPABASE_JWT_SECRET=... npm start
```

y entonces las contraseñas no las custodiás vos.

### Cómo encaja con las salas

La cuenta se queda en el **borde**: decide quién puede ocupar un asiento, no
cómo se juega. El núcleo de simulación no sabe qué es un usuario — sólo conoce
asientos. `clienteId` es la conexión; `userId` es la cuenta, y sobrevive a la
conexión. Una cuenta no puede ocupar dos asientos de la misma sala.

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
