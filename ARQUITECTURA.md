# PLAN DEFINITIVO — FÚLBO: Superliga Estelar
**Arquitectura, refactor y camino al online. Verificado contra `E:\fulbo\index.html` (2411 líneas).**

---

## 0. Resumen ejecutivo en cinco líneas

1. **MVC no sirve para el partido; sí sirve para el menú y el HUD.** En el campo se usa **núcleo de simulación puro + adaptadores** (la Vista lee el estado cada frame, no se suscribe a cambios).
2. El trabajo real no es "partir archivos": es **cortar 4 soldaduras concretas** entre simulación y render que hoy hacen imposible correr el juego en Node.
3. **Lo primero no es Vite: es el determinismo y el golden master**, hechos *dentro del monolito de hoy*. Sin eso, la cirugía se hace a ciegas.
4. Framework: **Vite + three por npm + Vitest**. Nada más por ahora. TypeScript sólo en `core/` y *antes* de la cirugía de vectores. Colyseus **sólo** cuando ataques el online.
5. Hay un **punto de parada declarado** (fin de Fase 5). Si parás ahí para siempre, el proyecto ya ganó.

---

## 1. ¿MVC sirve para este juego?

**Respuesta corta: para el campo de juego, no. Para el menú, el HUD y el torneo, sí — y ahí lo vas a usar.**

Tu intuición al pedir MVC es correcta y es exactamente el diagnóstico del problema: *"lo que sabe las reglas no debe saber cómo se dibuja"*. Eso lo conservo entero. Lo que cambio es el **mecanismo**, por cuatro razones medidas en tu código, no por moda:

**(a) MVC es reactivo; un juego es un bucle.** MVC asume que la Vista se entera cuando el Modelo cambia (observador/listeners). En tu `animate()` (línea 2072) cambia *todo* en *todos* los frames: el balón, 22 jugadores, la cámara, el reloj, el minimapa. Notificar 60 veces por segundo que `ball.position` cambió es coste puro. La Vista debe **leer el estado entero cada frame**. Eso se llama *binder* o *presentador*, no Vista MVC.

**(b) Tu Controlador ya rechazó MVC solo.** `pollInput()` (967) no escucha eventos: **muestrea** teclado y gamepads cada frame y hace detección de flanco a mano (`i.pass = r.pass && !i._p`). Eso ya es un adaptador de entrada. Y `leerDispositivo()` (935) ya devuelve `{mx,my,pass,shoot,sprint,sw}`: **es literalmente un paquete de red serializable**. Tenés medio puerto de entrada escrito sin saberlo.

**(c) MVC no tiene la palabra "tiempo".** Tu frontera arquitectónica más importante no es Modelo/Vista/Controlador: es **paso de simulación fijo vs. frame de render variable**. Hoy `animate()` mete `clock.getDelta()` directo a la física (`b.position.addScaledVector(u.vel, dt)`, línea 1151) y encima la IA decide con probabilidades **por frame** (`Math.random()<0.02*diff.react`): **hoy tu juego se juega distinto a 60 Hz que a 144 Hz**. Ningún reparto MVC arregla eso; un acumulador de paso fijo sí.

**(d) MVC no exige que el Modelo sea serializable ni determinista**, que es justo lo que necesita el online. Hoy `S._owner` es una **referencia viva** a un `Player`, que contiene un `THREE.Group` con geometrías de WebGL. Eso no cabe en un paquete de red.

### Lo que usamos en su lugar

> **Núcleo de simulación determinista + puertos y adaptadores.**
> Flujo en **un solo sentido**: `InputCommand → stepMatch(match, inputs, DT) → MatchEvent[] → presentadores`.

Traducido al vocabulario que esperabas:

| MVC | En FÚLBO se llama | Qué es |
|---|---|---|
| **Modelo** | `src/core/` | Estado plano + reglas. Sin `THREE`, sin `document`, sin `Math.random`, sin `setTimeout`. Corre en Node. |
| **Vista** | `src/render/` + `src/ui/` + `src/audio/` | **Lee** el estado cada frame (`SceneBinder.sync(match, alpha)`) y **escucha** eventos discretos (gol, tarjeta, silbato). Nunca escribe en el estado. |
| **Controlador** | `src/input/` + `src/app/` | Muestrea dispositivos → `InputCommand` serializable. Maneja el bucle. |

Y **donde sí aplicás MVC de verdad**: el menú (`buildMenu`, `renderPlayersCfg`, `renderSel`), la pantalla de torneo (`mostrarTorneo`) y el scorebug. Son formularios y tablas, cambian por acción del usuario, son puro DOM. Ahí un **view-model** (`MatchState → HudVM`) es el patrón correcto y es lo que vas a escribir en `src/ui/`.

**Frase para recordarlo: MVC en el menú, simulación pura en el campo.**

### Las 4 soldaduras reales (verificadas en tu archivo)

Esto es lo que hay que cortar. No es teoría:

1. **`Player.build()` termina en `scene.add(g)`** dentro del constructor (línea ~875). Crear un jugador exige un `scene` de WebGL vivo. Por eso no arranca en Node.
2. **El balón autoritativo ES un `THREE.Mesh`.** `ball.position` (34 accesos directos, más los alias `const b=ball` / `const u=b.userData`) y `ball.userData.vel`. La física vive dentro de un objeto de render.
3. **`Player.update(dt)` mezcla animación y REGLAS.** Verificado en las líneas 878-905: además de rotar mallas, calcula `this.facing = Math.atan2(this.vel.x, this.vel.z)` — que leen `tryPossession` (1368), `kickBall` y `slideTackle` — y decrementa `stunTimer`, `slideCd`, `heading` y **`this.sliding` (escondido dentro de la rama visual de la pose de barrida)**. Si te llevás `update()` entero a la vista, en el servidor **todos apuntan a +Z y las barridas no terminan nunca**. Detalle extra: `p.update(dt)` se llama **fuera del `if(S.phase==='play')`**, o sea que esos temporizadores avanzan en todas las fases. Al moverlos, mantené esa semántica.
4. **`refreshRings()` (1092) — la soldadura que casi nadie ve.** Toca `p.ring.visible` y `p.ring.material.color`, y se la llama desde **6 puntos de simulación**: 1124, 1223 (saque), 1327 (expulsión), **1431 (dentro de `doPass`)**, 1646 y 1651 (`updateHuman`). Ningún `grep "THREE"` ni `grep "document"` la detecta, porque no contiene ninguna de las dos palabras. **Es la que va a tirar tu primer `sim90.mjs` con un `TypeError` en el primer pase.**

Y el caso especial que hay que tratar aparte:

5. **`playReplay()` (1720) ESCRIBE el estado autoritativo**: `e.pl.pos.set(nx,0,nz)`, `e.pl.vel.set(...)`, `ball.position.set(...)`. Hoy es inocuo sólo porque `endReplay()` llama a `placeKickoff()` después. **La repetición no es una vista: hoy es un rebobinador del modelo.** Y `replay.frames[].pl` guarda la **referencia viva al objeto Player**, así que ni se puede serializar.

Bonus que también hay que arreglar: **`updatePhase` tiene el equipo 0 cableado como "el humano"** (líneas 1868, 1873, 1877: `if(S.kickTeam!==0 ...)`, `const auto = (sp && sp.team===0) ? 4.5 : 1.3`). En cuanto haya humanos en **ambos** equipos — que es exactamente el multijugador local que ya tenés y el online que querés — al humano del equipo 1 la IA le ejecuta el saque en 1.3 s. Se cambia por *"¿este equipo tiene un asiento humano?"*.

---

## 2. Árbol de archivos definitivo

**Criterio de granularidad (deliberado):** ~55 archivos, no 99. Ningún archivo por debajo de ~40 líneas salvo constantes y datos; los `core/systems/*` quedan en 60-140 líneas cada uno, que es la unidad en la que realmente vas a trabajar. Fragmentar `buildSky` (16 líneas) en su propio archivo es un impuesto de navegación que pagás todos los días.

