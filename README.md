# FÚLBO — Superliga Estelar ⚽

Juego de fútbol arcade estilo AAA hecho en **Three.js**, con equipos y jugadores
inventados, físicas de balón, IA de 11 vs 11, portero, cámara de transmisión,
menús y HUD. Todo en español. Sin assets externos: gráficos, texturas y audio
son 100% procedurales.

## ▶ Cómo jugar

El juego es un único archivo (`index.html`). Como usa módulos ES, **necesita un
servidor local** (abrirlo con doble clic como `file://` no ejecuta los módulos en
Chrome). Opciones:

**Opción A — Python** (más simple):
```bash
cd E:\fulbo
python -m http.server 8777
```
Luego abre: http://localhost:8777/index.html

**Opción B — Node:**
```bash
npx serve E:\fulbo
```

> Requiere conexión a internet la primera vez para cargar Three.js desde el CDN
> (unpkg). Si quieres jugar 100% sin conexión, descarga `three.module.js` y ajusta
> el `importmap` del `<head>` para que apunte al archivo local.

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
- 22 jugadores con equipación por colores, dorsal y animación de carrera procedural.
- Físicas de balón: gravedad, rebote, fricción de césped y arrastre de aire.
- IA por roles (POR/DEF/MED/DEL), formación 4-3-3, portero que achica.
- Pase inteligente al compañero mejor ubicado, tiro a puerta, robo/entrada.
- Cámara de transmisión que sigue la jugada, minimapa, marcador y reloj.
- Celebración de gol con confeti del color del equipo y anuncio del goleador.
- Audio procedural: ambiente de hinchada, silbato y golpeo de balón (WebAudio).

## 📁 Estructura

```
E:\fulbo\
├── index.html   ← el juego completo (motor + UI + estilos)
└── LEEME.md     ← este archivo
```

¡A jugar! 🏆
