/* ==========================================================================
   TrabajoFácil — panel de administración
   Todas las rutas de este módulo exigen rol 'admin' y validan CSRF en los POST.
   ========================================================================== */
import { q, ahora } from './db.mjs';
import {
  html, raw, esc, slugify, layout,
  fmtEuros, fmtEurosCorto, fmtFecha, fechaCorta, estrellas,
  TAREAS_ESTADO, PRESU_ESTADO, VERIF_ESTADO
} from './vistas.mjs';
import { exigirRol, exigirCsrf, flash } from './auth.mjs';
import { eurosDeTokens, tokensConsumidos, tokensComprados, movimientosGlobales } from './tokens.mjs';

/* ------------------------------------------------------------------ */
/* Utilidades internas                                                 */
/* ------------------------------------------------------------------ */

const POR_PAGINA = 25;
const ROLES = ['cliente', 'profesional', 'admin'];

/** Etiqueta legible de cada rol de usuario. */
const ROL_ETIQUETA = {
  cliente: 'Cliente',
  profesional: 'Profesional',
  admin: 'Administrador'
};

/** Tipos de transacción con su etiqueta en el panel. */
const TIPOS_TRANSACCION = {
  recarga: 'Recarga',
  pago_cliente: 'Pago de cliente',
  pago_profesional: 'Trabajo cobrado',
  compra_tokens: 'Compra de tokens',
  retirada: 'Retirada'
};

/**
 * Fragmento ya construido: `frag` devuelve un objeto `raw` para incrustarlo dentro
 * de otro `html`. En plantillas simples (backticks sin etiqueta) usa `html`, que ya
 * devuelve una cadena lista para concatenar.
 */
const frag = (strings, ...vals) => raw(html(strings, ...vals));

/** Normaliza un checkbox (string, array o ausente) a booleano. */
function bool(v) {
  if (Array.isArray(v)) v = v[v.length - 1];
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'on' || s === 'true' || s === 'si' || s === 'sí';
}