```
E:\fulbo\
├─ index.html                   ~100 líneas: SOLO el markup (menú, HUD, pausa, torneo, loader,
│                                 minimap, scorebug, cardFx, replayFx, padstate) + <script src=/src/main.js>
├─ package.json                 scripts: dev, build, preview, test, golden, sim90
├─ vite.config.js
├─ jsconfig.json                checkJs:true para todo el proyecto (JSDoc, sin migrar a .ts)
├─ tsconfig.core.json           SOLO src/core + src/data · "lib":["ES2022"] SIN "DOM"  ← la prueba real
├─ eslint.config.js             no-restricted-imports en src/core/**: 'three', '../ui/*',
│                                 '../render/*', '../audio/*'  +  no-restricted-globals: document,
│                                 window, Math.random, setTimeout, Date
├─ vercel.json                  outputDirectory: "dist"  (hoy cachea /index.html: hay que tocarlo)
├─ legacy/
│  └─ index-v0.html             EL MONOLITO CONGELADO. Nunca se toca. A/B visual en dos pestañas.
├─ scripts/
│  ├─ sim90.mjs                 partido completo IA vs IA en Node, sin canvas. Imprime marcador+hash.
│  └─ golden.mjs                genera/compara tests/golden/*.json
│
├─ src/
│  ├─ main.js                   ← ex boot() (2386). Raíz de composición: orden EXPLÍCITO de init().
│  │
│  ├─ core/            ★ SIN three · SIN document · SIN Math.random · SIN setTimeout · SIN Date
│  │  ├─ index.js               API pública: createMatch(cfg, seed) · stepMatch(m, inputs, DT) → MatchEvent[]
│  │  ├─ state.js               MatchState: fusiona S(372) + teams(989) + ball(756) + cards(1297)
│  │  │                           + lastTouch(1146) + goalCooldown(1190) + offsidePend(1436)
│  │  │                           + passReceiver + lastScorer + seats + rng. Todo plano y serializable.
│  │  ├─ constants.js           F, HALF_W, HALF_L, GOAL_*, BALL_R, CIRCULO, TOQUE_MAX(1.05),
│  │  │                           CAPTURA(1.70), SPRINT_MUL, GRAVEDAD 22, REBOTE .45, FRICCION .12,
│  │  │                           ARRASTRE .75, KICK_LOCK, REPLAY_SEC/HZ/SPEED, halfLen
│  │  ├─ math.js                Vec3 con la API **IDÉNTICA** a THREE.Vector3 (set, copy, add, sub,
│  │  │                           addScaledVector, multiplyScalar, length, lengthSq, normalize, lerp,
│  │  │                           setLength, distanceToSquared) + Vec2 + distXZ + clamp + damp
│  │  ├─ rng.js                 mulberry32; el ESTADO del rng vive dentro de MatchState
│  │  ├─ events.js              MatchEvent: GOL FALTA TARJETA EXPULSION SAQUE SILBATO PATADA PASE
│  │  │                           TIRO CABEZAZO FUERA_DE_JUEGO CONTROL_CAMBIADO DESCANSO FINAL
│  │  ├─ snapshot.js            encode/decode a ArrayBuffer + hashMatch() + lerpSnapshot()
│  │  ├─ input.js               InputCommand {seq, tick, mx, my, buttons:bitmask} + derivación de
│  │  │                           FLANCOS dentro de la sim (comparando con prevButtons de cada asiento)
│  │  ├─ league.js              LIGA, generarCalendario, crearLiga, registrar, golesSimulados,
│  │  │                           simularJornada, clasificacion, partidoUsuario  (ya es puro hoy)
│  │  └─ systems/
│  │     ├─ phase.js            updatePhase(1864), scoreGoal(1809) sin DOM/audio, reloj, medio tiempo,
│  │     │                        fin de partido (sin setTimeout), duración retenida de la fase 'goal'
│  │     ├─ humans.js           updateHumans(1612)/updateHuman(1615) — SIN el remap de cámara
│  │     ├─ seats.js            ★ asignarControl(1100), masCercanoLibre(1107),
│  │     │                        asignarPosicionesIniciales(1118), humanoDe(1126).
│  │     │                        El asiento es ESTADO DE SIM (seatId ↔ playerId, por id, no por ref).
│  │     ├─ movement.js         steer(1558), baseSpeed(1552), clampToField(1567), separarJugadores(1016),
│  │     │                        stamina, integración, homePos(1007), goalDirZ(1141)
│  │     │                        ★ y tickTimers(): facing, stunTimer, slideCd, heading, sliding, runPhase
│  │     ├─ ai.js               updateAI(1472), shouldChase(1537), aiWithBall(1572)
│  │     ├─ goalkeeper.js       goalkeeper(1590), inPenaltyBox(1298)
│  │     ├─ ball.js             updateBall(1147) SIN rotación visual ni blob · handleGoalCheck(1191)
│  │     ├─ possession.js       tryPossession(1353), kickBall(1396), nearestToBall(1075),
│  │     │                        nearestOpponentDist(1452)
│  │     ├─ actions.js          doPass(1411), doShoot(1459), canHead(1661), header(1665), slideTackle(1680)
│  │     ├─ offside.js          isOffside(1437), callOffside(1446)
│  │     ├─ fouls.js            commitFoul(1302), sendOff(1323), estado de tarjetas
│  │     ├─ setpieces.js        SP_LABEL, startSetPiece(1207), positionForSetPiece(1229), takeSetPiece(1271)
│  │     └─ kickoff.js          spawnTeams(991) sólo datos, placeKickoff(1034), enforceKickoffRule(1525),
│  │                              setFormation(1129), cycleFormation(1136)
│  │
│  ├─ data/                     datos puros, cero lógica
│  │  ├─ teams.js               TEAMS(301)          ├─ names.js       NOMBRES(312)
│  │  ├─ formations.js          FORMACIONES(317), NOMBRES_FORM, FORMATION, etiquetasSlots(2281)
│  │  └─ difficulty.js          DIFF
│  │
│  ├─ input/                    === CONTROLADOR ===
│  │  ├─ devices.js             keys{}(920), pad{}(928), listeners, DISPOSITIVOS(1085), leerDispositivo(935)
│  │  ├─ sampler.js             pollInput(967) → InputCommand[]  (SIN detección de flanco: va en la sim)
│  │  └─ cameraSpace.js         ★ el remap de cámara lateral (-move.y, 0, move.x) SALE de la sim.
│  │                              El servidor no debe saber dónde está tu cámara.
│  │
│  ├─ render/                   ★ TODO lo que dice "THREE." vive aquí y en ningún otro sitio
│  │  ├─ Renderer.js            initThree(393), EffectComposer/UnrealBloom/OutputPass, resize,
│  │  │                           conmutación calidad alta|media (2103) — ¡preservar la rama del bloom!
│  │  ├─ SceneBinder.js         ★ sync(match, prev, alpha): proyecta MatchState → mallas. Indexa por
│  │  │                           playerId estable, no por identidad de objeto. Crea/destruye vistas.
│  │  ├─ PlayerView.js          todo build()(795-876) + la MITAD DE ANIMACIÓN de update():
│  │  │                           rotaciones, cadencia, codos, rebote del torso, poses de barrida
│  │  │                           (-1.15) / caído (-1.35) / cabezazo (-0.45), blob, ring de control
│  │  ├─ BallView.js            malla + textura de paneles(743) + rotación visual + blob de sombra
│  │  ├─ assets.js              ★ GeometryCache compartido (hoy 22 jugadores × ~14 mallas cada uno crean
│  │  │                           su geometría), skinTex(768), softShadowTexture(355), disposeAll()
│  │  ├─ stadium/
│  │  │  ├─ sky.js              buildSky(437) + buildFlashes(1982)
│  │  │  ├─ lights.js           buildLights(453), buildFloodTower(481)
│  │  │  ├─ pitch.js            buildField(573), makePitchTexture(502), buildGoal(647), makeNetTexture(595)
│  │  │  └─ stands.js           buildStadium(675), buildCrowd(711), updateCrowd(1965),
│  │  │                           buildLedBoards(626), makeLedTexture(609)
│  │  ├─ fx.js                  buildConfetti(1924), burstConfetti(1934), updateConfetti(1949)
│  │  ├─ camera.js              updateCamera(1778), camTarget, VIEW_LEN, CAM_DIST, CAM_H, AIM_X,
│  │  │                           + replayCamera(1744)
│  │  └─ replayView.js          ★ recordReplay/startReplay/playReplay/endReplay REESCRITOS sobre
│  │                              snapshots. NO escribe el estado autoritativo: pinta un estado paralelo.
│  │
│  ├─ ui/                       === AQUÍ SÍ: MVC/MVVM ===
│  │  ├─ viewmodels.js          MatchState → HudVM / MenuVM / TorneoVM. Puro, testeable sin navegador.
│  │  ├─ hud.js                 announce(1820), updateScorebug(1829), updateClock(1833),
│  │  │                           buildStaminaUI(1842), updateStaminaUI(1855),
│  │  │                           showCard(1329), updateCardsUI(1338)
│  │  ├─ minimap.js             drawMinimap(2053) + su getElementById (hoy se ejecuta al cargar → init())
│  │  ├─ menu.js                buildMenu(2217), renderSel(2334), setupHUDTeams(2341), badgeCSS(2215)
│  │  ├─ players.js             crearHumanos(2260), renderPlayersCfg(2291), COLORES_HUMANO(1084),
│  │  │                           updatePadUI(979)
│  │  ├─ tournament.js          mostrarTorneo(2169), tabla, jugarJornada, salirTorneo
│  │  ├─ pause.js               togglePause(2109), #resume, #toMenu
│  │  └─ presenter.js           ★ drena MatchEvent[] cada frame → hud + audio + fx + ring de control
│  │
│  ├─ audio/
│  │  └─ audio.js               initAudio(2013), playKick(2026), playWhistle(2033), crowdCheer(2042),
│  │                             resume en primer gesto(2408). Se SUSCRIBE a eventos.
│  │
│  ├─ app/
│  │  ├─ loop.js                ★ acumulador de paso fijo: DT=1/60, TOPE DE 5 PASOS POR FRAME
│  │  │                           (sin tope = espiral de muerte al volver de una pestaña en segundo plano)
│  │  ├─ session.js             interfaz: .match .events .sendInput(cmd)  — el render no sabe si es on/offline
│  │  ├─ localSession.js        llama stepMatch en el navegador. ES EL JUEGO DE HOY, 1-4 personas.
│  │  ├─ match.js               startMatch(2355) / endMatch(1893) descompuestos: orquesta core+render+ui
│  │  ├─ settings.js            quality, difficulty, halfLen, formation, numHumanos (hoy mezclados en S)
│  │  └─ debug.js               ★ window.__dbg AMPLIADO (ver Fase 0)
│  │
│  ├─ net/                      === VACÍO hasta la Fase 6 ===
│  │  ├─ transport.js           interfaz send/onMessage/close (aísla de Colyseus)
│  │  ├─ protocol.js            ids de mensaje + PROTOCOL_VERSION (reusa core/snapshot.js)
│  │  ├─ onlineSession.js       implementa Session contra la red
│  │  ├─ predictor.js           ★ ROLLBACK + resimulación del World completo (ver §5)
│  │  ├─ clock.js               RTT, offset de tick, drift
│  │  └─ lobby.js               crear/unirse por código, lista de salas, ready, reconexión
│  │
│  └─ styles/
│     ├─ base.css               :root vars (--verde1/--acento/--panel), reset, #app, #loader
│     ├─ hud.css                scorebug, announce, cardFx, replayFx, stamina, padstate, minimap
│     └─ menu.css               teamlist, team-opt, opts, chips, pcard, #torneo, tabla, pause
│
├─ tests/
│  ├─ golden/partido-ia-vs-ia.json   ★ la traza de referencia (generada en la Fase 1)
│  ├─ golden.test.js            reproduce la traza y compara hash por segundo  ← EL TEST QUE MANDA
│  ├─ determinism.test.js       misma semilla + mismos inputs = mismo hash a los 90'
│  ├─ isolation.test.js         ★ DOS createMatch() con semillas distintas, step() intercalado,
│  │                              hashes independientes  ← prueba que no queda estado global
│  ├─ ball.test.js              gravedad 22, rebote .45, fricción, salida por banda
│  ├─ possession.test.js        invariante CAPTURA(1.70) > TOQUE_MAX(1.05)
│  ├─ offside.test.js           penúltimo defensor, propio campo, delante del balón
│  ├─ setpieces.test.js         banda/córner/puerta según lastTouch
│  ├─ seats.test.js             ★ el pase reasigna control; nadie roba el jugador de OTRO humano
│  └─ league.test.js            round-robin de 8 equipos: 7 jornadas × 4 partidos
│
└─ server/                      === FASE 7+. NO va en Vercel. Sin monorepo ni workspaces. ===
   ├─ package.json              importa el core por RUTA RELATIVA: '../src/core/index.js'
   ├─ Dockerfile                ★ contexto de build = raíz del repo; COPY src/core src/data server
   └─ src/
      ├─ index.js               arranque Colyseus + @colyseus/monitor + /health
      ├─ MatchRoom.js           ★ el "mini servidor": 1 sala = 1 createMatch() + acumulador 60 Hz
      ├─ LobbyRoom.js           listado de salas públicas
      ├─ inputQueue.js          ★ COLA por asiento con seq + ack del último seq procesado
      ├─ encode.js              snapshot binario cuantizado (x,z int16 cm · facing int8 · flags bitmask)
      └─ validate.js            clamp |move|<=1, rate limit, seq fuera de ventana, anti-spam de 'switch'
```

