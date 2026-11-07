/* Servidor estático mínimo para revisar el prototipo en local.
   Uso:  node herramientas/servidor.mjs [puerto]     (por defecto 4173) */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const puerto = Number(process.argv[2]) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

createServer(async (req, res) => {
  try {
    let ruta = decodeURIComponent(req.url.split('?')[0]);
    if (ruta === '/' || ruta === '') ruta = '/index.html';
    const destino = join(raiz, normalize(ruta).replace(/^(\.\.[/\\])+/, ''));
    if (!destino.startsWith(raiz)) { res.writeHead(403).end('Prohibido'); return; }
    const datos = await readFile(destino);
    res.writeHead(200, { 'Content-Type': MIME[extname(destino).toLowerCase()] || 'application/octet-stream' });
    res.end(datos);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1>');
  }
}).listen(puerto, () => console.log('TrabajoFácil en http://localhost:' + puerto));
