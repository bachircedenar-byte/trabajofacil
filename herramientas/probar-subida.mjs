/* Prueba de subida multipart: verificación de identidad con DNI y selfie. */
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:4174';
const db = new DatabaseSync(join(raiz, 'datos', 'trabajofacil.db'));

let ok = 0, fallos = 0;
const l = [];
const marca = (n, b, d = '') => { if (b) { ok++; l.push(`  ✓ ${n}`); } else { fallos++; l.push(`  ✗ ${n}${d ? ' → ' + d : ''}`); } };

// PNG falso mínimo (cabecera válida) para probar la subida
const pngFalso = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
mkdirSync(join(raiz, 'contenido', 'tmp'), { recursive: true });
const rutaDni = join(raiz, 'contenido', 'tmp', 'dni-prueba.png');
const rutaSelfie = join(raiz, 'contenido', 'tmp', 'selfie-prueba.png');
writeFileSync(rutaDni, pngFalso);
writeFileSync(rutaSelfie, pngFalso);

let galleta = '';
async function pedir(metodo, ruta, cuerpo = null, cabecerasExtra = {}) {
  const cab = { ...cabecerasExtra };
  if (cuerpo && !(cuerpo instanceof FormData)) cab['Content-Type'] = 'application/x-www-form-urlencoded';
  if (galleta) cab.Cookie = galleta;
  const r = await fetch(BASE + ruta, {
    method: metodo, headers: cab, redirect: 'manual',
    body: cuerpo instanceof FormData ? cuerpo
      : (cuerpo ? new URLSearchParams(cuerpo).toString() : undefined)
  });
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
    const par = c.split(';')[0];
    if (par.startsWith('tf_sesion=') || par.startsWith('tf_csrf=')) {
      const n = par.split('=')[0];
      galleta = galleta.split('; ').filter(x => !x.startsWith(n + '=')).concat([par]).join('; ');
    }
  }
  return { status: r.status, loc: r.headers.get('location') || '', texto: await r.text() };
}
const csrfDe = h => (/name="csrf"\s+value="([^"]+)"/.exec(h || '')?.[1]) || '';

// Login como profesional pendiente de verificar (rosa@ejemplo.es)
const r0 = await pedir('GET', '/accede');
const csrf = csrfDe(r0.texto);
await pedir('POST', '/accede', { csrf, email: 'rosa@ejemplo.es', password: 'demo1234' });
const v = await pedir('GET', '/profesional/verificacion');
marca('el profesional pendiente abre el formulario de verificación', v.status === 200, `status ${v.status}`);
const token = csrfDe(v.texto);
marca('el formulario de verificación trae token CSRF', !!token);

const fd = new FormData();
fd.set('csrf', token);
fd.set('documento_tipo', 'dni');
fd.set('documento_numero', '12345678Z');
fd.set('documento_frente', new Blob([pngFalso], { type: 'image/png' }), 'mi-dni.png');
fd.set('documento_reverso', new Blob([pngFalso], { type: 'image/png' }), 'mi-dni-reverso.png');
fd.set('selfie', new Blob([pngFalso], { type: 'image/png' }), 'mi-selfie.png');
fd.set('notas', 'Documentación de prueba automática.');

const rSub = await pedir('POST', '/profesional/verificacion', fd);
marca('la subida multipart se procesa', rSub.status === 302, `status ${rSub.status}`);

const rosa = db.prepare("SELECT id FROM usuarios WHERE email='rosa@ejemplo.es'").get();
const prof = db.prepare('SELECT * FROM profesionales WHERE usuario_id=?').get(rosa.id);
marca('el perfil guarda la ruta del documento frontal', !!prof && prof.documento_frente && prof.documento_frente.includes('mi-dni'), prof ? prof.documento_frente : '');
marca('el perfil guarda la ruta del selfie', !!prof && prof.selfie && prof.selfie.includes('selfie'), prof ? prof.selfie : '');
marca('el estado de verificación queda "pendiente"', prof && prof.estado_verificacion === 'pendiente', prof ? prof.estado_verificacion : '');

