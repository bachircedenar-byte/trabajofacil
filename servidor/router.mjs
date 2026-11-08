/* ==========================================================================
   TrabajoFácil — router HTTP mínimo (sin dependencias)
   Patrones con parámetros (`/t/:id`), parseo de formularios, subida de
   ficheros vía multipart/form-data y servicio de estáticos.
   ========================================================================== */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DIR_CONTENIDO = join(raiz, 'contenido');
export const DIR_ASSETS = join(raiz, 'assets');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.woff2': 'font/woff2'
};

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */
export function crearRouter() {
  const rutas = [];

  function registrar(metodo, patron, handler, opts = {}) {
    const nombres = [];
    const regex = new RegExp('^' + patron.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) => {
      nombres.push(n); return '([^/]+)';
    }).replace(/\*$/, '(.*)') + '$');
    rutas.push({ metodo, regex, nombres, handler, opts });
  }

  return {
    get(patron, handler, opts) { registrar('GET', patron, handler, opts); },
    post(patron, handler, opts) { registrar('POST', patron, handler, opts); },
    put(patron, handler, opts) { registrar('PUT', patron, handler, opts); },
    del(patron, handler, opts) { registrar('DELETE', patron, handler, opts); },

    resolver(metodo, ruta) {
      let existeRuta = false;
      for (const r of rutas) {
        const m = r.regex.exec(ruta);
        if (!m) continue;
        existeRuta = true;
        if (r.metodo !== metodo) continue;
        const params = {};
        r.nombres.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params, opts: r.opts };
      }
      return existeRuta ? { metodoNoPermitido: true } : null;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Lectura del cuerpo de la petición                                   */
/* ------------------------------------------------------------------ */
export async function leerCuerpo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  return Buffer.concat(trozos);
}

/* ------------------------------------------------------------------ */
/* Parseo de formularios                                                */
/* ------------------------------------------------------------------ */
export function parsearUrlEncoded(buf) {
  const p = new URLSearchParams(buf.toString('utf8'));
  const out = {};
  for (const [k, v] of p.entries()) {
    if (k in out) out[k] = [].concat(out[k], v);
    else out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Multipart / uploads                                                 */
/* ------------------------------------------------------------------ */
export async function parsearMultipart(req, buf, destinoDir) {
  const ct = req.headers['content-type'] || '';
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
  if (!m) return { campos: {}, archivos: [] };
  const boundary = (m[1] || m[2]).trim();
  const campos = {};
  const archivos = [];

  const sep = Buffer.from('--' + boundary);
  let inicio = buf.indexOf(sep);
  if (inicio < 0) return { campos, archivos };
  inicio += sep.length;

  while (inicio < buf.length) {
    // fin del cuerpo
    if (buf.slice(inicio, inicio + 2).toString() === '--') break;
    // saltar CRLF
    if (buf.slice(inicio, inicio + 2).toString() === '\r\n') inicio += 2;
    const finParte = buf.indexOf(sep, inicio);
    if (finParte < 0) break;
    let fin = finParte;
    if (buf.slice(fin - 2, fin).toString() === '\r\n') fin -= 2;

    const parte = buf.slice(inicio, fin);
    const corte = parte.indexOf('\r\n\r\n');
    if (corte < 0) { inicio = finParte + sep.length; continue; }

    const cabeceras = parte.slice(0, corte).toString('utf8');
    const contenido = parte.slice(corte + 4);

    const nm = /name="([^"]*)"/i.exec(cabeceras);
    const nombreCampo = nm ? nm[1] : '';
    const nf = /filename="([^"]*)"/i.exec(cabeceras);
    const tipo = (/content-type:\s*([^\r\n]+)/i.exec(cabeceras) || [])[1] || 'application/octet-stream';

    if (nf && nf[1]) {
      const original = nf[1];
      const seguro = original.replace(/[^\w.\-]+/g, '_').slice(-80);
      const sub = join(destinoDir, seguro.replace(/^.*[\\/]/, '') || 'fichero');
      const dir = dirname(sub);
      await mkdir(dir, { recursive: true });
      await writeFile(sub, contenido);
      archivos.push({
        campo: nombreCampo, nombre: original, ruta: sub,
        nombreGuardado: seguro, tipo, tamano: contenido.length
      });
    } else if (nombreCampo) {
      const texto = contenido.toString('utf8');
      if (nombreCampo in campos) campos[nombreCampo] = [].concat(campos[nombreCampo], texto);
      else campos[nombreCampo] = texto;
    }

    inicio = finParte + sep.length;
  }
  return { campos, archivos };
}

/* ------------------------------------------------------------------ */
/* Estáticos                                                            */
/* ------------------------------------------------------------------ */
export async function servirEstatico(res, urlPath) {
  const limpio = decodeURIComponent(urlPath.split('?')[0]);
  let base = null, resto = limpio;

  if (limpio.startsWith('/assets/')) { base = DIR_ASSETS; resto = limpio.slice('/assets'.length); }
  else if (limpio.startsWith('/contenido/')) { base = DIR_CONTENIDO; resto = limpio.slice('/contenido'.length); }
  if (!base) return false;

  const destino = join(base, normalize(resto).replace(/^(\.\.[/\\])+/, ''));
  if (!destino.startsWith(base)) return false;

  try {
    const datos = await readFile(destino);
    res.writeHead(200, {
      'Content-Type': MIME[extname(destino).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=300'
    });
    res.end(datos);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Respuestas                                                          */
/* ------------------------------------------------------------------ */
export function responderJson(res, datos, codigo = 200) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(datos));
}

export function responderHtml(res, html, codigo = 200) {
  res.writeHead(codigo, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

export function redirigir(res, ruta, codigo = 302) {
  res.writeHead(codigo, { Location: ruta });
  res.end();
}