---

## 3. Framework y librerías: qué sí, qué no, y por qué

### Ahora (los tres únicos imprescindibles)

**1. Vite** (`npm create vite@latest`, plantilla vanilla) — **este es "el framework que ayuda a mantener el código"**. Recarga en caliente (hoy recargás 2411 líneas a mano), build a `dist/` estático que Vercel despliega igual, y te saca de encima el importmap de unpkg, que hoy es **un punto único de fallo de terceros en cada carga** (líneas 279-283).
*Nota:* el comando instala la versión mayor actual; fijala en `package.json` y no la persigas.

**2. three por npm, versión 0.160.0 exacta** (`npm i three`). **No la subas durante el refactor.** De r160 en adelante hay cambios de color management y postprocesado que pueden alterar el look del bloom y del tone mapping ACES que ya afinaste. Una variable a la vez.
*Dato verificado:* el `exports map` de three r160 **ya resuelve `three/addons/*` desde npm**. No tenés que reescribir los imports a `three/examples/jsm/` ni poner un alias. Es trabajo inventado.

**3. Vitest** — comparte configuración con Vite, cero toolchain nueva. Es lo que convierte "creo que no rompí nada" en un hash idéntico.

### Tipos: JSDoc + `checkJs`, no migración a `.ts`

`jsconfig.json` con `"checkJs": true` y tipos en JSDoc (`/** @param {MatchState} m */`). **Y esto entra en la Fase 3, ANTES de la cirugía de vectores**, no al final: el compilador es la única red automática que atrapa "cambiaste la forma de `pos`", "olvidaste un `.set()`", "esta función todavía llama a `Math.random`". Ponerlo después significa hacer la parte peligrosa a ciegas y volver a pasar por los mismos 20 archivos.

Añadí `tsconfig.core.json` que compila **sólo** `src/core` + `src/data` con `"lib": ["ES2022"]` **sin `"DOM"`**. Ese detalle es el que hace que la puerta sirva: con la lib DOM heredada, un `document.getElementById` dentro de `core/` **compila perfectamente** y el núcleo "headless" explota recién en Node.

### El Vec3: **API idéntica a THREE.Vector3**

Conté 77 llamadas a la API de `Vector3` dentro del rango de simulación (`.set`, `.copy`, `.add`, `.sub`, `.addScaledVector`, `.length`, `.lerp`, `.multiplyScalar`, `.normalize`, `.distanceToSquared`, `.setLength`, `.lengthSq`). Si escribís un Vec3 "bonito" con funciones libres y otros nombres, convertís un buscar-y-reemplazar en **77 ediciones a mano sobre código afinado a sensación**. Con la API idéntica, la Fase 4a es literalmente `new THREE.Vector3(` → `new Vec3(` y nada más. ~80 líneas de archivo, riesgo casi cero.