/** Texto de un campo del cuerpo (los checkboxes pueden llegar como array). */
function texto(v) {
  if (Array.isArray(v)) v = v[v.length - 1];
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

/** Número con valor por defecto. */
function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/** Entero con valor por defecto. */
function entero(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

/** Construye una URL con parámetros, ignorando valores vacíos. */
function urlCon(ruta, params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `${ruta}?${s}` : ruta;
}

/** URL escapada para incrustar en un atributo href. */
const href = (ruta, params) => esc(urlCon(ruta, params));

/** Enlace de salto de página conservando los filtros activos. */
function paginacion(ruta, params, pagina, total, porPagina = POR_PAGINA) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return '';
  const enlace = (n, txt, cls) => `<a class="${cls}" href="${href(ruta, { ...params, pagina: n })}">${txt}</a>`;
  const partes = [];
  if (pagina > 1) partes.push(enlace(pagina - 1, '‹ Anterior', 'pagina'));
  const desde = Math.max(1, Math.min(pagina - 2, paginas - 4));
  const hasta = Math.min(paginas, desde + 4);
  for (let i = desde; i <= hasta; i++) {
    partes.push(i === pagina ? `<span class="pagina activa">${i}</span>` : enlace(i, String(i), 'pagina'));
  }
  if (pagina < paginas) partes.push(enlace(pagina + 1, 'Siguiente ›', 'pagina'));
  return `<nav class="paginacion">${partes.join('')}<span class="muted">Página ${pagina} de ${paginas} · ${total} registros</span></nav>`;
}

/** Registra una acción administrativa. */
function auditar(ctx, accion, entidad, entidadId, detalle = '') {
  q.run('INSERT INTO auditoria (admin_id,accion,entidad,entidad_id,detalle,creado_en) VALUES (?,?,?,?,?,?)',
    ctx.usuario.id, accion, entidad, entidadId ?? null, texto(detalle), ahora());
}

/** Crea una notificación en el buzón del usuario. */
function notificar(usuarioId, tipo, titulo, cuerpo = '') {
  q.run('INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,0,?)',
    usuarioId, tipo, titulo, cuerpo, 'web', ahora());
}

/** URL pública de un fichero guardado en la carpeta contenido/. */
function contenidoUrl(ruta) {
  if (!ruta) return '';
  let r = String(ruta).replace(/^\/+/, '');
  if (!r.startsWith('contenido/')) r = 'contenido/' + r;
  return '/' + r;
}

/** Lista de fotos de una tarea (columna `fotos` de `tarea_extra`, JSON array). */
function fotosTarea(valor) {
  if (!valor) return [];
  try {
    const arr = JSON.parse(valor);
    if (!Array.isArray(arr)) return [];
    return arr.map(f => String(f || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Avatar del usuario. */
function avatar(u, clase = 'avatar') {
  const src = u && u.avatar ? String(u.avatar) : '/assets/img/avatar-1.svg';
  return `<img class="${esc(clase)}" src="${esc(src)}" alt="" width="48" height="48">`;
}

/** Etiqueta de color para un estado. */
function pill(textoEstado, color) {
  return `<span class="pill-estado" style="background:${esc(color)}">${esc(textoEstado)}</span>`;
}

/** Estado de una tarea con su color. */
function pillTarea(estado) {
  const e = TAREAS_ESTADO[estado] || { txt: estado || '—', color: '#777' };
  return pill(e.txt, e.color);
}

/** Estado de un presupuesto con su color. */
function pillPresupuesto(estado) {
  const e = PRESU_ESTADO[estado] || { txt: estado || '—', color: '#777' };
  return pill(e.txt, e.color);
}

/** Estado de verificación con su color. */
function pillVerificacion(estado) {
  const e = VERIF_ESTADO[estado] || { txt: estado || '—', color: '#777' };
  return pill(e.txt, e.color);
}

/** Campo oculto de CSRF. */
const csrfCampo = ctx => `<input type="hidden" name="csrf" value="${esc(ctx.csrf)}">`;

/** Nombre completo del usuario. */
const nombreCompleto = u => `${u.nombre || ''} ${u.apellidos || ''}`.trim() || u.email;

/* ------------------------------------------------------------------ */
/* Estructura del panel (sidebar + contenido)                          */
/* ------------------------------------------------------------------ */

const MENU_ADMIN = [
  ['', 'Panel', '/admin'],
  ['usuarios', 'Usuarios', '/admin/usuarios'],
  ['verificaciones', 'Verificaciones', '/admin/verificaciones'],
  ['tareas', 'Tareas', '/admin/tareas'],
  ['presupuestos', 'Presupuestos', '/admin/presupuestos'],
  ['categorias', 'Categorías', '/admin/categorias'],
  ['ciudades', 'Ciudades', '/admin/ciudades'],
  ['transacciones', 'Transacciones', '/admin/transacciones'],
  ['tokens', 'Tokens', '/admin/tokens'],
  ['landings', 'Landings SEO', '/admin/landings'],
  ['auditoria', 'Auditoría', '/admin/auditoria']
];

function panel(ctx, { titulo, subtitulo = '', contenido, acciones = '' }) {
  const seg = ctx.ruta.split('/').filter(Boolean);
  const actual = seg[0] === 'admin' ? (seg[1] || '') : '';
  const enlaces = MENU_ADMIN.map(([clave, txt, url]) =>
    `<a class="sidebar-link${clave === actual ? ' activo' : ''}" href="${url}">${esc(txt)}</a>`).join('');

  const cuerpo = html`
    <div class="app-shell">
      <aside class="sidebar">
        <h4>Administración</h4>
        ${raw(enlaces)}
        <h4>Sitio</h4>
        <a class="sidebar-link" href="/">← Volver a la web</a>
      </aside>
      <div class="app-main">
        <div class="panel-head">
          <div>
            <h1>${titulo}</h1>
            ${subtitulo ? frag`<p class="muted">${subtitulo}</p>` : ''}
          </div>
          ${acciones ? frag`<div class="acciones">${acciones}</div>` : ''}
        </div>
        ${raw(contenido)}
      </div>
    </div>`;

  return layout({
    titulo: `Administración — ${titulo}`,
    descripcion: 'Panel de administración de TrabajoFácil',
    usuario: ctx.usuario,
    ruta: ctx.ruta,
    ancho: 'ancho',
    flash: ctx.flash,
    contenido: cuerpo
  });
}

/* ------------------------------------------------------------------ */
/* Bloque reutilizable de filtros (formulario GET)                     */
/* ------------------------------------------------------------------ */

function filtroSelect(nombre, etiqueta, opciones, valor) {
  const ops = opciones.map(o => {
    const v = typeof o === 'string' ? o : o.valor;
    const t = typeof o === 'string' ? o : o.texto;
    return `<option value="${esc(v)}"${String(v) === String(valor) ? ' selected' : ''}>${esc(t)}</option>`;
  }).join('');
  return `<div class="campo"><label for="f_${nombre}">${esc(etiqueta)}</label>
    <select id="f_${nombre}" name="${nombre}">${ops}</select></div>`;
}

function bloqueFiltros(ruta, campos) {
  return `<form class="filtros" method="get" action="${esc(ruta)}">
    ${campos}
    <div class="campo"><label>&nbsp;</label>
      <button class="btn btn-sm" type="submit">Filtrar</button>
      <a class="btn btn-sm btn-hollow" href="${esc(ruta)}">Limpiar</a>
    </div>
  </form>`;
}

/* ------------------------------------------------------------------ */
/* Registro de rutas                                                   */
/* ------------------------------------------------------------------ */

export function registrarAdmin(router) {

  /* ================================================================== */
  /* Panel principal                                                     */
  /* ================================================================== */
  router.get('/admin', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const totUsuarios = q.get('SELECT COUNT(*) AS n FROM usuarios').n;
    const porRol = { cliente: 0, profesional: 0, admin: 0 };
    for (const r of q.all('SELECT rol, COUNT(*) AS n FROM usuarios GROUP BY rol')) porRol[r.rol] = r.n;

    const porEstadoTarea = { borrador: 0, publicada: 0, en_curso: 0, completada: 0, cancelada: 0 };
    for (const r of q.all('SELECT estado, COUNT(*) AS n FROM tareas GROUP BY estado')) porEstadoTarea[r.estado] = r.n;

    const presuEnviados = q.get("SELECT COUNT(*) AS n FROM presupuestos WHERE estado='enviado'").n;
    const presuTotales = q.get('SELECT COUNT(*) AS n FROM presupuestos').n;

    const ingresosBrutos = num(q.get(
      "SELECT COALESCE(SUM(monto),0) AS v FROM transacciones WHERE estado='completada' AND tipo='pago_cliente'").v);
    const tokensGastados = tokensConsumidos();
    const tokensPorGastar = Math.max(0, tokensComprados() - tokensGastados);
    const ingresosTokens = eurosDeTokens(tokensGastados);

    const verifPendientes = q.get("SELECT COUNT(*) AS n FROM profesionales WHERE estado_verificacion='pendiente'").n;
    const docsPendientes = q.get("SELECT COUNT(*) AS n FROM documentos WHERE estado='pendiente'").n;

    const inicioHoy = new Date();
    inicioHoy.setHours(0, 0, 0, 0);
    const mensajesHoy = q.get('SELECT COUNT(*) AS n FROM mensajes WHERE creado_en>=?', inicioHoy.toISOString()).n;

    const ultimasTareas = q.all(`SELECT t.id, t.titulo, t.estado, t.creada_en, t.precio_final, t.ciudad_id,
        c.nombre AS categoria_nombre, ci.nombre AS ciudad_nombre,
        u.nombre AS cliente_nombre, u.apellidos AS cliente_apellidos
      FROM tareas t
      LEFT JOIN categorias c ON c.id = t.categoria_id
      LEFT JOIN ciudades ci ON ci.id = t.ciudad_id
      LEFT JOIN usuarios u ON u.id = t.cliente_id
      ORDER BY t.creada_en DESC LIMIT 8`);

    const pendientes = q.all(`SELECT p.usuario_id, p.documento_tipo, p.documento_numero, p.documento_frente,
        p.selfie, p.estado_verificacion, p.desde, p.titularidad,
        u.nombre, u.apellidos, u.email
      FROM profesionales p
      JOIN usuarios u ON u.id = p.usuario_id
      WHERE p.estado_verificacion = 'pendiente'
      ORDER BY COALESCE(p.desde, p.formado_en, u.creado_en) DESC LIMIT 6`);

    const kpis = html`
      <div class="stats">
        <div class="stat">
          <span class="valor">${totUsuarios}</span>
          <span class="etiqueta">Usuarios</span>
          <span class="muted">${porRol.cliente} clientes · ${porRol.profesional} profesionales · ${porRol.admin} admins</span>
        </div>
        <div class="stat">
          <span class="valor">${porEstadoTarea.publicada}</span>
          <span class="etiqueta">Tareas publicadas</span>
          <span class="muted">${porEstadoTarea.en_curso} en curso · ${porEstadoTarea.completada} completadas · ${porEstadoTarea.borrador} borradores</span>
        </div>
        <div class="stat">
          <span class="valor">${porEstadoTarea.completada}</span>
          <span class="etiqueta">Tareas completadas</span>
          <span class="muted">${porEstadoTarea.cancelada} canceladas</span>
        </div>
        <div class="stat">
          <span class="valor">${presuEnviados}</span>
          <span class="etiqueta">Presupuestos enviados</span>
          <span class="muted">${presuTotales} presupuestos en total</span>
        </div>
        <div class="stat">
          <span class="valor">${fmtEurosCorto(ingresosBrutos)}</span>
          <span class="etiqueta">Ingresos brutos</span>
          <span class="muted">Cobros completados</span>
        </div>
        <div class="stat">
          <span class="valor">${fmtEuros(ingresosTokens)}</span>
          <span class="etiqueta">Ingresos por tokens</span>
          <span class="muted">${tokensGastados} tokens consumidos</span>
        </div>
        <div class="stat">
          <span class="valor">${tokensPorGastar}</span>
          <span class="etiqueta">Tokens pendientes de gastar</span>
          <span class="muted">Sin comisión por trabajo: el profesional recibe el 100 % del importe</span>
        </div>
        <div class="stat">
          <span class="valor">${verifPendientes}</span>
          <span class="etiqueta">Verificaciones pendientes</span>
          <span class="muted">${docsPendientes} documentos en cola</span>
        </div>
        <div class="stat">
          <span class="valor">${mensajesHoy}</span>
          <span class="etiqueta">Mensajes hoy</span>
          <span class="muted">Desde las 00:00</span>
        </div>
      </div>`;

    const filasTareas = ultimasTareas.length
      ? ultimasTareas.map(t => `<tr>
          <td><a href="/admin/tareas/${t.id}">${esc(t.titulo)}</a></td>
          <td>${esc(t.categoria_nombre || '—')}</td>
          <td>${esc(t.ciudad_nombre || '—')}</td>
          <td>${esc((t.cliente_nombre || '') + ' ' + (t.cliente_apellidos || ''))}</td>
          <td>${pillTarea(t.estado)}</td>
          <td class="mono">${esc(fechaCorta(t.creada_en))}</td>
        </tr>`).join('')
      : '<tr><td colspan="6" class="vacio">Todavía no hay tareas registradas.</td></tr>';

    const tablaTareas = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Tarea</th><th>Categoría</th><th>Ciudad</th><th>Cliente</th><th>Estado</th><th>Alta</th></tr></thead>
      <tbody>${filasTareas}</tbody></table></div>`;

    const listaVerif = pendientes.length
      ? pendientes.map(p => `<tr>
          <td><a href="/admin/verificaciones/usr-${p.usuario_id}">${esc((p.nombre || '') + ' ' + (p.apellidos || ''))}</a><br>
            <span class="muted">${esc(p.email)}</span></td>
          <td>${esc(p.documento_tipo || '—')}</td>
          <td class="mono">${esc(p.documento_numero || '—')}</td>
          <td>${p.documento_frente ? html`<img class="doc-mini" src="${esc(contenidoUrl(p.documento_frente))}" alt="Documento">` : '<span class="muted" title="Sin imagen">—</span>'}</td>
          <td>${pillVerificacion(p.estado_verificacion)}</td>
          <td class="mono">${esc(fechaCorta(p.desde))}</td>
        </tr>`).join('')
      : '<tr><td colspan="6" class="vacio">No hay verificaciones pendientes.</td></tr>';

    const tablaVerif = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Profesional</th><th>Documento</th><th>Nº</th><th>Imagen</th><th>Estado</th><th>Alta</th></tr></thead>
      <tbody>${listaVerif}</tbody></table></div>`;

    const contenido = html`
      ${raw(kpis)}
      <div class="row">
        <div class="columns large-7">
          <div class="panel">
            <div class="panel-head"><h3>Últimas tareas</h3><a class="btn btn-sm btn-hollow" href="/admin/tareas">Ver todas</a></div>
            ${raw(tablaTareas)}
          </div>
        </div>
        <div class="columns large-5">
          <div class="panel">
            <div class="panel-head"><h3>Verificaciones pendientes</h3><a class="btn btn-sm btn-hollow" href="/admin/verificaciones">Abrir cola</a></div>
            ${raw(tablaVerif)}
          </div>
        </div>
      </div>`;

    return panel(ctx, {
      titulo: 'Panel de control',
      subtitulo: 'Resumen de la actividad de la plataforma',
      contenido
    });
  });

  /* ================================================================== */
  /* Usuarios                                                            */
  /* ================================================================== */
  router.get('/admin/usuarios', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const busqueda = texto(ctx.query.q);
    const rol = texto(ctx.query.rol);
    const estado = texto(ctx.query.estado);
    const pagina = Math.max(1, entero(ctx.query.pagina, 1));
    const porPagina = POR_PAGINA;

    const cond = [];
    const args = [];
    if (busqueda) {
      const like = `%${busqueda}%`;
      cond.push('(u.email LIKE ? OR u.nombre LIKE ? OR u.apellidos LIKE ? OR u.telefono LIKE ? OR u.dni_nie LIKE ?)');
      args.push(like, like, like, like, like);
    }
    if (ROLES.includes(rol)) { cond.push('u.rol = ?'); args.push(rol); }
    if (estado === 'activo') cond.push('u.activo = 1');
    else if (estado === 'suspendido') cond.push('u.activo = 0');
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const total = q.get(`SELECT COUNT(*) AS n FROM usuarios u ${where}`, ...args).n;
    const filas = q.all(`SELECT u.id, u.email, u.nombre, u.apellidos, u.telefono, u.rol, u.activo,
        u.creado_en, u.avatar, u.ciudad_id, u.dni_nie,
        c.nombre AS ciudad_nombre,
        (SELECT COUNT(*) FROM tareas t WHERE t.cliente_id = u.id OR t.profesional_id = u.id) AS n_tareas,
        (SELECT COUNT(*) FROM presupuestos p WHERE p.profesional_id = u.id) AS n_presupuestos,
        (SELECT COUNT(*) FROM opiniones o WHERE o.profesional_id = u.id) AS n_opiniones,
        (SELECT ROUND(AVG(o.puntuacion), 2) FROM opiniones o WHERE o.profesional_id = u.id) AS valoracion
      FROM usuarios u
      LEFT JOIN ciudades c ON c.id = u.ciudad_id
      ${where}
      ORDER BY u.creado_en DESC
      LIMIT ? OFFSET ?`, ...args, porPagina, (pagina - 1) * porPagina);

    const filtros = bloqueFiltros('/admin/usuarios', `
      <div class="campo"><label for="f_q">Buscar</label>
        <input type="search" id="f_q" name="q" value="${esc(busqueda)}" placeholder="Nombre, email, teléfono o DNI"></div>
      ${filtroSelect('rol', 'Rol', [{ valor: '', texto: 'Todos' }, ...ROLES.map(r => ({ valor: r, texto: r }))], rol)}
      ${filtroSelect('estado', 'Estado', [{ valor: '', texto: 'Todos' }, { valor: 'activo', texto: 'Activos' }, { valor: 'suspendido', texto: 'Suspendidos' }], estado)}
    `);

    const chips = [
      `<a class="chip${!rol && !estado && !busqueda ? ' sel' : ''}" href="/admin/usuarios">Todos</a>`,
      ...ROLES.map(r => `<a class="chip${rol === r ? ' sel' : ''}" href="${href('/admin/usuarios', { rol: r, q: busqueda, estado })}">${esc(r)}</a>`),
      `<a class="chip${estado === 'activo' ? ' sel' : ''}" href="${href('/admin/usuarios', { estado: 'activo', rol, q: busqueda })}">Activos</a>`,
      `<a class="chip${estado === 'suspendido' ? ' sel' : ''}" href="${href('/admin/usuarios', { estado: 'suspendido', rol, q: busqueda })}">Suspendidos</a>`
    ].join('');

    const cuerpo = filas.length
      ? filas.map(u => `<tr>
          <td><a href="/admin/usuarios/${u.id}">${esc(nombreCompleto(u))}</a></td>
          <td class="mono">${esc(u.email)}</td>
          <td>${esc(u.rol)}</td>
          <td>${esc(u.ciudad_nombre || '—')}</td>
          <td>${u.rol === 'profesional'
            ? (u.valoracion !== null && u.valoracion !== undefined
              ? `<span class="estrellas">${esc(estrellas(u.valoracion))}</span> <span class="muted">${Number(u.valoracion).toFixed(1)} (${u.n_opiniones})</span>`
              : '<span class="muted">Sin opiniones</span>')
            : '<span class="muted">—</span>'}</td>
          <td>${u.n_tareas} / ${u.n_presupuestos}</td>
          <td class="mono">${esc(fechaCorta(u.creado_en))}</td>
          <td>${u.activo ? pill('Activo', '#2ea378') : pill('Suspendido', '#e45252')}</td>
        </tr>`).join('')
      : '';

    const tabla = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Ciudad</th><th>Valoración</th><th>Tareas / Press.</th><th>Alta</th><th>Estado</th></tr></thead>
      <tbody>${cuerpo || '<tr><td colspan="8" class="vacio">No hay usuarios que coincidan con la búsqueda.</td></tr>'}</tbody></table></div>`;

    const params = { q: busqueda, rol, estado };
    const contenido = html`
      ${raw(filtros)}
      <div class="chips">${raw(chips)}</div>
      <div class="panel">
        <div class="panel-head"><h3>Usuarios (${total})</h3></div>
        ${raw(tabla)}
        ${raw(paginacion('/admin/usuarios', params, pagina, total, porPagina))}
      </div>`;

    return panel(ctx, {
      titulo: 'Usuarios',
      subtitulo: `${total} cuentas registradas`,
      contenido
    });
  });

  router.get('/admin/usuarios/:id', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const id = entero(ctx.params.id, 0);
    const u = id ? q.get('SELECT * FROM usuarios WHERE id=?', id) : null;
    if (!u) {
      flash(ctx.res, 'El usuario no existe.', 'error');
      return ctx.redirigir('/admin/usuarios');
    }

    const ciudad = u.ciudad_id ? q.get('SELECT nombre, provincia FROM ciudades WHERE id=?', u.ciudad_id) : null;
    const profesional = q.get('SELECT * FROM profesionales WHERE usuario_id=?', u.id);

    const tareas = q.all(`SELECT t.*, c.nombre AS categoria_nombre, ci.nombre AS ciudad_nombre,
        u2.nombre AS profesional_nombre, u2.apellidos AS profesional_apellidos
      FROM tareas t
      LEFT JOIN categorias c ON c.id = t.categoria_id
      LEFT JOIN ciudades ci ON ci.id = t.ciudad_id
      LEFT JOIN usuarios u2 ON u2.id = t.profesional_id
      WHERE t.cliente_id = ? OR t.profesional_id = ?
      ORDER BY t.creada_en DESC LIMIT 50`, u.id, u.id);

    const presupuestos = q.all(`SELECT p.*, t.titulo AS tarea_titulo, t.id AS tarea_id
      FROM presupuestos p JOIN tareas t ON t.id = p.tarea_id
      WHERE p.profesional_id = ? ORDER BY p.creado_en DESC LIMIT 50`, u.id);

    const mensajes = q.all(`SELECT m.*, t.titulo AS tarea_titulo,
        e.nombre AS emisor_nombre, e.apellidos AS emisor_apellidos
      FROM mensajes m
      LEFT JOIN tareas t ON t.id = m.tarea_id
      LEFT JOIN usuarios e ON e.id = m.emisor_id
      WHERE m.emisor_id = ? OR m.destinatario_id = ?
      ORDER BY m.creado_en DESC LIMIT 50`, u.id, u.id);

    const transacciones = q.all(`SELECT * FROM transacciones WHERE usuario_id = ? ORDER BY creado_en DESC LIMIT 50`, u.id);

    const opiniones = q.all(`SELECT o.*, t.titulo AS tarea_titulo,
        a.nombre AS autor_nombre, a.apellidos AS autor_apellidos
      FROM opiniones o
      LEFT JOIN tareas t ON t.id = o.tarea_id
      LEFT JOIN usuarios a ON a.id = o.autor_id
      WHERE o.profesional_id = ? OR o.autor_id = ?
      ORDER BY o.creado_en DESC LIMIT 50`, u.id, u.id);

    const docs = q.all('SELECT * FROM documentos WHERE usuario_id = ? ORDER BY creado_en DESC', u.id);
    const valoracion = q.get('SELECT ROUND(AVG(puntuacion),2) AS v, COUNT(*) AS n FROM opiniones WHERE profesional_id=?', u.id);

    const fichas = [
      ['Email', u.email], ['Teléfono', u.telefono || '—'], ['Rol', u.rol],
      ['Ciudad', ciudad ? `${ciudad.nombre} (${ciudad.provincia})` : '—'], ['Código postal', u.cp || '—'],
      ['DNI / NIE', u.dni_nie || '—'], ['Nacimiento', u.fecha_nacimiento || '—'],
      ['Email verificado', u.email_verificado ? 'Sí' : 'No'],
      ['Telegram', u.telegram_id || '—'],
      ['Alta', fmtFecha(u.creado_en, true)], ['Última actualización', fmtFecha(u.actualizado_en, true)]
    ];

    const fichaDatos = `<div class="table-wrap"><table class="tabla">
      <tbody>${fichas.map(([k, v]) => `<tr><th style="width:220px">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody>
    </table></div>`;

    let bloqueProfesional = '';
    if (profesional) {
      let cats = [];
      try { cats = JSON.parse(profesional.categorias || '[]'); } catch { cats = []; }
      const listaCats = cats.length
        ? cats.map(cid => {
            const c = q.get('SELECT nombre, color, code FROM categorias WHERE id=?', cid);
            return c ? `<span class="badge-cat" style="background:${esc(c.color)}">${esc(c.code || '')}</span> ${esc(c.nombre)}` : '';
          }).filter(Boolean).join(' ')
        : '<span class="muted">Sin categorías</span>';

      bloqueProfesional = html`
        <div class="panel">
          <div class="panel-head"><h3>Perfil profesional</h3>${pillVerificacion(profesional.estado_verificacion)}</div>
          <div class="table-wrap"><table class="tabla"><tbody>
            <tr><th style="width:220px">Titularidad</th><td>${esc(profesional.titularidad || '—')}</td></tr>
            <tr><th>NIF</th><td class="mono">${esc(profesional.nif || '—')}</td></tr>
            <tr><th>Precio/hora</th><td>${fmtEuros(profesional.precio_hora)}</td></tr>
            <tr><th>Categorías</th><td>${raw(listaCats)}</td></tr>
            <tr><th>Documento</th><td>${esc(profesional.documento_tipo || '—')} ${esc(profesional.documento_numero || '')}</td></tr>
            <tr><th>Verificado</th><td>${profesional.verificado_en ? esc(fmtFecha(profesional.verificado_en, true)) : '—'}</td></tr>
            <tr><th>Alta como profesional</th><td>${esc(profesional.desde || '—')}</td></tr>
            <tr><th>Radio de trabajo</th><td>${esc(String(profesional.radio_km || 0))} km</td></tr>
            <tr><th>Disponible</th><td>${profesional.disponible ? 'Sí' : 'No'}</td></tr>
            <tr><th>Notas internas</th><td>${esc(profesional.notas || '—')}</td></tr>
          </tbody></table></div>
        </div>`;
    }

    const fotosDoc = docs.length
      ? docs.map(d => `<tr>
          <td>${esc(d.tipo || '—')}</td>
          <td>${d.archivo ? html`<a href="${esc(contenidoUrl(d.archivo))}" target="_blank" rel="noopener">${esc(d.archivo)}</a>` : '<span class="muted">—</span>'}</td>
          <td>${pillVerificacion(d.estado)}</td>
          <td class="mono">${esc(fechaCorta(d.creado_en))}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="vacio">No hay documentos adjuntos.</td></tr>';

    const tablaDocs = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Tipo</th><th>Archivo</th><th>Estado</th><th>Alta</th></tr></thead><tbody>${fotosDoc}</tbody></table></div>`;

    const filasTareas = tareas.length ? tareas.map(t => `<tr>
        <td><a href="/admin/tareas/${t.id}">${esc(t.titulo)}</a></td>
        <td>${esc(t.categoria_nombre || '—')}</td>
        <td>${pillTarea(t.estado)}</td>
        <td>${t.profesional_id ? esc((t.profesional_nombre || '') + ' ' + (t.profesional_apellidos || '')) : '<span class="muted">Sin asignar</span>'}</td>
        <td>${t.precio_final ? esc(fmtEurosCorto(t.precio_final)) : '—'}</td>
        <td class="mono">${esc(fechaCorta(t.creada_en))}</td>
      </tr>`).join('')
      : '<tr><td colspan="6" class="vacio">Sin tareas.</td></tr>';

    const tablaTareas = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Tarea</th><th>Categoría</th><th>Estado</th><th>Profesional</th><th>Precio</th><th>Alta</th></tr></thead>
      <tbody>${filasTareas}</tbody></table></div>`;

    const filasPresu = presupuestos.length ? presupuestos.map(p => `<tr>
        <td><a href="/admin/tareas/${p.tarea_id}">${esc(p.tarea_titulo)}</a></td>
        <td>${esc(fmtEurosCorto(p.precio))} · ${esc(String(p.horas || 0))} h</td>
        <td>${pillPresupuesto(p.estado)}</td>
        <td class="mono">${esc(fechaCorta(p.creado_en))}</td>
      </tr>`).join('')
      : '<tr><td colspan="4" class="vacio">Sin presupuestos.</td></tr>';

    const tablaPresu = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Tarea</th><th>Precio</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>${filasPresu}</tbody></table></div>`;

    const filasMensajes = mensajes.length ? mensajes.map(m => `<tr>
        <td>${esc(m.tarea_titulo || '—')}</td>
        <td>${esc((m.emisor_nombre || '') + ' ' + (m.emisor_apellidos || ''))}</td>
        <td>${esc(m.cuerpo)}</td>
        <td class="mono">${esc(fechaCorta(m.creado_en))}</td>
      </tr>`).join('')
      : '<tr><td colspan="4" class="vacio">Sin mensajes.</td></tr>';

    const tablaMensajes = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Tarea</th><th>Emisor</th><th>Mensaje</th><th>Fecha</th></tr></thead><tbody>${filasMensajes}</tbody></table></div>`;

    const filasTrans = transacciones.length ? transacciones.map(t => `<tr>
        <td>${esc(t.tipo)}</td>
        <td>${esc(fmtEurosCorto(t.monto))}</td>
        <td>${t.comision ? esc(fmtEurosCorto(t.comision)) : '—'}</td>
        <td>${esc(t.estado)}</td>
        <td>${esc(t.descripcion || '—')}</td>
        <td class="mono">${esc(fechaCorta(t.creado_en))}</td>
      </tr>`).join('')
      : '<tr><td colspan="6" class="vacio">Sin transacciones.</td></tr>';

    const tablaTrans = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Tipo</th><th>Monto</th><th>Comisión</th><th>Estado</th><th>Descripción</th><th>Fecha</th></tr></thead>
      <tbody>${filasTrans}</tbody></table></div>`;

    const filasOp = opiniones.length ? opiniones.map(o => `<tr>
        <td>${esc(o.tarea_titulo || '—')}</td>
        <td>${esc((o.autor_nombre || '') + ' ' + (o.autor_apellidos || ''))}</td>
        <td><span class="estrellas">${esc(estrellas(o.puntuacion))}</span></td>
        <td>${esc(o.comentario || '—')}</td>
        <td class="mono">${esc(fechaCorta(o.creado_en))}</td>
      </tr>`).join('')
      : '<tr><td colspan="5" class="vacio">Sin opiniones.</td></tr>';

    const tablaOp = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Tarea</th><th>Autor</th><th>Puntuación</th><th>Comentario</th><th>Fecha</th></tr></thead>
      <tbody>${filasOp}</tbody></table></div>`;

    const acciones = html`
      <div class="acciones">
        <form method="post" action="/admin/usuarios/${u.id}/accion">
          ${raw(csrfCampo(ctx))}
          <input type="hidden" name="accion" value="${u.activo ? 'suspender' : 'reactivar'}">
          <button class="btn btn-sm" type="submit">${u.activo ? 'Suspender cuenta' : 'Reactivar cuenta'}</button>
        </form>
        <form method="post" action="/admin/usuarios/${u.id}/accion" class="form-acciones">
          ${raw(csrfCampo(ctx))}
          <input type="hidden" name="accion" value="rol">
          <select name="rol" aria-label="Rol">
            ${ROLES.map(r => `<option value="${r}"${r === u.rol ? ' selected' : ''}>${r}</option>`).join('')}
          </select>
          <button class="btn btn-sm btn-hollow" type="submit">Cambiar rol</button>
        </form>
      </div>`;

    const panelVerif = profesional ? html`
      <div class="panel">
        <div class="panel-head"><h3>Verificación de identidad</h3>${pillVerificacion(profesional.estado_verificacion)}</div>
        <div class="table-wrap"><table class="tabla"><tbody>
          <tr><th style="width:220px">Estado</th><td>${pillVerificacion(profesional.estado_verificacion)}</td></tr>
          <tr><th>Documento</th><td>${esc(profesional.documento_tipo || '—')} ${esc(profesional.documento_numero || '')}</td></tr>
          <tr><th>Frente</th><td>${profesional.documento_frente ? frag`<a class="doc-mini" href="${esc(contenidoUrl(profesional.documento_frente))}" target="_blank" rel="noopener"><img src="${esc(contenidoUrl(profesional.documento_frente))}" alt="Frente del documento"></a>` : '<span class="muted">—</span>'}</td></tr>
          <tr><th>Reverso</th><td>${profesional.documento_reverso ? frag`<a class="doc-mini" href="${esc(contenidoUrl(profesional.documento_reverso))}" target="_blank" rel="noopener"><img src="${esc(contenidoUrl(profesional.documento_reverso))}" alt="Reverso del documento"></a>` : '<span class="muted">—</span>'}</td></tr>
          <tr><th>Selfie</th><td>${profesional.selfie ? frag`<a class="doc-mini" href="${esc(contenidoUrl(profesional.selfie))}" target="_blank" rel="noopener"><img src="${esc(contenidoUrl(profesional.selfie))}" alt="Selfie de identidad"></a>` : '<span class="muted">—</span>'}</td></tr>
        </tbody></table></div>
        <form method="post" action="/admin/usuarios/${u.id}/accion" class="form-grid">
          ${raw(csrfCampo(ctx))}
          <input type="hidden" name="accion" value="rechazar_verificacion">
          <div class="campo"><label for="notas_verif">Notas del rechazo</label>
            <textarea id="notas_verif" name="notas" rows="2" placeholder="Motivo del rechazo"></textarea></div>
          <div class="acciones">
            <button class="btn btn-sm" type="submit" name="accion" value="verificar">Aprobar identidad</button>
            <button class="btn btn-sm btn-hollow" type="submit">Rechazar identidad</button>
          </div>
        </form>
      </div>` : '';

    const cabecera = html`
      <div class="panel">
        <div class="perfil-cab">
          ${raw(avatar(u, 'avatar-lg'))}
          <div class="datos">
            <b>${nombreCompleto(u)}</b>
            <span class="muted">${u.email}</span>
            <div class="etiquetas">
              <span class="etiqueta">${u.rol}</span>
              ${u.rol === 'profesional' ? frag`<span class="etiqueta">Valoración ${valoracion.v ? Number(valoracion.v).toFixed(1) : '—'} (${valoracion.n})</span>` : ''}
              ${u.activo ? frag`<span class="etiqueta">Activo</span>` : frag`<span class="etiqueta">Suspendido</span>`}
            </div>
          </div>
        </div>
        ${raw(acciones)}
      </div>`;

    const contenido = html`
      ${raw(cabecera)}
      <div class="row">
        <div class="columns large-6">
          <div class="panel"><div class="panel-head"><h3>Datos de la cuenta</h3></div>${raw(fichaDatos)}</div>
        </div>
        <div class="columns large-6">
          ${raw(panelVerif)}
          <div class="panel"><div class="panel-head"><h3>Documentos</h3></div>${raw(tablaDocs)}</div>
        </div>
      </div>
      ${raw(bloqueProfesional)}
      <div class="panel"><div class="panel-head"><h3>Tareas</h3></div>${raw(tablaTareas)}</div>
      <div class="panel"><div class="panel-head"><h3>Presupuestos</h3></div>${raw(tablaPresu)}</div>
      <div class="panel"><div class="panel-head"><h3>Mensajes</h3></div>${raw(tablaMensajes)}</div>
      <div class="panel"><div class="panel-head"><h3>Transacciones</h3></div>${raw(tablaTrans)}</div>
      <div class="panel"><div class="panel-head"><h3>Opiniones</h3></div>${raw(tablaOp)}</div>`;

    return panel(ctx, {
      titulo: nombreCompleto(u),
      subtitulo: `Ficha del usuario #${u.id} — ${u.email}`,
      contenido
    });
  });

  router.post('/admin/usuarios/:id/accion', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;
    if (!exigirCsrf(ctx)) return;

    const id = entero(ctx.params.id, 0);
    const u = id ? q.get('SELECT * FROM usuarios WHERE id=?', id) : null;
    if (!u) {
      flash(ctx.res, 'El usuario no existe.', 'error');
      return ctx.redirigir('/admin/usuarios');
    }

    const accion = texto(ctx.body.accion);
    const notas = texto(ctx.body.notas);
    const ts = ahora();
    const volver = `/admin/usuarios/${u.id}`;

    if (accion === 'suspender') {
      if (u.id === ctx.usuario.id) {
        flash(ctx.res, 'No puedes suspender tu propia cuenta.', 'error');
        return ctx.redirigir(volver);
      }
      q.run('UPDATE usuarios SET activo=0, actualizado_en=? WHERE id=?', ts, u.id);
      q.run('DELETE FROM sesiones WHERE usuario_id=?', u.id);
      auditar(ctx, 'usuario_suspendido', 'usuario', u.id, `${u.email} — cuenta suspendida${notas ? `: ${notas}` : ''}`);
      notificar(u.id, 'aviso', 'Tu cuenta ha sido suspendida', notas || 'Un administrador ha suspendido tu cuenta. Escríbenos si crees que es un error.');
      flash(ctx.res, 'Cuenta suspendida.', 'ok');
      return ctx.redirigir(volver);
    }

    if (accion === 'reactivar') {
      q.run('UPDATE usuarios SET activo=1, actualizado_en=? WHERE id=?', ts, u.id);
      auditar(ctx, 'usuario_reactivado', 'usuario', u.id, `${u.email} — cuenta reactivada`);
      notificar(u.id, 'info', 'Tu cuenta vuelve a estar activa', 'Ya puedes volver a usar TrabajoFácil con normalidad.');
      flash(ctx.res, 'Cuenta reactivada.', 'ok');
      return ctx.redirigir(volver);
    }

    if (accion === 'rol') {
      const nuevoRol = texto(ctx.body.rol);
      if (!ROLES.includes(nuevoRol)) {
        flash(ctx.res, 'El rol indicado no es válido.', 'error');
        return ctx.redirigir(volver);
      }
      if (u.id === ctx.usuario.id && nuevoRol !== 'admin') {
        flash(ctx.res, 'No puedes quitarte a ti mismo el rol de administrador.', 'error');
        return ctx.redirigir(volver);
      }
      q.run('UPDATE usuarios SET rol=?, actualizado_en=? WHERE id=?', nuevoRol, ts, u.id);
      if (nuevoRol === 'profesional') {
        const existe = q.get('SELECT usuario_id FROM profesionales WHERE usuario_id=?', u.id);
        if (!existe) {
          q.run(`INSERT INTO profesionales (usuario_id,titularidad,nif,precio_hora,categorias,estado_verificacion,
                disponible,radio_km,desde,formado_en) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            u.id, 'autonomo', '', 0, '[]', 'pendiente', 1, 10, ts.slice(0, 10), ts);
        }
      }
      auditar(ctx, 'usuario_rol_cambiado', 'usuario', u.id, `${u.email}: ${u.rol} → ${nuevoRol}`);
      notificar(u.id, 'info', 'Se ha actualizado tu rol', `Tu cuenta pasa a tener el rol «${nuevoRol}».`);
      flash(ctx.res, `Rol actualizado a «${nuevoRol}».`, 'ok');
      return ctx.redirigir(volver);
    }

    if (accion === 'verificar' || accion === 'rechazar_verificacion') {
      const aprobar = accion === 'verificar';
      const estado = aprobar ? 'aprobado' : 'rechazado';
      const profesional = q.get('SELECT * FROM profesionales WHERE usuario_id=?', u.id);
      if (!profesional) {
        flash(ctx.res, 'Este usuario no tiene perfil profesional.', 'error');
        return ctx.redirigir(volver);
      }
      q.run('UPDATE profesionales SET estado_verificacion=?, verificado_en=?, revisado_por=?, notas=? WHERE usuario_id=?',
        estado, aprobar ? ts : null, ctx.usuario.id, notas, u.id);
      q.run("UPDATE documentos SET estado=?, revisado_por=?, revisado_en=?, notas=? WHERE usuario_id=? AND estado='pendiente'",
        estado, ctx.usuario.id, ts, notas, u.id);
      auditar(ctx, `verificacion_${estado}`, 'usuario', u.id,
        `${u.email} — identidad ${aprobar ? 'aprobada' : 'rechazada'}${notas ? `: ${notas}` : ''}`);
      notificar(u.id, aprobar ? 'exito' : 'aviso',
        aprobar ? 'Identidad verificada' : 'Verificación de identidad rechazada',
        aprobar ? 'Ya puedes recibir tareas de clientes.' : (notas || 'Revisa los datos de tu documento y vuelve a enviarlos.'));
      flash(ctx.res, aprobar ? 'Identidad aprobada.' : 'Identidad rechazada.', 'ok');
      return ctx.redirigir(volver);
    }

    flash(ctx.res, 'Acción administrativa no reconocida.', 'error');
    return ctx.redirigir(volver);
  });

  /* ================================================================== */
  /* Verificaciones                                                       */
  /* ================================================================== */

  /* Documentos en cola + profesionales pendientes sin documento adjunto + clientes pendientes de verificar. */
  function colaVerificaciones() {
    const docs = q.all(`SELECT d.id AS documento_id, d.tipo, d.archivo, d.estado, d.notas, d.creado_en,
        u.id AS usuario_id, u.nombre, u.apellidos, u.email, u.telefono, u.dni_nie, u.rol, u.creado_en AS alta,
        p.estado_verificacion, p.documento_tipo, p.documento_numero, p.documento_frente,
        p.documento_reverso, p.selfie, p.titularidad, p.nif, p.precio_hora
      FROM documentos d
      JOIN usuarios u ON u.id = d.usuario_id
      LEFT JOIN profesionales p ON p.usuario_id = u.id
      WHERE d.estado = 'pendiente'
      ORDER BY d.creado_en ASC`);

    const soloProfesionales = q.all(`SELECT p.usuario_id, p.estado_verificacion, p.documento_tipo, p.documento_numero,
        p.documento_frente, p.documento_reverso, p.selfie, p.titularidad, p.nif, p.precio_hora, p.desde,
        u.nombre, u.apellidos, u.email, u.telefono, u.dni_nie, u.rol, u.creado_en AS alta
      FROM profesionales p
      JOIN usuarios u ON u.id = p.usuario_id
      WHERE p.estado_verificacion = 'pendiente'
        AND NOT EXISTS (SELECT 1 FROM documentos d WHERE d.usuario_id = p.usuario_id AND d.estado = 'pendiente')
      ORDER BY u.creado_en ASC`);

    const filas = docs.map(d => ({
      ref: `doc-${d.documento_id}`, documentoId: d.documento_id, usuarioId: d.usuario_id,
      nombre: d.nombre, apellidos: d.apellidos, email: d.email, telefono: d.telefono, dni: d.dni_nie,
      rol: d.rol || '',
      tipo: d.tipo || d.documento_tipo || 'identidad', numero: d.documento_numero || '',
      archivo: d.archivo || d.documento_frente || '', frente: d.documento_frente || '',
      reverso: d.documento_reverso || '', selfie: d.selfie || '',
      estado: d.estado, estadoVerif: d.estado_verificacion || 'pendiente',
      titularidad: d.titularidad || '', nif: d.nif || '', precio: d.precio_hora || 0,
      alta: d.creado_en || d.alta, adjunto: Boolean(d.archivo)
    }));

    const extras = soloProfesionales.map(p => ({
      ref: `usr-${p.usuario_id}`, documentoId: null, usuarioId: p.usuario_id,
      nombre: p.nombre, apellidos: p.apellidos, email: p.email, telefono: p.telefono, dni: p.dni_nie,
      rol: p.rol || '',
      tipo: p.documento_tipo || 'identidad', numero: p.documento_numero || '',
      archivo: p.documento_frente || '', frente: p.documento_frente || '',
      reverso: p.documento_reverso || '', selfie: p.selfie || '',
      estado: 'pendiente', estadoVerif: p.estado_verificacion || 'pendiente',
      titularidad: p.titularidad || '', nif: p.nif || '', precio: p.precio_hora || 0,
      alta: p.alta, adjunto: Boolean(p.documento_frente || p.selfie)
    }));

    const clientes = q.all(`SELECT v.id, v.estado, v.documento_tipo, v.documento_numero, v.documento_frente,
        v.documento_reverso, v.selfie, v.creado_en,
        u.id AS usuario_id, u.nombre, u.apellidos, u.email, u.telefono, u.dni_nie, u.rol, u.creado_en AS alta
      FROM verificaciones v
      JOIN usuarios u ON u.id = v.usuario_id
      WHERE v.estado = 'pendiente'
      ORDER BY v.creado_en ASC`);

    const verifs = clientes.map(v => ({
      ref: `ver-${v.id}`, documentoId: null, usuarioId: v.usuario_id,
      nombre: v.nombre, apellidos: v.apellidos, email: v.email, telefono: v.telefono, dni: v.dni_nie,
      rol: v.rol || '',
      tipo: v.documento_tipo || 'identidad', numero: v.documento_numero || '',
      archivo: v.documento_frente || '', frente: v.documento_frente || '',
      reverso: v.documento_reverso || '', selfie: v.selfie || '',
      estado: v.estado, estadoVerif: v.estado,
      titularidad: '', nif: '', precio: 0,
      alta: v.creado_en || v.alta, adjunto: Boolean(v.documento_frente || v.documento_reverso || v.selfie)
    }));

    return filas.concat(extras, verifs);
  }

  router.get('/admin/verificaciones', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const cola = colaVerificaciones();

    const filas = cola.length ? cola.map(v => `<tr>
        <td><a href="/admin/verificaciones/${v.ref}">${esc((v.nombre || '') + ' ' + (v.apellidos || ''))}</a><br>
          <span class="muted">${esc(v.email)}</span></td>
        <td>${esc(ROL_ETIQUETA[v.rol] || v.rol || '—')}</td>
        <td>${esc(v.tipo || '—')}</td>
        <td class="mono">${esc(v.numero || '—')}</td>
        <td>${v.frente
          ? html`<a class="doc-mini" href="${esc(contenidoUrl(v.frente))}" target="_blank" rel="noopener"><img src="${esc(contenidoUrl(v.frente))}" alt="Documento de identidad"></a>`
          : '<span class="muted" title="Sin imagen">—</span>'}</td>
        <td>${pillVerificacion(v.estado)}</td>
        <td class="mono">${esc(fechaCorta(v.alta))}</td>
        <td class="row-actions">
          <a class="btn btn-sm" href="/admin/verificaciones/${v.ref}">Revisar</a>
          <a class="btn btn-sm btn-hollow" href="/admin/usuarios/${v.usuarioId}">Ficha</a>
        </td>
      </tr>`).join('')
      : '';

    const tabla = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Persona</th><th>Rol</th><th>Doc.</th><th>Nº</th><th>Imagen</th><th>Estado</th><th>Alta</th><th></th></tr></thead>
      <tbody>${filas || '<tr><td colspan="8" class="vacio">No hay verificaciones pendientes de revisar.</td></tr>'}</tbody></table></div>`;

    const contenido = html`
      <div class="panel">
        <div class="panel-head"><h3>Cola de verificaciones (${cola.length})</h3></div>
        ${raw(tabla)}
      </div>`;

    return panel(ctx, {
      titulo: 'Verificaciones de identidad',
      subtitulo: `${cola.length} solicitudes pendientes de revisión`,
      contenido
    });
  });

  router.get('/admin/verificaciones/:id', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const ref = texto(ctx.params.id);
    const m = ref.match(/^(doc|usr|ver)-(\d+)$/);
    if (!m) {
      flash(ctx.res, 'Referencia de verificación no válida.', 'error');
      return ctx.redirigir('/admin/verificaciones');
    }

    const tipo = m[1];
    const refId = Number(m[2]);

    let usuarioId = refId;
    let documento = null;
    let verificacion = null;
    if (tipo === 'doc') {
      documento = q.get('SELECT * FROM documentos WHERE id=?', refId);
      if (!documento) {
        flash(ctx.res, 'El documento ya no existe.', 'error');
        return ctx.redirigir('/admin/verificaciones');
      }
      usuarioId = documento.usuario_id;
    }
    if (tipo === 'ver') {
      verificacion = q.get('SELECT * FROM verificaciones WHERE id=?', refId);
      if (!verificacion) {
        flash(ctx.res, 'La solicitud de verificación ya no existe.', 'error');
        return ctx.redirigir('/admin/verificaciones');
      }
      usuarioId = verificacion.usuario_id;
    }

    const u = q.get('SELECT * FROM usuarios WHERE id=?', usuarioId);
    if (!u) {
      flash(ctx.res, 'El usuario ya no existe.', 'error');
      return ctx.redirigir('/admin/verificaciones');
    }

    const profesional = q.get('SELECT * FROM profesionales WHERE usuario_id=?', usuarioId);
    const docs = q.all('SELECT * FROM documentos WHERE usuario_id=? ORDER BY creado_en DESC', usuarioId);

    const fotos = [];
    const anadirFoto = (etiqueta, ruta) => { if (ruta) fotos.push({ etiqueta, ruta }); };
    if (documento && documento.archivo) anadirFoto('Archivo del documento', documento.archivo);
    if (verificacion) {
      anadirFoto('Frente del documento', verificacion.documento_frente);
      anadirFoto('Reverso del documento', verificacion.documento_reverso);
      anadirFoto('Selfie de identidad', verificacion.selfie);
    }
    if (profesional && tipo !== 'ver') {
      anadirFoto('Frente', profesional.documento_frente);
      anadirFoto('Reverso', profesional.documento_reverso);
      anadirFoto('Selfie', profesional.selfie);
    }
    if (!fotos.length && profesional && profesional.documento_frente) anadirFoto('Frente', profesional.documento_frente);

    const galeria = fotos.length
      ? fotos.map(f => `<figure class="doc-foto">
          <a href="${esc(contenidoUrl(f.ruta))}" target="_blank" rel="noopener">
            <img src="${esc(contenidoUrl(f.ruta))}" alt="${esc(f.etiqueta)}" loading="lazy">
          </a>
          <figcaption>${esc(f.etiqueta)} · <a href="${esc(contenidoUrl(f.ruta))}" target="_blank" rel="noopener">Abrir</a></figcaption>
        </figure>`).join('')
      : '<p class="vacio">No hay imágenes adjuntas a esta solicitud.</p>';

    const estadoActual = tipo === 'ver'
      ? (verificacion ? verificacion.estado : 'pendiente')
      : (profesional ? profesional.estado_verificacion : 'pendiente');

    const fichas = tipo === 'ver'
      ? [
        ['Usuario', `${u.nombre || ''} ${u.apellidos || ''}`.trim() || u.email],
        ['Rol', ROL_ETIQUETA[u.rol] || u.rol || '—'],
        ['Email', u.email],
        ['Teléfono', u.telefono || '—'],
        ['DNI / NIE', u.dni_nie || '—'],
        ['Documento declarado', `${verificacion.documento_tipo || '—'} ${verificacion.documento_numero || ''}`.trim()],
        ['Alta de la cuenta', fmtFecha(u.creado_en, true)],
        ['Estado de verificación', VERIF_ESTADO[estadoActual] ? VERIF_ESTADO[estadoActual].txt : estadoActual]
      ]
      : [
        ['Usuario', `${u.nombre || ''} ${u.apellidos || ''}`.trim()],
        ['Rol', ROL_ETIQUETA[u.rol] || u.rol || '—'],
        ['Email', u.email],
        ['Teléfono', u.telefono || '—'],
        ['DNI / NIE', u.dni_nie || '—'],
        ['Documento declarado', profesional ? `${profesional.documento_tipo || '—'} ${profesional.documento_numero || ''}`.trim() : '—'],
        ['NIF', profesional ? (profesional.nif || '—') : '—'],
        ['Titularidad', profesional ? (profesional.titularidad || '—') : '—'],
        ['Precio/hora', profesional ? fmtEuros(profesional.precio_hora) : '—'],
        ['Alta de la cuenta', fmtFecha(u.creado_en, true)],
        ['Estado de verificación', profesional ? profesional.estado_verificacion : '—']
      ];

    const tablaDatos = `<div class="table-wrap"><table class="tabla">
      <tbody>${fichas.map(([k, v]) => `<tr><th style="width:240px">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`;

    const tablaDocs = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Tipo</th><th>Archivo</th><th>Estado</th><th>Revisado</th><th>Notas</th></tr></thead>
      <tbody>${docs.length ? docs.map(d => `<tr>
          <td>${esc(d.tipo || '—')}</td>
          <td>${d.archivo ? html`<a href="${esc(contenidoUrl(d.archivo))}" target="_blank" rel="noopener">${esc(d.archivo)}</a>` : '<span class="muted">—</span>'}</td>
          <td>${pillVerificacion(d.estado)}</td>
          <td class="mono">${esc(d.revisado_en ? fechaCorta(d.revisado_en) : '—')}</td>
          <td>${esc(d.notas || '—')}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="vacio">Sin documentos registrados.</td></tr>'}</tbody></table></div>`;

    const formulario = `<form method="post" action="/admin/verificaciones/${esc(ref)}/decision" class="form-grid">
      ${csrfCampo(ctx)}
      <div class="campo"><label for="notas_decision">Notas (obligatorias al rechazar)</label>
        <textarea id="notas_decision" name="notas" rows="3" placeholder="Motivo de la decisión"></textarea></div>
      <div class="acciones">
        <button class="btn btn-sm" type="submit" name="decision" value="aprobar">Aprobar identidad</button>
        <button class="btn btn-sm btn-hollow" type="submit" name="decision" value="rechazar">Rechazar</button>
      </div>
    </form>`;

    const contenido = html`
      <div class="panel">
        <div class="panel-head">
          <h3>${(u.nombre || '') + ' ' + (u.apellidos || '')}</h3>
          ${raw(pillVerificacion(estadoActual))}
        </div>
        ${raw(tablaDatos)}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Imágenes del documento</h3></div>
        <div class="doc-galeria">${raw(galeria)}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Documentos registrados</h3></div>
        ${raw(tablaDocs)}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Decisión</h3></div>
        ${raw(formulario)}
      </div>`;

    return panel(ctx, {
      titulo: 'Revisión de verificación',
      subtitulo: `Solicitud ${ref} — ${u.email}`,
      contenido
    });
  });

  router.post('/admin/verificaciones/:id/decision', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;
    if (!exigirCsrf(ctx)) return;

    const ref = texto(ctx.params.id);
    const m = ref.match(/^(doc|usr|ver)-(\d+)$/);
    if (!m) {
      flash(ctx.res, 'Referencia de verificación no válida.', 'error');
      return ctx.redirigir('/admin/verificaciones');
    }

    const tipo = m[1];
    const refId = Number(m[2]);
    const decision = texto(ctx.body.decision);
    const notas = texto(ctx.body.notas);

    if (!['aprobar', 'rechazar'].includes(decision)) {
      flash(ctx.res, 'La decisión indicada no es válida.', 'error');
      return ctx.redirigir(`/admin/verificaciones/${encodeURIComponent(ref)}`);
    }
    if (decision === 'rechazar' && !notas) {
      flash(ctx.res, 'Indica el motivo del rechazo.', 'error');
      return ctx.redirigir(`/admin/verificaciones/${encodeURIComponent(ref)}`);
    }

    let usuarioId = refId;
    if (tipo === 'doc') {
      const doc = q.get('SELECT * FROM documentos WHERE id=?', refId);
      if (!doc) {
        flash(ctx.res, 'El documento ya no existe.', 'error');
        return ctx.redirigir('/admin/verificaciones');
      }
      usuarioId = doc.usuario_id;
    }
    if (tipo === 'ver') {
      const ver = q.get('SELECT * FROM verificaciones WHERE id=?', refId);
      if (!ver) {
        flash(ctx.res, 'La solicitud de verificación ya no existe.', 'error');
        return ctx.redirigir('/admin/verificaciones');
      }
      usuarioId = ver.usuario_id;
    }

    const u = q.get('SELECT * FROM usuarios WHERE id=?', usuarioId);
    if (!u) {
      flash(ctx.res, 'El usuario ya no existe.', 'error');
      return ctx.redirigir('/admin/verificaciones');
    }

    const profesional = q.get('SELECT * FROM profesionales WHERE usuario_id=?', usuarioId);
    const estado = decision === 'aprobar' ? 'aprobado' : 'rechazado';
    const ts = ahora();

    if (tipo === 'ver') {
      q.run('UPDATE verificaciones SET estado=?, revisado_por=?, revisado_en=?, notas=? WHERE id=?',
        estado, ctx.usuario.id, ts, notas, refId);
      auditar(ctx, `verificacion_${estado}`, 'cliente', refId,
        `${u.email} — verificación de identidad ${estado}${notas ? `: ${notas}` : ''}`);
      notificar(usuarioId, decision === 'aprobar' ? 'exito' : 'aviso',
        'Verificación de identidad',
        decision === 'aprobar'
          ? 'Tu verificación de identidad ha sido aprobada'
          : `Tu verificación de identidad ha sido rechazada: ${notas}`);
      flash(ctx.res, decision === 'aprobar' ? 'Verificación aprobada.' : 'Verificación rechazada.', 'ok');
      return ctx.redirigir('/admin/verificaciones');
    }

    if (tipo === 'doc') {
      q.run('UPDATE documentos SET estado=?, revisado_por=?, revisado_en=?, notas=? WHERE id=?',
        estado, ctx.usuario.id, ts, notas, refId);
    } else {
      q.run("UPDATE documentos SET estado=?, revisado_por=?, revisado_en=?, notas=? WHERE usuario_id=? AND estado='pendiente'",
        estado, ctx.usuario.id, ts, notas, usuarioId);
    }

    if (profesional) {
      q.run('UPDATE profesionales SET estado_verificacion=?, verificado_en=?, revisado_por=?, notas=? WHERE usuario_id=?',
        estado, decision === 'aprobar' ? ts : null, ctx.usuario.id, notas, usuarioId);
    }

    auditar(ctx, `verificacion_${estado}`, tipo === 'doc' ? 'documento' : 'profesional',
      tipo === 'doc' ? refId : usuarioId,
      `${u.email} — verificación ${estado}${notas ? `: ${notas}` : ''}`);

    notificar(usuarioId,
      decision === 'aprobar' ? 'exito' : 'aviso',
      decision === 'aprobar' ? 'Identidad verificada' : 'Verificación de identidad rechazada',
      decision === 'aprobar'
        ? 'Ya puedes recibir tareas de clientes en TrabajoFácil.'
        : (notas || 'Revisa los datos de tu documento y vuelve a subirlos.'));

    flash(ctx.res, decision === 'aprobar' ? 'Verificación aprobada.' : 'Verificación rechazada.', 'ok');
    return ctx.redirigir('/admin/verificaciones');
  });

  /* ================================================================== */
  /* Tareas                                                              */
  /* ================================================================== */
  router.get('/admin/tareas', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const busqueda = texto(ctx.query.q);
    const estado = texto(ctx.query.estado);
    const categoria = entero(ctx.query.categoria, 0);
    const ciudad = entero(ctx.query.ciudad, 0);
    const pagina = Math.max(1, entero(ctx.query.pagina, 1));
    const porPagina = POR_PAGINA;

    const cond = [];
    const args = [];
    if (busqueda) {
      const like = `%${busqueda}%`;
      cond.push('(t.titulo LIKE ? OR t.descripcion LIKE ? OR t.direccion LIKE ?)');
      args.push(like, like, like);
    }
    if (Object.keys(TAREAS_ESTADO).includes(estado)) { cond.push('t.estado = ?'); args.push(estado); }
    if (categoria) { cond.push('t.categoria_id = ?'); args.push(categoria); }
    if (ciudad) { cond.push('t.ciudad_id = ?'); args.push(ciudad); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const total = q.get(`SELECT COUNT(*) AS n FROM tareas t ${where}`, ...args).n;
    const filas = q.all(`SELECT t.id, t.titulo, t.estado, t.creada_en, t.fecha, t.horas, t.precio_final,
        t.ciudad_id, t.categoria_id, t.profesional_id, t.cliente_id,
        c.nombre AS categoria_nombre, ci.nombre AS ciudad_nombre,
        uc.nombre AS cliente_nombre, uc.apellidos AS cliente_apellidos,
        up.nombre AS prof_nombre, up.apellidos AS prof_apellidos,
        te.fotos,
        (SELECT v.estado FROM verificaciones v WHERE v.usuario_id = t.cliente_id LIMIT 1) AS cliente_verif,
        (SELECT COUNT(*) FROM presupuestos p WHERE p.tarea_id = t.id) AS n_presupuestos
      FROM tareas t
      LEFT JOIN categorias c ON c.id = t.categoria_id
      LEFT JOIN ciudades ci ON ci.id = t.ciudad_id
      LEFT JOIN usuarios uc ON uc.id = t.cliente_id
      LEFT JOIN usuarios up ON up.id = t.profesional_id
      LEFT JOIN tarea_extra te ON te.tarea_id = t.id
      ${where}
      ORDER BY t.creada_en DESC
      LIMIT ? OFFSET ?`, ...args, porPagina, (pagina - 1) * porPagina);

    const cats = q.all('SELECT id, nombre FROM categorias ORDER BY nombre');
    const ciudades = q.all('SELECT id, nombre FROM ciudades ORDER BY nombre');

    const filtros = bloqueFiltros('/admin/tareas', `
      <div class="campo"><label for="f_q">Buscar</label>
        <input type="search" id="f_q" name="q" value="${esc(busqueda)}" placeholder="Título, descripción o dirección"></div>
      ${filtroSelect('estado', 'Estado', [{ valor: '', texto: 'Todas' }, ...Object.keys(TAREAS_ESTADO).map(e => ({ valor: e, texto: TAREAS_ESTADO[e].txt }))], estado)}
      ${filtroSelect('categoria', 'Categoría', [{ valor: '', texto: 'Todas' }, ...cats.map(c => ({ valor: c.id, texto: c.nombre }))], categoria)}
      ${filtroSelect('ciudad', 'Ciudad', [{ valor: '', texto: 'Todas' }, ...ciudades.map(c => ({ valor: c.id, texto: c.nombre }))], ciudad)}
    `);

    const cuerpo = filas.length ? filas.map(t => {
      const fotos = fotosTarea(t.fotos);
      const celdaFotos = fotos.length
        ? `<div class="doc-galeria">${fotos.slice(0, 3).map(u => `<figure class="doc-foto">
              <a href="${esc(contenidoUrl(u))}" target="_blank" rel="noopener">
                <img src="${esc(contenidoUrl(u))}" alt="Foto del trabajo" loading="lazy">
              </a>
            </figure>`).join('')}</div>`
        : '<span class="muted">Sin fotos</span>';
      return `<tr>
        <td class="celda-titulo"><a href="/admin/tareas/${t.id}" title="${esc(t.titulo)}">${esc(t.titulo)}</a></td>
        <td>${celdaFotos}</td>
        <td>${esc(t.categoria_nombre || '—')}</td>
        <td>${esc(t.ciudad_nombre || '—')}</td>
        <td>${esc((t.cliente_nombre || '') + ' ' + (t.cliente_apellidos || ''))}</td>
        <td>${t.cliente_verif === 'aprobado' ? pill('Verificado', '#2ea378') : '<span class="muted">No</span>'}</td>
        <td>${t.profesional_id ? esc((t.prof_nombre || '') + ' ' + (t.prof_apellidos || '')) : '<span class="muted">Sin asignar</span>'}</td>
        <td>${pillTarea(t.estado)}</td>
        <td>${t.precio_final ? esc(fmtEurosCorto(t.precio_final)) : '—'}</td>
        <td>${t.n_presupuestos}</td>
        <td class="mono">${esc(fechaCorta(t.creada_en))}</td>
      </tr>`;
    }).join('')
      : '';

    const tabla = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Tarea</th><th>Fotos</th><th>Categoría</th><th>Ciudad</th><th>Cliente</th><th>Cliente verificado</th><th>Profesional</th><th>Estado</th><th>Precio</th><th>Press.</th><th>Alta</th></tr></thead>
      <tbody>${cuerpo || '<tr><td colspan="11" class="vacio">No hay tareas que coincidan con los filtros.</td></tr>'}</tbody></table></div>`;

    const params = { q: busqueda, estado, categoria, ciudad };
    const contenido = html`
      ${raw(filtros)}
      <div class="panel">
        <div class="panel-head"><h3>Tareas (${total})</h3></div>
        ${raw(tabla)}
        ${raw(paginacion('/admin/tareas', params, pagina, total, porPagina))}
      </div>`;

    return panel(ctx, {
      titulo: 'Tareas',
      subtitulo: `${total} tareas registradas`,
      contenido
    });
  });

  router.get('/admin/tareas/:id', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const id = entero(ctx.params.id, 0);
    const t = id ? q.get('SELECT * FROM tareas WHERE id=?', id) : null;
    if (!t) {
      flash(ctx.res, 'La tarea no existe.', 'error');
      return ctx.redirigir('/admin/tareas');
    }

    const categoria = t.categoria_id ? q.get('SELECT * FROM categorias WHERE id=?', t.categoria_id) : null;
    const ciudad = t.ciudad_id ? q.get('SELECT * FROM ciudades WHERE id=?', t.ciudad_id) : null;
    const cliente = q.get('SELECT * FROM usuarios WHERE id=?', t.cliente_id);
    const profesional = t.profesional_id ? q.get('SELECT * FROM usuarios WHERE id=?', t.profesional_id) : null;
    const extra = q.get('SELECT * FROM tarea_extra WHERE tarea_id=?', t.id);
    const fotos = fotosTarea(extra ? extra.fotos : '');
    const verifCliente = t.cliente_id
      ? q.get('SELECT estado FROM verificaciones WHERE usuario_id=?', t.cliente_id)
      : null;

    const presupuestos = q.all(`SELECT p.*, u.nombre, u.apellidos, u.email
      FROM presupuestos p JOIN usuarios u ON u.id = p.profesional_id
      WHERE p.tarea_id = ? ORDER BY p.creado_en DESC`, t.id);

    const mensajes = q.all(`SELECT m.*, e.nombre AS emisor_nombre, e.apellidos AS emisor_apellidos
      FROM mensajes m LEFT JOIN usuarios e ON e.id = m.emisor_id
      WHERE m.tarea_id = ? ORDER BY m.creado_en ASC`, t.id);

    const transacciones = q.all('SELECT * FROM transacciones WHERE tarea_id=? ORDER BY creado_en DESC', t.id);

    const fichas = [
      ['Título', t.titulo],
      ['Categoría', categoria ? categoria.nombre : '—'],
      ['Ciudad', ciudad ? `${ciudad.nombre} (${ciudad.provincia})` : '—'],
      ['Dirección', t.direccion || '—'],
      ['Código postal', t.cp || '—'],
      ['Fecha / hora', `${t.fecha || '—'} ${t.hora || ''}`.trim()],
      ['Horas', String(t.horas || 0)],
      ['Frecuencia', t.frecuencia || '—'],
      ['Tipo de presupuesto', t.tipo_presupuesto || '—'],
      ['Estado', TAREAS_ESTADO[t.estado] ? TAREAS_ESTADO[t.estado].txt : t.estado],
      ['Precio final', t.precio_final ? fmtEuros(t.precio_final) : '—'],
      ['Comisión de la plataforma', 'Sin comisión por trabajo: el profesional recibe el 100 % del importe'],
      ['Creada', fmtFecha(t.creada_en, true)],
      ['Publicada', fmtFecha(t.publicada_en, true)],
      ['Cerrada', fmtFecha(t.cerrada_en, true)]
    ];

    const tablaDatos = `<div class="table-wrap"><table class="tabla">
      <tbody>${fichas.map(([k, v]) => `<tr><th style="width:220px">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`;

    const personas = `<div class="table-wrap"><table class="tabla"><tbody>
      <tr><th style="width:220px">Cliente</th><td>${cliente ? html`<a href="/admin/usuarios/${cliente.id}">${esc(nombreCompleto(cliente))}</a> · ${esc(cliente.email)}` : '—'}</td></tr>
      <tr><th>Cliente verificado</th><td>${verifCliente && verifCliente.estado === 'aprobado'
        ? pill('Verificado', '#2ea378')
        : '<span class="muted">No verificado</span>'}</td></tr>
      <tr><th>Profesional asignado</th><td>${profesional ? html`<a href="/admin/usuarios/${profesional.id}">${esc(nombreCompleto(profesional))}</a> · ${esc(profesional.email)}` : '<span class="muted">Sin asignar</span>'}</td></tr>
      </tbody></table></div>`;

    const galeriaFotos = fotos.length
      ? `<div class="doc-galeria">${fotos.map(u => `<figure class="doc-foto">
            <a href="${esc(contenidoUrl(u))}" target="_blank" rel="noopener">
              <img src="${esc(contenidoUrl(u))}" alt="Foto del trabajo" loading="lazy">
            </a>
            <figcaption><a href="${esc(contenidoUrl(u))}" target="_blank" rel="noopener">Abrir</a></figcaption>
          </figure>`).join('')}</div>`
      : '<p class="vacio">El cliente no ha adjuntado fotos del trabajo.</p>';

    const filasPresu = presupuestos.length ? presupuestos.map(p => `<tr>
        <td><a href="/admin/usuarios/${p.profesional_id}">${esc((p.nombre || '') + ' ' + (p.apellidos || ''))}</a></td>
        <td>${esc(fmtEurosCorto(p.precio))}</td>
        <td>${esc(String(p.horas || 0))} h</td>
        <td>${pillPresupuesto(p.estado)}</td>
        <td>${esc(p.mensaje || '—')}</td>
        <td class="mono">${esc(fechaCorta(p.creado_en))}</td>
      </tr>`).join('')
      : '<tr><td colspan="6" class="vacio">Sin presupuestos recibidos.</td></tr>';

    const tablaPresu = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Profesional</th><th>Precio</th><th>Horas</th><th>Estado</th><th>Mensaje</th><th>Fecha</th></tr></thead>
      <tbody>${filasPresu}</tbody></table></div>`;

    const filasMensajes = mensajes.length ? mensajes.map(m => `<tr>
        <td>${esc((m.emisor_nombre || '') + ' ' + (m.emisor_apellidos || ''))}</td>
        <td>${esc(m.cuerpo)}</td>
        <td class="mono">${esc(fechaCorta(m.creado_en))}</td>
      </tr>`).join('')
      : '<tr><td colspan="3" class="vacio">Sin mensajes.</td></tr>';

    const tablaMensajes = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Emisor</th><th>Mensaje</th><th>Fecha</th></tr></thead><tbody>${filasMensajes}</tbody></table></div>`;

    const filasTrans = transacciones.length ? transacciones.map(tr => `<tr>
        <td>${esc(tr.tipo)}</td>
        <td>${esc(fmtEurosCorto(tr.monto))}</td>
        <td>${tr.comision ? esc(fmtEurosCorto(tr.comision)) : '—'}</td>
        <td>${esc(tr.estado)}</td>
        <td>${esc(tr.descripcion || '—')}</td>
        <td class="mono">${esc(fechaCorta(tr.creado_en))}</td>
      </tr>`).join('')
      : '<tr><td colspan="6" class="vacio">Sin transacciones.</td></tr>';

    const tablaTrans = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Tipo</th><th>Monto</th><th>Comisión</th><th>Estado</th><th>Descripción</th><th>Fecha</th></tr></thead>
      <tbody>${filasTrans}</tbody></table></div>`;

    const botonAccion = (accion, etiqueta, clase) => `<form method="post" action="/admin/tareas/${t.id}/accion" class="form-acciones">
      ${csrfCampo(ctx)}
      <input type="hidden" name="accion" value="${accion}">
      <button class="btn btn-sm ${clase}" type="submit">${esc(etiqueta)}</button>
    </form>`;

    const acciones = `<div class="acciones">
      ${botonAccion('cerrar', 'Marcar completada', 'btn-sm')}
      ${botonAccion('cancelar', 'Cancelar tarea', 'btn-sm btn-hollow')}
      ${botonAccion('reabrir', 'Reabrir', 'btn-sm btn-hollow')}
    </div>`;

    const contenido = html`
      <div class="panel">
        <div class="panel-head">
          <h3>${t.titulo}</h3>
          ${raw(pillTarea(t.estado))}
        </div>
        ${raw(tablaDatos)}
        ${raw(personas)}
        ${raw(acciones)}
      </div>
      <div class="panel"><div class="panel-head"><h3>Fotos del trabajo</h3></div>${raw(galeriaFotos)}</div>
      <div class="panel"><div class="panel-head"><h3>Presupuestos</h3></div>${raw(tablaPresu)}</div>
      <div class="panel"><div class="panel-head"><h3>Mensajes</h3></div>${raw(tablaMensajes)}</div>
      <div class="panel"><div class="panel-head"><h3>Transacciones</h3></div>${raw(tablaTrans)}</div>`;

    return panel(ctx, {
      titulo: `Tarea #${t.id}`,
      subtitulo: t.titulo,
      contenido
    });
  });

  router.post('/admin/tareas/:id/accion', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;
    if (!exigirCsrf(ctx)) return;

    const id = entero(ctx.params.id, 0);
    const t = id ? q.get('SELECT * FROM tareas WHERE id=?', id) : null;
    if (!t) {
      flash(ctx.res, 'La tarea no existe.', 'error');
      return ctx.redirigir('/admin/tareas');
    }

    const accion = texto(ctx.body.accion);
    const ts = ahora();
    const volver = `/admin/tareas/${t.id}`;

    if (accion === 'cancelar') {
      q.run("UPDATE tareas SET estado='cancelada', cerrada_en=? WHERE id=?", ts, t.id);
      auditar(ctx, 'tarea_cancelada', 'tarea', t.id, `${t.titulo} — cancelada por administración`);
      notificar(t.cliente_id, 'aviso', 'Tu tarea ha sido cancelada', `La tarea «${t.titulo}» ha sido cancelada por el equipo de TrabajoFácil.`);
      if (t.profesional_id) notificar(t.profesional_id, 'aviso', 'Tarea cancelada', `La tarea «${t.titulo}» ha sido cancelada.`);
      flash(ctx.res, 'Tarea cancelada.', 'ok');
      return ctx.redirigir(volver);
    }

    if (accion === 'cerrar') {
      q.run("UPDATE tareas SET estado='completada', cerrada_en=?, comision=0 WHERE id=?", ts, t.id);
      auditar(ctx, 'tarea_cerrada', 'tarea', t.id, `${t.titulo} — completada por administración`);
      notificar(t.cliente_id, 'exito', 'Tarea completada', `La tarea «${t.titulo}» figura como completada.`);
      if (t.profesional_id) notificar(t.profesional_id, 'exito', 'Tarea completada', `La tarea «${t.titulo}» figura como completada.`);
      flash(ctx.res, 'Tarea marcada como completada.', 'ok');
      return ctx.redirigir(volver);
    }

    if (accion === 'reabrir') {
      q.run("UPDATE tareas SET estado='publicada', cerrada_en=NULL WHERE id=?", t.id);
      auditar(ctx, 'tarea_reabierta', 'tarea', t.id, `${t.titulo} — reabierta por administración`);
      notificar(t.cliente_id, 'info', 'Tu tarea vuelve a estar publicada', `La tarea «${t.titulo}» se ha reabierto.`);
      flash(ctx.res, 'Tarea reabierta.', 'ok');
      return ctx.redirigir(volver);
    }

    flash(ctx.res, 'Acción no reconocida.', 'error');
    return ctx.redirigir(volver);
  });

  /* ================================================================== */
  /* Presupuestos                                                        */
  /* ================================================================== */
  router.get('/admin/presupuestos', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const busqueda = texto(ctx.query.q);
    const estado = texto(ctx.query.estado);
    const pagina = Math.max(1, entero(ctx.query.pagina, 1));
    const porPagina = POR_PAGINA;

    const cond = [];
    const args = [];
    if (busqueda) {
      const like = `%${busqueda}%`;
      cond.push('(t.titulo LIKE ? OR u.nombre LIKE ? OR u.apellidos LIKE ?)');
      args.push(like, like, like);
    }
    if (Object.keys(PRESU_ESTADO).includes(estado)) { cond.push('p.estado = ?'); args.push(estado); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const total = q.get(`SELECT COUNT(*) AS n FROM presupuestos p JOIN tareas t ON t.id = p.tarea_id JOIN usuarios u ON u.id = p.profesional_id ${where}`, ...args).n;
    const filas = q.all(`SELECT p.*, t.titulo AS tarea_titulo, t.id AS tarea_id, t.estado AS tarea_estado,
        u.nombre, u.apellidos, u.email
      FROM presupuestos p
      JOIN tareas t ON t.id = p.tarea_id
      JOIN usuarios u ON u.id = p.profesional_id
      ${where}
      ORDER BY p.creado_en DESC
      LIMIT ? OFFSET ?`, ...args, porPagina, (pagina - 1) * porPagina);

    const filtros = bloqueFiltros('/admin/presupuestos', `
      <div class="campo"><label for="f_q">Buscar</label>
        <input type="search" id="f_q" name="q" value="${esc(busqueda)}" placeholder="Tarea o profesional"></div>
      ${filtroSelect('estado', 'Estado', [{ valor: '', texto: 'Todos' }, ...Object.keys(PRESU_ESTADO).map(e => ({ valor: e, texto: PRESU_ESTADO[e].txt }))], estado)}
    `);

    const cuerpo = filas.length ? filas.map(p => `<tr>
        <td><a href="/admin/tareas/${p.tarea_id}">${esc(p.tarea_titulo)}</a></td>
        <td><a href="/admin/usuarios/${p.profesional_id}">${esc((p.nombre || '') + ' ' + (p.apellidos || ''))}</a></td>
        <td>${esc(fmtEurosCorto(p.precio))}</td>
        <td>${esc(String(p.horas || 0))} h</td>
        <td>${pillPresupuesto(p.estado)}</td>
        <td class="mono">${esc(fechaCorta(p.creado_en))}</td>
        <td class="row-actions">
          ${p.estado !== 'retirado' ? `<form method="post" action="/admin/presupuestos/${p.id}/anular" class="row-actions">
            ${csrfCampo(ctx)}
            <button class="btn btn-sm btn-hollow" type="submit">Anular</button>
          </form>` : '<span class="muted">—</span>'}
        </td>
      </tr>`).join('')
      : '';

    const tabla = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Tarea</th><th>Profesional</th><th>Precio</th><th>Horas</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>
      <tbody>${cuerpo || '<tr><td colspan="7" class="vacio">No hay presupuestos que coincidan con los filtros.</td></tr>'}</tbody></table></div>`;

    const params = { q: busqueda, estado };
    const contenido = html`
      ${raw(filtros)}
      <div class="panel">
        <div class="panel-head"><h3>Presupuestos (${total})</h3></div>
        ${raw(tabla)}
        ${raw(paginacion('/admin/presupuestos', params, pagina, total, porPagina))}
      </div>`;

    return panel(ctx, {
      titulo: 'Presupuestos',
      subtitulo: `${total} presupuestos enviados`,
      contenido
    });
  });

  router.post('/admin/presupuestos/:id/anular', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;
    if (!exigirCsrf(ctx)) return;

    const id = entero(ctx.params.id, 0);
    const p = id ? q.get('SELECT * FROM presupuestos WHERE id=?', id) : null;
    if (!p) {
      flash(ctx.res, 'El presupuesto no existe.', 'error');
      return ctx.redirigir('/admin/presupuestos');
    }

    q.run("UPDATE presupuestos SET estado='retirado', responde_en=? WHERE id=?", ahora(), p.id);
    auditar(ctx, 'presupuesto_anulado', 'presupuesto', p.id, `Presupuesto #${p.id} anulado por administración`);
    notificar(p.profesional_id, 'aviso', 'Presupuesto anulado', 'Un administrador ha retirado uno de tus presupuestos.');
    flash(ctx.res, 'Presupuesto anulado.', 'ok');
    return ctx.redirigir('/admin/presupuestos');
  });

  /* ================================================================== */
  /* Categorías                                                          */
  /* ================================================================== */

  /** Campos de edición de una categoría (formularios en línea). */
  function inputsCategoria(cat, areas, prefijo) {
    const id = n => `${prefijo}_${n}`;
    const areaOpts = ['<option value="">— sin área —</option>']
      .concat(areas.map(a => `<option value="${a.id}"${cat && cat.area_id === a.id ? ' selected' : ''}>${esc(a.nombre)}</option>`))
      .join('');
    const keywords = cat && cat.keywords
      ? (() => { try { return JSON.parse(cat.keywords || '[]').join(', '); } catch { return ''; } })()
      : '';
    const activa = !cat || cat.activa;
    return `<div class="form-grid">
      <label class="campo" for="${id('nombre')}">Nombre
        <input type="text" id="${id('nombre')}" name="nombre" value="${esc(cat ? cat.nombre : '')}" required maxlength="80">
      </label>
      <label class="campo" for="${id('slug')}">Slug
        <input type="text" id="${id('slug')}" name="slug" value="${esc(cat ? cat.slug : '')}" maxlength="90" placeholder="se genera del nombre">
      </label>
      <label class="campo" for="${id('code')}">Código
        <input type="text" id="${id('code')}" name="code" value="${esc(cat ? cat.code : '')}" maxlength="12">
      </label>
      <label class="campo" for="${id('color')}">Color
        <input type="text" id="${id('color')}" name="color" value="${esc(cat ? cat.color : 'rgba(0,172,181,1)')}" maxlength="40">
      </label>
      <label class="campo" for="${id('familia')}">Familia
        <input type="text" id="${id('familia')}" name="familia" value="${esc(cat ? cat.familia : '')}" maxlength="60">
      </label>
      <label class="campo" for="${id('area_id')}">Área
        <select id="${id('area_id')}" name="area_id">${areaOpts}</select>
      </label>
      <label class="campo" for="${id('precio_medio')}">Precio medio (€/h)
        <input type="number" id="${id('precio_medio')}" name="precio_medio" step="0.01" min="0" value="${esc(cat ? cat.precio_medio : 0)}">
      </label>
      <label class="campo" for="${id('keywords')}">Keywords (separadas por comas)
        <input type="text" id="${id('keywords')}" name="keywords" value="${esc(keywords)}" maxlength="600">
      </label>
      <label class="campo" for="${id('orden')}">Orden
        <input type="number" id="${id('orden')}" name="orden" value="${esc(cat ? cat.orden : 0)}">
      </label>
      <label class="check"><input type="checkbox" name="activa" value="1"${activa ? ' checked' : ''}> <span>Activa</span></label>
    </div>`;
  }

  /** Valida y normaliza los datos de una categoría. */
  function datosCategoria(body, areas, idActual = 0) {
    const nombre = texto(body.nombre);
    const slug = slugify(texto(body.slug) || nombre);
    const code = texto(body.code).toUpperCase();
    const color = texto(body.color) || 'rgba(0,172,181,1)';
    const familia = texto(body.familia);
    const areaId = entero(body.area_id, 0);
    const precio = num(body.precio_medio, 0);
    const orden = entero(body.orden, 0);
    const activa = bool(body.activa);
    const kw = texto(body.keywords);

    if (!nombre) return { error: 'Escribe el nombre de la categoría.' };
    if (nombre.length > 80) return { error: 'El nombre no puede superar los 80 caracteres.' };
    if (!slug) return { error: 'El slug no puede quedar vacío.' };
    const dup = q.get('SELECT id FROM categorias WHERE slug=? AND id<>?', slug, idActual);
    if (dup) return { error: `Ya existe otra categoría con el slug «${slug}».` };
    if (!/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(color)) return { error: 'El color no tiene un formato válido (usa #hex o rgba()).' };
    if (precio < 0) return { error: 'El precio medio no puede ser negativo.' };
    if (areaId && !areas.some(a => a.id === areaId)) return { error: 'El área indicada no existe.' };

    const keywords = kw
      ? kw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 60)
      : [];

    return {
      valores: {
        nombre, slug, code, color, familia,
        area_id: areaId || null,
        precio_medio: Math.round(precio * 100) / 100,
        keywords: JSON.stringify(keywords),
        activa: activa ? 1 : 0,
        orden
      }
    };
  }

  router.get('/admin/categorias', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const areas = q.all('SELECT id, nombre FROM areas ORDER BY orden, nombre');
    const cats = q.all(`SELECT c.*, a.nombre AS area_nombre,
        (SELECT COUNT(*) FROM tareas t WHERE t.categoria_id = c.id) AS n_tareas
      FROM categorias c LEFT JOIN areas a ON a.id = c.area_id
      ORDER BY c.orden, c.nombre`);

    const filas = cats.length ? cats.map(c => {
      let keywords = [];
      try { keywords = JSON.parse(c.keywords || '[]'); } catch { keywords = []; }
      return `<tr>
        <td><span class="badge-cat" style="background:${esc(c.color)}">${esc(c.code || '')}</span>
          ${esc(c.nombre)}<br><span class="muted mono">${esc(c.slug)}</span></td>
        <td>${esc(c.familia || '—')}</td>
        <td>${esc(c.area_nombre || '—')}</td>
        <td>${esc(fmtEurosCorto(c.precio_medio))}</td>
        <td>${c.n_tareas}</td>
        <td>${keywords.length ? html`<span class="muted">${esc(keywords.slice(0, 4).join(', '))}${keywords.length > 4 ? '…' : ''}</span>` : '<span class="muted">—</span>'}</td>
        <td>${c.activa ? pill('Activa', '#2ea378') : pill('Inactiva', '#777')}</td>
        <td class="row-actions">
          <form method="post" action="/admin/categorias/${c.id}/alternar" class="row-actions">
            ${csrfCampo(ctx)}
            <button class="btn btn-sm btn-hollow" type="submit">${c.activa ? 'Desactivar' : 'Activar'}</button>
          </form>
        </td>
      </tr>
      <tr><td colspan="8">
        <details class="panel">
          <summary>Editar «${esc(c.nombre)}»</summary>
          <form method="post" action="/admin/categorias/${c.id}/actualizar">
            ${csrfCampo(ctx)}
            ${inputsCategoria(c, areas, `cat_${c.id}`)}
            <div class="acciones"><button class="btn btn-sm" type="submit">Guardar cambios</button></div>
          </form>
        </details>
      </td></tr>`;
    }).join('')
      : '<tr><td colspan="8" class="vacio">No hay categorías registradas.</td></tr>';

    const tabla = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Categoría</th><th>Familia</th><th>Área</th><th>Precio medio</th><th>Tareas</th><th>Keywords</th><th>Estado</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div>`;

    const formularioNuevo = `<form method="post" action="/admin/categorias/nueva">
      ${csrfCampo(ctx)}
      ${inputsCategoria(null, areas, 'nueva')}
      <div class="acciones"><button class="btn btn-sm" type="submit">Crear categoría</button></div>
    </form>`;

    const contenido = html`
      <div class="panel">
        <div class="panel-head"><h3>Categorías (${cats.length})</h3></div>
        ${raw(tabla)}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Nueva categoría</h3></div>
        ${raw(formularioNuevo)}
      </div>`;

    return panel(ctx, {
      titulo: 'Categorías',
      subtitulo: `${cats.length} categorías en el catálogo`,
      contenido
    });
  });

  router.post('/admin/categorias/nueva', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;
    if (!exigirCsrf(ctx)) return;

    const areas = q.all('SELECT id FROM areas');
    const r = datosCategoria(ctx.body, areas, 0);
    if (r.error) {
      flash(ctx.res, r.error, 'error');
      return ctx.redirigir('/admin/categorias');
    }

    const v = r.valores;
    const ins = q.run(`INSERT INTO categorias (nombre,slug,code,color,familia,area_id,precio_medio,keywords,descripcion,activa,orden)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      v.nombre, v.slug, v.code, v.color, v.familia, v.area_id, v.precio_medio, v.keywords, '', v.activa, v.orden);

    auditar(ctx, 'categoria_creada', 'categoria', ins.id, `${v.nombre} (${v.slug})`);
    flash(ctx.res, `Categoría «${v.nombre}» creada.`, 'ok');
    return ctx.redirigir('/admin/categorias');
  });

  router.post('/admin/categorias/:id/actualizar', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;
    if (!exigirCsrf(ctx)) return;

    const id = entero(ctx.params.id, 0);
    const cat = id ? q.get('SELECT * FROM categorias WHERE id=?', id) : null;
    if (!cat) {
      flash(ctx.res, 'La categoría no existe.', 'error');
      return ctx.redirigir('/admin/categorias');
    }

    const areas = q.all('SELECT id FROM areas');
    const r = datosCategoria(ctx.body, areas, id);
    if (r.error) {
      flash(ctx.res, r.error, 'error');
      return ctx.redirigir('/admin/categorias');
    }

    const v = r.valores;
    q.run(`UPDATE categorias SET nombre=?, slug=?, code=?, color=?, familia=?, area_id=?, precio_medio=?, keywords=?, activa=?, orden=? WHERE id=?`,
      v.nombre, v.slug, v.code, v.color, v.familia, v.area_id, v.precio_medio, v.keywords, v.activa, v.orden, id);

    auditar(ctx, 'categoria_actualizada', 'categoria', id, `${cat.nombre} → ${v.nombre} (${v.slug})`);
    flash(ctx.res, 'Categoría actualizada.', 'ok');
    return ctx.redirigir('/admin/categorias');
  });

  router.post('/admin/categorias/:id/alternar', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;
    if (!exigirCsrf(ctx)) return;

    const id = entero(ctx.params.id, 0);
    const cat = id ? q.get('SELECT * FROM categorias WHERE id=?', id) : null;
    if (!cat) {
      flash(ctx.res, 'La categoría no existe.', 'error');
      return ctx.redirigir('/admin/categorias');
    }

    const nuevo = cat.activa ? 0 : 1;
    q.run('UPDATE categorias SET activa=? WHERE id=?', nuevo, id);
    auditar(ctx, 'categoria_alternada', 'categoria', id, `${cat.nombre}: ${nuevo ? 'activada' : 'desactivada'}`);
    flash(ctx.res, `Categoría «${cat.nombre}» ${nuevo ? 'activada' : 'desactivada'}.`, 'ok');
    return ctx.redirigir('/admin/categorias');
  });

  /* ================================================================== */
  /* Ciudades                                                            */
  /* ================================================================== */
  router.get('/admin/ciudades', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const ciudades = q.all(`SELECT c.*,
        (SELECT COUNT(*) FROM tareas t WHERE t.ciudad_id = c.id) AS n_tareas,
        (SELECT COUNT(*) FROM usuarios u WHERE u.ciudad_id = c.id AND u.rol = 'profesional') AS n_profesionales,
        (SELECT COUNT(*) FROM usuarios u WHERE u.ciudad_id = c.id) AS n_usuarios
      FROM ciudades c
      ORDER BY c.provincia, c.nombre`);

    const cuerpo = ciudades.length ? ciudades.map(c => `<tr>
        <td>${esc(c.nombre)}<br><span class="muted mono">${esc(c.slug)}</span></td>
        <td>${esc(c.provincia)}</td>
        <td class="mono">${esc(c.cp || '—')}</td>
        <td>${c.n_tareas}</td>
        <td>${c.n_profesionales}</td>
        <td>${c.n_usuarios}</td>
        <td>${c.activa ? pill('Activa', '#2ea378') : pill('Inactiva', '#777')}</td>
        <td class="row-actions">
          <form method="post" action="/admin/ciudades/${c.id}/alternar" class="row-actions">
            ${csrfCampo(ctx)}
            <button class="btn btn-sm btn-hollow" type="submit">${c.activa ? 'Desactivar' : 'Activar'}</button>
          </form>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="8" class="vacio">No hay ciudades registradas.</td></tr>';

    const tabla = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Ciudad</th><th>Provincia</th><th>CP</th><th>Tareas</th><th>Profesionales</th><th>Usuarios</th><th>Estado</th><th></th></tr></thead>
      <tbody>${cuerpo}</tbody></table></div>`;

    const contenido = html`
      <div class="panel">
        <div class="panel-head"><h3>Ciudades (${ciudades.length})</h3></div>
        ${raw(tabla)}
      </div>`;

    return panel(ctx, {
      titulo: 'Ciudades',
      subtitulo: `${ciudades.length} ciudades con cobertura`,
      contenido
    });
  });

  router.post('/admin/ciudades/:id/alternar', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;
    if (!exigirCsrf(ctx)) return;

    const id = entero(ctx.params.id, 0);
    const c = id ? q.get('SELECT * FROM ciudades WHERE id=?', id) : null;
    if (!c) {
      flash(ctx.res, 'La ciudad no existe.', 'error');
      return ctx.redirigir('/admin/ciudades');
    }

    const nuevo = c.activa ? 0 : 1;
    q.run('UPDATE ciudades SET activa=? WHERE id=?', nuevo, id);
    auditar(ctx, 'ciudad_alternada', 'ciudad', id, `${c.nombre}: ${nuevo ? 'activada' : 'desactivada'}`);
    flash(ctx.res, `Ciudad «${c.nombre}» ${nuevo ? 'activada' : 'desactivada'}.`, 'ok');
    return ctx.redirigir('/admin/ciudades');
  });

  /* ================================================================== */
  /* Transacciones                                                       */
  /* ================================================================== */
  router.get('/admin/transacciones', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const tipo = texto(ctx.query.tipo);
    const estado = texto(ctx.query.estado);
    const pagina = Math.max(1, entero(ctx.query.pagina, 1));
    const porPagina = POR_PAGINA;

    const tipos = Object.keys(TIPOS_TRANSACCION);
    const estados = ['pendiente', 'completada', 'revertida'];

    const cond = [];
    const args = [];
    if (tipos.includes(tipo)) { cond.push('tr.tipo = ?'); args.push(tipo); }
    if (estados.includes(estado)) { cond.push('tr.estado = ?'); args.push(estado); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const total = q.get(`SELECT COUNT(*) AS n FROM transacciones tr ${where}`, ...args).n;
    const filas = q.all(`SELECT tr.*, u.nombre, u.apellidos, u.email, t.titulo AS tarea_titulo
      FROM transacciones tr
      LEFT JOIN usuarios u ON u.id = tr.usuario_id
      LEFT JOIN tareas t ON t.id = tr.tarea_id
      ${where}
      ORDER BY tr.creado_en DESC
      LIMIT ? OFFSET ?`, ...args, porPagina, (pagina - 1) * porPagina);

    const totalCobrado = num(q.get(
      "SELECT COALESCE(SUM(monto),0) AS v FROM transacciones WHERE estado='completada' AND tipo='pago_cliente'").v);
    const tokensGastados = tokensConsumidos();
    const ingresosTokens = eurosDeTokens(tokensGastados);
    const saldoMonedero = num(q.get(
      "SELECT COALESCE(SUM(CASE WHEN tipo='recarga' THEN monto ELSE -monto END),0) AS v FROM transacciones WHERE estado='completada' AND tipo IN ('recarga','pago_profesional','retirada')").v);
    const pendientes = q.get("SELECT COUNT(*) AS n FROM transacciones WHERE estado='pendiente'").n;

    const kpis = html`
      <div class="stats">
        <div class="stat"><span class="valor">${fmtEurosCorto(totalCobrado)}</span><span class="etiqueta">Total cobrado</span><span class="muted">Pagos de cliente completados</span></div>
        <div class="stat"><span class="valor">${fmtEuros(ingresosTokens)}</span><span class="etiqueta">Ingresos por tokens</span><span class="muted">${tokensGastados} tokens consumidos · Sin comisión por trabajo: el profesional recibe el 100 % del importe</span></div>
        <div class="stat"><span class="valor">${fmtEurosCorto(saldoMonedero)}</span><span class="etiqueta">Saldo de monedero</span><span class="muted">Recargas menos salidas</span></div>
        <div class="stat"><span class="valor">${pendientes}</span><span class="etiqueta">Transacciones pendientes</span><span class="muted">${total} en total</span></div>
      </div>`;

    const filtros = bloqueFiltros('/admin/transacciones', `
      ${filtroSelect('tipo', 'Tipo', [{ valor: '', texto: 'Todos' }, ...tipos.map(t => ({ valor: t, texto: TIPOS_TRANSACCION[t] }))], tipo)}
      ${filtroSelect('estado', 'Estado', [{ valor: '', texto: 'Todos' }, ...estados.map(e => ({ valor: e, texto: e }))], estado)}
    `);

    const cuerpo = filas.length ? filas.map(tr => `<tr>
        <td class="mono">#${tr.id}</td>
        <td>${esc(TIPOS_TRANSACCION[tr.tipo] || tr.tipo)}</td>
        <td>${tr.usuario_id ? html`<a href="/admin/usuarios/${tr.usuario_id}">${esc((tr.nombre || '') + ' ' + (tr.apellidos || ''))}</a>` : '<span class="muted">—</span>'}</td>
        <td class="celda-titulo">${tr.tarea_id ? html`<a href="/admin/tareas/${tr.tarea_id}" title="${esc(tr.tarea_titulo || '')}">${esc(tr.tarea_titulo || '—')}</a>` : '<span class="muted">—</span>'}</td>
        <td>${esc(fmtEurosCorto(tr.monto))}</td>
        <td>${tr.comision ? esc(fmtEurosCorto(tr.comision)) : '—'}</td>
        <td>${pill(tr.estado, tr.estado === 'completada' ? '#2ea378' : (tr.estado === 'revertida' ? '#e45252' : '#f0aa28'))}</td>
        <td class="mono">${esc(fechaCorta(tr.creado_en))}</td>
        <td class="row-actions">
          ${tr.estado !== 'revertida' ? `<form method="post" action="/admin/transacciones/${tr.id}/estado" class="row-actions">
            ${csrfCampo(ctx)}
            <input type="hidden" name="estado" value="revertida">
            <button class="btn btn-sm btn-hollow" type="submit">Revertir</button>
          </form>` : ''}
          ${tr.estado !== 'pendiente' ? `<form method="post" action="/admin/transacciones/${tr.id}/estado" class="row-actions">
            ${csrfCampo(ctx)}
            <input type="hidden" name="estado" value="pendiente">
            <button class="btn btn-sm btn-hollow" type="submit" title="Marcar la transacción como pendiente">Pendiente</button>
          </form>` : ''}
        </td>
      </tr>`).join('')
      : '';

    const tabla = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>ID</th><th>Tipo</th><th>Usuario</th><th>Tarea</th><th>Monto</th><th>Comisión</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>
      <tbody>${cuerpo || '<tr><td colspan="9" class="vacio">No hay transacciones que coincidan con los filtros.</td></tr>'}</tbody></table></div>`;

    const params = { tipo, estado };
    const contenido = html`
      ${raw(kpis)}
      ${raw(filtros)}
      <div class="panel">
        <div class="panel-head"><h3>Transacciones (${total})</h3></div>
        ${raw(tabla)}
        ${raw(paginacion('/admin/transacciones', params, pagina, total, porPagina))}
      </div>`;

    return panel(ctx, {
      titulo: 'Transacciones',
      subtitulo: 'Flujo de dinero de la plataforma',
      contenido
    });
  });

  router.post('/admin/transacciones/:id/estado', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;
    if (!exigirCsrf(ctx)) return;

    const id = entero(ctx.params.id, 0);
    const tr = id ? q.get('SELECT * FROM transacciones WHERE id=?', id) : null;
    if (!tr) {
      flash(ctx.res, 'La transacción no existe.', 'error');
      return ctx.redirigir('/admin/transacciones');
    }

    const nuevo = texto(ctx.body.estado);
    if (!['pendiente', 'completada', 'revertida'].includes(nuevo)) {
      flash(ctx.res, 'El estado indicado no es válido.', 'error');
      return ctx.redirigir('/admin/transacciones');
    }

    q.run('UPDATE transacciones SET estado=? WHERE id=?', nuevo, id);
    auditar(ctx, 'transaccion_estado', 'transaccion', id, `Transacción #${id}: ${tr.estado} → ${nuevo}`);
    if (tr.usuario_id) {
      notificar(tr.usuario_id, nuevo === 'revertida' ? 'aviso' : 'info',
        nuevo === 'revertida' ? 'Transacción revertida' : 'Transacción actualizada',
        `Tu transacción #${id} (${fmtEurosCorto(tr.monto)}) figura ahora como «${nuevo}».`);
    }
    flash(ctx.res, `Transacción marcada como «${nuevo}».`, 'ok');
    return ctx.redirigir('/admin/transacciones');
  });

  /* ================================================================== */
  /* Tokens                                                              */
  /* ================================================================== */
  router.get('/admin/tokens', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const comprados = tokensComprados();
    const consumidos = tokensConsumidos();
    const porGastar = Math.max(0, comprados - consumidos);
    const ingresoEuros = eurosDeTokens(consumidos);
    const movimientos = movimientosGlobales(200);

    const ETIQUETA_MOV = {
      compra: 'Compra',
      presupuesto: 'Presupuesto',
      reembolso: 'Devolución'
    };

    const kpis = html`
      <div class="stats">
        <div class="stat"><span class="valor">${comprados}</span><span class="etiqueta">Tokens comprados</span><span class="muted">Equivale a ${fmtEuros(eurosDeTokens(comprados))}</span></div>
        <div class="stat"><span class="valor">${consumidos}</span><span class="etiqueta">Tokens consumidos</span><span class="muted">${porGastar} tokens pendientes de gastar</span></div>
        <div class="stat"><span class="valor">${fmtEuros(ingresoEuros)}</span><span class="etiqueta">Ingreso en euros</span><span class="muted">Sin comisión por trabajo: el profesional recibe el 100 % del importe</span></div>
      </div>`;

    const cuerpo = movimientos.length ? movimientos.map(m => {
      const cantidad = Number(m.cantidad || 0);
      return `<tr>
        <td class="mono">${esc(fechaCorta(m.creado_en))}</td>
        <td><a href="/admin/usuarios/${m.usuario_id}">${esc((m.nombre || '') + ' ' + (m.apellidos || ''))}</a><br>
          <span class="muted">${esc(m.email || '')}</span></td>
        <td>${esc(ETIQUETA_MOV[m.tipo] || m.tipo || '—')}</td>
        <td class="mono">${esc((cantidad > 0 ? '+' : '') + cantidad)}</td>
        <td>${esc(fmtEuros(m.euros))}</td>
        <td>${esc(m.tarea_titulo || '—')}</td>
        <td>${esc(m.descripcion || '—')}</td>
      </tr>`;
    }).join('')
      : '';

    const tabla = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Fecha</th><th>Profesional</th><th>Tipo</th><th>Cantidad</th><th>Euros</th><th>Tarea</th><th>Descripción</th></tr></thead>
      <tbody>${cuerpo || '<tr><td colspan="7" class="vacio">Todavía no hay movimientos de tokens.</td></tr>'}</tbody></table></div>`;

    const contenido = html`
      ${raw(kpis)}
      <div class="panel">
        <div class="panel-head"><h3>Movimientos de tokens (${movimientos.length})</h3></div>
        ${raw(tabla)}
      </div>`;

    return panel(ctx, {
      titulo: 'Tokens',
      subtitulo: 'Ingreso de la plataforma por tokens consumidos',
      contenido
    });
  });

  /* ================================================================== */
  /* Landings SEO                                                        */
  /* ================================================================== */
  router.get('/admin/landings', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const landings = q.all(`SELECT l.*, c.nombre AS categoria_nombre, ci.nombre AS ciudad_nombre
      FROM landings l
      LEFT JOIN categorias c ON c.id = l.categoria_id
      LEFT JOIN ciudades ci ON ci.id = l.ciudad_id
      ORDER BY l.tipo, c.nombre, ci.nombre`);

    const catsActivas = q.get('SELECT COUNT(*) AS n FROM categorias WHERE activa=1').n;
    const ciudadesActivas = q.get('SELECT COUNT(*) AS n FROM ciudades WHERE activa=1').n;
    const posibles = catsActivas * ciudadesActivas;

    const cuerpo = landings.length ? landings.map(l => `<tr>
        <td>${esc(l.tipo)}</td>
        <td>${esc(l.categoria_nombre || '—')}</td>
        <td>${esc(l.ciudad_nombre || '—')}</td>
        <td class="mono"><a href="/${esc(l.slug)}" target="_blank" rel="noopener">/${esc(l.slug)}</a></td>
        <td class="mono">${esc(l.generada_en ? fechaCorta(l.generada_en) : '—')}</td>
        <td>${l.activa ? pill('Activa', '#2ea378') : pill('Inactiva', '#777')}</td>
        <td class="row-actions">
          <form method="post" action="/admin/landings/${l.id}/alternar" class="row-actions">
            ${csrfCampo(ctx)}
            <button class="btn btn-sm btn-hollow" type="submit">${l.activa ? 'Desactivar' : 'Activar'}</button>
          </form>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="7" class="vacio">Todavía no hay landings generados.</td></tr>';

    const tabla = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Tipo</th><th>Categoría</th><th>Ciudad</th><th>Slug</th><th>Generada</th><th>Estado</th><th></th></tr></thead>
      <tbody>${cuerpo}</tbody></table></div>`;

    const botonGenerar = `<form method="post" action="/admin/landings/generar">
      ${csrfCampo(ctx)}
      <button class="btn btn-sm" type="submit">Generar landings servicio × ciudad</button>
    </form>`;

    const contenido = html`
      <div class="alert-box">
        Hay <b>${catsActivas}</b> categorías activas y <b>${ciudadesActivas}</b> ciudades activas:
        en total se pueden generar <b>${posibles}</b> landings «servicio × ciudad».
        Las que ya existen no se duplican.
      </div>
      <div class="panel">
        <div class="panel-head">
          <h3>Landings (${landings.length})</h3>
          <div class="acciones">${raw(botonGenerar)}</div>
        </div>
        ${raw(tabla)}
      </div>`;

    return panel(ctx, {
      titulo: 'Landings SEO',
      subtitulo: `${landings.length} landings en el catálogo`,
      contenido
    });
  });

  router.post('/admin/landings/generar', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;
    if (!exigirCsrf(ctx)) return;

    const cats = q.all('SELECT id, slug FROM categorias WHERE activa=1');
    const ciudades = q.all('SELECT id, slug FROM ciudades WHERE activa=1');
    const ts = ahora();
    let creadas = 0;

    for (const c of cats) {
      for (const ci of ciudades) {
        const slug = `servicios-de-${c.slug}-en-${ci.slug}`;
        const r = q.run(`INSERT OR IGNORE INTO landings (tipo,categoria_id,ciudad_id,slug,activa,generada_en)
          VALUES (?,?,?,?,1,?)`, 'servicio_ciudad', c.id, ci.id, slug, ts);
        creadas += r.cambios;
      }
    }

    auditar(ctx, 'landings_generadas', 'landing', null,
      `Generación servicio × ciudad: ${creadas} landings nuevas de ${cats.length * ciudades.length} posibles`);
    flash(ctx.res, creadas ? `Se han generado ${creadas} landings nuevas.` : 'No hay landings nuevas que generar.', 'ok');
    return ctx.redirigir('/admin/landings');
  });

  router.post('/admin/landings/:id/alternar', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;
    if (!exigirCsrf(ctx)) return;

    const id = entero(ctx.params.id, 0);
    const l = id ? q.get('SELECT * FROM landings WHERE id=?', id) : null;
    if (!l) {
      flash(ctx.res, 'La landing no existe.', 'error');
      return ctx.redirigir('/admin/landings');
    }

    const nuevo = l.activa ? 0 : 1;
    q.run('UPDATE landings SET activa=? WHERE id=?', nuevo, id);
    auditar(ctx, 'landing_alternada', 'landing', id, `${l.slug}: ${nuevo ? 'activada' : 'desactivada'}`);
    flash(ctx.res, `Landing ${nuevo ? 'activada' : 'desactivada'}.`, 'ok');
    return ctx.redirigir('/admin/landings');
  });

  /* ================================================================== */
  /* Auditoría                                                           */
  /* ================================================================== */
  router.get('/admin/auditoria', async (ctx) => {
    if (!exigirRol(ctx, 'admin')) return;

    const accion = texto(ctx.query.accion);
    const pagina = Math.max(1, entero(ctx.query.pagina, 1));
    const porPagina = POR_PAGINA;

    const cond = [];
    const args = [];
    if (accion) { cond.push('a.accion = ?'); args.push(accion); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const total = q.get(`SELECT COUNT(*) AS n FROM auditoria a ${where}`, ...args).n;
    const filas = q.all(`SELECT a.*, u.nombre AS admin_nombre, u.apellidos AS admin_apellidos
      FROM auditoria a
      LEFT JOIN usuarios u ON u.id = a.admin_id
      ${where}
      ORDER BY a.creado_en DESC, a.id DESC
      LIMIT ? OFFSET ?`, ...args, porPagina, (pagina - 1) * porPagina);

    const acciones = q.all('SELECT DISTINCT accion FROM auditoria ORDER BY accion').map(r => r.accion);

    const filtros = bloqueFiltros('/admin/auditoria', `
      ${filtroSelect('accion', 'Acción', [{ valor: '', texto: 'Todas' }, ...acciones.map(a => ({ valor: a, texto: a }))], accion)}
    `);

    const cuerpo = filas.length ? filas.map(a => `<tr>
        <td class="mono">${esc(fechaCorta(a.creado_en))} ${esc(a.creado_en ? String(a.creado_en).slice(11, 16) : '')}</td>
        <td><span class="etiqueta">${esc(a.accion)}</span></td>
        <td>${esc(a.entidad || '—')}${a.entidad_id ? html` <span class="mono">#${esc(a.entidad_id)}</span>` : ''}</td>
        <td>${a.admin_id ? html`<a href="/admin/usuarios/${a.admin_id}">${esc((a.admin_nombre || '') + ' ' + (a.admin_apellidos || ''))}</a>` : '<span class="muted">sistema</span>'}</td>
        <td>${esc(a.detalle || '—')}</td>
      </tr>`).join('')
      : '<tr><td colspan="5" class="vacio">No hay registros de auditoría para este filtro.</td></tr>';

    const tabla = `<div class="table-wrap"><table class="tabla">
      <thead><tr><th>Fecha</th><th>Acción</th><th>Entidad</th><th>Administrador</th><th>Detalle</th></tr></thead>
      <tbody>${cuerpo}</tbody></table></div>`;

    const params = { accion };
    const contenido = html`
      ${raw(filtros)}
      <div class="panel">
        <div class="panel-head"><h3>Registro de auditoría (${total})</h3></div>
        ${raw(tabla)}
        ${raw(paginacion('/admin/auditoria', params, pagina, total, porPagina))}
      </div>`;

    return panel(ctx, {
      titulo: 'Auditoría',
      subtitulo: `${total} acciones registradas`,
      contenido
    });
  });

}
