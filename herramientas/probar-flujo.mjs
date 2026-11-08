/* ==========================================================================
   TrabajoFácil — prueba del flujo de negocio completo
   Publicar tarea (con foto del trabajo) → comprar tokens → enviar
   presupuesto → rechazo con devolución de 5 tokens → segundo presupuesto →
   aceptación sin devolución → el profesional cobra el 100 % (sin comisión)
   → completar → valorar → comprobar monedero, tokens y panel de admin.
   Verifica no solo el HTML sino el estado real en la base de datos.
   ========================================================================== */
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:4174';
const db = new DatabaseSync(join(raiz, 'datos', 'trabajofacil.db'));

let ok = 0, fallos = 0;
const lineas = [];
function marca(nombre, bien, detalle = '') {
  if (bien) { ok++; lineas.push(`  ✓ ${nombre}`); }
  else { fallos++; lineas.push(`  ✗ ${nombre}${detalle ? ' → ' + detalle : ''}`); }
}

function crearCliente() {
  let galleta = '';
  return async function pedir(metodo, ruta, cuerpo = null) {
    const cabeceras = {};
    if (cuerpo && !(cuerpo instanceof FormData)) cabeceras['Content-Type'] = 'application/x-www-form-urlencoded';
    if (galleta) cabeceras.Cookie = galleta;
    const r = await fetch(BASE + ruta, {
      method: metodo, headers: cabeceras, redirect: 'manual',
      body: cuerpo instanceof FormData ? cuerpo
        : (cuerpo ? new URLSearchParams(cuerpo).toString() : undefined)
    });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of set) {
      const par = c.split(';')[0];
      if (par.startsWith('tf_sesion=') || par.startsWith('tf_csrf=')) {
        const n = par.split('=')[0];
        galleta = galleta.split('; ').filter(x => !x.startsWith(n + '=')).concat([par]).join('; ');
      }
    }
    return { status: r.status, loc: r.headers.get('location') || '', texto: await r.text() };
  };
}
const csrfDe = h => (/(?:name="csrf"\s+value="|value="[^"]*"\s+name="csrf")([^"]+)"/.exec(h || '')?.[1]) || '';

async function entrar(c, email, password = 'demo1234') {
  const r0 = await c('GET', '/accede');
  const csrf = csrfDe(r0.texto);
  await c('POST', '/accede', { csrf, email, password });
  const chk = await c('GET', '/mi-cuenta');
  return { csrf, ok: chk.status === 200 };
}

/* --- fichero de imagen para la foto del trabajo ------------------------ */
const pngFalso = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
mkdirSync(join(raiz, 'contenido', 'tmp'), { recursive: true });
const rutaFoto = join(raiz, 'contenido', 'tmp', 'trabajo-prueba.png');
writeFileSync(rutaFoto, pngFalso);

/* --- helpers de base de datos ------------------------------------------ */
const idUsuario = email => db.prepare('SELECT id FROM usuarios WHERE email=?').get(email)?.id;
const saldoTokens = id => Number(db.prepare('SELECT COALESCE(SUM(cantidad),0) AS s FROM tokens_movimientos WHERE usuario_id=?').get(id).s);
const fotosDeTarea = id => {
  const f = db.prepare('SELECT fotos FROM tarea_extra WHERE tarea_id=?').get(id);
  try { return JSON.parse(f?.fotos || '[]'); } catch { return []; }
};

/* --- publica una tarea paso a paso (con la foto del trabajo) ----------- */
async function publicarTarea(c, csrf, descripcion) {
  const pasos = [
    ['servicio', { categoria: 'limpieza-de-hogar' }],
    ['cp', { cp: '28001' }],
    ['frecuencia', { frecuencia: 'once' }],
    ['fecha', { fecha: '2026-12-01' }],
    ['hora', { hora: '10:00' }],
    ['horas', { horas: '3' }],
    ['flexibilidad-fecha', { flexibilidad_fecha: 'si' }],
    ['flexibilidad-hora', { flexibilidad_hora: 'cualquiera' }],
    ['transportes', { transportes: 'metro' }],
    ['descripcion', { descripcion }]
  ];
  let okPasos = true;
  for (const [paso, cuerpo] of pasos) {
    const r = await c('POST', '/publicar-tarea/' + paso, { csrf, ...cuerpo });
    if (r.status !== 302) { okPasos = false; break; }
  }
  if (!okPasos) return { id: null, pasos: false };
  // La foto del trabajo es obligatoria: se adjunta en el paso "fotos".
  const fd = new FormData();
  fd.set('csrf', csrf);
  fd.set('fotos', new Blob([pngFalso], { type: 'image/png' }), 'trabajo.png');
  await c('POST', '/publicar-tarea/fotos', fd);
  const rPub = await c('POST', '/publicar-tarea/publicar', { csrf });
  const m = /\/mi-cuenta\/tareas\/(\d+)/.exec(rPub.loc);
  return { id: m ? Number(m[1]) : null, pasos: true, pub: rPub };
}

/* ====================================================================== */
console.log(`\n  Prueba del flujo de negocio contra ${BASE}\n`);

const cliente = crearCliente();
const profesional = crearCliente();

/* --- 1. el cliente publica una tarea paso a paso --- */
const sesionCli = await entrar(cliente, 'admin@trabajofacil.es');
marca('el cliente inicia sesión', sesionCli.ok);

const publicacion = await publicarTarea(cliente, sesionCli.csrf,
  'Piso de 80 m2 en 4o con ascensor. Limpieza a fondo de cocina y dos banos.');
const idTarea = publicacion.id;
marca('POST /publicar-tarea/publicar publica la tarea', !!idTarea, `loc ${publicacion.pub?.loc}`);
marca('la tarea publicada tiene id', !!idTarea);

if (idTarea) {
  const t = db.prepare('SELECT * FROM tareas WHERE id=?').get(idTarea);
  marca('el estado de la tarea es "publicada"', t && t.estado === 'publicada', t ? t.estado : 'no existe');
  marca('la tarea guarda la categoría y la ciudad',
    !!t && !!t.categoria_id && !!t.ciudad_id, JSON.stringify({ cat: t?.categoria_id, ciudad: t?.ciudad_id }));
  marca('la tarea tiene slug SEO', !!t && /^\d+-.*-en-/.test(t.slug || ''), t ? t.slug : '');
  marca('la tarea adjunta la foto del trabajo', fotosDeTarea(idTarea).length > 0, JSON.stringify(fotosDeTarea(idTarea)));
}

/* --- 2. la tarea aparece en el listado público --- */
{
  const anon = crearCliente();
  const r = await anon('GET', '/tareas-publicas');
  marca('la tarea publicada aparece en /tareas-publicas', r.texto.includes('Limpieza a fondo') || r.texto.includes('Piso de 80'), 'no encontrada');
}

/* --- 3. el profesional compra tokens --- */
const sesionPro = await entrar(profesional, 'nuria@ejemplo.es');
marca('el profesional inicia sesión', sesionPro.ok);

const idPro = idUsuario('nuria@ejemplo.es');
const saldoInicial = saldoTokens(idPro);
{
  const monedero = await profesional('GET', '/profesional/tokens');
  marca('el monedero de tokens se abre', monedero.status === 200, `status ${monedero.status}`);
  const r = await profesional('POST', '/profesional/tokens/comprar', { csrf: sesionPro.csrf, tokens: '50' });
  marca('el profesional compra 50 tokens (5 €)', r.status === 302, `status ${r.status}`);
  marca('el saldo sube 50 tokens', saldoTokens(idPro) === saldoInicial + 50,
    `${saldoInicial} → ${saldoTokens(idPro)}`);
  const compra = db.prepare("SELECT * FROM transacciones WHERE usuario_id=? AND tipo='compra_tokens' ORDER BY id DESC").get(idPro);
  marca('la compra se anota como ingreso de la plataforma', !!compra && Number(compra.monto) === 5,
    compra ? String(compra.monto) : 'no existe');
}

/* --- 4. el profesional envía un presupuesto: cuesta 10 tokens --- */
let idPresupuesto = null;
if (idTarea) {
  const vista = await profesional('GET', '/profesional/ofertas');
  marca('la tarea aparece en las ofertas del profesional', vista.texto.includes('Limpieza a fondo') || vista.texto.includes('Piso de 80'), 'no listada');

  const saldoAntes = saldoTokens(idPro);
  const r = await profesional('POST', `/tareas/${idTarea}/presupuesto`, {
    csrf: sesionPro.csrf, precio: '54', horas: '3', mensaje: 'Puedo hacerlo con material propio.'
  });
  marca('el profesional envía un presupuesto de 54 €', r.status === 302, `status ${r.status}`);
  const p = db.prepare('SELECT * FROM presupuestos WHERE tarea_id=? ORDER BY id DESC').get(idTarea);
  idPresupuesto = p ? p.id : null;
  marca('enviar el presupuesto cuesta 10 tokens', saldoTokens(idPro) === saldoAntes - 10,
    `${saldoAntes} → ${saldoTokens(idPro)}`);
  const gasto = db.prepare("SELECT * FROM tokens_movimientos WHERE presupuesto_id=? AND tipo='presupuesto'").get(idPresupuesto);
  marca('el gasto queda anotado en el libro de tokens', !!gasto && Number(gasto.cantidad) === -10,
    gasto ? String(gasto.cantidad) : 'no existe');
}

/* --- 5. el cliente ve y RECHAZA el presupuesto: vuelve la mitad --- */
if (idTarea && idPresupuesto) {
  const det = await cliente('GET', `/mi-cuenta/tareas/${idTarea}`);
  marca('el cliente ve el presupuesto recibido', det.texto.includes('54'), 'no aparece el precio');
  const p = db.prepare('SELECT * FROM presupuestos WHERE tarea_id=?').get(idTarea);
  marca('el presupuesto queda registrado con estado "enviado"', p && p.estado === 'enviado', p ? p.estado : 'no existe');

  const saldoAntes = saldoTokens(idPro);
  const r = await cliente('POST', `/mi-cuenta/tareas/${idTarea}/rechazar/${idPresupuesto}`, { csrf: sesionCli.csrf });
  marca('el cliente rechaza el presupuesto', r.status === 302, `status ${r.status}`);
  const p2 = db.prepare('SELECT * FROM presupuestos WHERE tarea_id=?').get(idTarea);
  marca('el presupuesto pasa a "rechazado"', p2.estado === 'rechazado', p2.estado);
  marca('al rechazar se devuelven 5 tokens', saldoTokens(idPro) === saldoAntes + 5,
    `${saldoAntes} → ${saldoTokens(idPro)}`);
  const dev = db.prepare("SELECT * FROM tokens_movimientos WHERE presupuesto_id=? AND tipo='reembolso'").get(idPresupuesto);
  marca('la devolución queda anotada', !!dev && Number(dev.cantidad) === 5, dev ? String(dev.cantidad) : 'no existe');
}

/* --- 6. el profesional presupuesta OTRA tarea y el cliente la acepta --- */
let idTareaB = null;
if (idTarea) {
  // Cada profesional solo puede presupuestar una vez por tarea, así que la
  // aceptación se prueba sobre una segunda tarea.
  const segunda = await publicarTarea(cliente, sesionCli.csrf,
    'Segunda tarea:Reparación de una persiana enrollable en el salón.');
  idTareaB = segunda.id;
  marca('se publica una segunda tarea para probar la aceptación', !!idTareaB);

  const saldoAntes = saldoTokens(idPro);
  const r = await profesional('POST', `/tareas/${idTareaB}/presupuesto`, {
    csrf: sesionPro.csrf, precio: '54', horas: '3', mensaje: 'Segundo envío, con material propio.'
  });
  marca('el profesional envía un presupuesto a la segunda tarea', r.status === 302, `status ${r.status}`);
  const p = db.prepare('SELECT * FROM presupuestos WHERE tarea_id=? ORDER BY id DESC').get(idTareaB);
  idPresupuesto = p ? p.id : null;
  marca('el presupuesto cuesta 10 tokens', saldoTokens(idPro) === saldoAntes - 10,
    `${saldoAntes} → ${saldoTokens(idPro)}`);

  const r2 = await cliente('POST', `/mi-cuenta/tareas/${idTareaB}/aceptar/${idPresupuesto}`, { csrf: sesionCli.csrf });
  marca('el cliente acepta el presupuesto', r2.status === 302, `status ${r2.status}`);
}

/* --- 7. se comprueba el dinero: sin comisión --- */
{
  const t = db.prepare('SELECT * FROM tareas WHERE id=?').get(idTareaB);
  marca('la tarea pasa a "en_curso"', t && t.estado === 'en_curso', t ? t.estado : 'no existe');
  marca('el precio final es 54 €', Number(t.precio_final) === 54, String(t.precio_final));
  marca('la tarea no tiene comisión', Number(t.comision) === 0, String(t.comision));
  marca('la tarea queda asignada al profesional', !!t.profesional_id, String(t.profesional_id));

  const p = db.prepare('SELECT * FROM presupuestos WHERE tarea_id=?').get(idTareaB);
  marca('el presupuesto pasa a "aceptado"', p.estado === 'aceptado', p.estado);

  const cargo = db.prepare("SELECT * FROM transacciones WHERE tarea_id=? AND tipo='pago_cliente'").get(idTareaB);
  const abono = db.prepare("SELECT * FROM transacciones WHERE tarea_id=? AND tipo='pago_profesional'").get(idTareaB);
  marca('se registra el cargo al cliente de 54 €', !!cargo && Number(cargo.monto) === 54, cargo ? String(cargo.monto) : 'no existe');
  marca('el profesional recibe el importe íntegro (54 €, sin comisión)',
    !!abono && Math.abs(Number(abono.monto) - 54) < 0.01, abono ? String(abono.monto) : 'no existe');
  marca('la transacción no lleva comisión', !!abono && Number(abono.comision) === 0, abono ? String(abono.comision) : 'no existe');

  const saldoAntes = saldoTokens(idPro);
  const devolucion = db.prepare("SELECT COUNT(*) AS n FROM tokens_movimientos WHERE presupuesto_id=? AND tipo='reembolso'").get(idPresupuesto);
  marca('al aceptar no se devuelve ningún token', devolucion.n === 0 && saldoTokens(idPro) === saldoAntes,
    `devoluciones ${devolucion.n}, saldo ${saldoAntes} → ${saldoTokens(idPro)}`);

  const notif = db.prepare('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id=?').get(t.profesional_id);
  marca('el profesional recibe una notificación', notif.n > 0, String(notif.n));
}

/* --- 8. el profesional ve sus ingresos (100 %, sin comisión) --- */
{
  const ing = await profesional('GET', '/profesional/ingresos');
  marca('el monedero del profesional muestra el ingreso', ing.texto.includes('54'), 'no aparece 54');
  marca('el monedero ya no muestra comisión', !/15\s*%/.test(ing.texto), 'sigue apareciendo un 15 %');
}

/* --- 9. sin tokens no se puede presupuestar --- */
{
  const segunda = await publicarTarea(cliente, sesionCli.csrf,
    'Segunda tarea de prueba para el bloque de tokens del profesional.');
  db.prepare('DELETE FROM tokens_movimientos WHERE usuario_id=?').run(idPro);
  const saldo = saldoTokens(idPro);
  const r = await profesional('POST', `/tareas/${segunda.id}/presupuesto`, {
    csrf: sesionPro.csrf, precio: '40', horas: '2', mensaje: 'Intento sin tokens.'
  });
  marca('sin saldo no se puede enviar un presupuesto', r.status === 302 && /tokens/.test(r.loc),
    `status ${r.status} loc ${r.loc}`);
  const creado = db.prepare('SELECT COUNT(*) AS n FROM presupuestos WHERE tarea_id=?').get(segunda.id);
  marca('no se crea ningún presupuesto sin tokens', creado.n === 0, `presupuestos ${creado.n}`);
  marca('el saldo sigue a cero', saldo === 0, String(saldo));

  // Compra tokens y vuelve a presupuestar
  const r2 = await profesional('POST', '/profesional/tokens/comprar', { csrf: sesionPro.csrf, tokens: '10' });
  marca('el profesional recupera tokens comprando', r2.status === 302 && saldoTokens(idPro) === 10,
    `saldo ${saldoTokens(idPro)}`);
  const r3 = await profesional('POST', `/tareas/${segunda.id}/presupuesto`, {
    csrf: sesionPro.csrf, precio: '40', horas: '2', mensaje: 'Ahora sí, con tokens.'
  });
  marca('con tokens vuelve a poder presupuestar', r3.status === 302, `status ${r3.status}`);
}

/* --- 10. completar y valorar --- */
if (idTareaB) {
  const r = await cliente('POST', `/mi-cuenta/tareas/${idTareaB}/completar`, { csrf: sesionCli.csrf });
  marca('el cliente marca la tarea como completada', r.status === 302, `status ${r.status}`);
  const t = db.prepare('SELECT * FROM tareas WHERE id=?').get(idTareaB);
  marca('el estado pasa a "completada"', t.estado === 'completada', t.estado);

  const r2 = await cliente('POST', `/mi-cuenta/tareas/${idTareaB}/opinion`, {
    csrf: sesionCli.csrf, puntuacion: '5', comentario: 'Puntual y profesional, todo perfecto.'
  });
  marca('el cliente deja una valoración de 5', r2.status === 302, `status ${r2.status}`);
  const o = db.prepare('SELECT * FROM opiniones WHERE tarea_id=?').get(idTareaB);
  marca('la opinión queda guardada', !!o && o.puntuacion === 5, o ? String(o.puntuacion) : 'no existe');
}

/* --- 11. el admin ve los tokens y la ausencia de comisión --- */
{
  const admin = crearCliente();
  const s = await entrar(admin, 'admin@trabajofacil.es');
  marca('el admin inicia sesión', s.ok);
  const tr = await admin('GET', '/admin/transacciones');
  marca('el panel de transacciones no muestra comisiones', !/8,10|45,90/.test(tr.texto), 'aparece una comisión');
  const tk = await admin('GET', '/admin/tokens');
  marca('el panel de tokens del admin se abre', tk.status === 200, `status ${tk.status}`);
  marca('el panel de tokens muestra los movimientos', /token/i.test(tk.texto), 'vacío');
  const aud = await admin('GET', '/admin/auditoria');
  marca('el panel de auditoría registra acciones', aud.texto.includes('Tarea') || aud.texto.includes('tarea'), 'vacío');
}

/* --- 12. verificación de identidad pendiente en la cola del admin --- */
{
  const admin = crearCliente();
  await entrar(admin, 'admin@trabajofacil.es');
  const v = await admin('GET', '/admin/verificaciones');
  marca('la cola de verificación muestra al profesional pendiente', v.texto.includes('Rosa'), 'no aparece Rosa');
  marca('la cola de verificación incluye a los clientes', v.texto.includes('Cliente'), 'no aparece la columna de rol');
}

/* ====================================================================== */
console.log(lineas.join('\n'));
console.log(`\n  ${ok} correctos · ${fallos} fallidos\n`);
db.close();
process.exit(fallos > 0 ? 1 : 0);