### Cuando ataques el online

**Colyseus** (versión estable actual de la línea 0.16). Su primitiva de primera clase es la **Room**: es literalmente el "mini servidor donde se conectan y juegan" que pediste. Trae matchmaking, códigos de sala privada, `LobbyRoom`, `allowReconnection()` y ciclo de vida, que es justo la parte de netcode que no querés escribir.

**Dos advertencias honestas que las otras propuestas escondieron:**
- Colyseus es de facto **un mantenedor**, y su API de `@colyseus/schema` **ha roto entre versiones menores**. Es una apuesta razonable, pero es una apuesta.
- Por eso: **usá Colyseus para salas, matchmaking y ciclo de vida; NO para sincronizar el estado del partido.** El `Schema` lleva sólo estado lento (marcador, fase, roster, ready). Los snapshots calientes van como **ArrayBuffer propio** por `room.send()`, detrás de `net/transport.js`. Si algún día Colyseus estorba, lo reemplazás por `ws` + `Map<roomId, Match>` tocando ~200 líneas.
  *(Sí, esto significa que no usás su función estrella. Es deliberado: pagás la dependencia por el lobby, no por el sincronizador, y evitás la duplicación `MatchState` ↔ `MatchSchema` que obligaría a mantener a mano un bucle de copia de 22 jugadores × 8 campos a 60 Hz.)*

**Presupuesto de ancho de banda, calculado:** 22 jugadores × (x, z, facing, flags cuantizados ≈ 7 B) + balón (12 B) + fase/marcador/reloj/posesión/asientos (~20 B) ≈ **190 bytes por snapshot**. A 20 Hz son **~3.8 KB/s de bajada por cliente**. No hace falta optimizar nada — pero **sí hace falta que sea binario**: el mismo estado en JSON son ~1200 B y ×8 la factura sin contrapartida.

### Descartados, con motivo

| Descartado | Por qué |
|---|---|
| **ECS (bitECS, miniplex)** | 23 entidades. El beneficio de rendimiento es **cero** y bitECS te obliga a que la entidad sea un `number` y los componentes `TypedArray`s: reescribís las 107 funciones y perdés la legibilidad de `teams[p.team].filter(m => m!==p && !m.isGK)`. Tu problema no es cómo se almacenan las entidades: es que la simulación llama al DOM. |
| **Babylon / PlayCanvas / Phaser / react-three-fiber** | Tirarías 2411 líneas que funcionan y **se ven bien**: el rig procedural de 12 piezas, `makePitchTexture` a 16 px/m, las vallas LED con emissiveMap, la grada como InstancedMesh, la cámara de TV con `AIM_X` por bisectriz. Semanas para llegar al mismo píxel. |
| **Motor de física (Rapier, cannon-es)** | `updateBall` son 12 líneas de Euler ya calibradas (gravedad 22, rebote 0.45, `Math.pow(0.12,dt)`). Un motor real añade ~1 MB, te quita el control del *feel* arcade y complica el determinismo. La colisión que necesitás son dos comparaciones contra `HALF_W`/`HALF_L`. |
| **React / Vue / Zustand** | No hay React en el proyecto. El HUD son 8 nodos DOM que ya actualizás a mano. Un árbol de reconciliación encima de un canvas a 60 fps para gestionar un marcador es coste puro. |
| **Lit** | Se justificaría por un lobby que **no existe hasta la Fase 8**. Es un tercer paradigma nuevo (shadow DOM peleando con tu CSS global) a crédito contra una feature especulativa. Si en la Fase 8 el `innerHTML` del lobby te duele, lo agregás **entonces**, sólo para el lobby. |
| **Lockstep determinista / Rune** | Requiere determinismo **bit a bit entre motores**, y `Math.sin/cos/pow/atan2/hypot` **no** están garantizados idénticos entre V8, SpiderMonkey y JavaScriptCore. Chrome y Firefox se desincronizarían. Y en lockstep todos esperan al de peor ping. |
| **geckos.io / WebRTC-UDP en la v1** | Necesita un rango de puertos UDP abiertos (fuera de casi todo PaaS barato) y STUN. Queda como **swap detrás de `transport.js`** si algún día la latencia duele. |
| **Socket.IO como base** | Te da un socket y nada más: salas, delta, matchmaking, códigos y reconexión los escribís vos, que es justo lo que no dominás. |

---

## 4. Plan de migración

**Regla que vale para todo el plan: al final de cada fase el juego arranca, se juega y despliega.** Si una fase no puede cumplir eso, está mal partida.

### 🟢 HAZLO AHORA — Fases 0 a 5 (~35-45 horas de tardes)

---

#### **FASE 0 — Red de seguridad e instrumentación** (2-3 h)

Esto no toca una línea de lógica y es lo que hace verificable todo lo demás.

1. `git init` si hace falta, commitear el estado actual, `git tag v0-monolito`.
2. Copiar `index.html` → `legacy/index-v0.html`. **Ese archivo no se toca nunca más.** Es el A/B visual en dos pestañas.
3. **Ampliar `window.__dbg`** (hoy, línea 2397, sólo tiene *getters* de lectura: `cam`, `ball`, `S`, `teams`, `camCalls`, `LIGA`). Añadir **comandos de forzado**:
   ```js
   __dbg.seed(n)              __dbg.hash()
   __dbg.forceSetPiece('penal'|'corner'|'banda'|'puerta', team)
   __dbg.card(playerId,'roja'|'amarilla')     __dbg.forceOffside()
   __dbg.teleportBall(x,y,z)  __dbg.setClock(seg)   __dbg.goal(team)
   ```
   Son ~30 líneas. **Convierten tu checklist de humo de 20 minutos de juego con suerte en 90 segundos deterministas.** Sin esto, "provocar un penal" depende de que la IA barra al 2% por frame *dentro del área*; nadie repite eso 20 veces y a la tercera fase se abandona la verificación.
4. Escribir en el README la **checklist de humo de 12 puntos** (menú → elegir equipos → 2 humanos teclado 1 y 2 → gol → repetición → córner → banda → penal → roja → cambio de formación con F → pausa con Esc → una jornada de torneo). Con `__dbg` se corre entera en minuto y medio.

**Verificable:** `legacy/index-v0.html` y `index.html` se juegan idénticos; los 12 puntos pasan en 90 s.

---

#### **FASE 1 — Determinismo y golden master, TODAVÍA en el monolito** (3-4 h) ⭐ **la fase que salva el proyecto**

**Esta fase va antes de partir nada. Es la corrección más importante respecto de cualquier plan "primero Vite, después tests".** Hacerla ahora significa que el único archivo que existe es el que ya conocés, que cualquier diferencia de sensación se atribuye sin ambigüedad, y que a partir de aquí **tenés un oráculo automático** para las 4 fases peligrosas que vienen.

1. **RNG sembrado.** `mulberry32(seed)` y reemplazar los **~18 `Math.random()` que afectan a las reglas** (de los 40 totales): `separarJugadores` 1023 · `positionForSetPiece` 1243/1245/1249 · `takeSetPiece` 1278/1281 · severidad de falta 1307 · dispersión de tiro `doShoot` 1461 · cabezazo de la IA 1486 · barrida de la IA 1492 · `aiWithBall` 1577/1578/1580/1584 · portero 1604 · `header` 1669/1672 · goleador 1814.
   **NO toques los ~22 cosméticos**: piel y pelo (799, 818), césped (528-530), estrellas (447), público (723-729), paneles del balón (750), confeti (1941-43), flashes (1985-90), ruido de grada (2019). *Esa separación "aleatorio de reglas" vs "aleatorio visual" es exactamente la frontera core/render, y sirve como comprobación de que el corte está bien pensado.*
