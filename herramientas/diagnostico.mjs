/* Diagnóstico: pide cada ruta con timeout de 8 s y reporta cuál se cuelga. */
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const rutaDB = process.env.TF_DB || join(raiz, 'datos', 'trabajofacil.db');
const db = new DatabaseSync(rutaDB);

/* Los slugs se leen de la base de datos: así la comprobación usa siempre
   categorías reales y no inventadas (una ruta inexistente daría un 404
   que parece un fallo del servidor). */
const cat = db.prepare("SELECT slug FROM categorias WHERE activa=1 ORDER BY id LIMIT 1").get();
const slug = cat ? cat.slug : 'limpieza-de-hogar';

const BASE = process.env.TF_BASE || 'http://localhost:4174';
const rutas = [
  '/', '/servicios', '/servicios-de-limpieza-de-hogar', '/servicios-de-limpieza-de-hogar-en-madrid',
  '/t', `/t/taskers-${slug}`, '/tareas-publicas', '/como-funciona', '/precios',
  '/hazte-profesional', '/aviso-legal', '/sitemap.xml', '/api/buscar?q=limpiadora',
  '/accede', '/registro', '/recuperar-contrasena', '/salir',
  '/mi-cuenta', '/mi-cuenta/datos', '/mi-cuenta/tareas', '/mi-cuenta/presupuestos',
  '/mi-cuenta/mensajes', '/mi-cuenta/facturacion', '/publicar-tarea',
  '/profesional', '/profesional/perfil', '/profesional/verificacion', '/profesional/ofertas',
  '/profesional/presupuestos', '/profesional/mensajes', '/profesional/ingresos', '/profesional/ranking',
  '/admin', '/admin/usuarios', '/admin/verificaciones', '/admin/tareas', '/admin/presupuestos',
  '/admin/categorias', '/admin/ciudades', '/admin/transacciones', '/admin/landings', '/admin/auditoria'
];

for (const r of rutas) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(BASE + r, { signal: ctrl.signal, redirect: 'manual' });
    clearTimeout(t);
    await res.text();
    console.log(`${String(res.status).padEnd(4)} ${String(Date.now() - t0).padStart(5)} ms  ${r}`);
  } catch (e) {
    console.log(`COLGADO  ${String(Date.now() - t0).padStart(5)} ms  ${r}  → ${e.message}`);
    process.exit(1);
  }
}
console.log('\nTodas las rutas responden.');
db.close();
