# Imagen del servidor de salas.
#
# OJO CON EL CONTEXTO: se construye desde la RAÍZ del repositorio, no desde
# server/. El servidor importa el núcleo por ruta relativa (../../src/core),
# porque las reglas del fútbol son las mismas que corren en el navegador y no
# se duplican. Por eso:
#
#   docker build -f server/Dockerfile -t fulbo-salas .
#                                                    ↑ el punto es la raíz
FROM node:22-alpine

# Un usuario sin privilegios: si alguien encuentra un agujero, que no sea root.
RUN addgroup -S fulbo && adduser -S fulbo -G fulbo

WORKDIR /app

# Las dependencias primero, para que Docker las cachee entre despliegues.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

# El núcleo compartido y el servidor.
COPY src ./src
COPY server/src ./server/src

# Los datos van en un volumen: el disco del contenedor es efímero y sin esto
# cada despliegue borraría todas las cuentas.
RUN mkdir -p /datos && chown -R fulbo:fulbo /datos /app
VOLUME ["/datos"]

ENV NODE_ENV=production \
    PORT=8080 \
    CUENTAS=/datos/cuentas.json

USER fulbo
EXPOSE 8080

# Sin init: node recibe la señal directamente y hace su cierre ordenado.
CMD ["node", "server/src/index.js"]
