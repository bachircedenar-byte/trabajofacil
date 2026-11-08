/* ==========================================================================
   TrabajoFácil — autenticación y sesiones
   Cookies httpOnly + token aleatorio en la tabla `sesiones`.
   Contraseñas con scrypt (node:crypto), sin dependencias externas.
   ========================================================================== */
import { randomBytes } from 'node:crypto';
import { q, ahora, hashSync, verificarPassword } from './db.mjs';

const COOKIE_SESION = 'tf_sesion';
const COOKIE_FLASH = 'tf_flash';
const DIAS_SESION = 30;

/* ------------------------------------------------------------------ */
/* Cookies                                                             */
/* ------------------------------------------------------------------ */
export function leerCookies(req) {
  const cab = req.headers.cookie;
  const out = {};
  if (!cab) return out;
  for (const trozo of cab.split(';')) {
    const i = trozo.indexOf('=');
    if (i < 0) continue;
    const k = trozo.slice(0, i).trim();
    const v = trozo.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function ponerCookie(res, nombre, valor, { maxAge = null, httpOnly = true, path = '/' } = {}) {
  let c = `${nombre}=${encodeURIComponent(valor)}; Path=${path}; SameSite=Lax`;
  if (httpOnly) c += '; HttpOnly';
  if (maxAge != null) c += `; Max-Age=${maxAge}`;
  const prev = res.getHeader('Set-Cookie');
  const lista = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  lista.push(c);
  res.setHeader('Set-Cookie', lista);
}

export function borrarCookie(res, nombre) {
  ponerCookie(res, nombre, '', { maxAge: 0 });
}

/* ------------------------------------------------------------------ */
/* Mensajes flash                                                      */
/* ------------------------------------------------------------------ */
export function flash(res, texto, tipo = 'ok') {
  ponerCookie(res, COOKIE_FLASH, JSON.stringify({ texto, tipo }), { maxAge: 60, httpOnly: false });
}

export function leerFlash(req, res) {
  const cookies = leerCookies(req);
  const raw = cookies[COOKIE_FLASH];
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* Sesiones                                                            */
/* ------------------------------------------------------------------ */
export function crearSesion(res, usuarioId, req) {
  const token = randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + DIAS_SESION * 86400000).toISOString();
  q.run('INSERT INTO sesiones (token,usuario_id,creado_en,expira_en,ip,user_agent) VALUES (?,?,?,?,?,?)',
    token, usuarioId, ahora(), expira,
    (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim(),
    (req.headers['user-agent'] || '').slice(0, 200));
  ponerCookie(res, COOKIE_SESION, token, { maxAge: DIAS_SESION * 86400 });
  return token;
}

export function destruirSesion(req, res) {
  const token = leerCookies(req)[COOKIE_SESION];
  if (token) q.run('DELETE FROM sesiones WHERE token=?', token);
  borrarCookie(res, COOKIE_SESION);
}

export function usuarioActual(req) {
  const token = leerCookies(req)[COOKIE_SESION];
  if (!token) return null;
  const s = q.get('SELECT * FROM sesiones WHERE token=?', token);
  if (!s) return null;
  if (new Date(s.expira_en).getTime() < Date.now()) {
    q.run('DELETE FROM sesiones WHERE token=?', token);
    return null;
  }
  const u = q.get('SELECT * FROM usuarios WHERE id=?', s.usuario_id);
  if (!u || !u.activo) return null;
  const ciudad = u.ciudad_id ? q.get('SELECT nombre FROM ciudades WHERE id=?', u.ciudad_id) : null;
  const prof = u.rol === 'profesional'
    ? q.get('SELECT * FROM profesionales WHERE usuario_id=?', u.id)
    : null;
  /* Verificación de identidad del cliente (obligatoria para publicar tareas). */
  const verif = (u.rol === 'cliente' || u.rol === 'admin')
    ? q.get('SELECT * FROM verificaciones WHERE usuario_id=?', u.id)
    : null;
  return { ...u, ciudad_nombre: ciudad ? ciudad.nombre : '', profesional: prof || null, verificacion: verif || null };
}

/* ------------------------------------------------------------------ */
/* CSRF (double submit con cookie)                                     */
/* ------------------------------------------------------------------ */
export function csrfToken(req, res) {
  const c = leerCookies(req).tf_csrf;
  if (c) return c;
  const t = randomBytes(16).toString('hex');
  ponerCookie(res, 'tf_csrf', t, { maxAge: DIAS_SESION * 86400, httpOnly: false });
  return t;
}

export function csrfValido(req, body) {
  const c = leerCookies(req).tf_csrf;
  return !!(c && body && body.csrf && body.csrf === c);
}

export function exigirCsrf(ctx) {
  if (csrfValido(ctx.req, ctx.body)) return true;
  ctx.redirigir('/?error=csrf');
  return false;
}

/* ------------------------------------------------------------------ */
/* Guardas de acceso                                                   */
/* ------------------------------------------------------------------ */
export function exigirLogin(ctx) {
  if (ctx.usuario) return true;
  const volver = encodeURIComponent(ctx.rutaCompleta || ctx.req.url);
  ctx.redirigir(`/accede?volver=${volver}`);
  return false;
}

export function exigirRol(ctx, ...roles) {
  if (!exigirLogin(ctx)) return false;
  if (roles.includes(ctx.usuario.rol)) return true;
  ctx.res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
  ctx.res.end('<h1>403 — No tienes permiso</h1><p><a href="/">Volver al inicio</a></p>');
  return false;
}

/**
 * ¿Puede este usuario publicar una tarea?
 * Los clientes deben tener la identidad verificada (aprobada por el admin):
 * así la tarea que sale publicada es real. Los administradores están exentos.
 */
export function clienteVerificado(u) {
  if (!u) return false;
  if (u.rol === 'admin') return true;
  if (u.verificacion) return u.verificacion.estado === 'aprobado';
  const v = q.get('SELECT estado FROM verificaciones WHERE usuario_id=?', u.id);
  return !!v && v.estado === 'aprobado';
}

/** Motivo por el que un cliente no puede publicar todavía (para el mensaje). */
export function motivoSinVerificar(u) {
  if (!u) return 'Necesitas una cuenta para publicar tareas.';
  if (u.rol === 'admin') return '';
  const v = u.verificacion || q.get('SELECT * FROM verificaciones WHERE usuario_id=?', u.id);
  if (v && v.estado === 'pendiente') return 'Tu verificación de identidad está en revisión.';
  if (v && v.estado === 'rechazado') return 'Tu verificación de identidad fue rechazada. Vuelve a enviarla.';
  return 'Antes de publicar una tarea necesitamos verificar tu identidad.';
}

/* ------------------------------------------------------------------ */
/* Utilidades de cuenta                                                */
/* ------------------------------------------------------------------ */
export function registrarUsuario({ email, password, nombre, apellidos = '', telefono = '', rol = 'cliente', cp = '', ciudad = '' }) {
  const emailMin = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(emailMin)) throw new Error('El correo no parece válido.');
  if (String(password || '').length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  if (!String(nombre || '').trim()) throw new Error('Escribe tu nombre.');
  if (q.get('SELECT id FROM usuarios WHERE email=?', emailMin)) throw new Error('Ya existe una cuenta con ese correo.');

  let ciudadId = null, lat = null, lng = null;
  if (cp) {
    const c = q.get('SELECT * FROM codigos_postales WHERE cp=?', String(cp).trim());
    if (c) {
      ciudadId = q.get('SELECT id FROM ciudades WHERE nombre=?', c.ciudad)?.id ?? null;
      lat = c.lat; lng = c.lng;
    }
  }

  const tokenVerif = randomBytes(24).toString('hex');
  const r = q.run(
    `INSERT INTO usuarios (email,password,nombre,apellidos,telefono,rol,ciudad_id,cp,lat,lng,activo,email_verificado,token_verificacion,creado_en,actualizado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,0,?,?,?)`,
    emailMin, hashSync(password), String(nombre).trim(), apellidos, telefono, rol,
    ciudadId, cp, lat, lng, tokenVerif, ahora(), ahora()
  );
  return { id: r.id, tokenVerificacion: tokenVerif };
}

export function contraseñaValida(password, almacenado) {
  return verificarPassword(password, almacenado);
}

export function tokenSesionValido(token) {
  if (!token) return null;
  const s = q.get('SELECT * FROM sesiones WHERE token=?', token);
  if (!s || new Date(s.expira_en).getTime() < Date.now()) return null;
  return s;
}
