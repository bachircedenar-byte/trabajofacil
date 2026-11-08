/* ==========================================================================
   TrabajoFácil — módulo de cliente y autenticación
   Rutas: acceso/registro/recuperación, área privada del cliente y flujo
   de publicación de tareas por pasos.
   Sin dependencias externas: sólo módulos nativos de Node.
   ========================================================================== */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rename } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, ahora, hashSync } from './db.mjs';
import {
  html, raw, slugify, fmtEuros, fmtEurosCorto, fmtFecha, fechaCorta,
  tiempoRelativo, estrellas, TAREAS_ESTADO, PRESU_ESTADO,
  layout, badgeCategoria, campo, checkbox
} from './vistas.mjs';
import {
  flash, crearSesion, destruirSesion, exigirLogin, registrarUsuario,
  contraseñaValida, exigirCsrf, clienteVerificado, motivoSinVerificar
} from './auth.mjs';
import { reembolsarTokens, reembolsarPendientes } from './tokens.mjs';

/* ------------------------------------------------------------------ */
/* Utilidades locales                                                  */
/* ------------------------------------------------------------------ */
const frag = (strings, ...vals) => raw(html(strings, ...vals));
const H = s => raw(s);
/* Convierte un fragmento (objeto raw) en la cadena HTML que espera layout(). */
const asHtml = o => html`${o}`;

const txt = v => String(v ?? '').trim();
const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const redondear = n => Math.round(Number(n) * 100) / 100;
const lista = v => (Array.isArray(v) ? v : (v === undefined || v === null || v === '' ? [] : [v]))
  .map(txt).filter(Boolean);
const marcado = v => lista(v).length > 0;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const emailValido = e => EMAIL_RE.test(String(e || '').trim());
const jsJson = v => JSON.stringify(v).replace(/</g, '\\u003c');
const inicioPorRol = rol => (rol === 'admin' ? '/admin' : rol === 'profesional' ? '/profesional' : '/mi-cuenta');
/* Sólo rutas internas: evita redirecciones abiertas ("//evil.com"). */
const urlSegura = v => { const s = String(v || ''); return (s.startsWith('/') && !s.startsWith('//')) ? s : null; };
const esEmail = e => emailValido(e);

/* ------------------------------------------------------------------ */
/* Ficheros subidos y galerías                                        */
/* ------------------------------------------------------------------ */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_CONTENIDO = join(RAIZ, 'contenido');

/** Guarda un fichero subido en contenido/<subcarpeta> y devuelve su ruta relativa. */
async function guardarArchivo(archivo, subcarpeta) {
  const dir = join(DIR_CONTENIDO, subcarpeta);
  await mkdir(dir, { recursive: true });
  const ext = extname(archivo.nombreGuardado).toLowerCase();
  const base = basename(archivo.nombreGuardado, ext).replace(/[^\w\-]/g, '_').slice(0, 40) || 'fichero';
  const destino = join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}-${base}${ext}`);
  await rename(archivo.ruta, destino);
  return `${subcarpeta}/${basename(destino)}`;
}

/** Busca un fichero subido por el nombre del campo del formulario. */
function archivoDe(ctx, campo) {
  return (ctx.archivos || []).find(a => a.campo === campo) || null;
}

/** URL pública de un fichero guardado dentro de la carpeta contenido/. */
const urlContenido = ruta => {
  const s = String(ruta || '').trim();
  if (!s) return '';
  if (s.startsWith('/')) return s;
  return '/contenido/' + s.replace(/^\/+/, '');
};

/** Galería de miniaturas con enlace (fotos del trabajo o documentos). */
function galeriaFotos(urls, etiqueta = 'Foto del trabajo') {
  const lista = (urls || []).map(urlContenido).filter(Boolean);
  if (!lista.length) return '';
  return frag`
    <div class="doc-galeria">
      ${lista.map(u => frag`
        <figure class="doc-foto">
          <a href="${u}" target="_blank" rel="noopener">
            <img src="${u}" alt="${etiqueta}" loading="lazy">
          </a>
        </figure>`)}
    </div>`;
}

/** Miniaturas compactas para listados en tabla. */
function miniFotos(urls) {
  const lista = (urls || []).map(urlContenido).filter(Boolean);
  if (!lista.length) return '—';
  return frag`
    <div class="acciones">
      ${lista.map(u => frag`
        <a href="${u}" target="_blank" rel="noopener" title="Ver la foto del trabajo">
          <img class="doc-mini" src="${u}" alt="Foto del trabajo">
        </a>`)}
    </div>`;
}

/** Miniaturas de los documentos de identidad ya subidos. */
function galeriaDocumentos(v) {
  const items = [
    ['Frente del documento', v && v.documento_frente],
    ['Reverso del documento', v && v.documento_reverso],
    ['Selfie con el documento al lado', v && v.selfie]
  ].filter(([, ruta]) => ruta);
  if (!items.length) return '';
  return frag`
    <div class="doc-galeria">
      ${items.map(([etiqueta, ruta]) => {
        const url = urlContenido(ruta);
        return frag`
          <figure class="doc-foto">
            <a href="${url}" target="_blank" rel="noopener">
              <img src="${url}" alt="${etiqueta}" loading="lazy">
            </a>
            <figcaption>${etiqueta}</figcaption>
          </figure>`;
      })}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Constantes de la aplicación                                        */
/* ------------------------------------------------------------------ */
const ENLACES_CUENTA = [
  ['/mi-cuenta', 'Resumen'],
  ['/mi-cuenta/tareas', 'Mis tareas'],
  ['/mi-cuenta/presupuestos', 'Presupuestos'],
  ['/mi-cuenta/mensajes', 'Mensajes'],
  ['/mi-cuenta/facturacion', 'Facturación'],
  ['/mi-cuenta/verificacion', 'Verificación'],
  ['/mi-cuenta/datos', 'Mis datos']
];

const DIAS_SEMANA = [
  ['lunes', 'Lunes'], ['martes', 'Martes'], ['miercoles', 'Miércoles'],
  ['jueves', 'Jueves'], ['viernes', 'Viernes'], ['sabado', 'Sábado'], ['domingo', 'Domingo']
];

const TRANSPORTES = [
  ['bus', 'Autobús'], ['tren', 'Tren'], ['metro', 'Metro'],
  ['tranvia', 'Tranvía'], ['coche', 'Coche propio']
];

const FRECUENCIAS = [
  ['once', 'Una sola vez'],
  ['consecutiva', 'Varios días seguidos'],
  ['semanal', 'Todas las semanas'],
  ['quincenal', 'Cada quince días']
];

const PASOS = [
  { id: 'servicio', nombre: 'Servicio' },
  { id: 'cp', nombre: 'Código postal' },
  { id: 'frecuencia', nombre: 'Frecuencia' },
  { id: 'fecha', nombre: 'Fecha' },
  { id: 'hora', nombre: 'Hora' },
  { id: 'horas', nombre: 'Horas' },
  { id: 'flexibilidad-fecha', nombre: 'Flexibilidad de fecha' },
  { id: 'flexibilidad-hora', nombre: 'Franja horaria' },
  { id: 'transportes', nombre: 'Transportes' },
  { id: 'descripcion', nombre: 'Descripción' },
  { id: 'fotos', nombre: 'Fotos' },
  { id: 'publicar', nombre: 'Publicar' }
];

const REQUERIDOS_PUBLISH = ['servicio', 'cp', 'frecuencia', 'fecha', 'hora', 'horas', 'descripcion', 'fotos'];

/* ------------------------------------------------------------------ */
/* Consultas de apoyo                                                  */
/* ------------------------------------------------------------------ */
/* Busca un código postal. Primero en `codigos_postales` y, si no está, en
   `ciudades` (que guarda un CP representativo por ciudad). */
function cpInfo(cp) {
  const c = txt(cp);
  if (!c) return null;
  const directo = q.get('SELECT * FROM codigos_postales WHERE cp=?', c);
  if (directo) {
    const ciudad = q.get('SELECT * FROM ciudades WHERE nombre=? LIMIT 1', directo.ciudad)
      || q.get('SELECT * FROM ciudades WHERE cp=? LIMIT 1', c);
    return {
      cp: c, ciudad: directo.ciudad, provincia: directo.provincia,
      lat: directo.lat, lng: directo.lng, ciudad_id: ciudad ? ciudad.id : null
    };
  }
  const ci = q.get('SELECT * FROM ciudades WHERE cp=? AND activa=1 LIMIT 1', c);
  if (ci) {
    return { cp: c, ciudad: ci.nombre, provincia: ci.provincia, lat: ci.lat, lng: ci.lng, ciudad_id: ci.id };
  }
  return null;
}

function ciudadPorCp(cp) {
  const info = cpInfo(cp);
  if (!info) return null;
  const ciudad = info.ciudad_id ? q.get('SELECT * FROM ciudades WHERE id=?', info.ciudad_id) : null;
  return { ...info, ciudad, ciudad_nombre: info.ciudad };
}

function valoracionDe(usuarioId) {
  const v = q.get(
    'SELECT AVG(puntuacion) AS media, COUNT(*) AS n FROM opiniones WHERE profesional_id=?',
    usuarioId
  );
  return { media: Number(v.media || 0), n: Number(v.n || 0) };
}

function saldoMonedero(usuarioId) {
  const rec = num(q.get("SELECT COALESCE(SUM(monto),0) AS s FROM transacciones WHERE usuario_id=? AND tipo='recarga'", usuarioId).s);
  const pag = num(q.get("SELECT COALESCE(SUM(monto),0) AS s FROM transacciones WHERE usuario_id=? AND tipo='pago_cliente'", usuarioId).s);
  return redondear(rec - pag);
}

function tareaDeCliente(clienteId, tareaId) {
  return q.get('SELECT * FROM tareas WHERE id=? AND cliente_id=?', tareaId, clienteId) || null;
}

/* ------------------------------------------------------------------ */
/* Piezas de vista reutilizables                                      */
/* ------------------------------------------------------------------ */
function pillEstado(texto, color) {
  return H(`<span class="pill-estado" style="background:${color};color:#fff">${texto}</span>`);
}

function pillTarea(estado) {
  const e = TAREAS_ESTADO[estado] || TAREAS_ESTADO.borrador;
  return pillEstado(e.txt, e.color);
}

function pillPresupuesto(estado) {
  const e = PRESU_ESTADO[estado] || PRESU_ESTADO.enviado;
  return pillEstado(e.txt, e.color);
}

function panelCuenta(ctx, titulo, cuerpo) {
  const enlaces = ENLACES_CUENTA.map(([href, nombre]) => {
    const activo = ctx.ruta === href || (href !== '/mi-cuenta' && ctx.ruta.startsWith(href + '/'));
    return frag`<a class="sidebar-link${activo ? ' activo' : ''}" href="${href}">${nombre}</a>`;
  });
  return frag`
    <div class="app-shell">
      <aside class="sidebar">
        ${enlaces}
        <a class="btn btn-hollow btn-sm btn-block mt-2" href="/publicar-tarea">Publicar tarea</a>
      </aside>
      <div class="app-main">
        <div class="panel-head">
          <h2>${titulo}</h2>
        </div>
        ${cuerpo}
      </div>
    </div>`;
}

function tablaVacia(mensaje) {
  return frag`<div class="vacio">${mensaje}</div>`;
}

function hiloMensajes(mensajes, yoId) {
  if (!mensajes.length) return frag`<p class="muted">Todavía no hay mensajes sobre esta tarea.</p>`;
  return frag`
    <div class="hilo">
      ${mensajes.map(m => frag`
        <div class="opinion">
          <div class="quien">${m.emisor_id === yoId ? 'Tú' : `${m.emisor_nombre} ${m.emisor_apellidos || ''}`}</div>
          <div class="fecha">${fmtFecha(m.creado_en, true)}</div>
          <p>${m.cuerpo}</p>
        </div>`)}
    </div>`;
}

/* `hidden` debe ser un fragmento (raw) con campos ocultos adicionales. */
function formMensaje(ctx, accion, hidden = '') {
  return frag`
    <form method="post" action="${accion}">
      <input type="hidden" name="csrf" value="${ctx.csrf}">
      ${hidden}
      <div class="campo">
        <label for="c_cuerpo">Escribe tu mensaje</label>
        <textarea id="c_cuerpo" name="cuerpo" required placeholder="Cuéntale los detalles al profesional…"></textarea>
      </div>
      <div class="acciones">
        <button class="btn" type="submit">Enviar mensaje</button>
      </div>
    </form>`;
}

