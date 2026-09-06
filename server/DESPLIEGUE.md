# Poner el servidor en internet

El cliente sigue en Vercel, gratis. El servidor **no puede ir ahí**: Vercel es
serverless y sin estado, y una sala es un proceso vivo simulando sesenta veces
por segundo durante cuatro minutos. Va a Fly.io, Railway o Render.

Todo lo que sigue está probado con la imagen ya construida en esta máquina
(`docker build -f server/Dockerfile -t fulbo-salas .`), salvo los dos pasos que
requieren TU cuenta.

## Antes de publicar: leé esto

El almacén de cuentas por defecto (`AUTH=local`) guarda contraseñas con scrypt
y sal, y está bien hecho, pero **no tiene recuperación de contraseña, ni
verificación, ni es una base de datos** — es un JSON en un volumen. Para jugar
con conocidos alcanza. Si vas a abrirlo a desconocidos, poné `AUTH=supabase` y
`SUPABASE_JWT_SECRET`, y las contraseñas dejan de ser tuyas para custodiar.

## Fly.io

```bash
# 1) instalar y entrar (esto lo hacés vos: crear cuentas y pagar no lo
#    automatizo)
#    https://fly.io/docs/flyctl/install/
fly auth login

# 2) crear la app sin desplegar todavía
fly apps create fulbo-salas

# 3) el volumen donde viven las cuentas: sin esto, cada despliegue las borra
fly volumes create fulbo_datos --region eze --size 1 --app fulbo-salas

# 4) desplegar — OJO: desde la RAÍZ del repo, no desde server/
fly deploy . --config server/fly.toml

# 5) comprobar
curl https://fulbo-salas.fly.dev/salud
```

Coste orientativo: una `shared-cpu-1x` de 512 MB con `auto_stop_machines`
suspende la máquina cuando no hay nadie conectado, así que en reposo tiende a
cero y sólo pagás mientras se juega. El volumen de 1 GB sí es fijo (centavos).

## Conectar el cliente

El juego tiene que saber a dónde conectarse. En Vercel, variable de entorno:

```
VITE_SERVIDOR = wss://fulbo-salas.fly.dev
```

y volver a desplegar el cliente. **Tiene que ser `wss://`, no `ws://`**: una
página servida por https no puede abrir un socket sin cifrar, el navegador lo
bloquea y el juego se queda "conectando…" sin decir por qué. Si falta la
variable, la consola avisa.

Y en `server/fly.toml`, `ORIGENES` tiene que ser la URL exacta de tu web, o el
servidor rechazará las conexiones con un 403.

## Railway o Render

Mismo Dockerfile. Lo único que hay que respetar:

- **contexto de build = la raíz del repo** (el servidor importa `../../src/core`);
- un **disco persistente montado en `/datos`**;
- las variables `PORT`, `CUENTAS=/datos/cuentas.json`, `ORIGENES`;
- comprobación de salud en `/salud`.

## Lo que ya está puesto para aguantar internet

| | |
|---|---|
| Lista de orígenes | sólo tu web puede abrir sockets (`ORIGENES`) |
| Tope de mensaje | 16 KB; un mensaje del juego no llega a 1 KB |
| Tope de salas | 200 (`MAX_SALAS`) |
| Tope de conexiones | 400 (`MAX_CONEX`) |
| Registros por IP | 5 por hora (`MAX_REGISTROS_IP`) |
| Intentos de entrada | 5 fallos bloquean 15 minutos, por cuenta |
| Usuario del contenedor | sin privilegios, no root |
| Apagado ordenado | avisa a las salas y cierra los sockets con SIGTERM |

Comprobado contra el contenedor, no sobre el papel:

- la suite entera (`npm run probar`) pasa contra la imagen;
- origen permitido → aceptado; origen ajeno → 403; sin origen → 403;
- `docker stop` deja `[SIGTERM] cerrando: 3 sala(s)` en el log;
- 7 cuentas sobrevivieron a borrar y recrear el contenedor con el mismo volumen.
