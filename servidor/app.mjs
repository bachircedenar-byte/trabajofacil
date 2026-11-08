/* ==========================================================================
   TrabajoFácil — servidor de la aplicación
   Arranque:  node servidor/app.mjs        (puerto 4174 por defecto)
   ========================================================================== */
import http from 'node:http';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sembrar } from './db.mjs';
import { usuarioActual, leerFlash, ponerCookie, csrfToken } from './auth.mjs';
import {
  crearRouter, leerCuerpo, parsearUrlEncoded, parsearMultipart,
  servirEstatico, responderHtml, responderJson, redirigir, DIR_CONTENIDO
} from './router.mjs';

import { registrarPublico } from './rutas-publico.mjs';
import { registrarCuenta } from './rutas-cuenta.mjs';
import { registrarProfesional } from './rutas-profesional.mjs';
import { registrarAdmin } from './rutas-admin.mjs';
import { layout } from './vistas.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = Number(process.env.PORT || 4174);

await mkdir(DIR_CONTENIDO, { recursive: true });
await mkdir(join(DIR_CONTENIDO, 'documentos'), { recursive: true });
await mkdir(join(DIR_CONTENIDO, 'avatares'), { recursive: true });
sembrar({ silencioso: true });

const router = crearRouter();
registrarPublico(router);
registrarCuenta(router);
registrarProfesional(router);
registrarAdmin(router);

/* ------------------------------------------------------------------ */
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ruta = url.pathname.replace(/\/+$/, '') || '/';

  try {
    /* estáticos */
    if (await servirEstatico(res, ruta)) return;

    /* cuerpo de la petición */
    let body = {};
    let archivos = [];
    if (req.method === 'POST' || req.method === 'PUT') {
      const buf = await leerCuerpo(req);
      const ct = req.headers['content-type'] || '';
      if (ct.includes('multipart/form-data')) {
        const p = await parsearMultipart(req, buf, DIR_CONTENIDO);
        body = p.campos; archivos = p.archivos;
      } else if (ct.includes('application/json')) {
        try { body = JSON.parse(buf.toString('utf8')); } catch { body = {}; }
      } else {
        body = parsearUrlEncoded(buf);
      }
    }

    /* contexto */
    const usuario = usuarioActual(req);
    const ctx = {
      req, res, body, archivos,
      query: Object.fromEntries(url.searchParams.entries()),
      params: {},
      usuario,
      ruta,
      rutaCompleta: req.url,
      csrf: csrfToken(req, res),
      flash: null,
      redirigir(destino) { redirigir(res, destino); },
      json(datos, codigo = 200) { responderJson(res, datos, codigo); }
    };

    const encontrada = router.resolver(req.method, ruta);
    if (!encontrada) return paginaNoEncontrada(ctx);
    if (encontrada.metodoNoPermitido) {
      res.writeHead(405, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>405 — Método no permitido</h1>');
    }

    ctx.params = encontrada.params;

    /* flash: se lee de la cookie y se consume */
    const cookieFlash = leerFlash(req, res);
    if (cookieFlash) {
      ctx.flash = cookieFlash;
      ponerCookie(res, 'tf_flash', '', { maxAge: 0, httpOnly: false });
    }

    const resultado = await encontrada.handler(ctx);

    if (res.headersSent) return;                 // el handler ya respondió
    if (resultado === undefined || resultado === null) return paginaNoEncontrada(ctx);
    if (typeof resultado === 'string') return responderHtml(res, resultado);
    if (resultado.redirigir) return redirigir(res, resultado.redirigir);
    if (resultado.json) return responderJson(res, resultado.json, resultado.codigo || 200);
    return responderHtml(res, String(resultado));

  } catch (err) {
    console.error('✖ Error en', req.method, ruta, '→', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>500 — Error interno</h1><pre>${String(err && err.stack || err)}</pre>`);
    } else res.end();
  }
});

function paginaNoEncontrada(ctx) {
  if (ctx.res.headersSent) return;
  ctx.res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  ctx.res.end(layout({
    titulo: 'Página no encontrada', usuario: ctx.usuario, ruta: ctx.ruta,
    contenido: `<div class="row"><div class="columns centro">
      <h1 style="font-size:4rem;margin:.4em 0 .1em">404</h1>
      <p class="intro" style="margin:0 auto 1.4rem">Esta página no existe o ya no está disponible.</p>
      <div class="acciones" style="justify-content:center">
        <a class="btn" href="/">Volver al inicio</a>
        <a class="btn btn-hollow" href="/servicios">Ver servicios</a>
      </div>
    </div></div>`
  }));
}

servidor.listen(PUERTO, () => {
  console.log(`\n  TrabajoFácil escuchando en http://localhost:${PUERTO}\n`);
  console.log('  Cuentas de demostración (contraseña: demo1234):');
  console.log('    admin@trabajofacil.es  → administrador');
  console.log('    nuria@ejemplo.es       → profesional verificada');
  console.log('    rosa@ejemplo.es        → profesional pendiente de verificar');
  console.log('    admin@trabajofacil.es  → también sirve como cliente para publicar tareas\n');
});