2. **Paso fijo, dentro de `animate()`.** Acumulador `DT = 1/60`, **tope de 5 pasos por frame**. El bloque `if(S.phase==='play'||'kickoff')` pasa a correr en ticks fijos; el render sigue a la tasa del monitor.
3. **Probabilidades por frame → por segundo.** Verificado: `updateAI` usa `Math.random()<0.30` (cabezazo) y `<0.02*diff.react` (barrida) **sin multiplicar por dt**, y `aiWithBall` igual (0.006 + react*0.01, y 0.05 el pase). Hoy en un monitor de 144 Hz la IA barre **~2.4 veces más** que a 60 Hz. Escalalas: `rng() < 0.02*diff.react*60*DT`.
4. **Arreglar `steer()` mientras estás ahí.** `p.vel.lerp(desired, Math.min(1, dt*6))` **no es dt-correcto**: la aceleración efectiva cambia con el dt. Con paso fijo deja de importar en el cliente, pero **el servidor tiene que usar el mismo DT**, así que dejá la forma exponencial `1 - Math.pow(1-0.1, dt*60)` o simplemente fijá `DT` y documentalo.
5. **Grabador de golden master.** Reusá `recordReplay` (1705), que ya muestrea a 30 Hz exactamente lo que hace falta. `__dbg.golden(90)` corre 90 segundos IA vs IA con semilla fija e inputs guionados, y vuelca un JSON con **un hash del estado por segundo**. Guardalo en `tests/golden/partido-ia-vs-ia.json`.

**⚠️ Aviso honesto:** esta fase **cambia la sensación del juego a propósito**. Tus constantes (`adher` 12/8 de la línea 1374, la aceleración de `updateHuman`, `TOQUE_MAX` 1.05) están afinadas contra `clock.getDelta()` variable. Vas a necesitar **una tarde entera de retoque**, y hay que hacerla ahora, aislada, con el monolito intacto y `legacy/index-v0.html` abierto al lado. Es innegociable: sin paso fijo no hay online, y sin hacerlo primero nunca vas a poder distinguir "retoque intencional" de "bug de la Fase 4".

**Verificable:** `__dbg.golden(90)` da el mismo hash dos veces seguidas; el juego se siente igual de bien a 60 y a 144 Hz; los 12 puntos de humo pasan.
**A partir de aquí, toda fase que cambie el golden sin que vos lo hayas decidido es un bug, y sabés exactamente en qué commit.**

---

#### **FASE 2 — Vite y npm, sin partir nada** (1-2 h)

`npm create vite@latest` (⚠️ sobre un directorio no vacío te **pregunta si borra los archivos existentes**; el tag `v0-monolito` te salva, pero no digas que sí a ciegas). `npm i three@0.160.0`, `npm i -D vite vitest`.

- Borrar el importmap (279-283).
- Mover el `<script type="module">` completo (286-2409) a `src/main.js` **tal cual, sin reordenar una línea**.
- Mover el `<style>` (7-188) a `src/styles/base.css` e importarlo desde `main.js`.
- `index.html` queda con el markup del body (~96 líneas reales, 190-285: menú, HUD, pausa, torneo) + el `<script src="/src/main.js">`.
- `vercel.json`: añadir `"outputDirectory": "dist"` y `"buildCommand": "vite build"`. **Probá `vercel --prod` en esta fase, no al final** — si no ajustás la salida, Vercel sirve el `index.html` viejo sin scripts y el juego aparece en negro.

**Verificable:** golden idéntico byte a byte + humo + despliegue en producción funcionando. Ganancia inmediata: HMR, y el juego deja de depender de que unpkg esté vivo.

---

#### **FASE 3 — Split mecánico + `checkJs`** (1 día, hacelo en un solo día)

Repartir las 2124 líneas en los archivos del árbol usando `export`/`import`. **Copiar y pegar; no refactorizar nada.**

**Tres trampas concretas, verificadas, que hay que anticipar:**

1. **Los bindings importados de ESM son de sólo lectura.** Hay ~15 globales `let` que se **asignan dentro de funciones** que van a otro archivo: `renderer/scene/camera/clock/composer/bloomPass` se asignan en `initThree` (394-418), `ball` en `buildBall` (753), `actx/crowdGain` en `initAudio`, `goalCooldown` en `scoreGoal` pero se lee en `animate` (2098), `lastScorer` en `scoreGoal` y se lee en `endReplay` y `replayCamera`. Si los ponés en un `globals.js` y hacés `import {renderer}`, `renderer = new THREE.WebGLRenderer(...)` es **un error de compilación**. **Solución: un único objeto contenedor mutable** `src/app/G.js` → `export const G = {}` y `G.renderer = ...`. Feo a propósito, temporal, y desaparece en la Fase 4g.
2. **Prohibido el efecto secundario a nivel de módulo.** Hoy la línea 2052 hace `document.getElementById('minimap')` al cargar, y los listeners de teclado se registran en la 921. Cada archivo exporta una `init()` y `main.js` tiene **una lista explícita** de llamadas en el orden exacto de `boot()` (initThree antes que buildSky, buildBall antes que spawnTeams).
3. **Preservar la rama del bloom.** `animate()` hace `if(S.quality==='alta' && composer) composer.render(); else renderer.render(scene, camera)`. Al mover el bucle es facilísimo perderla. Probá **las dos calidades**.

Al final de la fase: `jsconfig.json` con `checkJs:true` y tipar con JSDoc `MatchState`, `PlayerState`, `InputCommand` y `MatchEvent`. **Antes de la Fase 4, no después.**

**Verificable:** golden idéntico + humo + ningún archivo por encima de ~350 líneas.

---

#### **FASE 4 — Cortar las soldaduras** (2-3 días) ⭐ **el corazón del refactor**

**Un sub-paso = un commit = correr el golden.** Si el golden cambia, revertís ese commit y ya sabés por qué.

**4a. Vec3 drop-in** (1 h). `core/math.js` con la API idéntica a `THREE.Vector3`. Reemplazar `new THREE.Vector3(` por `new Vec3(` **sólo** en estado de simulación: `p.pos`, `p.vel`, `p.home`, la velocidad del balón, los scratch. El render sigue usando `THREE.Vector3` donde le convenga.
**⚠️ Matá los scratch compartidos.** `_v` y `_v2` (línea 1074) los usan hoy `updateHuman`, `updateAI`, `aiWithBall` **y `updateCamera`**. Funciona por disciplina implícita. Al modularizar, cada módulo declara los suyos; **nunca exportes `_v`**, o te ganás un teletransporte intermitente 1 de cada 1000 frames.

**4b. Des-Three-ificar el balón** (3-4 h). `match.ball = { pos:Vec3, vel:Vec3, r, kickLock, spin }`. **Estrategia de coexistencia para no hacer un big-bang:** primero introducí `match.ball` como fuente de verdad y **espejá una vez por frame** hacia `ball.position`, dejando vivos los ~43 lectores; después migralos de a tandas. `BallView.sync()` se lleva la rotación visual (1182-83) y el blob (1185-88). Borrá `ball.userData`.

**4c. Partir `Player` en dos** (4-6 h). `PlayerState` (datos planos, con `playerId = team*100 + i`) a `core/state.js`; `build()` completo y la animación a `render/PlayerView.js`. **Y — esto es lo que rompe todo si se pasa por alto — a `core/systems/movement.js:tickTimers()` se van:**
- `this.facing = Math.atan2(this.vel.x, this.vel.z)` (línea 881) → **es estado autoritativo**, lo leen `tryPossession`, `kickBall` y `slideTackle`.
- `stunTimer -= dt`, `slideCd -= dt`, `heading -= dt` (902-904).
- **`this.sliding -= dt`**, que está escondido **dentro de la rama visual** `if(this.sliding>0){...}` (línea 901). Si se queda en la vista, en el servidor **las barridas no terminan nunca**.
- `runPhase` puede quedarse en la vista (es puramente cosmético) — pero si lo dejás ahí, no lo grabes en el snapshot.
- **Y `tickTimers` debe correr en TODAS las fases**, como hoy: `p.update(dt)` está fuera del `if(S.phase==='play')`.

