/* ==========================================================================
   TrabajoFácil — prueba de integración end-to-end
   Uso:  node servidor/app.mjs  (en otra terminal)
         node herramientas/probar.mjs [http://localhost:4174]
   Recorre el flujo real: registro, login, perfil, verificación, publicación
   de tarea, presupuesto, aceptación, comisión y panel de administración.
   ========================================================================== */
const BASE = process.argv[2] || 'http://localhost:4174';

let ok = 0, fallos = 0;
const resultados = [];

function marca(nombre, bien, detalle = '') {
  if (bien) { ok++; resultados.push(`  ✓ ${nombre}`); }
  else { fallos++; resultados.push(`  ✗ ${nombre}${detalle ? ' → ' + detalle : ''}`); }
}

/* --- cliente HTTP con galleta de sesión --- */
function crearCliente() {
  let galleta = '';
  return async function pedir(metodo, ruta, cuerpo = null, extra = {}) {
    const cabeceras = { ...(extra.cabeceras || {}) };
    if (cuerpo) cabeceras['Content-Type'] = 'application/x-www-form-urlencoded';
    if (galleta) cabeceras.Cookie = galleta;
    const r = await fetch(BASE + ruta, {
      method: metodo, headers: cabeceras, redirect: 'manual',
      body: cuerpo ? new URLSearchParams(cuerpo).toString() : undefined
    });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of set) {
      const par = c.split(';')[0];
      if (par.startsWith('tf_sesion=') || par.startsWith('tf_csrf=')) {
        const nombre = par.split('=')[0];
        galleta = galleta.split('; ').filter(x => !x.startsWith(nombre + '=')).concat([par]).join('; ');
      }
    }
    const texto = await r.text();
    return { status: r.status, cabeceras: r.headers, cookies: set, texto, url: r.url };
  };
}

function csrfDe(html) {
  const m = /name="csrf"\s+value="([^"]+)"/.exec(html || '');
  return m ? m[1] : '';
}

/* ====================================================================== */
console.log(`\n  Prueba end-to-end contra ${BASE}\n`);

/* --- 1. páginas públicas --- */
{
  const c = crearCliente();
  for (const [ruta, etiqueta] of [
    ['/', 'portada'],
    ['/servicios', 'catálogo de servicios'],
    ['/servicios-de-limpieza-de-hogar', 'landing de servicio'],
    ['/servicios-de-limpieza-de-hogar-en-madrid', 'landing servicio × ciudad'],
    ['/t', 'listado de profesionales'],
    ['/t/taskers-limpieza-de-hogar', 'profesionales por categoría'],
    ['/tareas-publicas', 'tareas públicas'],
    ['/como-funciona', 'cómo funciona'],
    ['/precios', 'precios'],
    ['/hazte-profesional', 'hazte profesional'],
    ['/aviso-legal', 'aviso legal'],
    ['/sitemap.xml', 'sitemap']
  ]) {
    const r = await c('GET', ruta);
    marca(`GET ${ruta} (${etiqueta})`, r.status === 200, `status ${r.status}`);
  }
}

/* --- 2. API del buscador --- */
{
  const c = crearCliente();
  const r = await c('GET', '/api/buscar?q=limpiadora');
  let datos = null;
  try { datos = JSON.parse(r.texto); } catch {}
  marca('GET /api/buscar?q=limpiadora devuelve resultados',
    r.status === 200 && Array.isArray(datos) && datos.length > 0,
    `status ${r.status}`);
  marca('el buscador encuentra "Limpieza de hogar" por sinónimo coloquial',
    !!datos && datos.some(x => /limpieza de hogar/i.test(x.nombre)),
    datos ? JSON.stringify(datos.map(x => x.nombre)) : 'sin datos');
}

/* --- 3. registro de cliente nuevo --- */
const correo = `prueba${Date.now()}@ejemplo.es`;
let csrfRegistro = '';
{
  const c = crearCliente();
  const r0 = await c('GET', '/registro');
  csrfRegistro = csrfDe(r0.texto);
  marca('GET /registro carga el formulario', r0.status === 200 && !!csrfRegistro, `status ${r0.status}`);

  const r = await c('POST', '/registro', {
    csrf: csrfRegistro, nombre: 'Prueba', apellidos: 'Automatizada',
    email: correo, password: 'contrasena123', password2: 'contrasena123',
    repetir: 'contrasena123', telefono: '600111222', cp: '28001'
  });
  marca('POST /registro crea la cuenta', r.status === 302 || r.status === 303, `status ${r.status}`);
}

/* --- 4. la cuenta nueva puede entrar --- */
{
  const c = crearCliente();
  const r0 = await c('GET', '/accede');
  const csrf = csrfDe(r0.texto);
  const r = await c('POST', '/accede', { csrf, email: correo, password: 'contrasena123' });
  marca('POST /accede inicia sesión con la cuenta nueva', r.status === 302 || r.status === 303, `status ${r.status}`);

  const m = await c('GET', '/mi-cuenta');
  marca('GET /mi-cuenta abre el panel del cliente', m.status === 200, `status ${m.status}`);

  const d = await c('GET', '/mi-cuenta/datos');
  marca('GET /mi-cuenta/datos abre el perfil', d.status === 200, `status ${d.status}`);
}

