# FÚLBO — Superliga Estelar ⚽

Juego de fútbol arcade estilo AAA hecho en **Three.js**, con equipos y jugadores
inventados, físicas de balón, IA de 11 vs 11, portero, cámara de transmisión,
menús y HUD. Todo en español. Sin assets externos: gráficos, texturas y audio
son 100% procedurales.

## ▶ Cómo jugar

Necesitás **Node.js 18 o superior**. La primera vez:

```bash
npm install
```

Y después, para jugar y desarrollar:

```bash
npm run dev
```

Abre la dirección que imprime (normalmente http://localhost:5173). Los cambios en
el código se recargan al instante, sin perder el estado.

Para generar la versión de producción y probarla en local:

```bash
npm run build && npm run preview
```

> **Sin dependencia de CDN.** Three.js viene de npm y se empaqueta con el juego,
> así que funciona sin conexión y no depende de que unpkg esté disponible.

### Estructura

```
fulbo/
├─ index.html                    solo el markup (menú, HUD, torneo, pausa)
├─ src/
│  ├─ main.js                    núcleo del partido y bucle (pendiente de partir)
│  ├─ config/                    datos puros, sin lógica
│  │  ├─ teams.js · formations.js · field.js · rules.js
│  ├─ core/
│  │  ├─ state.js                S, teams, cards: estado compartido del partido
│  │  └─ rng.js                  azar determinista con semilla
│  ├─ render/
│  │  ├─ textures.js             texturas por canvas
│  │  ├─ effects.js              confeti y destellos de las gradas
│  │  └─ scene/                  sky · lights · pitch · goals · stadium
│  ├─ league/league.js           modo torneo y tabla de posiciones
│  ├─ ui/badge.js                escudos de equipo
│  ├─ audio/audio.js             WebAudio procedural
│  ├─ app/G.js                   globales mutables (puente temporal a la Fase 4)
│  └─ styles/base.css
├─ public/legacy/index-v0.html   monolito congelado, para comparar A/B
├─ tests/golden/                 línea base de determinismo
├─ ARQUITECTURA.md               plan de modularización y camino al online
```

## ⚙️ Opciones y controles

Desde el menú, **⚙ Opciones · Controles**:

- **Reasignar teclas**: pulsa una acción y después la tecla que quieras. Hay dos
  perfiles independientes (Teclado 1 y Teclado 2) para jugar dos personas en el
  mismo teclado. Se guarda en tu navegador.
- **Tu nombre**: se guarda sólo en este dispositivo.

Durante el partido, el botón **?** de abajo a la izquierda muestra u oculta el
panel de controles. En el móvil arranca oculto para no tapar el campo.

## 📱 Móvil

La interfaz se adapta a pantallas estrechas: marcador compacto, minimapa más
pequeño, menú en una sola columna y panel de controles plegado. Usa `100dvh`,
así que la barra del navegador no recorta el campo.

## 🔐 Cuentas

Jugar **solo o con gente en la misma máquina no pide cuenta**: se crea un perfil
anónimo y listo. La cuenta hará falta únicamente para **jugar online**, y el
perfil local se subirá en lugar de perderse. El diseño completo está en
[ARQUITECTURA.md](ARQUITECTURA.md) §7.

## 👥 Multijugador local (hasta 4 personas)

En el menú, elige **Jugadores: 1-4**. Cada persona configura por separado:

- **Equipo**: puede jugar en el equipo local o en el visitante (1 contra 1, 2
  contra 2, o varios en el mismo equipo, como prefieran).
- **Puesto**: elige cuál de los 11 futbolistas controla (portero, defensas,
  medios o delanteros, con el lado del campo indicado).
- **Control**: Teclado 1, Teclado 2 o hasta 4 mandos.

Cada persona tiene su **anillo de color** bajo su futbolista y su propia **barra
de energía** en el HUD. El menú avisa si dos personas eligen el mismo mando o el
mismo puesto.

| Acción | Teclado 1 | Teclado 2 |
|---|---|---|
| Mover | `W A S D` | Flechas |
| Pase | `J` | `,` |
| Tiro | `K` | `.` |
| Sprint | `L` / `Shift izq.` | `/` / `Shift der.` |
| Cambiar jugador | `Espacio` | `Enter` |

## 🏆 Modo torneo

Pulsa **🏆 Jugar torneo** para disputar la Superliga Estelar: liga de todos
contra todos entre los 8 equipos (7 jornadas, 28 partidos). Juegas los partidos
de tu equipo y el resto se simulan según la fuerza de cada plantilla. Entre
jornada y jornada verás la **tabla de posiciones** (PJ, G, E, P, GF, GC, DIF,
PTS) y los resultados de la última fecha. Al terminar se corona al campeón.

## 🎮 Controles

| Acción      | Teclado                        | Joystick / Mando        |
|-------------|--------------------------------|-------------------------|
| Mover       | `W A S D` o Flechas            | Stick izquierdo         |
| Pase        | `J`                            | A                       |
| Tiro        | `K`                            | B / X                   |
| Sprint      | `L` o `Shift`                  | RT / RB                 |
| Cambiar jugador | `Espacio`                  | Y                       |
| **Barrida** (sin balón) | `K`                | B / X                   |
| **Cabezazo** (balón alto) | `J` o `K`        | A / B                   |
| **Cambiar formación** | `F`                  | —                       |
| Pausa       | `Esc`                          | —                       |

> La cámara es **lateral (estilo transmisión)**: los arcos quedan a izquierda y
> derecha, y tu equipo ataca hacia la **derecha**. Los controles son relativos a
> la cámara: `D` avanza hacia el arco rival.

### ⚡ Energía y sprint

El sprint **no es infinito**. Correr a tope vacía la barra de energía en unos
12 segundos; al agotarse, el jugador pierde punta de velocidad hasta recuperarse
trotando o caminando. Las velocidades son realistas (~7 m/s corriendo, ~9 m/s
esprintando): cruzar el campo lleva unos 12 segundos, no uno.

Además, **a más velocidad, menos control**: al esprintar el balón se separa del
pie y cuesta más manejarlo. Para regatear fino, suelta el sprint.

Conecta el mando y pulsa cualquier botón para que el juego lo detecte
(indicador abajo a la derecha: **Teclado / Joystick**).

## ⚙️ Opciones (menú)

- **Equipos:** elige tu equipo y el rival entre 8 clubes inventados.
- **Duración:** 4 / 6 / 10 minutos por partido.
- **Dificultad:** Fácil / Normal / Difícil (afecta velocidad y reacción de la IA).
- **Calidad:** Alta / Media (resolución de sombras y pixel ratio).

## ⚖️ Reglas y tácticas implementadas

- **Saques de banda**, **córners** y **saques de puerta** con colocación real de
  los 22 jugadores (en el córner ambos equipos cargan el área para el cabezazo).
- **Faltas** por barrida mal ejecutada, con **tarjetas amarillas y rojas**
  (doble amarilla = expulsión, y el equipo se queda con 10).
- **Penales** cuando la falta ocurre dentro del área.
- **Fuera de juego**: se evalúa en el instante del pase contra el penúltimo
  defensor; si el receptor está adelantado, se sanciona al recibir.
- **Formaciones** intercambiables en pleno partido con `F`:
  4-3-3, 4-4-2, 3-5-2 y 5-3-2.
- **Presión**: siempre hay un jugador presionando; si controlas al más cercano,
  un compañero sale a presionar por ti.
- **Marcaje individual**: defendiendo en campo propio, dos defensas se reparten
  a los dos rivales más adelantados y se colocan a unos tres metros, entre el
  rival y su propia portería. Medido sobre 12 partidos de IA vs IA: el punta
  queda suelto un 10,7 % del tiempo en vez de un 15,2 %, con el defensa por
  delante el 58,7 % de las veces en vez del 53,9 %.

## 🌐 Jugar online (salas)

El partido lo simula un servidor; los clientes mandan lo que aprietan y
dibujan lo que contesta. Nadie puede hacer trampa moviendo su jugador desde la
consola: el servidor es la única autoridad sobre el balón, la posesión, las
faltas, las tarjetas, el reloj y hasta sobre quién controla a qué jugador.

```bash
cd server && npm install     # una sola vez
npm run servidor             # desde la raíz: ws://localhost:2567
npm run dev                  # el juego, en otra terminal
```

En el menú, **🌐 Jugar online** te pide primero una cuenta: nombre y
contraseña, y listo. **Jugar solo, el torneo y varios en la misma máquina no
piden nada** — el registro aparece justo en el momento en que hace falta, no
en la pantalla de carga. La sesión queda guardada, así que la próxima vez
entrás directo.

No se pide correo (menos datos tuyos que guardar), y el precio de eso es que
**no hay recuperación de contraseña**: si la perdés, hay que borrar la cuenta
a mano en el servidor. Los detalles, y cómo delegar todo esto en Supabase para
abrirlo al público, están en [`server/README.md`](server/README.md).

Ya dentro tenés la **lista de salas abiertas** —se puede entrar sin que nadie
te pase nada— o *Crear sala*, que te da un código de cuatro letras (ej.
`WBPC`) para compartir. Cada uno elige equipo y puesto y pulsa **Estoy listo**;
el **anfitrión** (quien creó la sala) empieza el partido cuando están todos.
Los puestos que nadie tome los juega la IA de siempre, así que una sala es
jugable con dos personas o con ocho — no hacen falta 22.

**Si se te cae internet no pasa nada**: tu jugador lo toma la IA en el acto,
el partido sigue para los demás, y tenés un minuto para volver al mismo puesto.
El juego reintenta solo y te lo dice en pantalla.

Si alguien cierra la pestaña, su jugador **no se queda plantado**: se libera
el asiento y la IA lo retoma en el mismo tick. El partido no se interrumpe.

Para apuntar a un servidor que no sea el de tu máquina:
`VITE_SERVIDOR=wss://tu-servidor npm run build`.

### Comprobado, no supuesto

- Dos pestañas en la sala `HNF4`: sobre 35 ticks comunes, la huella del estado
  que recibió cada una es la **misma** (`9ffac5ea`). Ven exactamente el mismo
  partido.
- Dos cuentas distintas (`ana-prueba` y `beto-prueba`) en la sala `WBPC`, cada
  una con su asiento. Sin cuenta, el servidor rechaza entrar a cualquier sala.
- La contraseña no aparece ni en el archivo de cuentas, ni en `localStorage`,
  ni en el log del servidor. Sólo se guardan sal y hash.
- Reconexión, medida: cortada la conexión en el tick 1839, el cartel aparece,
  y a los 4 s se vuelve a la misma sala y al mismo asiento con el partido ya
  en el tick 2099. Nunca se detuvo.
- `cd server && npm run probar` — 45 comprobaciones entre cuentas, salas,
  anfitrión, listo, echar y reconexión.
- Un gol marcado por una persona aparece en la otra pantalla con su cartel y
  su marcador.
- `node scripts/sim90.mjs`: 90 s de partido en Node en **76 ms**, con el mismo
  hash que el navegador (`f25882e0`).
- `node scripts/salas-bench.mjs 40 600`: **7,4 µs por tick y sala**; cuarenta
  salas simultáneas usan el 1,78 % del presupuesto de 16,6 ms.

Lo que **todavía no** hay: predicción del lado del cliente. Tu jugador
responde con el retardo de la red (imperceptible en LAN, notorio a 100 ms).
Es la Fase 9 del plan y el núcleo ya está preparado para ella —determinista y
con el estado del azar dentro del partido—, pero no está hecha.

## 🎬 Cinemáticas

- **Repetición de gol en cámara lenta** (0.45x) con cámara baja en travelling
  detrás del arco, barras de cine y cartel de "REPETICIÓN".
- **Cámara de saque**: el encuadre se cierra en saques de centro y jugadas
  a balón parado, y se abre durante el juego.
- Celebración con confeti del color del equipo y nombre del goleador.

## 🎨 Detalles visuales

- **Césped** dibujado a escala real: franjas de corte con vetas de rodillo, ruido
  de hierba, desgaste frente a las porterías y en el círculo central.
- **Marcaje reglamentario exacto**: áreas de 40,32 × 16,5 m y 18,32 × 5,5 m,
  arcos del área calculados por trigonometría y arcos de córner recortados.
- **Redes de malla real** en los arcos (textura con alfa, no planos opacos).
- **Vallas LED publicitarias** emisivas rodeando todo el campo.
- **Proporciones reales**: jugadores de 1,80 m y balón a escala (antes el balón
  era tres veces más grande de lo que debía).
- **Modelos con más geometría**: cuello, torso entallado, cadera, antebrazos con
  codo articulado, manos, botines con puntera; tonos de piel y color de pelo
  variados entre jugadores.
- **Sombras de contacto suaves** con degradado, además de las sombras proyectadas.
- **Gradas llenas** y destellos de cámaras fotográficas parpadeando en el público.
- **Iluminación neutra y exposición calibrada** para que los colores de las
  equipaciones se vean fieles.
- **Bloom** (post-procesado): los focos del estadio y las vallas LED
  resplandecen. Se desactiva solo con la calidad **Media**.

## 🏟️ Qué incluye

- Estadio nocturno con gradas, multitud, torres de luz y cielo estrellado.
- Césped con franjas de corte, líneas reglamentarias, áreas y arcos con red.
- 22 jugadores con equipación por colores, dorsal y animación procedural:
  zancada que cambia de cadencia con la velocidad, cuerpo que se inclina al
  correr, respiración al estar parado, cabeza que sigue al balón y gesto
  completo de golpeo (armar, pegar y acompañar) con pierna buena por dorsal.
- Palomita del portero hacia el lado del remate, y festejo de gol: el equipo
  que marca levanta los brazos y salta, el que encaja baja la cabeza.
- Físicas de balón: gravedad, rebote, fricción de césped y arrastre de aire.
- IA por roles (POR/DEF/MED/DEL), formación 4-3-3, portero que achica.
- Pase inteligente al compañero mejor ubicado, tiro a puerta, robo/entrada.
- Cámara de transmisión que sigue la jugada, minimapa, marcador y reloj.
- Celebración de gol con confeti del color del equipo y anuncio del goleador.
- Audio procedural: ambiente de hinchada, silbato y golpeo de balón (WebAudio).

## 📁 Estructura

```
fulbo/
├── index.html    ← el juego completo (motor + UI + estilos)
├── README.md     ← este archivo
├── vercel.json   ← configuración de despliegue
└── .gitignore
```

¡A jugar! 🏆

## 🚀 Despliegue

El juego es un sitio **estático**: un único `index.html` sin proceso de compilación
ni dependencias que instalar. Se publica tal cual.

### GitHub

```bash
git remote add origin https://github.com/USUARIO/fulbo.git
git push -u origin main
```

### Vercel

**Opción A — desde la web (más simple):** entra en vercel.com → *Add New Project*
→ importa el repositorio de GitHub → *Deploy*. No hay que tocar ninguna opción:
Vercel detecta que es estático y sirve `index.html` desde la raíz. Cada `git push`
vuelve a desplegar automáticamente.

**Opción B — desde la terminal:**

```bash
npx vercel --prod
```

### GitHub Pages (alternativa gratuita)

En el repositorio: *Settings* → *Pages* → *Source: Deploy from a branch* →
rama `main`, carpeta `/ (root)`.

> **Nota sobre el mando:** la API de Gamepad requiere **HTTPS** (o `localhost`).
> Tanto Vercel como GitHub Pages sirven por HTTPS, así que los joysticks
> funcionan sin problema una vez desplegado.

## 🧪 Desarrollo: determinismo y prueba de humo

Desde la Fase 1 del refactor, la simulación corre a **paso fijo de 60 Hz** y todo
el azar que afecta a las reglas pasa por un **RNG con semilla**. El azar
cosmético (piel, pelo, césped, público, confeti) sigue siendo libre: esa
separación es exactamente la frontera entre núcleo y render.

### Consola de depuración (`__dbg`)

Abre la consola del navegador durante un partido:

```js
__dbg.seed(12345)                  // fija la semilla
__dbg.hash()                       // hash del estado autoritativo
__dbg.golden(90, 12345)            // 90 s de IA vs IA, hash por segundo
__dbg.tick                         // número de tick de simulación

__dbg.forceSetPiece('penal', 0)    // penal|corner|banda|puerta|falta, equipo
__dbg.card('roja', 1, 6)           // tipo, equipo, índice de jugador
__dbg.forceOffside()
__dbg.goal(0)                      // gol del equipo indicado
__dbg.teleportBall(x, y, z)
__dbg.setClock(85)                 // adelanta el reloj del partido
```

**El golden master es el oráculo del refactor:** `__dbg.golden(90, 12345)` debe
devolver siempre los mismos 90 hashes. Si una fase del refactor los cambia sin
que lo hayas decidido, es un bug — y sabés exactamente en qué commit.

### Prueba de humo (12 puntos, ~90 segundos)

Con los comandos de forzado, lo que antes exigía veinte minutos de jugar con
suerte ahora se comprueba en minuto y medio:

| # | Comprobación | Cómo |
|---|---|---|
| 1 | El menú carga y se eligen equipos | clic en la lista |
| 2 | Dos personas, teclado 1 y 2, equipos distintos | selector *Jugadores: 2* |
| 3 | Ambas mueven su jugador de forma independiente | `WASD` y flechas a la vez |
| 4 | Gol, celebración y goleador | `__dbg.goal(0)` |
| 5 | Repetición en cámara lenta y vuelta al saque | esperar tras el gol |
| 6 | Córner: los dos equipos cargan el área | `__dbg.forceSetPiece('corner',0)` |
| 7 | Saque de banda | `__dbg.forceSetPiece('banda',0)` |
| 8 | Penal: área despejada y ejecutor colocado | `__dbg.forceSetPiece('penal',0)` |
| 9 | Tarjeta roja: expulsión y equipo con 10 | `__dbg.card('roja',1,6)` |
| 10 | Fuera de juego señalado | `__dbg.forceOffside()` |
| 11 | Cambio de formación en caliente | tecla `F` |
| 12 | Pausa y una jornada de torneo | `Esc` · botón 🏆 |

### Comparación A/B

`public/legacy/index-v0.html` es el monolito congelado (accesible en `/legacy/index-v0.html`) **antes** del refactor. Ábrelo en
otra pestaña para comparar sensación y aspecto tras cada fase. No se toca nunca.