Introducí `GeometryCache` en `render/assets.js`: hoy cada uno de los 22 jugadores crea sus propias cápsulas y materiales. Y arreglá el leak que **ya existe**: `startMatch()` (2357) hace `scene.remove(p.mesh)` pero **nunca llama a `dispose()`** sobre geometrías, materiales ni texturas — en modo torneo (8 equipos, 7 jornadas) eso acumula memoria de GPU partido tras partido.

**4d. Asientos (`seats`) y `refreshRings`** (2-3 h). El vínculo humano↔jugador es **estado de simulación**, no una variable local:
```js
match.seats = [{ seatId, controllerId, team, slot, playerId, prevButtons }]
playerState.ownerSeat = seatId | null
```
Se acaban `h.controlled` y `p.humanOwner` como referencias vivas (y su ciclo, que revienta cualquier `JSON.stringify`). `asignarControl` queda en `core/systems/seats.js` **sin llamar a `refreshRings()`**: emite `{type:'CONTROL_CAMBIADO', seatId, playerId}` y `ui/presenter.js` pinta el anillo. Y **filtrá el robo**: hoy `asignarControl` quita el control a otro humano y `doPass` (1431) elige receptor sin mirar `ownerSeat` — en el sofá es una rareza, online es griefing.

**4e. Outbox de eventos** (3-4 h). `match.events` se vacía en cada tick. `scoreGoal` (1809), que hoy toca cuatro capas en nueve líneas, pasa a `state.score[team]++` + `push({type:'GOL', team, scorerIdx})`. Igual con `startSetPiece` (que llama a `announce` y `playWhistle` en 1221-22 **desde dentro de `updateBall`**), `kickBall`→`PATADA` (quitando el `playKick()` de 1407 y el de 1693), `commitFoul`, `sendOff`, `callOffside`, y los silbatos.
**Y sacá los `setTimeout` de reloj de pared del flujo de partido:** `endMatch` espera 5000 ms (1898), `announce._t` 2600 ms (1826), `showCard._t` 2200 ms (1334). En el servidor se desincronizan del tick, y si el navegador pasa a segundo plano el `requestAnimationFrame` se frena pero el `setTimeout` no. Los de UI (`announce`, `showCard`) pueden quedarse — son de la vista. **El de `endMatch` pasa a `match.phaseT`.**

**4f. Sacar la repetición de la simulación** (3-4 h) — **el sub-paso que ninguna propuesta trató bien.**
Hoy `playReplay` **escribe el estado autoritativo** (`e.pl.pos.set(...)`, `e.pl.vel.set(...)`, `ball.position.set(...)`) y guarda **la referencia viva `pl`**. Y `updatePhase` sólo avanza a `kickoff` porque `endReplay()` llama a `placeKickoff()`. Diseño nuevo:
- La sim, tras un gol, entra en fase `'goal'` con una **duración retenida** (`goalHoldT`) y al terminar hace `placeKickoff` y pasa a `'kickoff'`. **La sim no sabe qué es una repetición.**
- `render/replayView.js` guarda un buffer de **snapshots** (arrays planos indexados por `playerId`, formato de `core/snapshot.js`) y durante la fase `'goal'` pinta **ese** estado paralelo en lugar del estado vivo. El `SceneBinder` acepta una fuente de poses que no es el `MatchState`.
- Ganancia doble: la repetición deja de mutar el modelo, **y el formato del buffer de repetición pasa a ser el formato del paquete de red**. Ya tenías escrito el interpolador de snapshots a 30 Hz sin saberlo.

**4g. `createMatch()` — un objeto, no globales** (4-6 h, mecánico). Todo lo que hoy es variable suelta de módulo (`S`, `teams`, `names`, `ball`, `cards`, `lastTouch`, `offsidePend`, `goalCooldown`, `lastScorer`, `passReceiver`, `seats`, `rng`) entra en `match`. Todas las funciones de `core/` reciben `match` como primer argumento. `core/index.js` expone `stepMatch(match, inputs, DT)` reproduciendo **exactamente** el orden de `animate()`:
`updatePhase → updateHumans → updateAI → enforceKickoffRule → tryPossession → updateBall → tickTimers`.
**Ese orden es semántico**: `enforceKickoffRule` corrige posiciones *después* de que la IA se mueva, y `tryPossession` corre *antes* de `updateBall` para que el balón herede `owner.vel`. Cambiarlo cambia el juego.
Aprovechá para **borrar el equipo 0 cableado** de `updatePhase` (1868/1873/1877): `const esHumano = match.seats.some(s => s.team === sp.team)`.

**Verificable tras cada sub-paso:** golden idéntico + humo + A/B contra `legacy/index-v0.html`.

---

#### **FASE 5 — Cerrar la puerta y probar que es headless** (1 día) 🛑 **PUNTO DE PARADA DECLARADO**

1. **ESLint** en `src/core/**`: `no-restricted-imports` para `three`, `../ui/*`, `../render/*`, `../audio/*` (el lint anti-`three` solo **no alcanza**: un `import { announce } from '../ui/hud'` pasaría), y `no-restricted-globals` para `document`, `window`, `Math.random`, `setTimeout`, `Date`.
2. **`tsconfig.core.json`** con `"lib": ["ES2022"]` **sin DOM**. Si compila, el núcleo es headless de verdad.
3. **`node scripts/sim90.mjs`**: partido completo IA vs IA, sin canvas, en menos de un segundo. Imprime marcador, faltas y hash.
4. **La batería de tests**, en este orden de valor: `golden` → `isolation` (dos partidos simultáneos, step intercalado, hashes independientes — **este es el invariante que exigen las salas**) → `determinism` → `seats` → `possession` → `ball` → `offside` → `setpieces` → `league`.

> **🛑 Acá podés parar para siempre y el proyecto ya ganó.**
> Tenés: archivos de tamaño humano, HMR, cero dependencia de unpkg, sin bug de 144 Hz, tests automáticos, un golden master que te protege de toda regresión futura, y el juego se siente igual o mejor. Los puntos 1 y 2 de tu pedido están **completos**. Si el online nunca llega, no perdiste nada. **Volvé a esta línea antes de empezar la Fase 6.**

---

### 🔵 CUANDO ATAQUES EL ONLINE — Fases 6 a 9

**Regla de entrada: no escribas una línea de red hasta que `sim90.mjs` corra en Node y `golden.test.js` esté en verde.**

#### **FASE 6 — El input como frontera de red** (1 día, todavía offline)
- `core/input.js` define `InputCommand {seq, tick, mx, my, buttons:bitmask}`. **Con `seq` desde el día uno** — cuesta 15 líneas y sin él la reconciliación de la Fase 9 es imposible sin rediseñar el protocolo.
- **Los flancos se derivan DENTRO de la sim**, comparando `buttons` con `seat.prevButtons`. Hoy `pollInput` los calcula a frecuencia de render (`i.pass = r.pass && !i._p`); si el sampler los calcula, la resimulación **no los reproduce** y los pases se pierden o se duplican. Si mandás input a 30 Hz contra un servidor a 60 Hz con booleanos de nivel, **un pase se pierde o se manda dos veces**.
- El **remap de cámara lateral** (`_v.set(-input.move.y, 0, input.move.x)`, línea ~1620) sale de la sim a `input/cameraSpace.js`. El servidor no debe saber dónde está tu cámara.
- `h.device` ('teclado1'/'pad0') → `controllerId`, que en local es el dispositivo y online es el `sessionId`. **Así el multijugador local y el online comparten el mismo camino de código** en vez de bifurcarse en dos que hay que mantener para siempre.

#### **FASE 7 — `Session` y servidor mínimo** (2-3 días)
- `app/session.js` (interfaz) + `app/localSession.js` (el juego de hoy). Todo el render y la UI leen `session.match` y `session.events`. Sin cambio visible.
- `server/` con Colyseus. `MatchRoom.onCreate` siembra el RNG y llama a `createMatch()`.
- **⚠️ El servidor también necesita acumulador.** `setSimulationInterval` pasa el **delta real transcurrido**, no `1/60`, y el jitter de `setInterval` en Windows/Node es de 1-16 ms. Si escribís `setSimulationInterval(dt => stepMatch(m, inputs, dt), 1000/60)`, **la física del servidor difiere de la del cliente desde el primer tick**. Va: `setSimulationInterval(dtReal => { acc += dtReal; while(acc >= DT){ stepMatch(m, inputs, DT); acc -= DT; } }, 1000/60)`.
- `inputQueue.js`: **cola por asiento con `seq`**, y cada snapshot lleva el `lastProcessedSeq` de ese cliente.
- **Objetivo medible de la fase:** dos pestañas en la misma sala ven el mismo partido, **sin predicción todavía**. Si eso funciona en localhost, la arquitectura es correcta.