/* ------------------------------------------------------------------ */
/* Módulo                                                             */
/* ------------------------------------------------------------------ */
export function registrarCuenta(router) {
  /* ================================================================== */
  /* AUTENTICACIÓN                                                      */
  /* ================================================================== */

  router.get('/accede', async (ctx) => {
    if (ctx.usuario) return { redirigir: inicioPorRol(ctx.usuario.rol) };
    const volver = urlSegura(ctx.query.volver) || '';

    const contenido = frag`
      <div class="row">
        <div class="columns medium-6 large-5">
          <div class="panel">
            <h3>Accede a tu cuenta</h3>
            <form method="post" action="/accede">
              <input type="hidden" name="csrf" value="${ctx.csrf}">
              <input type="hidden" name="volver" value="${volver}">
              ${H(campo({ nombre: 'email', etiqueta: 'Correo electrónico', tipo: 'email', requerido: true, placeholder: 'tucorreo@ejemplo.es' }))}
              ${H(campo({ nombre: 'password', etiqueta: 'Contraseña', tipo: 'password', requerido: true, placeholder: '••••••••' }))}
              <button class="btn btn-block" type="submit">Entrar</button>
              <p class="pista mt-2">
                <a href="/recuperar-contrasena">He olvidado mi contraseña</a> ·
                <a href="/registro">Crear una cuenta</a>
              </p>
            </form>
          </div>
        </div>
        <div class="columns medium-6 large-7">
          <div class="nota-ok">
            <b>Cuentas de demostración</b>
            <p>Esta web es un prototipo: puedes entrar con cualquiera de estas cuentas.</p>
            <div class="resumen mt-2">
              <dl>
                <dt>Administrador</dt><dd>admin@trabajofacil.es</dd>
                <dt>Profesional</dt><dd>nuria@ejemplo.es</dd>
                <dt>Contraseña</dt><dd>demo1234</dd>
              </dl>
            </div>
          </div>
          <div class="panel mt-2">
            <h3>¿Todavía no tienes cuenta?</h3>
            <p class="muted">Regístrate como cliente para publicar tareas y recibir presupuestos de profesionales verificados.</p>
            <a class="btn btn-hollow" href="/registro">Crear cuenta de cliente</a>
          </div>
        </div>
      </div>`;

    return layout({
      titulo: 'Acceder', descripcion: 'Accede a tu cuenta de TrabajoFácil',
      usuario: ctx.usuario, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash
    });
  });

  router.post('/accede', async (ctx) => {
    if (!exigirCsrf(ctx)) return;
    const email = txt(ctx.body.email).toLowerCase();
    const password = String(ctx.body.password ?? '');
    const volver = urlSegura(ctx.body.volver || ctx.query.volver || '');

    if (!email || !password) {
      flash(ctx.res, 'Escribe tu correo y tu contraseña para entrar.', 'error');
      return { redirigir: '/accede' };
    }

    const u = q.get('SELECT * FROM usuarios WHERE email=?', email);
    if (!u || !u.activo || !contraseñaValida(password, u.password)) {
      flash(ctx.res, 'El correo o la contraseña no son correctos.', 'error');
      return { redirigir: '/accede' };
    }

    crearSesion(ctx.res, u.id, ctx.req);
    flash(ctx.res, `Hola de nuevo, ${u.nombre}. Sesión iniciada.`, 'ok');
    return { redirigir: volver || inicioPorRol(u.rol) };
  });

  router.get('/registro', async (ctx) => {
    if (ctx.usuario) return { redirigir: inicioPorRol(ctx.usuario.rol) };

    /* Mapa de códigos postales para la detección en vivo (pequeño y estático). */
    const mapaCP = {};
    for (const c of q.all('SELECT cp,ciudad,provincia FROM codigos_postales ORDER BY cp')) {
      mapaCP[c.cp] = { ciudad: c.ciudad, provincia: c.provincia };
    }
    for (const c of q.all("SELECT cp,nombre,provincia FROM ciudades WHERE cp<>'' AND activa=1 ORDER BY cp")) {
      if (!mapaCP[c.cp]) mapaCP[c.cp] = { ciudad: c.nombre, provincia: c.provincia };
    }

    const contenido = frag`
      <div class="row">
        <div class="columns medium-8">
          <div class="panel">
            <h3>Crea tu cuenta de cliente</h3>
            <p class="muted">Publica tareas, recibe presupuestos y contrata con profesionales verificados.</p>
            <form method="post" action="/registro">
              <input type="hidden" name="csrf" value="${ctx.csrf}">
              <div class="form-grid">
                ${H(campo({ nombre: 'nombre', etiqueta: 'Nombre', requerido: true, placeholder: 'Ana' }))}
                ${H(campo({ nombre: 'apellidos', etiqueta: 'Apellidos', placeholder: 'García López' }))}
                ${H(campo({ nombre: 'email', etiqueta: 'Correo electrónico', tipo: 'email', requerido: true, placeholder: 'tucorreo@ejemplo.es' }))}
                ${H(campo({ nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'tel', placeholder: '600 123 456' }))}
                ${H(campo({ nombre: 'password', etiqueta: 'Contraseña', tipo: 'password', requerido: true, pista: 'Mínimo 8 caracteres.' }))}
                ${H(campo({ nombre: 'password2', etiqueta: 'Repite la contraseña', tipo: 'password', requerido: true }))}
              </div>
              <div class="campo">
                <label for="c_cp">Código postal</label>
                <input type="text" id="c_cp" name="cp" inputmode="numeric" maxlength="5" placeholder="28001">
                <div class="pista" id="cpInfo">Escribe tu código postal para saber en qué ciudad estás.</div>
              </div>
              <div class="campo">
                ${H(checkbox({ nombre: 'como_profesional', etiqueta: 'Quiero registrarme también como profesional', valor: '1' }))}
                <div class="pista">Te crearemos un perfil profesional pendiente de verificar.</div>
              </div>
              <button class="btn" type="submit">Crear cuenta</button>
              <p class="pista mt-2">¿Ya tienes cuenta? <a href="/accede">Accede aquí</a>.</p>
            </form>
          </div>
        </div>
      </div>
      <script>
        (function () {
          var CP = ${H(jsJson(mapaCP))};
          var input = document.getElementById('c_cp');
          var salida = document.getElementById('cpInfo');
          if (!input || !salida) return;
          function pinta() {
            var cp = (input.value || '').replace(/\\s/g, '');
            if (!cp) { salida.textContent = 'Escribe tu código postal para saber en qué ciudad estás.'; return; }
            if (CP[cp]) {
              salida.textContent = CP[cp].ciudad + ', ' + CP[cp].provincia;
            } else {
              salida.textContent = 'No hemos encontrado ese código postal. Revísalo, por favor.';
            }
          }
          input.addEventListener('input', pinta);
          pinta();
        })();
      </script>`;

    return layout({
      titulo: 'Crear cuenta', descripcion: 'Regístrate en TrabajoFácil como cliente',
      usuario: ctx.usuario, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash
    });
  });

  router.post('/registro', async (ctx) => {
    if (!exigirCsrf(ctx)) return;
    const nombre = txt(ctx.body.nombre);
    const apellidos = txt(ctx.body.apellidos);
    const email = txt(ctx.body.email).toLowerCase();
    const password = String(ctx.body.password ?? '');
    const password2 = String(ctx.body.password2 ?? '');
    const telefono = txt(ctx.body.telefono);
    const cp = txt(ctx.body.cp);
    const comoProfesional = marcado(ctx.body.como_profesional);

    if (!nombre) {
      flash(ctx.res, 'Escribe tu nombre para crear la cuenta.', 'error');
      return { redirigir: '/registro' };
    }
    if (!esEmail(email)) {
      flash(ctx.res, 'El correo no parece válido.', 'error');
      return { redirigir: '/registro' };
    }
    if (password.length < 8) {
      flash(ctx.res, 'La contraseña debe tener al menos 8 caracteres.', 'error');
      return { redirigir: '/registro' };
    }
    if (password !== password2) {
      flash(ctx.res, 'Las dos contraseñas no coinciden.', 'error');
      return { redirigir: '/registro' };
    }
    if (cp && !cpInfo(cp)) {
      flash(ctx.res, 'Ese código postal no existe. Compruébalo o déjalo en blanco.', 'error');
      return { redirigir: '/registro' };
    }
    if (q.get('SELECT id FROM usuarios WHERE email=?', email)) {
      flash(ctx.res, 'Ya existe una cuenta con ese correo.', 'error');
      return { redirigir: '/registro' };
    }

    let nuevo;
    try {
      nuevo = registrarUsuario({ email, password, nombre, apellidos, telefono, rol: 'cliente', cp });
    } catch (err) {
      flash(ctx.res, err.message || 'No hemos podido crear la cuenta.', 'error');
      return { redirigir: '/registro' };
    }

    /* `registrarUsuario` sólo resuelve el CP en `codigos_postales`: completamos
       la ciudad y las coordenadas con la búsqueda ampliada. */
    const infoCp = cpInfo(cp);
    if (infoCp) {
      q.run('UPDATE usuarios SET ciudad_id=?, lat=?, lng=? WHERE id=?',
        infoCp.ciudad_id, infoCp.lat, infoCp.lng, nuevo.id);
    }

    if (comoProfesional) {
      q.run(
        `INSERT OR IGNORE INTO profesionales
          (usuario_id,titularidad,nif,precio_hora,categorias,estado_verificacion,disponible,radio_km,desde,formado_en)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        nuevo.id, 'autonomo', '', 0, '[]', 'pendiente', 1, 10, ahora(), ahora()
      );
    }

    crearSesion(ctx.res, nuevo.id, ctx.req);
    flash(ctx.res, `¡Bienvenido a TrabajoFácil, ${nombre}! Tu cuenta ya está activa.`, 'ok');
    return { redirigir: comoProfesional ? '/profesional/verificacion' : '/mi-cuenta' };
  });

  router.get('/recuperar-contrasena', async (ctx) => {
    const token = txt(ctx.query.token);
    const aviso = token
      ? q.get("SELECT * FROM notificaciones WHERE tipo='reset' AND cuerpo=? ORDER BY id DESC LIMIT 1", token)
      : null;

    const contenido = frag`
      <div class="row">
        <div class="columns medium-8 large-6">
          <div class="panel">
            <h3>Recupera tu contraseña</h3>
            <p class="muted">Escribe tu correo y te enviaremos un enlace para crear una contraseña nueva.</p>
            <form method="post" action="/recuperar-contrasena">
              <input type="hidden" name="csrf" value="${ctx.csrf}">
              ${H(campo({ nombre: 'email', etiqueta: 'Correo electrónico', tipo: 'email', requerido: true, placeholder: 'tucorreo@ejemplo.es' }))}
              <button class="btn" type="submit">Enviar enlace</button>
              <p class="pista mt-2"><a href="/accede">Volver a acceder</a></p>
            </form>
          </div>
          ${aviso ? frag`
            <div class="panel">
              <h3>Modo demostración</h3>
              <p class="muted">No enviamos correos reales: aquí tienes el enlace que usarías para restablecer la contraseña.</p>
              <p><a class="btn btn-hollow btn-sm" href="/recuperar-contrasena/${aviso.cuerpo}">Abrir enlace de recuperación</a></p>
              <p class="mono muted">/recuperar-contrasena/${aviso.cuerpo}</p>
            </div>` : ''}
        </div>
      </div>`;

    return layout({
      titulo: 'Recuperar contraseña', usuario: ctx.usuario, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash
    });
  });

  router.post('/recuperar-contrasena', async (ctx) => {
    if (!exigirCsrf(ctx)) return;
    const email = txt(ctx.body.email).toLowerCase();
    if (!esEmail(email)) {
      flash(ctx.res, 'El correo no parece válido.', 'error');
      return { redirigir: '/recuperar-contrasena' };
    }
    const u = q.get('SELECT id FROM usuarios WHERE email=?', email);
    if (!u) {
      flash(ctx.res, 'No hay ninguna cuenta registrada con ese correo.', 'error');
      return { redirigir: '/recuperar-contrasena' };
    }
    const token = randomBytes(24).toString('hex');
    q.run(
      'INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,?,?)',
      u.id, 'reset', 'Recuperación de contraseña', token, 'web', 0, ahora()
    );
    flash(ctx.res, 'Hemos generado un enlace para restablecer tu contraseña.', 'ok');
    return { redirigir: `/recuperar-contrasena?token=${encodeURIComponent(token)}` };
  });

  router.get('/recuperar-contrasena/:token', async (ctx) => {
    const token = txt(ctx.params.token);
    const n = q.get("SELECT * FROM notificaciones WHERE tipo='reset' AND cuerpo=? ORDER BY id DESC LIMIT 1", token);
    const reciente = !!n && (Date.now() - new Date(n.creado_en).getTime()) < 3600000;

    if (!reciente) {
      const contenido = frag`
        <div class="aviso">
          <h1>Enlace no válido</h1>
          <p>El enlace de recuperación no existe o ha caducado (caducan a la hora). Pide uno nuevo y vuelve a intentarlo.</p>
          <a class="btn" href="/recuperar-contrasena">Pedir un enlace nuevo</a>
        </div>`;
      return layout({ titulo: 'Enlace no válido', usuario: ctx.usuario, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash });
    }

    const contenido = frag`
      <div class="aviso">
        <h1>Crea una contraseña nueva</h1>
        <form method="post" action="/recuperar-contrasena/${token}">
          <input type="hidden" name="csrf" value="${ctx.csrf}">
          ${H(campo({ nombre: 'password', etiqueta: 'Contraseña nueva', tipo: 'password', requerido: true, pista: 'Mínimo 8 caracteres.' }))}
          ${H(campo({ nombre: 'password2', etiqueta: 'Repite la contraseña', tipo: 'password', requerido: true }))}
          <button class="btn" type="submit">Guardar contraseña</button>
        </form>
      </div>`;

    return layout({ titulo: 'Nueva contraseña', usuario: ctx.usuario, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash });
  });

  router.post('/recuperar-contrasena/:token', async (ctx) => {
    if (!exigirCsrf(ctx)) return;
    const token = txt(ctx.params.token);
    const n = q.get("SELECT * FROM notificaciones WHERE tipo='reset' AND cuerpo=? ORDER BY id DESC LIMIT 1", token);
    const reciente = !!n && (Date.now() - new Date(n.creado_en).getTime()) < 3600000;
    if (!reciente) {
      flash(ctx.res, 'El enlace ya no es válido. Pide uno nuevo.', 'error');
      return { redirigir: '/recuperar-contrasena' };
    }
    const password = String(ctx.body.password ?? '');
    const password2 = String(ctx.body.password2 ?? '');
    if (password.length < 8) {
      flash(ctx.res, 'La contraseña debe tener al menos 8 caracteres.', 'error');
      return { redirigir: `/recuperar-contrasena/${token}` };
    }
    if (password !== password2) {
      flash(ctx.res, 'Las dos contraseñas no coinciden.', 'error');
      return { redirigir: `/recuperar-contrasena/${token}` };
    }
    q.run('UPDATE usuarios SET password=?, actualizado_en=? WHERE id=?', hashSync(password), ahora(), n.usuario_id);
    q.run('DELETE FROM notificaciones WHERE id=?', n.id);
    destruirSesion(ctx.req, ctx.res);
    flash(ctx.res, 'Contraseña actualizada. Ya puedes entrar con la nueva.', 'ok');
    return { redirigir: '/accede' };
  });

  router.get('/verificar-email/:token', async (ctx) => {
    const token = txt(ctx.params.token);
    const u = q.get('SELECT id,nombre FROM usuarios WHERE token_verificacion=?', token);
    if (!u) {
      const contenido = frag`
        <div class="aviso">
          <h1>Enlace no válido</h1>
          <p>El enlace de verificación no existe o ya se ha utilizado.</p>
          <a class="btn" href="/mi-cuenta">Ir a mi cuenta</a>
        </div>`;
      return layout({ titulo: 'Verificación no válida', usuario: ctx.usuario, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash });
    }
    q.run('UPDATE usuarios SET email_verificado=1, token_verificacion=NULL, actualizado_en=? WHERE id=?', ahora(), u.id);
    const contenido = frag`
      <div class="aviso">
        <h1>¡Correo verificado!</h1>
        <div class="nota-ok"><b>${u.nombre}</b>, hemos confirmado tu dirección de correo.</div>
        <a class="btn" href="/mi-cuenta">Ir a mi cuenta</a>
      </div>`;
    return layout({ titulo: 'Correo verificado', usuario: ctx.usuario, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash });
  });

  router.get('/salir', async (ctx) => {
    destruirSesion(ctx.req, ctx.res);
    flash(ctx.res, 'Has cerrado sesión.', 'ok');
    return { redirigir: '/' };
  });

  /* ================================================================== */
  /* ÁREA PRIVADA DEL CLIENTE                                           */
  /* ================================================================== */

  router.get('/mi-cuenta', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    const yo = ctx.usuario;

    const activas = num(q.get(
      "SELECT COUNT(*) AS n FROM tareas WHERE cliente_id=? AND estado IN ('publicada','en_curso')", yo.id).n);
    const pendientes = num(q.get(
      "SELECT COUNT(*) AS n FROM presupuestos p JOIN tareas t ON t.id=p.tarea_id WHERE t.cliente_id=? AND p.estado='enviado'", yo.id).n);
    const sinLeer = num(q.get('SELECT COUNT(*) AS n FROM mensajes WHERE destinatario_id=? AND leido=0', yo.id).n);
    const saldo = saldoMonedero(yo.id);

    const tareas = q.all(
      `SELECT t.*, c.nombre AS categoria_nombre, c.slug AS categoria_slug,
              (SELECT COUNT(*) FROM presupuestos p WHERE p.tarea_id=t.id) AS ofertas,
              (SELECT COUNT(*) FROM presupuestos p WHERE p.tarea_id=t.id AND p.estado='enviado') AS ofertas_pendientes
       FROM tareas t LEFT JOIN categorias c ON c.id=t.categoria_id
       WHERE t.cliente_id=? ORDER BY t.id DESC LIMIT 8`, yo.id);

    const presupuestos = q.all(
      `SELECT p.*, t.titulo AS tarea_titulo, t.id AS tarea_id, u.nombre, u.apellidos
       FROM presupuestos p
       JOIN tareas t ON t.id=p.tarea_id
       JOIN usuarios u ON u.id=p.profesional_id
       WHERE t.cliente_id=? AND p.estado='enviado'
       ORDER BY p.creado_en DESC LIMIT 6`, yo.id);

    const cuerpo = frag`
      <div class="panel-head"><h3>Hola, ${yo.nombre}</h3></div>
      ${!yo.email_verificado && yo.token_verificacion ? frag`
        <div class="alert-box">
          <b>Verifica tu correo</b>
          <p class="muted">En este prototipo puedes confirmar tu dirección con este enlace:</p>
          <a class="btn btn-hollow btn-sm" href="/verificar-email/${yo.token_verificacion}">Verificar mi correo</a>
        </div>` : ''}
      ${clienteVerificado(yo) ? frag`
        <div class="nota-ok"><b>Identidad verificada</b> — ya puedes publicar tareas en TrabajoFácil.</div>` : frag`
        <div class="alert-box">
          <b>Verifica tu identidad</b>
          <p class="muted">Verifica tu identidad con tu DNI o NIE para poder publicar tareas.</p>
          <a class="btn btn-sm" href="/mi-cuenta/verificacion">Verificar mi identidad</a>
        </div>`}

      <div class="stats">
        <div class="stat"><span class="valor">${activas}</span><span class="etiqueta">Tareas activas</span></div>
        <div class="stat"><span class="valor">${pendientes}</span><span class="etiqueta">Presupuestos sin responder</span></div>
        <div class="stat"><span class="valor">${sinLeer}</span><span class="etiqueta">Mensajes sin leer</span></div>
        <div class="stat"><span class="valor">${fmtEurosCorto(saldo)}</span><span class="etiqueta">Saldo del monedero</span></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>Tareas recientes</h3>
          <a class="btn btn-hollow btn-sm" href="/mi-cuenta/tareas">Ver todas</a>
        </div>
        ${tareas.length ? frag`
          <div class="table-wrap">
            <table class="tabla">
              <thead>
                <tr><th>Tarea</th><th>Fecha</th><th>Estado</th><th>Presupuesto</th><th>Ofertas</th><th></th></tr>
              </thead>
              <tbody>
                ${tareas.map(t => frag`
                  <tr>
                    <td>
                      <b>${t.titulo || t.categoria_nombre || 'Tarea sin título'}</b>
                      <div class="muted">${t.categoria_nombre || ''}</div>
                    </td>
                    <td>${t.fecha ? fechaCorta(t.fecha) : '—'}</td>
                    <td>${pillTarea(t.estado)}</td>
                    <td class="mono">${t.precio_final ? fmtEurosCorto(t.precio_final) : '—'}</td>
                    <td>${t.ofertas}${t.ofertas_pendientes ? frag` <span class="pill-estado">${t.ofertas_pendientes} nuevas</span>` : ''}</td>
                    <td class="row-actions"><a class="btn btn-sm btn-hollow" href="/mi-cuenta/tareas/${t.id}">Ver</a></td>
                  </tr>`)}
              </tbody>
            </table>
          </div>` : tablaVacia('Todavía no has publicado ninguna tarea. <a href="/publicar-tarea">Publica la primera</a>.')}
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>Presupuestos por responder</h3>
          <a class="btn btn-hollow btn-sm" href="/mi-cuenta/presupuestos">Ver todos</a>
        </div>
        ${presupuestos.length ? frag`
          <div class="taskers-mini">
            ${presupuestos.map(p => frag`
              <div class="tasker-mini">
                <img class="avatar" src="/assets/img/avatar-1.svg" alt="" width="52" height="52">
                <div class="datos">
                  <b>${p.nombre} ${p.apellidos || ''}</b>
                  <span>${p.tarea_titulo || 'Tarea'} · ${p.horas} h · ${fmtEurosCorto(p.precio)}</span>
                </div>
                <a class="btn btn-sm" href="/mi-cuenta/tareas/${p.tarea_id}">Responder</a>
              </div>`)}
          </div>` : tablaVacia('No hay presupuestos pendientes de respuesta.')}
      </div>`;

    const contenido = panelCuenta(ctx, 'Mi cuenta', cuerpo);
    return layout({
      titulo: 'Mi cuenta', descripcion: 'Panel de cliente de TrabajoFácil',
      usuario: yo, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash
    });
  });

  router.get('/mi-cuenta/verificacion', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    const yo = ctx.usuario;
    const v = q.get('SELECT * FROM verificaciones WHERE usuario_id=?', yo.id);

    let bloque;
    if (v && v.estado === 'aprobado') {
      bloque = frag`
        <div class="nota-ok">
          <b>Identidad verificada.</b> Ya puedes publicar tareas: las ofertas que publiques se muestran como reales.
        </div>
        <p class="pista">Éstos son los ficheros que enviaste para la revisión:</p>
        ${galeriaDocumentos(v)}`;
    } else if (v && v.estado === 'pendiente') {
      bloque = frag`
        <div class="alert-box">
          <b>Tu verificación está en revisión</b>
          <p class="muted">Hemos recibido tu documentación. En cuanto la revisemos te avisaremos y podrás publicar tareas.</p>
        </div>
        <p class="pista">Estos son los ficheros que has enviado:</p>
        ${galeriaDocumentos(v)}`;
    } else {
      bloque = frag`
        <div class="alert-box">
          <b>Verificamos tu DNI o NIE para que las ofertas publicadas sean reales.</b>
          <p class="muted">${v && v.notas ? v.notas : 'Sube una foto de tu documento y un selfie: revisamos la documentación antes de que publiques.'}</p>
        </div>
        <form method="post" action="/mi-cuenta/verificacion" enctype="multipart/form-data">
          <input type="hidden" name="csrf" value="${ctx.csrf}">
          <div class="campo">
            <label for="verif_tipo">Tipo de documento</label>
            <select id="verif_tipo" name="documento_tipo" required>
              <option value="dni">DNI</option>
              <option value="nie">NIE</option>
            </select>
          </div>
          <div class="campo">
            <label for="verif_numero">Número del documento</label>
            <input type="text" id="verif_numero" name="documento_numero" maxlength="20"
                   minlength="5" placeholder="12345678Z" required>
          </div>
          <div class="campo">
            <label for="verif_frente">Frente del documento</label>
            <input type="file" id="verif_frente" name="documento_frente" accept="image/*" required>
            <div class="pista">Obligatorio: una foto nítida de la parte frontal.</div>
          </div>
          <div class="campo">
            <label for="verif_reverso">Reverso del documento</label>
            <input type="file" id="verif_reverso" name="documento_reverso" accept="image/*">
            <div class="pista">Opcional: sólo si tu documento tiene reverso.</div>
          </div>
          <div class="campo">
            <label for="verif_selfie">Selfie con el documento al lado</label>
            <input type="file" id="verif_selfie" name="selfie" accept="image/*" required>
            <div class="pista">Obligatorio: una foto tuya, de frente y con el documento al lado.</div>
          </div>
          <div class="acciones">
            <button class="btn" type="submit">Enviar documentación</button>
          </div>
        </form>`;
    }

    const cuerpo = frag`
      <div class="panel">
        <div class="panel-head"><h3>Verificación de identidad</h3></div>
        ${bloque}
      </div>`;

    const contenido = panelCuenta(ctx, 'Verificación de identidad', cuerpo);
    return layout({
      titulo: 'Verificación de identidad', descripcion: 'Verifica tu DNI o NIE para publicar tareas',
      usuario: yo, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash
    });
  });

  router.post('/mi-cuenta/verificacion', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    if (!exigirCsrf(ctx)) return;
    const yo = ctx.usuario;

    const tipo = txt(ctx.body.documento_tipo).toLowerCase();
    if (!['dni', 'nie'].includes(tipo)) {
      flash(ctx.res, 'Indica si tu documento es un DNI o un NIE.', 'error');
      return { redirigir: '/mi-cuenta/verificacion' };
    }
    const numero = txt(ctx.body.documento_numero).toUpperCase();
    if (numero.length < 5) {
      flash(ctx.res, 'Escribe el número de tu documento de identidad.', 'error');
      return { redirigir: '/mi-cuenta/verificacion' };
    }

    const frente = archivoDe(ctx, 'documento_frente');
    const reverso = archivoDe(ctx, 'documento_reverso');
    const selfie = archivoDe(ctx, 'selfie');
    if (!frente) {
      flash(ctx.res, 'Sube la parte frontal de tu documento.', 'error');
      return { redirigir: '/mi-cuenta/verificacion' };
    }
    if (!selfie) {
      flash(ctx.res, 'Sube un selfie con el documento al lado.', 'error');
      return { redirigir: '/mi-cuenta/verificacion' };
    }

    let rutaFrente, rutaReverso, rutaSelfie;
    try {
      rutaFrente = await guardarArchivo(frente, 'documentos');
      rutaReverso = reverso ? await guardarArchivo(reverso, 'documentos') : '';
      rutaSelfie = await guardarArchivo(selfie, 'documentos');
    } catch (e) {
      console.error('No se pudieron guardar los documentos:', e);
      flash(ctx.res, 'No pudimos guardar tus ficheros. Inténtalo de nuevo.', 'error');
      return { redirigir: '/mi-cuenta/verificacion' };
    }

    const existe = q.get('SELECT id FROM verificaciones WHERE usuario_id=?', yo.id);
    if (existe) {
      q.run(
        `UPDATE verificaciones SET estado='pendiente', documento_tipo=?, documento_numero=?,
           documento_frente=?, documento_reverso=?, selfie=?, revisado_por=NULL, revisado_en=NULL,
           notas='', creado_en=? WHERE usuario_id=?`,
        tipo, numero, rutaFrente, rutaReverso, rutaSelfie, ahora(), yo.id
      );
    } else {
      q.run(
        `INSERT INTO verificaciones
           (usuario_id,estado,documento_tipo,documento_numero,documento_frente,documento_reverso,selfie,creado_en)
         VALUES (?,?,?,?,?,?,?,?)`,
        yo.id, 'pendiente', tipo, numero, rutaFrente, rutaReverso, rutaSelfie, ahora()
      );
    }

    /* Aviso al equipo de administración. */
    const admin = q.get("SELECT id FROM usuarios WHERE rol='admin' ORDER BY id LIMIT 1");
    if (admin) {
      q.run(
        'INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,0,?)',
        admin.id, 'verificacion', 'Nueva verificación de identidad pendiente',
        `${yo.nombre} ${yo.apellidos || ''} (${yo.email}) ha enviado su ${tipo.toUpperCase()} ${numero}. Revisa los ficheros subidos.`,
        'web', ahora()
      );
    } else {
      q.run(
        'INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,0,?)',
        yo.id, 'verificacion', 'Documentación enviada',
        'Hemos recibido tu documentación. En cuanto haya un revisor disponible se validará tu identidad.',
        'web', ahora()
      );
    }

    flash(ctx.res, 'Documentación enviada. Tu verificación está en revisión.', 'ok');
    return { redirigir: '/mi-cuenta/verificacion' };
  });

  router.get('/mi-cuenta/datos', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    const yo = ctx.usuario;
    const cp = cpInfo(yo.cp);

    const cuerpo = frag`
      <div class="panel">
        <div class="panel-head"><h3>Datos de la cuenta</h3></div>
        <form method="post" action="/mi-cuenta/datos">
          <input type="hidden" name="csrf" value="${ctx.csrf}">
          <div class="form-grid">
            ${H(campo({ nombre: 'nombre', etiqueta: 'Nombre', valor: yo.nombre, requerido: true }))}
            ${H(campo({ nombre: 'apellidos', etiqueta: 'Apellidos', valor: yo.apellidos }))}
            ${H(campo({ nombre: 'email', etiqueta: 'Correo electrónico', tipo: 'email', valor: yo.email, attrs: 'readonly' }))}
            ${H(campo({ nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'tel', valor: yo.telefono }))}
            ${H(campo({ nombre: 'cp', etiqueta: 'Código postal', valor: yo.cp, attrs: 'maxlength="5"' }))}
          </div>
          <p class="pista">${cp ? `Tu código postal corresponde a ${cp.ciudad}, ${cp.provincia}.` : 'Aún no has guardado un código postal válido.'}</p>
          <div class="acciones">
            <button class="btn" type="submit">Guardar cambios</button>
            <a class="btn btn-hollow" href="/mi-cuenta">Volver</a>
          </div>
        </form>
      </div>`;

    const contenido = panelCuenta(ctx, 'Mis datos', cuerpo);
    return layout({ titulo: 'Mis datos', usuario: yo, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash });
  });

  router.post('/mi-cuenta/datos', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    if (!exigirCsrf(ctx)) return;
    const yo = ctx.usuario;
    const nombre = txt(ctx.body.nombre);
    const apellidos = txt(ctx.body.apellidos);
    const telefono = txt(ctx.body.telefono);
    const cp = txt(ctx.body.cp);

    if (!nombre) {
      flash(ctx.res, 'El nombre no puede estar vacío.', 'error');
      return { redirigir: '/mi-cuenta/datos' };
    }
    if (cp && !cpInfo(cp)) {
      flash(ctx.res, 'Ese código postal no existe.', 'error');
      return { redirigir: '/mi-cuenta/datos' };
    }

    let ciudadId = yo.ciudad_id, lat = yo.lat, lng = yo.lng;
    if (cp && cp !== yo.cp) {
      const info = cpInfo(cp);
      ciudadId = info ? info.ciudad_id : null;
      lat = info ? info.lat : null;
      lng = info ? info.lng : null;
    }

    q.run(
      'UPDATE usuarios SET nombre=?, apellidos=?, telefono=?, cp=?, ciudad_id=?, lat=?, lng=?, actualizado_en=? WHERE id=?',
      nombre, apellidos, telefono, cp, ciudadId, lat, lng, ahora(), yo.id
    );
    flash(ctx.res, 'Datos guardados correctamente.', 'ok');
    return { redirigir: '/mi-cuenta/datos' };
  });

  router.get('/mi-cuenta/tareas', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    const yo = ctx.usuario;
    const tareas = q.all(
      `SELECT t.*, c.nombre AS categoria_nombre, ci.nombre AS ciudad_nombre,
              e.fotos AS fotos_extra,
              (SELECT COUNT(*) FROM presupuestos p WHERE p.tarea_id=t.id) AS ofertas,
              (SELECT COUNT(*) FROM presupuestos p WHERE p.tarea_id=t.id AND p.estado='enviado') AS ofertas_pendientes
       FROM tareas t
       LEFT JOIN categorias c ON c.id=t.categoria_id
       LEFT JOIN ciudades ci ON ci.id=t.ciudad_id
       LEFT JOIN tarea_extra e ON e.tarea_id=t.id
       WHERE t.cliente_id=? ORDER BY t.id DESC`, yo.id);

    const cuerpo = frag`
      <div class="panel">
        <div class="panel-head">
          <h3>Mis tareas</h3>
          <a class="btn btn-sm" href="/publicar-tarea">Publicar tarea</a>
        </div>
        ${tareas.length ? frag`
          <div class="table-wrap">
            <table class="tabla">
              <thead>
                <tr><th>Tarea</th><th>Categoría</th><th>Fecha</th><th>Estado</th><th>Presupuesto</th><th>Ofertas</th><th>Fotos</th><th></th></tr>
              </thead>
              <tbody>
                ${tareas.map(t => frag`
                  <tr>
                    <td><b>${t.titulo || 'Tarea sin título'}</b><div class="muted">${t.ciudad_nombre || ''}</div></td>
                    <td>${t.categoria_nombre || '—'}</td>
                    <td>${t.fecha ? fechaCorta(t.fecha) : '—'}</td>
                    <td>${pillTarea(t.estado)}</td>
                    <td class="mono">${t.precio_final ? fmtEurosCorto(t.precio_final) : '—'}</td>
                    <td>${t.ofertas}${t.ofertas_pendientes ? frag` <span class="pill-estado">${t.ofertas_pendientes} nuevas</span>` : ''}</td>
                    <td>${miniFotos(jsonArr(t.fotos_extra))}</td>
                    <td class="row-actions"><a class="btn btn-sm btn-hollow" href="/mi-cuenta/tareas/${t.id}">Ver detalle</a></td>
                  </tr>`)}
              </tbody>
            </table>
          </div>` : tablaVacia('Todavía no tienes ninguna tarea. <a href="/publicar-tarea">Publica la primera</a>.')}
      </div>`;

    const contenido = panelCuenta(ctx, 'Mis tareas', cuerpo);
    return layout({ titulo: 'Mis tareas', usuario: yo, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash });
  });

  router.get('/mi-cuenta/tareas/:id', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    const yo = ctx.usuario;
    const tarea = tareaDeCliente(yo.id, Number(ctx.params.id));
    if (!tarea) {
      flash(ctx.res, 'No hemos encontrado esa tarea.', 'error');
      return { redirigir: '/mi-cuenta/tareas' };
    }

    const cat = tarea.categoria_id ? q.get('SELECT * FROM categorias WHERE id=?', tarea.categoria_id) : null;
    const ciudad = tarea.ciudad_id ? q.get('SELECT * FROM ciudades WHERE id=?', tarea.ciudad_id) : null;

    const presupuestos = q.all(
      `SELECT p.*, u.nombre, u.apellidos, u.avatar
       FROM presupuestos p JOIN usuarios u ON u.id=p.profesional_id
       WHERE p.tarea_id=? ORDER BY p.creado_en DESC`, tarea.id);

    const asignado = tarea.profesional_id ? q.get('SELECT * FROM usuarios WHERE id=?', tarea.profesional_id) : null;
    const mensajes = q.all(
      `SELECT m.*, u.nombre AS emisor_nombre, u.apellidos AS emisor_apellidos
       FROM mensajes m JOIN usuarios u ON u.id=m.emisor_id
       WHERE m.tarea_id=? ORDER BY m.creado_en ASC`, tarea.id);

    /* Los mensajes dirigidos a mí quedan leídos al abrir la tarea. */
    q.run('UPDATE mensajes SET leido=1 WHERE tarea_id=? AND destinatario_id=? AND leido=0', tarea.id, yo.id);

    const miOpinion = q.get('SELECT COUNT(*) AS n FROM opiniones WHERE tarea_id=? AND autor_id=?', tarea.id, yo.id);
    const valora = asignado ? valoracionDe(asignado.id) : { media: 0, n: 0 };
    const extra = q.get('SELECT fotos FROM tarea_extra WHERE tarea_id=?', tarea.id);
    const fotos = extra ? jsonArr(extra.fotos) : [];

    const cuerpo = frag`
      <div class="panel">
        <div class="panel-head">
          <h3>${tarea.titulo || 'Tarea sin título'}</h3>
          ${pillTarea(tarea.estado)}
        </div>
        <div class="resumen">
          <dl>
            <dt>Categoría</dt><dd>${cat ? cat.nombre : '—'}</dd>
            <dt>Dirección</dt><dd>${tarea.direccion || '—'}</dd>
            <dt>Ciudad</dt><dd>${ciudad ? ciudad.nombre : '—'}${tarea.cp ? ` (${tarea.cp})` : ''}</dd>
            <dt>Fecha</dt><dd>${tarea.fecha ? fmtFecha(tarea.fecha) : '—'}</dd>
            <dt>Hora</dt><dd>${tarea.hora || '—'}</dd>
            <dt>Duración</dt><dd>${tarea.horas} h</dd>
            <dt>Frecuencia</dt><dd>${tarea.frecuencia}</dd>
            <dt>Presupuesto</dt><dd>${tarea.precio_final ? fmtEuros(tarea.precio_final) : '—'}</dd>
          </dl>
        </div>
        <p class="mt-2">${tarea.descripcion || ''}</p>
        ${fotos.length ? frag`
          <div class="mt-2">
            <p class="pista">Fotos del trabajo a realizar:</p>
            ${galeriaFotos(fotos)}
          </div>` : ''}
        ${asignado ? frag`
          <div class="nota-ok">
            <b>Profesional asignado:</b> ${asignado.nombre} ${asignado.apellidos || ''}
            · valoración ${valora.media.toFixed(1)} (${valora.n} opiniones)
          </div>` : ''}
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Presupuestos recibidos (${presupuestos.length})</h3></div>
        ${presupuestos.length ? frag`
          <div class="taskers-mini">
            ${presupuestos.map(p => {
              const v = valoracionDe(p.profesional_id);
              const puedeDecidir = p.estado === 'enviado' && !tarea.profesional_id && tarea.estado !== 'completada';
              return frag`
                <div class="tasker-mini">
                  <img class="avatar" src="${p.avatar || '/assets/img/avatar-1.svg'}" alt="" width="52" height="52">
                  <div class="datos">
                    <b>${p.nombre} ${p.apellidos || ''}</b>
                    <span class="estrellas">${estrellas(v.media)} ${v.media.toFixed(1)} (${v.n})</span>
                    <span>${p.horas} h · <b class="precio">${fmtEurosCorto(p.precio)}</b></span>
                    <span>${p.mensaje || ''}</span>
                    <span class="fecha">${tiempoRelativo(p.creado_en)}</span>
                  </div>
                  <div class="acciones">
                    ${pillPresupuesto(p.estado)}
                    ${puedeDecidir ? frag`
                      <form method="post" action="/mi-cuenta/tareas/${tarea.id}/aceptar/${p.id}">
                        <input type="hidden" name="csrf" value="${ctx.csrf}">
                        <button class="btn btn-sm" type="submit">Aceptar</button>
                      </form>
                      <form method="post" action="/mi-cuenta/tareas/${tarea.id}/rechazar/${p.id}">
                        <input type="hidden" name="csrf" value="${ctx.csrf}">
                        <button class="btn btn-sm btn-hollow" type="submit">Rechazar</button>
                      </form>` : ''}
                  </div>
                </div>`;
            })}
          </div>` : tablaVacia('Todavía nadie ha enviado un presupuesto para esta tarea.')}
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Mensajes</h3></div>
        ${hiloMensajes(mensajes, yo.id)}
        ${tarea.profesional_id ? formMensaje(ctx, `/mi-cuenta/tareas/${tarea.id}/mensajes`) : ''}
      </div>

      ${tarea.estado === 'en_curso' ? frag`
        <div class="panel">
          <div class="panel-head"><h3>Finalizar trabajo</h3></div>
          <p class="muted">Cuando el profesional haya terminado, marca la tarea como completada.</p>
          <form method="post" action="/mi-cuenta/tareas/${tarea.id}/completar">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            <button class="btn" type="submit">Marcar como completada</button>
          </form>
        </div>` : ''}

      ${tarea.estado === 'completada' && asignado && num(miOpinion.n) === 0 ? frag`
        <div class="panel">
          <div class="panel-head"><h3>Valora a ${asignado.nombre}</h3></div>
          <form method="post" action="/mi-cuenta/tareas/${tarea.id}/opinion">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            <div class="campo">
              <label>Puntuación</label>
              <div class="opciones">
                ${[1, 2, 3, 4, 5].map(n => frag`
                  <label class="opcion">
                    <input type="radio" name="puntuacion" value="${n}" required> ${'★'.repeat(n)}
                  </label>`)}
              </div>
            </div>
            <div class="campo">
              <label for="c_comentario">Comentario (opcional)</label>
              <textarea id="c_comentario" name="comentario" placeholder="¿Qué tal ha ido el trabajo?"></textarea>
            </div>
            <button class="btn" type="submit">Enviar valoración</button>
          </form>
        </div>` : ''}`;

    const contenido = panelCuenta(ctx, 'Detalle de la tarea', cuerpo);
    return layout({ titulo: 'Detalle de la tarea', usuario: yo, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash });
  });

  router.post('/mi-cuenta/tareas/:id/aceptar/:pid', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    if (!exigirCsrf(ctx)) return;
    const yo = ctx.usuario;
    const tarea = tareaDeCliente(yo.id, Number(ctx.params.id));
    if (!tarea) {
      flash(ctx.res, 'No hemos encontrado esa tarea.', 'error');
      return { redirigir: '/mi-cuenta/tareas' };
    }
    const presu = q.get('SELECT * FROM presupuestos WHERE id=? AND tarea_id=?', Number(ctx.params.pid), tarea.id);
    if (!presu) {
      flash(ctx.res, 'Ese presupuesto no pertenece a tu tarea.', 'error');
      return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
    }
    if (presu.estado !== 'enviado') {
      flash(ctx.res, 'Ese presupuesto ya no está pendiente.', 'error');
      return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
    }
    if (tarea.profesional_id) {
      flash(ctx.res, 'Esta tarea ya tiene un profesional asignado.', 'error');
      return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
    }

    const precio = redondear(presu.precio);
    const ref = `T${tarea.id}-P${presu.id}`;

    q.run("UPDATE presupuestos SET estado='aceptado', responde_en=? WHERE id=?", ahora(), presu.id);
    q.run(
      `UPDATE tareas SET estado='en_curso', profesional_id=?, presupuesto_id=?, precio_final=?, comision=0, titulo=? WHERE id=?`,
      presu.profesional_id, presu.id, precio,
      tarea.titulo || `Servicio contratado (presupuesto ${ref})`, tarea.id
    );

    q.run(
      `INSERT INTO transacciones (tipo,usuario_id,tarea_id,monto,comision,estado,referencia,descripcion,creado_en)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      'pago_cliente', yo.id, tarea.id, precio, 0, 'completada', ref, 'Pago al profesional asignado', ahora()
    );
    q.run(
      `INSERT INTO transacciones (tipo,usuario_id,tarea_id,monto,comision,estado,referencia,descripcion,creado_en)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      'pago_profesional', presu.profesional_id, tarea.id, precio, 0, 'completada', ref,
      'Abono del profesional (sin comisión de plataforma)', ahora()
    );

    q.run(
      'INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,?,?)',
      presu.profesional_id, 'info', '¡Presupuesto aceptado!',
      `El cliente ha aceptado tu presupuesto de ${fmtEurosCorto(precio)} para la tarea "${tarea.titulo || ref}".`,
      'web', 0, ahora()
    );

    /* Los demás presupuestos pasan a rechazados y sus profesionales recuperan 5 tokens. */
    reembolsarPendientes(tarea.id, 'El cliente ha elegido otro presupuesto');

    flash(ctx.res, 'Presupuesto aceptado. El profesional ya está avisado.', 'ok');
    return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
  });

  router.post('/mi-cuenta/tareas/:id/rechazar/:pid', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    if (!exigirCsrf(ctx)) return;
    const yo = ctx.usuario;
    const tarea = tareaDeCliente(yo.id, Number(ctx.params.id));
    if (!tarea) {
      flash(ctx.res, 'No hemos encontrado esa tarea.', 'error');
      return { redirigir: '/mi-cuenta/tareas' };
    }
    const presu = q.get('SELECT * FROM presupuestos WHERE id=? AND tarea_id=?', Number(ctx.params.pid), tarea.id);
    if (!presu) {
      flash(ctx.res, 'Ese presupuesto no pertenece a tu tarea.', 'error');
      return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
    }
    if (presu.estado !== 'enviado') {
      flash(ctx.res, 'Ese presupuesto ya no está pendiente.', 'error');
      return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
    }

    q.run("UPDATE presupuestos SET estado='rechazado', responde_en=? WHERE id=?", ahora(), presu.id);
    /* El profesional recupera 5 de los 10 tokens del envío. */
    reembolsarTokens(presu.profesional_id, presu.id, 'Presupuesto rechazado por el cliente');
    q.run(
      'INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,?,?)',
      presu.profesional_id, 'info', 'Presupuesto no seleccionado',
      `El cliente no ha elegido tu presupuesto para la tarea "${tarea.titulo || ''}". Te devolvemos 5 tokens de los 10 tokens del envío.`,
      'web', 0, ahora()
    );

    flash(ctx.res, 'Has rechazado el presupuesto.', 'ok');
    return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
  });

  router.post('/mi-cuenta/tareas/:id/mensajes', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    if (!exigirCsrf(ctx)) return;
    const yo = ctx.usuario;
    const tarea = tareaDeCliente(yo.id, Number(ctx.params.id));
    if (!tarea) {
      flash(ctx.res, 'No hemos encontrado esa tarea.', 'error');
      return { redirigir: '/mi-cuenta/tareas' };
    }
    if (!tarea.profesional_id) {
      flash(ctx.res, 'Todavía no hay ningún profesional asignado a esta tarea.', 'error');
      return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
    }
    const cuerpo = txt(ctx.body.cuerpo);
    if (!cuerpo) {
      flash(ctx.res, 'Escribe un mensaje antes de enviarlo.', 'error');
      return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
    }

    q.run('INSERT INTO mensajes (tarea_id,emisor_id,destinatario_id,cuerpo,leido,creado_en) VALUES (?,?,?,?,?,?)',
      tarea.id, yo.id, tarea.profesional_id, cuerpo, 0, ahora());
    q.run(
      'INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,?,?)',
      tarea.profesional_id, 'mensaje', 'Nuevo mensaje del cliente',
      cuerpo.slice(0, 180), 'web', 0, ahora()
    );

    flash(ctx.res, 'Mensaje enviado.', 'ok');
    return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
  });

  router.post('/mi-cuenta/tareas/:id/completar', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    if (!exigirCsrf(ctx)) return;
    const yo = ctx.usuario;
    const tarea = tareaDeCliente(yo.id, Number(ctx.params.id));
    if (!tarea) {
      flash(ctx.res, 'No hemos encontrado esa tarea.', 'error');
      return { redirigir: '/mi-cuenta/tareas' };
    }
    if (tarea.estado !== 'en_curso') {
      flash(ctx.res, 'Sólo puedes completar una tarea que esté en curso.', 'error');
      return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
    }

    q.run("UPDATE tareas SET estado='completada', cerrada_en=? WHERE id=?", ahora(), tarea.id);
    if (tarea.profesional_id) {
      q.run(
        'INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,?,?)',
        tarea.profesional_id, 'info', 'Tarea completada',
        `El cliente ha marcado como completada la tarea "${tarea.titulo || ''}".`,
        'web', 0, ahora()
      );
    }
    flash(ctx.res, '¡Tarea completada! Ahora puedes valorar al profesional.', 'ok');
    return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
  });

  router.post('/mi-cuenta/tareas/:id/opinion', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    if (!exigirCsrf(ctx)) return;
    const yo = ctx.usuario;
    const tarea = tareaDeCliente(yo.id, Number(ctx.params.id));
    if (!tarea) {
      flash(ctx.res, 'No hemos encontrado esa tarea.', 'error');
      return { redirigir: '/mi-cuenta/tareas' };
    }
    if (tarea.estado !== 'completada' || !tarea.profesional_id) {
      flash(ctx.res, 'Sólo puedes valorar una tarea completada.', 'error');
      return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
    }
    if (num(q.get('SELECT COUNT(*) AS n FROM opiniones WHERE tarea_id=? AND autor_id=?', tarea.id, yo.id).n) > 0) {
      flash(ctx.res, 'Ya has valorado esta tarea.', 'error');
      return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
    }
    const puntuacion = Math.round(num(ctx.body.puntuacion));
    if (puntuacion < 1 || puntuacion > 5) {
      flash(ctx.res, 'Elige una puntuación entre 1 y 5 estrellas.', 'error');
      return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
    }
    const comentario = txt(ctx.body.comentario);

    q.run('INSERT INTO opiniones (tarea_id,autor_id,profesional_id,puntuacion,comentario,creado_en) VALUES (?,?,?,?,?,?)',
      tarea.id, yo.id, tarea.profesional_id, puntuacion, comentario, ahora());
    q.run(
      'INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,?,?)',
      tarea.profesional_id, 'info', 'Nueva valoración',
      `Has recibido ${puntuacion} estrellas en la tarea "${tarea.titulo || ''}".`,
      'web', 0, ahora()
    );

    flash(ctx.res, '¡Gracias por tu valoración!', 'ok');
    return { redirigir: `/mi-cuenta/tareas/${tarea.id}` };
  });

  router.get('/mi-cuenta/presupuestos', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    const yo = ctx.usuario;
    const tareas = q.all(
      `SELECT t.*, c.nombre AS categoria_nombre FROM tareas t
       LEFT JOIN categorias c ON c.id=t.categoria_id
       WHERE t.cliente_id=? ORDER BY t.id DESC`, yo.id);

    const cuerpo = frag`
      <div class="panel">
        <div class="panel-head"><h3>Presupuestos recibidos</h3></div>
        ${tareas.length ? frag`
          ${tareas.map(t => {
            const ps = q.all(
              `SELECT p.*, u.nombre, u.apellidos FROM presupuestos p
               JOIN usuarios u ON u.id=p.profesional_id
               WHERE p.tarea_id=? ORDER BY p.creado_en DESC`, t.id);
            if (!ps.length) return '';
            return frag`
              <div class="panel-head"><h3>${t.titulo || 'Tarea sin título'}</h3><a class="btn btn-sm btn-hollow" href="/mi-cuenta/tareas/${t.id}">Ver tarea</a></div>
              <div class="table-wrap">
                <table class="tabla">
                  <thead><tr><th>Profesional</th><th>Precio</th><th>Horas</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>
                  <tbody>
                    ${ps.map(p => frag`
                      <tr>
                        <td>${p.nombre} ${p.apellidos || ''}</td>
                        <td class="mono">${fmtEurosCorto(p.precio)}</td>
                        <td>${p.horas} h</td>
                        <td>${pillPresupuesto(p.estado)}</td>
                        <td>${fechaCorta(p.creado_en)}</td>
                        <td class="row-actions"><a class="btn btn-sm btn-hollow" href="/mi-cuenta/tareas/${t.id}">Abrir</a></td>
                      </tr>`)}
                  </tbody>
                </table>
              </div>`;
          })}
          ${tareas.every(t => num(q.get('SELECT COUNT(*) AS n FROM presupuestos WHERE tarea_id=?', t.id).n) === 0)
            ? tablaVacia('Todavía no has recibido ningún presupuesto.') : ''}
        ` : tablaVacia('Todavía no has publicado ninguna tarea. <a href="/publicar-tarea">Publica la primera</a>.')}
      </div>`;

    const contenido = panelCuenta(ctx, 'Presupuestos', cuerpo);
    return layout({ titulo: 'Presupuestos', usuario: yo, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash });
  });

  router.get('/mi-cuenta/mensajes', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    const yo = ctx.usuario;
    const filas = q.all(
      `SELECT m.*,
              CASE WHEN m.emisor_id=? THEN m.destinatario_id ELSE m.emisor_id END AS otro_id,
              u.nombre, u.apellidos
       FROM mensajes m
       JOIN usuarios u ON u.id = CASE WHEN m.emisor_id=? THEN m.destinatario_id ELSE m.emisor_id END
       WHERE m.emisor_id=? OR m.destinatario_id=?
       ORDER BY m.creado_en DESC`, yo.id, yo.id, yo.id, yo.id);

    const vistos = new Map();
    const conversaciones = [];
    for (const m of filas) {
      if (vistos.has(m.otro_id)) continue;
      vistos.set(m.otro_id, true);
      const sinLeer = num(q.get(
        'SELECT COUNT(*) AS n FROM mensajes WHERE destinatario_id=? AND emisor_id=? AND leido=0',
        yo.id, m.otro_id).n);
      conversaciones.push({ ...m, sinLeer });
    }

    const cuerpo = frag`
      <div class="panel">
        <div class="panel-head"><h3>Conversaciones</h3></div>
        ${conversaciones.length ? frag`
          <div class="taskers-mini">
            ${conversaciones.map(c => frag`
              <div class="tasker-mini">
                <img class="avatar" src="/assets/img/avatar-1.svg" alt="" width="52" height="52">
                <div class="datos">
                  <b>${c.nombre} ${c.apellidos || ''}</b>
                  <span>${c.cuerpo}</span>
                  <span class="fecha">${tiempoRelativo(c.creado_en)}${c.sinLeer ? ` · ${c.sinLeer} sin leer` : ''}</span>
                </div>
                <div class="acciones">
                  <a class="btn btn-sm btn-hollow" href="/mi-cuenta/mensajes/${c.otro_id}">Abrir</a>
                </div>
              </div>`)}
          </div>` : tablaVacia('No tienes conversaciones todavía. Cuando un profesional te escriba, aparecerá aquí.')}
      </div>`;

    const contenido = panelCuenta(ctx, 'Mensajes', cuerpo);
    return layout({ titulo: 'Mensajes', usuario: yo, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash });
  });

  router.post('/mi-cuenta/mensajes', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    if (!exigirCsrf(ctx)) return;
    const yo = ctx.usuario;
    const destinatario = Number(ctx.body.destinatario);
    const cuerpo = txt(ctx.body.cuerpo);
    const tareaId = Number(ctx.body.tarea_id) || null;

    if (!destinatario || !cuerpo) {
      flash(ctx.res, 'Elige a quién escribir y escribe el mensaje.', 'error');
      return { redirigir: '/mi-cuenta/mensajes' };
    }
    const tarea = tareaId ? tareaDeCliente(yo.id, tareaId) : null;

    q.run('INSERT INTO mensajes (tarea_id,emisor_id,destinatario_id,cuerpo,leido,creado_en) VALUES (?,?,?,?,?,?)',
      tarea ? tarea.id : null, yo.id, destinatario, cuerpo, 0, ahora());
    q.run(
      'INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,?,?)',
      destinatario, 'mensaje', 'Nuevo mensaje del cliente', cuerpo.slice(0, 180), 'web', 0, ahora()
    );

    flash(ctx.res, 'Mensaje enviado.', 'ok');
    return { redirigir: `/mi-cuenta/mensajes/${destinatario}` };
  });

  router.get('/mi-cuenta/mensajes/:id', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    const yo = ctx.usuario;
    const otro = Number(ctx.params.id);
    const otroUsuario = q.get('SELECT id,nombre,apellidos FROM usuarios WHERE id=?', otro);
    if (!otroUsuario) {
      flash(ctx.res, 'No hemos encontrado a ese profesional.', 'error');
      return { redirigir: '/mi-cuenta/mensajes' };
    }

    /* Sólo si existe una tarea común entre cliente y profesional. */
    const tareaComun = q.get(
      `SELECT t.* FROM tareas t
       WHERE t.cliente_id=? AND (t.profesional_id=? OR EXISTS (
         SELECT 1 FROM presupuestos p WHERE p.tarea_id=t.id AND p.profesional_id=?))
       ORDER BY t.id DESC LIMIT 1`, yo.id, otro, otro);

    if (!tareaComun) {
      flash(ctx.res, 'No tienes ninguna tarea en común con ese profesional.', 'error');
      return { redirigir: '/mi-cuenta/mensajes' };
    }

    const mensajes = q.all(
      `SELECT m.*, u.nombre AS emisor_nombre, u.apellidos AS emisor_apellidos
       FROM mensajes m JOIN usuarios u ON u.id=m.emisor_id
       WHERE (m.emisor_id=? AND m.destinatario_id=?) OR (m.emisor_id=? AND m.destinatario_id=?)
       ORDER BY m.creado_en ASC`, yo.id, otro, otro, yo.id);

    q.run('UPDATE mensajes SET leido=1 WHERE destinatario_id=? AND emisor_id=? AND leido=0', yo.id, otro);

    const cuerpo = frag`
      <div class="panel">
        <div class="panel-head">
          <h3>Conversación con ${otroUsuario.nombre} ${otroUsuario.apellidos || ''}</h3>
          <a class="btn btn-sm btn-hollow" href="/mi-cuenta/tareas/${tareaComun.id}">Ver tarea</a>
        </div>
        ${hiloMensajes(mensajes, yo.id)}
        ${formMensaje(ctx, `/mi-cuenta/mensajes/${otro}`,
          frag`<input type="hidden" name="tarea_id" value="${tareaComun.id}">`)}
      </div>`;

    const contenido = panelCuenta(ctx, 'Conversación', cuerpo);
    return layout({ titulo: 'Conversación', usuario: yo, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash });
  });

  router.post('/mi-cuenta/mensajes/:id', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    if (!exigirCsrf(ctx)) return;
    const yo = ctx.usuario;
    const otro = Number(ctx.params.id);
    const cuerpo = txt(ctx.body.cuerpo);
    const tareaId = Number(ctx.body.tarea_id) || null;

    const tarea = tareaId ? tareaDeCliente(yo.id, tareaId) : null;
    if (!tarea) {
      flash(ctx.res, 'La tarea indicada no es tuya.', 'error');
      return { redirigir: '/mi-cuenta/mensajes' };
    }
    if (!cuerpo) {
      flash(ctx.res, 'Escribe un mensaje antes de enviarlo.', 'error');
      return { redirigir: `/mi-cuenta/mensajes/${otro}` };
    }

    q.run('INSERT INTO mensajes (tarea_id,emisor_id,destinatario_id,cuerpo,leido,creado_en) VALUES (?,?,?,?,?,?)',
      tarea.id, yo.id, otro, cuerpo, 0, ahora());
    q.run(
      'INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,?,?)',
      otro, 'mensaje', 'Nuevo mensaje del cliente', cuerpo.slice(0, 180), 'web', 0, ahora()
    );

    flash(ctx.res, 'Mensaje enviado.', 'ok');
    return { redirigir: `/mi-cuenta/mensajes/${otro}` };
  });

  router.get('/mi-cuenta/facturacion', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    const yo = ctx.usuario;
    const saldo = saldoMonedero(yo.id);
    const transacciones = q.all(
      'SELECT * FROM transacciones WHERE usuario_id=? ORDER BY id DESC LIMIT 50', yo.id);

    const cuerpo = frag`
      <div class="stats">
        <div class="stat"><span class="valor">${fmtEurosCorto(saldo)}</span><span class="etiqueta">Saldo disponible</span></div>
        <div class="stat"><span class="valor">${transacciones.length}</span><span class="etiqueta">Movimientos</span></div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Recargar monedero (simulado)</h3></div>
        <p class="muted">Prueba el flujo de pago sin movimiento real de dinero.</p>
        <form method="post" action="/mi-cuenta/facturacion/recargar">
          <input type="hidden" name="csrf" value="${ctx.csrf}">
          <div class="form-grid">
            ${H(campo({ nombre: 'importe', etiqueta: 'Importe (€)', tipo: 'number', requerido: true, attrs: 'min="1" max="500" step="0.5"', placeholder: '50' }))}
          </div>
          <div class="acciones"><button class="btn" type="submit">Recargar</button></div>
        </form>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Histórico de movimientos</h3></div>
        ${transacciones.length ? frag`
          <div class="table-wrap">
            <table class="tabla">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Comisión</th><th>Referencia</th></tr></thead>
              <tbody>
                ${transacciones.map(t => frag`
                  <tr>
                    <td>${fechaCorta(t.creado_en)}</td>
                    <td>${t.tipo}</td>
                    <td class="mono">${fmtEurosCorto(t.monto)}</td>
                    <td class="mono">${t.comision ? fmtEurosCorto(t.comision) : '—'}</td>
                    <td class="mono muted">${t.referencia || '—'}</td>
                  </tr>`)}
              </tbody>
            </table>
          </div>` : tablaVacia('Todavía no tienes movimientos en el monedero.')}
      </div>`;

    const contenido = panelCuenta(ctx, 'Facturación', cuerpo);
    return layout({ titulo: 'Facturación', usuario: yo, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash });
  });

  router.post('/mi-cuenta/facturacion/recargar', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    if (!exigirCsrf(ctx)) return;
    const yo = ctx.usuario;
    const importe = redondear(num(ctx.body.importe));

    if (!(importe > 0)) {
      flash(ctx.res, 'El importe debe ser mayor que cero.', 'error');
      return { redirigir: '/mi-cuenta/facturacion' };
    }
    if (importe > 500) {
      flash(ctx.res, 'La recarga máxima es de 500 €.', 'error');
      return { redirigir: '/mi-cuenta/facturacion' };
    }

    q.run(
      `INSERT INTO transacciones (tipo,usuario_id,tarea_id,monto,comision,estado,referencia,descripcion,creado_en)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      'recarga', yo.id, null, importe, 0, 'completada', `REC-${Date.now().toString(36).toUpperCase()}`,
      'Recarga de monedero (simulada)', ahora()
    );

    flash(ctx.res, `Monedero recargado con ${fmtEurosCorto(importe)}.`, 'ok');
    return { redirigir: '/mi-cuenta/facturacion' };
  });

  /* ================================================================== */
  /* PUBLICAR TAREA (flujo por pasos)                                   */
  /* ================================================================== */

  function borradorDe(clienteId) {
    return q.get(
      `SELECT t.*, e.pasos, e.dias, e.repeticiones, e.flexibilidad_fecha,
              e.flexibilidad_hora, e.transportes, e.fotos
       FROM tareas t LEFT JOIN tarea_extra e ON e.tarea_id=t.id
       WHERE t.cliente_id=? AND t.estado='borrador'
       ORDER BY t.id DESC LIMIT 1`, clienteId) || null;
  }

  function crearBorrador(clienteId) {
    const r = q.run(
      "INSERT INTO tareas (cliente_id,descripcion,direccion,cp,horas,frecuencia,estado,creada_en) VALUES (?,?,?,?,?,?,?,?)",
      clienteId, '', '', '', 1, 'once', 'borrador', ahora()
    );
    q.run('INSERT OR IGNORE INTO tarea_extra (tarea_id) VALUES (?)', r.id);
    return r.id;
  }

  function pasosHechos(b) {
    if (!b || !b.pasos) return [];
    try { const p = JSON.parse(b.pasos); return Array.isArray(p) ? p : []; } catch { return []; }
  }

  function jsonArr(v) {
    if (!v) return [];
    try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
  }

  function pasoSiguiente(b) {
    const hechos = pasosHechos(b);
    for (const p of PASOS) if (!hechos.includes(p.id)) return p.id;
    return 'publicar';
  }

  function guardarPasos(tareaId, pasos) {
    q.run('INSERT OR IGNORE INTO tarea_extra (tarea_id) VALUES (?)', tareaId);
    q.run('UPDATE tarea_extra SET pasos=? WHERE tarea_id=?', JSON.stringify(pasos), tareaId);
  }

  function marcarPaso(clienteId, tareaId, pasoId) {
    const pasos = pasosHechos(borradorDe(clienteId));
    if (!pasos.includes(pasoId)) pasos.push(pasoId);
    guardarPasos(tareaId, pasos);
  }

  router.get('/publicar-tarea', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    const yo = ctx.usuario;

    if (yo.rol === 'profesional') {
      const contenido = frag`
        <div class="aviso">
          <h1>Publicar tareas es para clientes</h1>
          <p>Tu cuenta es de profesional: puedes enviar presupuestos a las tareas publicadas por otros clientes.</p>
          <a class="btn" href="/profesional">Ir a mi panel de profesional</a>
        </div>`;
      return layout({ titulo: 'Publicar tarea', usuario: yo, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash });
    }

    /* Para publicar hace falta verificar la identidad con DNI/NIE. */
    if (!clienteVerificado(yo)) {
      flash(ctx.res, motivoSinVerificar(yo), 'error');
      return { redirigir: '/mi-cuenta/verificacion' };
    }

    let borrador = borradorDe(yo.id);
    if (!borrador) crearBorrador(yo.id);
    borrador = borradorDe(yo.id);

    const pedido = ctx.query.paso;
    const paso = PASOS.some(p => p.id === pedido) ? pedido : pasoSiguiente(borrador);
    const contenido = vistaPaso(ctx, borrador, paso);
    return layout({
      titulo: 'Publicar tarea', descripcion: 'Publica tu tarea y recibe presupuestos',
      usuario: yo, ruta: ctx.ruta, contenido: asHtml(contenido), flash: ctx.flash
    });
  });

  router.post('/publicar-tarea/:paso', async (ctx) => {
    if (!exigirLogin(ctx)) return;
    const yo = ctx.usuario;
    if (yo.rol === 'profesional') {
      flash(ctx.res, 'Sólo los clientes pueden publicar tareas.', 'error');
      return { redirigir: '/profesional' };
    }
    /* Para publicar hace falta verificar la identidad con DNI/NIE. */
    if (!clienteVerificado(yo)) {
      flash(ctx.res, motivoSinVerificar(yo), 'error');
      return { redirigir: '/mi-cuenta/verificacion' };
    }
    if (!exigirCsrf(ctx)) return;
    const paso = txt(ctx.params.paso);
    if (!PASOS.some(p => p.id === paso)) {
      flash(ctx.res, 'Ese paso no existe.', 'error');
      return { redirigir: '/publicar-tarea' };
    }

    let borrador = borradorDe(yo.id);
    if (!borrador) crearBorrador(yo.id);
    borrador = borradorDe(yo.id);
    const tareaId = borrador.id;

    const error = (mensaje) => {
      flash(ctx.res, mensaje, 'error');
      return { redirigir: `/publicar-tarea?paso=${encodeURIComponent(paso)}` };
    };

    switch (paso) {
      case 'servicio': {
        const ref = txt(ctx.body.categoria);
        const cat = /^\d+$/.test(ref)
          ? q.get('SELECT * FROM categorias WHERE id=? AND activa=1', Number(ref))
          : q.get('SELECT * FROM categorias WHERE slug=? AND activa=1', ref);
        if (!cat) return error('Elige el tipo de servicio que necesitas.');
        q.run('UPDATE tareas SET categoria_id=? WHERE id=?', cat.id, tareaId);
        break;
      }

      case 'cp': {
        const cp = txt(ctx.body.cp);
        const info = cpInfo(cp);
        if (!info) return error('Ese código postal no existe. Comprueba que esté bien escrito.');
        const ciudad = ciudadPorCp(cp).ciudad;
        q.run('UPDATE tareas SET cp=?, ciudad_id=?, lat=?, lng=? WHERE id=?',
          cp, ciudad ? ciudad.id : null, info.lat, info.lng, tareaId);
        break;
      }

      case 'frecuencia': {
        const frec = txt(ctx.body.frecuencia);
        if (!FRECUENCIAS.some(f => f[0] === frec)) return error('Elige la frecuencia del servicio.');
        const dias = lista(ctx.body.dias).filter(d => DIAS_SEMANA.some(x => x[0] === d));
        const repeticiones = Math.max(0, Math.round(num(ctx.body.repeticiones)));
        q.run('UPDATE tareas SET frecuencia=? WHERE id=?', frec, tareaId);
        q.run('INSERT OR IGNORE INTO tarea_extra (tarea_id) VALUES (?)', tareaId);
        q.run('UPDATE tarea_extra SET dias=?, repeticiones=? WHERE tarea_id=?',
          JSON.stringify(dias), repeticiones, tareaId);
        break;
      }

      case 'fecha': {
        const fecha = txt(ctx.body.fecha);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return error('Indica una fecha válida.');
        const d = new Date(fecha + 'T00:00:00');
        if (isNaN(d.getTime())) return error('Indica una fecha válida.');
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        if (d.getTime() < hoy.getTime()) return error('La fecha no puede ser anterior a hoy.');
        q.run('UPDATE tareas SET fecha=? WHERE id=?', fecha, tareaId);
        break;
      }

      case 'hora': {
        const hora = txt(ctx.body.hora);
        if (!/^\d{1,2}:\d{2}$/.test(hora)) return error('Indica una hora válida.');
        q.run('UPDATE tareas SET hora=? WHERE id=?', hora.padStart(5, '0'), tareaId);
        break;
      }

      case 'horas': {
        const horas = num(ctx.body.horas, 0);
        if (!(horas > 0) || horas > 24) return error('Indica cuántas horas necesitas (entre 0,5 y 24).');
        q.run('UPDATE tareas SET horas=? WHERE id=?', redondear(horas), tareaId);
        break;
      }

      case 'flexibilidad-fecha': {
        const v = txt(ctx.body.flexibilidad_fecha) === 'si' ? 'si' : 'no';
        q.run('INSERT OR IGNORE INTO tarea_extra (tarea_id) VALUES (?)', tareaId);
        q.run('UPDATE tarea_extra SET flexibilidad_fecha=? WHERE tarea_id=?', v, tareaId);
        break;
      }

      case 'flexibilidad-hora': {
        const v = ['manana', 'tarde', 'cualquiera', 'no'].includes(txt(ctx.body.flexibilidad_hora))
          ? txt(ctx.body.flexibilidad_hora) : 'cualquiera';
        q.run('INSERT OR IGNORE INTO tarea_extra (tarea_id) VALUES (?)', tareaId);
        q.run('UPDATE tarea_extra SET flexibilidad_hora=? WHERE tarea_id=?', v, tareaId);
        break;
      }

      case 'transportes': {
        const t = lista(ctx.body.transportes).filter(x => TRANSPORTES.some(y => y[0] === x));
        q.run('INSERT OR IGNORE INTO tarea_extra (tarea_id) VALUES (?)', tareaId);
        q.run('UPDATE tarea_extra SET transportes=? WHERE tarea_id=?', JSON.stringify(t), tareaId);
        break;
      }

      case 'descripcion': {
        const descripcion = txt(ctx.body.descripcion);
        const direccion = txt(ctx.body.direccion);
        if (descripcion.length < 20) return error('Cuéntanos con algo más de detalle (mínimo 20 caracteres).');
        q.run('UPDATE tareas SET descripcion=?, direccion=? WHERE id=?', descripcion, direccion, tareaId);
        break;
      }

      case 'fotos': {
        const fotos = jsonArr(borrador.fotos);
        for (const a of ctx.archivos || []) {
          if (!/^image\//.test(a.tipo || '')) continue;
          /* Se guardan con nombre único: dos clientes no pueden llamar igual
             a su foto y pisarse. */
          fotos.push(urlContenido(await guardarArchivo(a, 'trabajos')));
        }
        if (!fotos.length) {
          return error('Adjunta al menos una foto del trabajo: sirve para demostrar que la oferta es real.');
        }
        q.run('INSERT OR IGNORE INTO tarea_extra (tarea_id) VALUES (?)', tareaId);
        q.run('UPDATE tarea_extra SET fotos=? WHERE tarea_id=?', JSON.stringify(fotos), tareaId);
        break;
      }

      case 'publicar': {
        const b = borradorDe(yo.id);
        if (!jsonArr(b.fotos).length) {
          flash(ctx.res, 'Adjunta al menos una foto del trabajo: sirve para demostrar que la oferta es real.', 'error');
          return { redirigir: '/publicar-tarea?paso=fotos' };
        }
        const hechos = pasosHechos(b);
        const faltan = REQUERIDOS_PUBLISH.filter(p => !hechos.includes(p));
        if (faltan.length) {
          flash(ctx.res, 'Completa todos los pasos obligatorios antes de publicar.', 'error');
          return { redirigir: `/publicar-tarea?paso=${encodeURIComponent(faltan[0])}` };
        }
        const cat = b.categoria_id ? q.get('SELECT * FROM categorias WHERE id=?', b.categoria_id) : null;
        if (!cat) return error('Elige el tipo de servicio antes de publicar.');

        const ciudad = b.ciudad_id ? q.get('SELECT * FROM ciudades WHERE id=?', b.ciudad_id) : null;
        const info = ciudadPorCp(b.cp);
        const slugCiudad = ciudad ? ciudad.slug : slugify(info ? info.ciudad : '');
        const slug = `${b.id}-${slugify(cat.slug)}${slugCiudad ? `-en-${slugCiudad}` : ''}`;
        const titulo = `${cat.nombre}${ciudad ? ' en ' + ciudad.nombre : ''}`;

        q.run(
          `UPDATE tareas SET estado='publicada', publicada_en=?, slug=?, titulo=? WHERE id=?`,
          ahora(), slug, titulo, b.id
        );
        q.run(
          'INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,?,?)',
          yo.id, 'info', 'Tarea publicada',
          `Tu tarea "${titulo}" ya está visible para los profesionales.`, 'web', 0, ahora()
        );

        flash(ctx.res, '¡Tarea publicada! Los profesionales ya pueden enviarte presupuestos.', 'ok');
        return { redirigir: `/mi-cuenta/tareas/${b.id}` };
      }
    }

    marcarPaso(yo.id, tareaId, paso);
    const siguiente = PASOS.find(p => p.id === paso);
    const indice = PASOS.indexOf(siguiente);
    const proximo = PASOS[indice + 1];
    if (paso === 'publicar') return { redirigir: `/mi-cuenta/tareas/${tareaId}` };
    return { redirigir: `/publicar-tarea?paso=${encodeURIComponent(proximo.id)}` };
  });

  /* ---------------------------------------------------------------- */
  /* Vistas del flujo de publicación                                   */
  /* ---------------------------------------------------------------- */
  function vistaPaso(ctx, b, pasoId) {
    const yo = ctx.usuario;
    const hechos = pasosHechos(b);
    const indice = PASOS.findIndex(p => p.id === pasoId);
    const actual = indice >= 0 ? indice : 0;

    const indicadores = PASOS.map((p, i) => frag`
      <span class="paso-pt ${hechos.includes(p.id) ? 'hecho' : (i === actual ? 'actual' : '')}"
            title="${p.nombre}" aria-label="Paso ${i + 1}: ${p.nombre}">${i + 1}</span>`);

    const progreso = frag`
      <div class="pasos-ind">${indicadores}</div>
      <p class="muted">Paso ${actual + 1} de ${PASOS.length} · ${PASOS[actual].nombre}</p>`;

    const nav = etiquetaContinuar => frag`
      <div class="stepper-nav">
        <a class="btn-fantasma" href="/mi-cuenta/tareas">Cancelar</a>
        <button class="btn" type="submit">${etiquetaContinuar}</button>
      </div>`;

    let cuerpo = '';

    switch (pasoId) {
      case 'servicio': {
        const cats = q.all('SELECT * FROM categorias WHERE activa=1 ORDER BY orden, nombre');
        const sel = b.categoria_id ? (q.get('SELECT slug FROM categorias WHERE id=?', b.categoria_id) || {}).slug : '';
        cuerpo = frag`
          <form method="post" action="/publicar-tarea/servicio">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            <p class="muted">Elige el tipo de servicio que necesitas.</p>
            <div class="chips">
              ${cats.map(c => frag`
                <label class="chip${c.slug === sel ? ' sel' : ''}">
                  <input type="radio" name="categoria" value="${c.slug}" ${c.slug === sel ? 'checked' : ''}>
                  ${H(badgeCategoria(c))}
                </label>`)}
            </div>
            ${nav('/publicar-tarea/servicio', 'Continuar')}
          </form>`;
        break;
      }

      case 'cp': {
        const info = cpInfo(b.cp);
        cuerpo = frag`
          <form method="post" action="/publicar-tarea/cp">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            ${H(campo({ nombre: 'cp', etiqueta: 'Código postal', valor: b.cp, requerido: true, attrs: 'maxlength="5" inputmode="numeric"', placeholder: '28001' }))}
            <p class="pista">${info ? `Tu código postal corresponde a ${info.ciudad}, ${info.provincia}.` : 'Los profesionales de tu zona podrán ver la tarea.'}</p>
            ${nav('/publicar-tarea/cp', 'Continuar')}
          </form>`;
        break;
      }

      case 'frecuencia': {
        const frec = b.frecuencia || 'once';
        const diasSel = jsonArr(b.dias);
        cuerpo = frag`
          <form method="post" action="/publicar-tarea/frecuencia">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            ${H(campo({
              nombre: 'frecuencia', etiqueta: '¿Con qué frecuencia lo necesitas?', tipo: 'select',
              valor: frec, opciones: FRECUENCIAS.map(f => ({ valor: f[0], texto: f[1] }))
            }))}
            <div class="campo">
              <label>Días de la semana</label>
              <div class="opciones">
                ${DIAS_SEMANA.map(d => frag`
                  <label class="opcion${diasSel.includes(d[0]) ? ' sel' : ''}">
                    <input type="checkbox" name="dias" value="${d[0]}" ${diasSel.includes(d[0]) ? 'checked' : ''}> ${d[1]}
                  </label>`)}
              </div>
              <div class="pista">Indica los días si el servicio es semanal o quincenal.</div>
            </div>
            ${H(campo({ nombre: 'repeticiones', etiqueta: 'Número de días seguidos', tipo: 'number', valor: num(b.repeticiones) || '', attrs: 'min="0" max="60"', placeholder: '5' }))}
            ${nav('/publicar-tarea/frecuencia', 'Continuar')}
          </form>`;
        break;
      }

      case 'fecha': {
        cuerpo = frag`
          <form method="post" action="/publicar-tarea/fecha">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            ${H(campo({ nombre: 'fecha', etiqueta: '¿Qué día lo necesitas?', tipo: 'date', valor: b.fecha, requerido: true }))}
            ${nav('/publicar-tarea/fecha', 'Continuar')}
          </form>`;
        break;
      }

      case 'hora': {
        cuerpo = frag`
          <form method="post" action="/publicar-tarea/hora">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            ${H(campo({ nombre: 'hora', etiqueta: '¿A qué hora?', tipo: 'time', valor: b.hora, requerido: true }))}
            ${nav('/publicar-tarea/hora', 'Continuar')}
          </form>`;
        break;
      }

      case 'horas': {
        cuerpo = frag`
          <form method="post" action="/publicar-tarea/horas">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            ${H(campo({ nombre: 'horas', etiqueta: '¿Cuántas horas necesitas?', tipo: 'number', valor: b.horas || 1, requerido: true, attrs: 'min="0.5" max="24" step="0.5"', placeholder: '2' }))}
            ${nav('/publicar-tarea/horas', 'Continuar')}
          </form>`;
        break;
      }

      case 'flexibilidad-fecha': {
        const v = b.flexibilidad_fecha || 'no';
        cuerpo = frag`
          <form method="post" action="/publicar-tarea/flexibilidad-fecha">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            <div class="campo">
              <label>¿Eres flexible con la fecha?</label>
              <div class="opciones">
                <label class="opcion${v === 'si' ? ' sel' : ''}">
                  <input type="radio" name="flexibilidad_fecha" value="si" ${v === 'si' ? 'checked' : ''}> Sí, acepto otras fechas
                </label>
                <label class="opcion${v === 'no' ? ' sel' : ''}">
                  <input type="radio" name="flexibilidad_fecha" value="no" ${v === 'no' ? 'checked' : ''}> No, la fecha es fija
                </label>
              </div>
            </div>
            ${nav('/publicar-tarea/flexibilidad-fecha', 'Continuar')}
          </form>`;
        break;
      }

      case 'flexibilidad-hora': {
        const v = b.flexibilidad_hora || 'cualquiera';
        cuerpo = frag`
          <form method="post" action="/publicar-tarea/flexibilidad-hora">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            ${H(campo({
              nombre: 'flexibilidad_hora', etiqueta: '¿Qué franja horaria te va bien?', tipo: 'select',
              valor: v, opciones: [
                { valor: 'manana', texto: 'Por la mañana' },
                { valor: 'tarde', texto: 'Por la tarde' },
                { valor: 'cualquiera', texto: 'Me da igual' },
                { valor: 'no', texto: 'Hora fija, sin flexibilidad' }
              ]
            }))}
            ${nav('/publicar-tarea/flexibilidad-hora', 'Continuar')}
          </form>`;
        break;
      }

      case 'transportes': {
        const sel = jsonArr(b.transportes);
        cuerpo = frag`
          <form method="post" action="/publicar-tarea/transportes">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            <p class="muted">¿Qué opciones de transporte necesita la persona que venga a trabajar?</p>
            <div class="opciones">
              ${TRANSPORTES.map(t => frag`
                <label class="opcion${sel.includes(t[0]) ? ' sel' : ''}">
                  <input type="checkbox" name="transportes" value="${t[0]}" ${sel.includes(t[0]) ? 'checked' : ''}> ${t[1]}
                </label>`)}
            </div>
            ${nav('/publicar-tarea/transportes', 'Continuar')}
          </form>`;
        break;
      }

      case 'descripcion': {
        cuerpo = frag`
          <form method="post" action="/publicar-tarea/descripcion">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            ${H(campo({ nombre: 'descripcion', etiqueta: '¿Qué necesitas exactamente?', tipo: 'textarea', valor: b.descripcion, requerido: true, placeholder: 'Describe el trabajo, el tamaño de la casa, los materiales que hacen falta…' }))}
            ${H(campo({ nombre: 'direccion', etiqueta: 'Dirección (opcional)', valor: b.direccion, placeholder: 'Calle, número, piso' }))}
            ${nav('/publicar-tarea/descripcion', 'Continuar')}
          </form>`;
        break;
      }

      case 'fotos': {
        const fotos = jsonArr(b.fotos);
        cuerpo = frag`
          <form method="post" action="/publicar-tarea/fotos" enctype="multipart/form-data">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            <p class="muted">Para demostrar que el trabajo es real, adjunta al menos una foto del trabajo a realizar. Los profesionales la ven antes de presupuestar.</p>
            <div class="campo">
              <label for="c_fotos">Imágenes</label>
              <input type="file" id="c_fotos" name="fotos" accept="image/*" multiple>
            </div>
            ${fotos.length ? frag`
              <p class="pista">Fotos que ya has adjuntado:</p>
              ${galeriaFotos(fotos)}` : ''}
            ${nav('/publicar-tarea/fotos', 'Continuar')}
          </form>`;
        break;
      }

      case 'publicar': {
        const cat = b.categoria_id ? q.get('SELECT * FROM categorias WHERE id=?', b.categoria_id) : null;
        const ciudad = b.ciudad_id ? q.get('SELECT * FROM ciudades WHERE id=?', b.ciudad_id) : null;
        const info = ciudadPorCp(b.cp);
        const faltan = REQUERIDOS_PUBLISH.filter(p => !hechos.includes(p));
        cuerpo = frag`
          <div class="resumen">
            <dl>
              <dt>Servicio</dt><dd>${cat ? cat.nombre : '—'}</dd>
              <dt>Dirección</dt><dd>${b.direccion || '—'}</dd>
              <dt>Código postal</dt><dd>${b.cp || '—'}</dd>
              <dt>Ciudad</dt><dd>${ciudad ? ciudad.nombre : (info ? info.ciudad_nombre : '—')}</dd>
              <dt>Fecha</dt><dd>${b.fecha ? fmtFecha(b.fecha) : '—'}</dd>
              <dt>Hora</dt><dd>${b.hora || '—'}</dd>
              <dt>Horas</dt><dd>${b.horas} h</dd>
              <dt>Frecuencia</dt><dd>${b.frecuencia}</dd>
              <dt>Flexibilidad</dt><dd>${b.flexibilidad_fecha === 'si' ? 'Fecha flexible' : 'Fecha fija'} · ${b.flexibilidad_hora || 'cualquiera'}</dd>
              <dt>Transportes</dt><dd>${jsonArr(b.transportes).map(t => (TRANSPORTES.find(x => x[0] === t) || [, t])[1]).join(', ') || '—'}</dd>
              <dt>Descripción</dt><dd>${b.descripcion || '—'}</dd>
            </dl>
          </div>
          ${faltan.length ? frag`
            <div class="alert-box">
              <b>Te faltan pasos</b>
              <p class="muted">Completa estos pasos antes de publicar: ${faltan.map(f => (PASOS.find(p => p.id === f) || { nombre: f }).nombre).join(', ')}.</p>
            </div>` : ''}
          <form method="post" action="/publicar-tarea/publicar">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            <div class="stepper-nav">
              <a class="btn-fantasma" href="/publicar-tarea?paso=fotos">Atrás</a>
              <button class="btn" type="submit">Publicar tarea</button>
            </div>
          </form>`;
        break;
      }
    }

    return frag`
      <div class="stepper">
        <h1>Publica tu tarea</h1>
        <p class="intro">Completa los pasos y recibe presupuestos de profesionales verificados de tu zona.</p>
        ${progreso}
        <div class="tarjeta-paso">
          <h2>${PASOS[actual].nombre}</h2>
          ${cuerpo}
        </div>
      </div>`;
  }
}