const doc = db.prepare('SELECT * FROM documentos WHERE usuario_id=? ORDER BY id DESC').get(rosa.id);
marca('se crea el documento en la cola de verificación', !!doc && doc.estado === 'pendiente', doc ? doc.estado : 'no existe');

// El fichero debe servirse en /contenido/
if (doc && doc.archivo) {
  const ruta = doc.archivo.startsWith('/') ? doc.archivo : '/contenido/' + doc.archivo;
  const rF = await pedir('GET', ruta);
  marca('el documento subido se sirve desde /contenido', rF.status === 200, `status ${rF.status} ruta ${ruta}`);
}

// El admin lo aprueba
async function crearAdmin() {
  let g = '';
  const pedirA = async (m, ru, c = null) => {
    const cab = {};
    if (c) cab['Content-Type'] = 'application/x-www-form-urlencoded';
    if (g) cab.Cookie = g;
    const r = await fetch(BASE + ru, { method: m, headers: cab, redirect: 'manual', body: c ? new URLSearchParams(c).toString() : undefined });
    for (const cc of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
      const par = cc.split(';')[0];
      if (par.startsWith('tf_sesion=') || par.startsWith('tf_csrf=')) {
        const n = par.split('=')[0];
        g = g.split('; ').filter(x => !x.startsWith(n + '=')).concat([par]).join('; ');
      }
    }
    return { status: r.status, loc: r.headers.get('location') || '', texto: await r.text() };
  };
  const a0 = await pedirA('GET', '/accede');
  await pedirA('POST', '/accede', { csrf: csrfDe(a0.texto), email: 'admin@trabajofacil.es', password: 'demo1234' });
  return pedirA;
}
const admin = await crearAdmin();
const cola = await admin('GET', '/admin/verificaciones');
marca('la cola del admin muestra el documento nuevo', cola.texto.includes('Rosa') && cola.texto.includes('mi-dni'), 'no aparece');
if (doc) {
  const det = await admin('GET', `/admin/verificaciones/doc-${doc.id}`);
  marca('la ficha de verificación se abre', det.status === 200, `status ${det.status}`);
  const rr = await admin('POST', `/admin/verificaciones/doc-${doc.id}/decision`, { csrf: csrfDe(det.texto), decision: 'aprobar', notas: 'Documentación correcta.' });
  marca('el admin aprueba la verificación', rr.status === 302 && /verificaciones/.test(rr.loc), `status ${rr.status} loc ${rr.loc}`);
}
const prof2 = db.prepare('SELECT * FROM profesionales WHERE usuario_id=?').get(rosa.id);
marca('el profesional pasa a "aprobado"', prof2.estado_verificacion === 'aprobado', prof2.estado_verificacion);
marca('se guarda la fecha de verificación', !!prof2.verificado_en, String(prof2.verificado_en));
const notif = db.prepare('SELECT * FROM notificaciones WHERE usuario_id=?').get(rosa.id);
marca('el profesional recibe notificación de la aprobación', !!notif);

/* ====================================================================== */
/* Verificación de identidad del CLIENTE (DNI/NIE)                        */
/* ====================================================================== */
let galletaCli = '';
async function pedirCli(metodo, ruta, cuerpo = null) {
  const cab = {};
  if (cuerpo && !(cuerpo instanceof FormData)) cab['Content-Type'] = 'application/x-www-form-urlencoded';
  if (galletaCli) cab.Cookie = galletaCli;
  const r = await fetch(BASE + ruta, {
    method: metodo, headers: cab, redirect: 'manual',
    body: cuerpo instanceof FormData ? cuerpo
      : (cuerpo ? new URLSearchParams(cuerpo).toString() : undefined)
  });
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
    const par = c.split(';')[0];
    if (par.startsWith('tf_sesion=') || par.startsWith('tf_csrf=')) {
      const n = par.split('=')[0];
      galletaCli = galletaCli.split('; ').filter(x => !x.startsWith(n + '=')).concat([par]).join('; ');
    }
  }
  return { status: r.status, loc: r.headers.get('location') || '', texto: await r.text() };
}