#### **FASE 8 — Lobby, salas y despliegue** (2-3 días)
Códigos de 4-5 letras, salas públicas, `LobbyRoom`, reconexión, reclamo de asiento. **Ojo:** todo el flujo que hoy *crea* el partido (`buildMenu`, `crearHumanos`, `renderPlayersCfg`, `asignarPosicionesIniciales`) vive en el DOM del cliente; en una sala eso se convierte en **una máquina de estados del servidor** con reclamo de asiento, resolución de conflictos, ready-up y expulsión. **Es la fase más subestimada del plan: presupuestala como si fuera del mismo tamaño que la Fase 7.**

#### **FASE 9 — Rollback y resimulación** (la difícil) — ver §5.

---

### Ranking de valor, para que decidas dónde parar

| Fase | Horas | Lo que te da |
|---|---|---|
| 0-1 | 6-8 | **El mayor retorno del plan.** Arregla un bug real (144 Hz), te da un oráculo automático, y hace verificable todo lo demás. |
| 2-3 | 10-12 | Lo que pediste en tus puntos 1 y 2: archivos, HMR, sin unpkg, tipos. |
| 4-5 | 20-25 | Mantenibilidad real + desbloquea el online. |
| 6-9 | 60-120 | **Sólo si vas al online.** Las fases 8 y 9 son investigación abierta, no refactor mecánico. |

---

## 5. Multijugador online: salas, autoridad y transporte

### El hallazgo que te ahorra la mitad del trabajo

`updateAI` ya hace `if(p.humanOwner){ continue; }` (línea 1477). **El multijugador local que ya escribiste ES el diseño del online.** Un slot con dueño humano lo mueve una persona; sin dueño, lo mueve la IA. Online sólo cambia *dónde vive* ese humano. **No hay que escribir una línea de IA nueva**, y una sala es jugable con 2 personas o con 8, sin necesitar 22.

### Modelo de autoridad

**Servidor autoritativo, sin excepciones**, sobre: posición y velocidad del balón, posesión, goles, faltas, tarjetas, fuera de juego, saques, reloj, fases, la IA de los 22, **y la asignación de asientos** (`asignarControl` / `masCercanoLibre`).

**El cliente sólo manda `InputCommand`.** Nunca posiciones, nunca eventos. `doShoot` y `slideTackle` tienen consecuencias de reglas (dispersión aleatoria, falta, tarjeta) que no pueden salir de la máquina del jugador. `validate.js` clampa `|move| <= 1`, limita la frecuencia y **limita el spam de `switch`** (hoy `asignarControl` le quita explícitamente el control a otro humano: online eso es robo de jugador entre compañeros).

### ⭐ La corrección más importante: **rollback del World completo, no "predice tu jugador e interpola el resto"**

Ese es el error que hunde el netcode de un juego de fútbol, y hay que verlo con los números de **tu** código:

`tryPossession` (1376) hace `ball.position.lerp(target, dt*adher)` con `target = owner.pos + dir*toque` y `toque <= TOQUE_MAX = 1.05 m`. Es decir: **durante el regate, la posición autoritativa del balón es una función de la posición del jugador.** Si predecís tu cuerpo pero interpolás el balón desde snapshots retrasados, a velocidad de sprint (~9 m/s con `SPRINT_MUL 1.3`) y con RTT/2 + 100 ms de buffer, **el balón se dibuja 1.1-1.4 m por detrás de tus pies**: más que un toque entero, y cerca de `CAPTURA` (1.70). Ves tu jugador corriendo sin balón. Y `tryPossession`, `slideTackle` y `canHead` deciden por proximidad global entre los 22, así que disputás la pelota contra un mundo 100 ms viejo.

**La solución correcta aquí es barata precisamente porque este juego es chico:**

> **Rollback + resimulación del `MatchState` completo.**
> El cliente guarda los últimos ~15 snapshots y sus propios `InputCommand`. Al llegar un snapshot autoritativo con `lastProcessedSeq`, restaura **el estado completo** (incluido el estado del RNG, que por eso vive dentro de `MatchState`) y **re-simula hasta el presente** con `stepMatch`, reaplicando sus inputs no confirmados y repitiendo el último input conocido de los remotos.

Costes reales: 23 entidades, ~0.2-0.5 ms por tick. Ocho ticks de resimulación son **~2-4 ms por snapshot recibido, 20 veces por segundo**. Perfectamente asequible, y resuelve de un golpe **todos** los problemas que hunden la alternativa: el balón va pegado a tus pies porque lo simulás vos también; la posesión disputada se predice y se corrige sola; el **cambio de jugador controlado** (que `doPass` dispara en la línea 1431 varias veces por minuto) se predice porque `asignarControl` es parte del `stepMatch` que estás resimulando.

Esto **sólo es posible porque el determinismo se construyó en la Fase 1**. Es la razón por la que esa fase va primera y no última.

**Umbral y corrección:** si tras la resimulación tu jugador difiere >5 cm, aceptás el estado del servidor sin más (ya está resimulado, no hay snap visible). Los remotos se dibujan con interpolación suave sobre el resultado de la resimulación.

**Qué NO hacer:** predecir sólo tu jugador. Lo probás y "se siente raro" durante una semana entera sin saber por qué.

### Transporte

**WebSocket binario** (Colyseus sobre `ws`), detrás de `net/transport.js`.
- Snapshots: **ArrayBuffer + DataView**, cuantizado (x/z int16 en cm, facing int8, flags en bitmask). ~190 B a 20 Hz = **3.8 KB/s**. Nada de JSON: multiplicaría por 8 sin contrapartida.
- **Dos canales lógicos**: los `MatchEvent` (GOL, TARJETA, SILBATO) necesitan **fiabilidad y orden**; los snapshots no. Con WebSocket ambos van fiables y no hay problema. **Pero si algún día cambiás a WebRTC no fiable, los eventos NO pueden ir por el mismo canal** o se pierden en silencio y el marcador no sube. Diseñá el protocolo con esa separación desde ya.
- Se descarta WebRTC/UDP en la v1 (STUN/TURN, rango de puertos UDP fuera de casi todo PaaS barato). Queda como swap detrás de la interfaz.

### Salas = "mini servidores"

```js
class MatchRoom { onCreate(opts){ this.match = createMatch(opts, seed); } }
```
**Esa frase es toda la arquitectura de servidor, y sólo es posible después de la Fase 4g.** Un `Map<codigo, MatchRoom>` en un solo proceso Node.

- **Entrar:** `client.joinOrCreate('match')` (partida rápida) · `client.joinById('K7M2')` (código de 4-5 letras que compartís por WhatsApp) · `LobbyRoom` con la lista pública.
- **Asientos:** cada cliente reclama un asiento (equipo + puesto) con la misma UI de `renderPlayersCfg`. Los puestos sin humano los mueve la IA que ya tenés.
- **Desconexión:** `seat.controllerId = null` → la IA retoma ese jugador **instantáneamente e invisiblemente**. `allowReconnection(30s)` para volver al mismo puesto. El partido no se interrumpe nunca.
- **Capacidad, medida honestamente:** `separarJugadores` es O(n²) sobre 22 con 4 iteraciones, `updateAI` hace escaneos de rival más cercano dentro de su bucle, `tryPossession` recorre los 22. Realista: **0.2-0.5 ms/tick/sala**, o sea **~25-40 salas por núcleo** antes de saturar el presupuesto de 16.6 ms, y eso antes de serializar y escribir sockets. No son "cientos". **Medí `process.cpuUsage()` con 10 salas ANTES de anunciar el modo online.**
- **Empezá por 1v1 o 2v2 + IA.** Si arrancás por 11v11 online, el proyecto se estanca en el lobby y nunca llegás a jugar.

