# Desplegar TrabajoFácil

La aplicación es un **servidor Node** (no un sitio estático): renderiza HTML en
el servidor y guarda los datos en SQLite. Por eso no vale GitHub Pages.

Requisitos: **Node 24 o superior** (usa `node:sqlite`). Cero dependencias npm.

```bash
node servidor/app.mjs      # http://localhost:4174
```

En el primer arranque se crea la base (`datos/trabajofacil.db`) y se siembra con
datos de demostración: 14 usuarios, 9 tareas, 24 presupuestos y las fotos de
ejemplo. No hay nada que instalar.

## Variables de entorno

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `PORT` | `4174` | Puerto de escucha. En Render lo pone la plataforma. |
| `TF_DB` | `<raíz>/datos/trabajofacil.db` | Ruta del fichero SQLite. **Apúntala a un disco persistente.** |
| `TF_BASE` | `http://localhost:4174` | Solo para `herramientas/diagnostico.mjs`. |

## Opción A — Render (recomendada, la más rápida)

El repositorio incluye `render.yaml` (plantilla *Blueprint*).

1. Entra en [render.com](https://render.com) y crea una cuenta (o entra con GitHub).
2. **New → Blueprint** y selecciona el repositorio.
3. Render lee `render.yaml` y crea el servicio web con un disco de 1 GB en
   `/var/data`, y arranca `node servidor/app.mjs` con
   `TF_DB=/var/data/trabajofacil.db`.
4. Cuando termine el despliegue te da una URL pública tipo
   `https://trabajofacil.onrender.com`.

> El disco persistente exige un plan de pago (el gratuito no incluye disco y
> perderías los datos en cada reinicio). Si quieres probar sin pagar, quita el
> bloque `disk:` del `render.yaml` y acepta que la base se resetee al reiniciar.

## Opción B — Docker (cualquier hosting)

```bash
docker build -t trabajofacil .
docker run -d -p 4174:4174 \
  -v tf-datos:/datos \
  -e TF_DB=/datos/trabajofacil.db \
  --name trabajofacil trabajofacil
```

## Opción C — Railway / Fly.io / un VPS

1. New project → Deploy from GitHub → elige el repositorio.
2. **No** marque el repo como build de Node con `npm install`: no hay
   dependencias. El comando de arranque es `node servidor/app.mjs`.
3. Crea un volumen y apúntalo a `/datos`, y define `TF_DB=/datos/trabajofacil.db`.
4. En Fly.io: `fly launch` con `fly.toml` (o `fly volumes create datos` y
   `fly secrets`).

## Sobre SQLite en producción

La base es un fichero. En un contenedor o una plataforma *serverless* sin
volumen, **se pierde en cada reinicio**. Por eso el paso obligatorio en todos
los proveedores es montar un disco y apuntar `TF_DB` a él.

Para escalar a varios instances habría que migrar a PostgreSQL: el SQL usado es
SQLite estándar y las consultas están todas en `servidor/*.mjs` y
`servidor/db.mjs`, sin dialectos propios salvo `INSERT OR IGNORE`/`REPLACE` y
`PRAGMA`.

## CI

El `buildCommand` de `render.yaml` **arranca el servidor y ejecuta las cuatro
baterías de pruebas** (routing, flujo de negocio con tokens, subida de documentos
y verificación de rutas) en cada despliegue. Si alguna falla, el despliegue se
cancela y no se publica: es la misma puerta que en un CI clásico.

Además, el proyecto incluye `.github/workflows/ci.yml`, que hace exactamente lo
mismo en cada `push` a `main` (y añade una insignia en la página del
repositorio). Si quieres activarlo en GitHub, basta con subir ese fichero a la
ruta `.github/workflows/ci.yml` del repositorio desde la web de GitHub: se
puede arrastrar el fichero directamente sobre la raíz del repo y GitHub crea
la carpeta por ti.

## Nota sobre SQLite y las pruebas

Las pruebas del `buildCommand` se ejecutan contra una base recién creada en el
directorio de trabajo (`datos/trabajofacil.db`), no sobre el disco persistente.
La base real del servicio vive en `TF_DB=/var/data/trabajofacil.db`, que se
crea y se siembra sola en el primer arranque.