const correoCli = `cliente${Date.now()}@ejemplo.es`;
{
  // Se registra un cliente nuevo: sin verificar no puede publicar
  const r0 = await pedirCli('GET', '/registro');
  await pedirCli('POST', '/registro', {
    csrf: csrfDe(r0.texto), nombre: 'Cliente', apellidos: 'De Prueba',
    email: correoCli, password: 'contrasena123', password2: 'contrasena123',
    repetir: 'contrasena123', telefono: '600333444', cp: '28001'
  });
  const l0 = await pedirCli('GET', '/accede');
  await pedirCli('POST', '/accede', { csrf: csrfDe(l0.texto), email: correoCli, password: 'contrasena123' });

  const v = await pedirCli('GET', '/mi-cuenta/verificacion');
  marca('el cliente abre su verificación de identidad', v.status === 200, `status ${v.status}`);
  const tokenCli = csrfDe(v.texto);
  marca('el formulario de verificación del cliente trae token CSRF', !!tokenCli);

  const pub = await pedirCli('GET', '/publicar-tarea?categoria=limpieza-de-hogar');
  marca('un cliente sin verificar no puede publicar una tarea',
    pub.status === 302 && /verificacion/.test(pub.loc), `status ${pub.status} loc ${pub.loc}`);

  const fd = new FormData();
  fd.set('csrf', tokenCli);
  fd.set('documento_tipo', 'dni');
  fd.set('documento_numero', '12345678Z');
  fd.set('documento_frente', new Blob([pngFalso], { type: 'image/png' }), 'mi-dni-cliente.png');
  fd.set('selfie', new Blob([pngFalso], { type: 'image/png' }), 'mi-selfie-cliente.png');

  const rSub = await pedirCli('POST', '/mi-cuenta/verificacion', fd);
  marca('el cliente envía su DNI y su selfie', rSub.status === 302, `status ${rSub.status}`);

  const cli = db.prepare('SELECT id FROM usuarios WHERE email=?').get(correoCli);
  const verif = db.prepare('SELECT * FROM verificaciones WHERE usuario_id=?').get(cli.id);
  marca('la verificación del cliente queda pendiente', !!verif && verif.estado === 'pendiente',
    verif ? verif.estado : 'no existe');
  marca('el cliente guarda la ruta del documento frontal',
    !!verif && verif.documento_frente && verif.documento_frente.includes('mi-dni-cliente'),
    verif ? verif.documento_frente : '');
  marca('el cliente guarda la ruta del selfie',
    !!verif && verif.selfie && verif.selfie.includes('selfie'),
    verif ? verif.selfie : '');

  // El admin lo aprueba desde la cola de verificaciones
  const adminCli = await crearAdmin();
  const cola = await adminCli('GET', '/admin/verificaciones');
  marca('la cola del admin muestra al cliente pendiente', cola.texto.includes('Cliente'), 'no aparece');
  if (verif) {
    const det = await adminCli('GET', `/admin/verificaciones/ver-${verif.id}`);
    marca('la ficha de verificación del cliente se abre', det.status === 200, `status ${det.status}`);
    const rr = await adminCli('POST', `/admin/verificaciones/ver-${verif.id}/decision`, {
      csrf: csrfDe(det.texto), decision: 'aprobar', notas: 'Documentación correcta.'
    });
    marca('el admin aprueba la verificación del cliente', rr.status === 302 && /verificaciones/.test(rr.loc),
      `status ${rr.status} loc ${rr.loc}`);
  }
  const verif2 = db.prepare('SELECT * FROM verificaciones WHERE usuario_id=?').get(cli.id);
  marca('el cliente pasa a "aprobado"', verif2 && verif2.estado === 'aprobado', verif2 ? verif2.estado : 'no existe');
  const notifCli = db.prepare('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id=?').get(cli.id);
  marca('el cliente recibe notificación de la aprobación', notifCli.n > 0, String(notifCli.n));

  const pub2 = await pedirCli('GET', '/publicar-tarea?categoria=limpieza-de-hogar');
  marca('un cliente verificado ya puede publicar una tarea', pub2.status === 200, `status ${pub2.status}`);
}

console.log(l.join('\n'));
console.log(`\n  ${ok} correctos · ${fallos} fallidos\n`);
db.close();
process.exit(fallos > 0 ? 1 : 0);