### Hosting

**El cliente sigue estático en Vercel, gratis.** **Vercel NO puede alojar el servidor**: es serverless y sin estado; una sala es un proceso vivo con estado en memoria simulando 60 veces por segundo durante 4 minutos. Va a **Fly.io / Railway / Render**, ~5-10 USD/mes, con TLS para `wss://`, CORS y una variable `VITE_GAME_SERVER_URL`. Sin monorepo ni npm workspaces: `server/` tiene su propio `package.json` e importa el core por **ruta relativa** (`../src/core/index.js`), y el **Dockerfile usa la raíz del repo como contexto de build**. Desarrollo en Windows con `tsx watch server/src/index.js`.

*Alternativa barata que evalué y descarto como base, pero que existe:* **host autoritativo** — el navegador de uno corre la simulación y los demás mandan inputs. Elimina el servidor de juego, pero igual necesitás señalización, y perdés el lobby, la reconexión y la resistencia a que el host se vaya. Como el core ya es headless, **portarlo después cuesta un archivo**: si te asusta el coste mensual, es un v0 legítimo.

### ✅ Las 10 reglas que hay que respetar DESDE HOY

Estas son las que, si las rompés, te obligan a rehacer trabajo:

1. **`src/core/` no importa `three`, no toca `document`, no llama a `announce/playWhistle/showCard`.** Aplicado por ESLint + `tsconfig.core.json` sin lib DOM.
2. **Cero `Math.random()` en el core.** Sólo `match.rng()`, y su **estado vive dentro de `MatchState`** (sin eso, no hay rollback).
3. **Cero `setTimeout`/`Date.now()` en el flujo de partido.** Temporizadores en tiempo de simulación (`match.phaseT`).
4. **Cero estado mutable a nivel de módulo** en `core/`. Todo cuelga de `match`. Lo verifica `isolation.test.js`.
5. **Ids, nunca referencias.** `S._owner`, `h.controlled`, `p.humanOwner`, `offsidePend`, `passReceiver` y `replay.frames[].pl` pasan a `playerId`/`seatId`. Y `p.formation` guarda hoy **una referencia al objeto de `FORMACIONES`**: pasá a `formName` y resolvé al leer.
6. **Paso fijo de 60 Hz en cliente y servidor**, con el **mismo acumulador**.
7. **`InputCommand` lleva `seq` y `tick`**, y el servidor **acusa recibo** del último `seq` procesado en cada snapshot.
8. **Los flancos de botón se derivan en la sim**, comparando con `seat.prevButtons`. Nunca en el sampler.
9. **El snapshot debe contener todo lo que `stepMatch` LEE**, no sólo lo que se dibuja: `vel`, `stamina`, `stunTimer`, `slideCd`, `sliding`, `heading`, `ownerSeat`, `lastTouch`, `offsidePend`, `passReceiver`, `goalCooldown`, `phaseT`, `setPiece`, `cards` y **el estado del RNG**. Un snapshot "de render" no sirve para resimular.
10. **El remap de cámara vive en el cliente.** El servidor no sabe dónde está tu cámara.

---

## 6. Los 3 errores más caros que debés evitar

### ❌ 1. Hacer la cirugía antes de tener el oráculo

**El error:** montar Vite, partir 50 archivos, des-Three-ificar el balón y partir `Player` — y recién entonces escribir los tests. Es lo que hacen por defecto todos los planes de refactor, y es exactamente al revés.

**Por qué duele tanto acá:** tu juego está afinado **a sensación**, con constantes comentadas en el propio código (`TOQUE_MAX 1.05` vs `CAPTURA 1.70`, con el comentario que avisa de que si se invierten "el balón sale despedido"; `adher` 12 para humanos vs 8 para IA; rebote 0.45; `Math.pow(0.12,dt)`). Una regresión ahí **no lanza ninguna excepción y no aparece en ninguna consola**: simplemente el regate deja de sentirse bien, tres semanas después, con ocho commits enormes de por medio y sin ninguna línea base contra la que comparar. Y la "checklist de humo manual" que todo el mundo promete se abandona en el cuarto commit, porque provocar un penal a voluntad hoy es imposible.

**El arreglo, y es barato:** Fase 0 (`__dbg` con comandos de forzado, ~30 líneas) + Fase 1 (RNG sembrado + paso fijo + golden master reusando `recordReplay`, que **ya está escrito** y ya muestrea exactamente lo que hace falta). Son 6-8 horas **antes** de tocar la estructura, y convierten las Fases 3, 4 y 5 en verificables hash a hash.

---

### ❌ 2. Elegir mal el modelo de red: "predecir mi jugador e interpolar el balón"

**El error:** el manual de netcode de shooters dice "predecí tu personaje, interpolá el resto". Aplicado a un juego de fútbol donde el balón va **pegado al pie** (`ball.lerp(owner.pos + dir*toque, dt*12)`, con `toque <= 1.05 m`), produce el peor artefacto posible: **corrés y el balón se arrastra un metro por detrás tuyo**, y cada pase o remate arranca de un balón que ves que no está donde estás. No es un problema de tuning ni de transporte: UDP baja la latencia, no elimina el RTT. Es el único fallo de esta lista que **no se arregla cambiando un adaptador**, y aparece recién cuando ya escribiste todo el netcode.

**Su corolario, igual de caro:** diseñar el protocolo *sin* `seq`, sin ack, guardando "sólo el último input por asiento", y con un snapshot que sólo lleva lo que se dibuja. Eso **diseña fuera** la única salida que tenés, y descubrirlo te obliga a rediseñar protocolo, cola de entrada y estrategia de corrección.

**El arreglo:** **rollback + resimulación del `MatchState` completo** desde el primer día de online, que con 23 entidades cuesta 2-4 ms por snapshot. Requiere: RNG dentro del estado, snapshot completo, `seq` + ack, y paso fijo idéntico en ambos lados. Todo eso son decisiones de las Fases 1, 4 y 6, es decir, **decisiones que tomás antes de escribir una línea de red**.

---

### ❌ 3. Convertir el refactor en un big-bang y quedarte a mitad

**El error tiene tres caras, y todas terminan igual: un repo a medio migrar, injugable, abandonado.**
- **Cambiar de motor o meter ECS/física "ya que estoy".** Reescribirías las 130 referencias a `THREE.` y el estadio procedural entero — semanas para llegar al mismo píxel, resolviendo un problema que no tenés. Tu problema no es el render (que está pulido y se ve bien): es que la simulación llama al DOM.
- **Fragmentar en 99 archivos de 30 líneas** porque "más módulos es más limpio". Para una persona sola eso no es mantenibilidad, es un impuesto de navegación pagado todos los días. 55 archivos de tamaño humano dan el 95% del beneficio.
- **No tener un punto de parada.** Un plan de 12-15 pasos sin una línea que diga *"acá ya ganaste"* garantiza que si te cansás en el paso 7 sentís que fracasaste, cuando en realidad ya cobraste todo lo que pediste.

**El arreglo, explícito:**
- Fase 3 en **un solo día** (un árbol a medio partir es el peor sitio donde dejar el proyecto).
- Fase 4 en **sub-pasos de un commit cada uno**, cada uno con golden. Y para los dos más grandes (balón y `Player`), **estrategia de coexistencia**: introducí la nueva fuente de verdad, espejala hacia la vieja una vez por frame, y migrá los lectores de a tandas. Nada de tocar 43 sitios en un commit.
- **El fin de la Fase 5 es la meta.** Ahí están completos los puntos 1 y 2 de tu pedido. La Fase 6 en adelante es un **producto nuevo**, no una feature más: decidilo con la cabeza fría, con el juego funcionando y los tests en verde, y no antes.

---

**Archivos clave del proyecto actual referenciados:** `E:\fulbo\index.html` (monolito, 2411 líneas) · `E:\fulbo\vercel.json` (hoy sin `outputDirectory`, hay que tocarlo en la Fase 2).