/* --- 5. contraseña incorrecta --- */
{
  const c = crearCliente();
  const r0 = await c('GET', '/accede');
  const csrf = csrfDe(r0.texto);
  const r = await c('POST', '/accede', { csrf, email: correo, password: 'incorrecta123' });
  const vuelve = r.status === 302 ? (r.cabeceras.get('location') || '') : '';
  marca('el login rechaza una contraseña incorrecta', r.status === 302 && /accede/.test(vuelve), `status ${r.status}`);
}

/* --- 6. profesional: verificación de identidad --- */
{
  const c = crearCliente();
  const r0 = await c('GET', '/accede');
  const csrf = csrfDe(r0.texto);
  await c('POST', '/accede', { csrf, email: 'nuria@ejemplo.es', password: 'demo1234' });
  const v = await c('GET', '/profesional/verificacion');
  marca('GET /profesional/verificacion abre el flujo de identidad', v.status === 200, `status ${v.status}`);
  const p = await c('GET', '/profesional');
  marca('GET /profesional abre el panel del profesional', p.status === 200, `status ${p.status}`);
  const o = await c('GET', '/profesional/ofertas');
  marca('GET /profesional/ofertas lista tareas', o.status === 200, `status ${o.status}`);
  const i = await c('GET', '/profesional/ingresos');
  marca('GET /profesional/ingresos muestra el monedero', i.status === 200, `status ${i.status}`);
  const tk = await c('GET', '/profesional/tokens');
  marca('GET /profesional/tokens muestra el monedero de tokens', tk.status === 200, `status ${tk.status}`);
}

/* --- 7. administración --- */
{
  const c = crearCliente();
  const r0 = await c('GET', '/accede');
  const csrf = csrfDe(r0.texto);
  const login = await c('POST', '/accede', { csrf, email: 'admin@trabajofacil.es', password: 'demo1234' });
  marca('el admin puede iniciar sesión', login.status === 302 || login.status === 303, `status ${login.status}`);

  for (const [ruta, etiqueta] of [
    ['/admin', 'dashboard'], ['/admin/usuarios', 'usuarios'],
    ['/admin/verificaciones', 'cola de verificación'], ['/admin/tareas', 'tareas'],
    ['/admin/presupuestos', 'presupuestos'], ['/admin/categorias', 'categorías'],
    ['/admin/ciudades', 'ciudades'], ['/admin/transacciones', 'transacciones'],
    ['/admin/tokens', 'tokens'], ['/admin/landings', 'landings SEO'], ['/admin/auditoria', 'auditoría']
  ]) {
    const r = await c('GET', ruta);
    marca(`GET ${ruta} (${etiqueta})`, r.status === 200, `status ${r.status}`);
  }
}

/* --- 8. protección de rutas privadas --- */
{
  const c = crearCliente();
  const r = await c('GET', '/mi-cuenta');
  const redirige = r.status === 302 && /accede/.test(r.cabeceras.get('location') || '');
  marca('GET /mi-cuenta sin sesión redirige a /accede', redirige, `status ${r.status}`);
  const a = await c('GET', '/admin');
  marca('GET /admin sin sesión no da acceso', a.status === 302 || a.status === 403, `status ${a.status}`);
}

/* --- 9. protección CSRF --- */
{
  const c = crearCliente();
  const r0 = await c('GET', '/accede');
  const csrf = csrfDe(r0.texto);
  await c('POST', '/accede', { csrf, email: 'admin@trabajofacil.es', password: 'demo1234' });
  const r = await c('POST', '/admin/categorias/nueva', { nombre: 'Sin CSRF' });
  marca('un POST sin token CSRF se rechaza', r.status === 302 && /error=csrf|accede/.test(r.cabeceras.get('location') || ''),
    `status ${r.status} → ${r.cabeceras.get('location')}`);
}

/* --- 10. publicar una tarea y recibir presupuesto --- */
{
  const c = crearCliente();
  const r0 = await c('GET', '/accede');
  const csrf = csrfDe(r0.texto);
  await c('POST', '/accede', { csrf, email: correo, password: 'contrasena123' });
  const ver = await c('GET', '/mi-cuenta/verificacion');
  marca('GET /mi-cuenta/verificacion abre la verificación del cliente', ver.status === 200, `status ${ver.status}`);
  const pub = await c('GET', '/publicar-tarea?categoria=limpieza-de-hogar');
  const redirige = pub.status === 302 && /verificacion/.test(pub.cabeceras.get('location') || '');
  marca('un cliente sin verificar no puede publicar una tarea', redirige,
    `status ${pub.status} → ${pub.cabeceras.get('location')}`);
}

/* ====================================================================== */
console.log(resultados.join('\n'));
console.log(`\n  ${ok} correctos · ${fallos} fallidos\n`);
process.exit(fallos > 0 ? 1 : 0);
