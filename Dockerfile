# Imagen de producción para cualquier hosting con contenedores
# (Render, Railway, Fly.io, un VPS propio…).
#   docker build -t trabajofacil .
#   docker run -p 4174:4174 -v tf-datos:/datos -e TF_DB=/datos/trabajofacil.db trabajofacil
FROM node:24-alpine

WORKDIR /app

# El proyecto no tiene dependencias npm: no hace falta npm install.
COPY . .

# La base SQLite vive en un volumen; en un contenedor efímero se perdería.
VOLUME ["/datos"]
ENV TF_DB=/datos/trabajofacil.db
ENV PORT=4174
ENV NODE_ENV=production

EXPOSE 4174

CMD ["node", "servidor/app.mjs"]
