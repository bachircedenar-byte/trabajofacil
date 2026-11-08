/* ==========================================================================
   TrabajoFácil — módulo del profesional
   Panel, perfil, verificación de identidad, disponibilidad, ofertas,
   presupuestos, mensajes, monedero (ingresos) y ranking.
   Sin dependencias npm: solo módulos nativos de Node.
   ========================================================================== */
import { randomUUID } from 'node:crypto';
import { mkdir, rename } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { q, ahora } from './db.mjs';
import {
  html, raw, esc, fmtEuros, fmtEurosCorto, fechaCorta, tiempoRelativo,
  estrellas, TAREAS_ESTADO, PRESU_ESTADO, VERIF_ESTADO,
  layout, badgeCategoria
} from './vistas.mjs';
import { flash, exigirRol, exigirCsrf } from './auth.mjs';
import {
  PAQUETES, TOKENS_PRESUPUESTO, TOKENS_REEMBOLSO,
  saldoTokens, eurosDeTokens, movimientosTokens,
  comprarTokens, gastarTokens, reembolsarTokens
} from './tokens.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_CONTENIDO = join(RAIZ, 'contenido');

/* ------------------------------------------------------------------ */
/* Utilidades                                                         */
/* ------------------------------------------------------------------ */

/** Marca un fragmento ya construido como HTML seguro para el tagged template. */
const R = s => raw(s == null ? '' : String(s));

/** Estilo inline con color escapado (colores propios de las constantes). */
const bg = color => R(`background:${esc(color)}`);

/** Normaliza un valor de formulario (string o array) a lista de cadenas. */
function lista(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  const s = String(v).trim();
  return s ? [s] : [];
}

/** Normaliza un checkbox (puede llegar como string o array). */
function marcado(v) {
  return lista(v).some(x => ['1', 'true', 'on', 'si', 'sí', 'yes'].includes(x.toLowerCase()));
}

/** Número a partir de un valor de formulario (acepta coma decimal). */
function num(v, def = 0) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return def;
  const n = Number(s);
  return Number.isFinite(n) ? n : def;
}

/** Texto limpio y acotado. */
function texto(v, max = 1000) {
  return String(v ?? '').trim().slice(0, max);
}

/** Recorta un texto largo para las tarjetas. */
function recorte(s, max = 220) {
  const t = String(s || '').trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
}

/** Categorías del profesional (JSON array de ids) como lista de enteros. */
function catsDe(p) {
  if (!p) return [];
  try {
    const a = JSON.parse(p.categorias || '[]');
    if (!Array.isArray(a)) return [];
    return [...new Set(a.map(Number).filter(n => Number.isInteger(n) && n > 0))];
  } catch { return []; }
}

/** Distancia aproximada en km entre dos puntos (fórmula de haversine). */
function distanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = x => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Perfil profesional del usuario (o valores por defecto si aún no existe). */
function perfilDe(u) {
  const p = q.get('SELECT * FROM profesionales WHERE usuario_id=?', u.id);
  if (p) return p;
  return {
    usuario_id: u.id, titularidad: 'autonomo', nif: '', precio_hora: 0, categorias: '[]',
    estado_verificacion: 'pendiente', documento_tipo: '', documento_numero: '',
    documento_frente: '', documento_reverso: '', selfie: '', verificado_en: null,
    revisado_por: null, desde: '', disponible: 1, radio_km: 10, notas: '', formado_en: null
  };
}

/** Guarda un fichero subido y devuelve su ruta relativa a /contenido. */
async function guardarArchivo(archivo, subcarpeta) {
  const dir = join(DIR_CONTENIDO, subcarpeta);
  await mkdir(dir, { recursive: true });
  const ext = extname(archivo.nombreGuardado).toLowerCase();
  const base = basename(archivo.nombreGuardado, ext).replace(/[^\w\-]/g, '_').slice(0, 40) || 'fichero';
  const destino = join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}-${base}${ext}`);
  await rename(archivo.ruta, destino);
  return `${subcarpeta}/${basename(destino)}`;
}

/** Busca un fichero subido por el nombre del campo. */
function archivoDe(ctx, campo) {
  return (ctx.archivos || []).find(a => a.campo === campo) || null;
}

/* ------------------------------------------------------------------ */
/* Estructura del panel                                               */
/* ------------------------------------------------------------------ */

const NAV_PRO = [
  ['/profesional', 'Mi panel', 'panel'],
  ['/profesional/ofertas', 'Ofertas de trabajo', 'ofertas'],
  ['/profesional/presupuestos', 'Mis presupuestos', 'presupuestos'],
  ['/profesional/mensajes', 'Mensajes', 'mensajes'],
  ['/profesional/ingresos', 'Ingresos', 'ingresos'],
  ['/profesional/tokens', 'Tokens', 'tokens'],
  ['/profesional/ranking', 'Ranking', 'ranking'],
  ['/profesional/perfil', 'Mi perfil', 'perfil'],
  ['/profesional/verificacion', 'Verificación', 'verificacion'],
  ['/profesional/disponibilidad', 'Disponibilidad', 'disponibilidad']
];

/** Envuelve el contenido en la maqueta del panel del profesional. */
function shell(ctx, { titulo, subtitulo = '', activo = '', contenido }) {
  const u = ctx.usuario;
  const saldo = saldoTokens(u.id);
  const enlaces = NAV_PRO
    .map(([href, txt, key]) => html`<a class="sidebar-link${key === activo ? ' activo' : ''}" href="${href}">${txt}</a>`)
    .join('');

  const cuerpo = html`
    <div class="app-shell">
      <nav class="sidebar">
        <div class="sidebar-cab">
          <b>Panel profesional</b>
          <span class="muted">${u.nombre} ${u.apellidos || ''}</span>
          <a class="muted" href="/profesional/tokens">${saldo} tokens · ${fmtEuros(eurosDeTokens(saldo))}</a>
        </div>
        ${R(enlaces)}
        <div class="acciones">
          <a class="btn btn-hollow btn-sm" href="/tareas-publicas">Ver tareas públicas</a>
        </div>
      </nav>
      <main class="app-main">
        <div class="panel-head">
          <div>
            <h1>${titulo}</h1>
            ${subtitulo ? R(html`<p class="muted">${subtitulo}</p>`) : ''}
          </div>
          <div class="acciones">
            <a class="btn btn-hollow btn-sm" href="/profesional/perfil">Editar perfil</a>
            <a class="btn btn-sm" href="/profesional/ofertas">Buscar tareas</a>
          </div>
        </div>
        ${R(contenido)}
      </main>
    </div>`;

  return layout({
    titulo,
    descripcion: 'Panel del profesional en TrabajoFácil: ofertas, presupuestos, mensajes e ingresos.',
    usuario: u,
    ruta: ctx.ruta,
    contenido: cuerpo,
    flash: ctx.flash
  });
}

/** Pastilla de estado con el color de las constantes de vistas.mjs. */
function pastilla(estado, mapa) {
  const e = mapa[estado] || { txt: estado || '—', color: '#777' };
  return html`<span class="pill-estado" style="${bg(e.color)}">${e.txt}</span>`;
}

/** Fila de KPI del panel. */
function kpi(valor, etiqueta) {
  return html`<div class="stat"><div class="valor">${valor}</div><div class="etiqueta">${etiqueta}</div></div>`;
}

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */

/** Tareas publicadas que encajan con las categorías (y opcionalmente ciudad). */
function tareasQueEncajan(u, cats, { soloCategoria = null, soloCiudad = null, soloMiCiudad = false, limite = 40 } = {}) {
  const cond = ["t.estado = 'publicada'", 't.cliente_id != ?'];
  const params = [u.id];
  if (cats.length) {
    cond.push(`t.categoria_id IN (${cats.map(() => '?').join(',')})`);
    params.push(...cats);
  }
  if (soloCategoria) { cond.push('t.categoria_id = ?'); params.push(soloCategoria); }
  if (soloCiudad) { cond.push('t.ciudad_id = ?'); params.push(soloCiudad); }
  else if (soloMiCiudad && u.ciudad_id) { cond.push('t.ciudad_id = ?'); params.push(u.ciudad_id); }
  const sql = `SELECT t.*, c.nombre AS categoria_nombre, c.code AS categoria_code,
      c.color AS categoria_color, c.precio_medio AS categoria_precio_medio,
      ci.nombre AS ciudad_nombre
    FROM tareas t
    LEFT JOIN categorias c ON c.id = t.categoria_id
    LEFT JOIN ciudades ci ON ci.id = t.ciudad_id
    WHERE ${cond.join(' AND ')}
    ORDER BY t.publicada_en DESC, t.id DESC
    LIMIT ?`;
  params.push(limite);
  return q.all(sql, ...params);
}

/** Distancia de una tarea al profesional (null si no hay coordenadas). */
function distanciaDe(u, t) {
  if (u.lat == null || u.lng == null || t.lat == null || t.lng == null) return null;
  return Math.round(distanciaKm(u.lat, u.lng, t.lat, t.lng));
}

/** Formulario en línea para enviar un presupuesto. */
function formPresupuesto(ctx, t) {
  const id = `p${t.id}`;
  const precio = Number(t.categoria_precio_medio || 0) || 0;
  return html`
    <form method="post" action="/tareas/${t.id}/presupuesto" class="form-grid">
      <input type="hidden" name="csrf" value="${ctx.csrf}">
      <div class="campo">
        <label for="${id}_precio">Precio total (€)</label>
        <input type="number" id="${id}_precio" name="precio" step="0.01" min="1" value="${precio || ''}" required>
      </div>
      <div class="campo">
        <label for="${id}_horas">Horas estimadas</label>
        <input type="number" id="${id}_horas" name="horas" step="0.5" min="0.5" value="${t.horas || 1}">
      </div>
      <div class="campo">
        <label for="${id}_mensaje">Mensaje para el cliente</label>
        <input type="text" id="${id}_mensaje" name="mensaje" maxlength="500" placeholder="Hola, puedo ayudarte el día acordado.">
      </div>
      <div class="acciones">
        <button class="btn btn-sm" type="submit">Enviar presupuesto</button>
      </div>
    </form>`;
}

/** Tarjeta de una tarea ofertada. */
function tarjetaOferta(ctx, t, { yaPresupuestada = false, distancia = null, radioKm = 10 } = {}) {
  const est = TAREAS_ESTADO[t.estado] || TAREAS_ESTADO.publicada;
  const fuera = distancia !== null && distancia > radioKm;
  const meta = [t.categoria_nombre || 'Sin categoría', t.ciudad_nombre || 'Sin ciudad'];
  if (t.fecha) meta.push(fechaCorta(t.fecha));
  if (distancia !== null) meta.push(`a ${distancia} km${fuera ? ' (fuera de tu radio)' : ''}`);

  /* foto del trabajo adjunta por el cliente */
  const fotos = fotosDeTarea(t.id);
  const bloqueFoto = fotos.length
    ? html`
      <a href="${fotos[0]}" target="_blank" rel="noopener" title="Ver la foto del trabajo en grande">
        <img src="${fotos[0]}" alt="Foto del trabajo a realizar"
             style="width:150px;height:112px;object-fit:cover;border-radius:8px;border:1px solid var(--borde)">
      </a>`
    : '';

  /* insignia de cliente verificado */
  const verificado = clienteVerificado(t.cliente_id);

  /* coste de enviar el presupuesto y saldo actual */
  const saldo = saldoTokens(ctx.usuario.id);

  return html`
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>${t.titulo}</h3>
          <p class="muted">${meta.join(' · ')}</p>
        </div>
        <div class="row-actions">
          ${verificado ? R(html`<span class="pill-estado" style="${bg('#2ea378')}">Cliente verificado</span>`) : ''}
          ${R(pastilla(t.estado, TAREAS_ESTADO))}
          ${t.categoria_color ? R(html`<span class="badge-cat" style="${bg(t.categoria_color)}">${t.categoria_code || ''}</span>`) : ''}
        </div>
      </div>
      ${R(bloqueFoto)}
      <p>${recorte(t.descripcion)}</p>
      <div class="acciones">
        ${yaPresupuestada
          ? R(html`<span class="pill-estado" style="${bg('#777')}">Ya has presupuestado esta tarea</span>
                   <a class="btn btn-hollow btn-sm" href="/profesional/presupuestos">Ver mis presupuestos</a>`)
          : R(formPresupuesto(ctx, t))}
      </div>
      <p class="pista">Enviar un presupuesto cuesta ${TOKENS_PRESUPUESTO} tokens (${fmtEuros(eurosDeTokens(TOKENS_PRESUPUESTO))}). Si el cliente no lo acepta, te devolvemos ${TOKENS_REEMBOLSO}.</p>
      <p class="pista">Tu saldo actual: <a href="/profesional/tokens">${saldo} tokens (${fmtEuros(eurosDeTokens(saldo))})</a></p>
    </div>`;
}

/** ¿El usuario participa en esta tarea (cliente, profesional o con mensajes)? */
function participaEnTarea(u, tareaId) {
  const t = q.get('SELECT * FROM tareas WHERE id=?', tareaId);
  if (!t) return null;
  if (t.cliente_id === u.id || t.profesional_id === u.id) return t;
  const m = q.get('SELECT COUNT(*) AS n FROM mensajes WHERE tarea_id=? AND (emisor_id=? OR destinatario_id=?)', tareaId, u.id, u.id);
  return m.n > 0 ? t : null;
}

/** Interlocutor de un hilo. */
function destinatarioDe(u, tarea, tareaId) {
  if (tarea.cliente_id && tarea.cliente_id !== u.id) return tarea.cliente_id;
  if (tarea.profesional_id && tarea.profesional_id !== u.id) return tarea.profesional_id;
  const m = q.get('SELECT emisor_id,destinatario_id FROM mensajes WHERE tarea_id=? ORDER BY creado_en DESC, id DESC LIMIT 1', tareaId);
  if (!m) return null;
  return m.emisor_id === u.id ? m.destinatario_id : m.emisor_id;
}

/** Fotos del trabajo adjuntas por el cliente (array de URLs). */
function fotosDeTarea(tareaId) {
  const ex = q.get('SELECT fotos FROM tarea_extra WHERE tarea_id=?', tareaId);
  if (!ex || !ex.fotos) return [];
  try {
    const a = JSON.parse(ex.fotos);
    return Array.isArray(a) ? a.filter(x => typeof x === 'string' && x) : [];
  } catch { return []; }
}

/** ¿El cliente de la tarea tiene la identidad verificada? */
function clienteVerificado(clienteId) {
  if (!clienteId) return false;
  const v = q.get('SELECT estado FROM verificaciones WHERE usuario_id=?', clienteId);
  return !!v && v.estado === 'aprobado';
}

/** Texto legible del tipo de movimiento de tokens. */
function tipoMovTokens(tipo) {
  return {
    compra: 'Compra',
    presupuesto: 'Presupuesto',
    reembolso: 'Devolución'
  }[tipo] || 'Movimiento';
}

/** Cantidad de tokens con signo (+100, −10, +5). */
function cantidadConSigno(n) {
  const v = Number(n || 0);
  if (v > 0) return `+${v}`;
  if (v < 0) return `−${Math.abs(v)}`;
  return '0';
}

/* ================================================================== */
/* Registro de rutas                                                  */
/* ================================================================== */

export function registrarProfesional(router) {

  /* ---------------------------------------------------------------- */
  /* GET /profesional — panel del profesional                          */
  /* ---------------------------------------------------------------- */
  router.get('/profesional', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    const u = ctx.usuario;
    const p = perfilDe(u);
    const cats = catsDe(p);
    const verificado = p.estado_verificacion === 'aprobado';

    const kpis = {
      enviados: q.get("SELECT COUNT(*) AS n FROM presupuestos WHERE profesional_id=? AND estado='enviado'", u.id).n,
      aceptados: q.get("SELECT COUNT(*) AS n FROM presupuestos WHERE profesional_id=? AND estado='aceptado'", u.id).n,
      ingresos: q.get("SELECT COALESCE(SUM(monto),0) AS s FROM transacciones WHERE usuario_id=? AND tipo='pago_profesional' AND estado='completada'", u.id).s,
      enCurso: q.get("SELECT COUNT(*) AS n FROM tareas WHERE profesional_id=? AND estado='en_curso'", u.id).n
    };

    /* tareas que encajan: mis categorías + mi ciudad */
    const encajan = tareasQueEncajan(u, cats, { soloMiCiudad: true, limite: 5 });
    const misPresupuestos = new Map(
      q.all('SELECT tarea_id, estado FROM presupuestos WHERE profesional_id=?', u.id)
        .map(r => [r.tarea_id, r.estado])
    );

    const ultimos = q.all(`
      SELECT pr.*, t.titulo AS tarea_titulo, cl.nombre AS cliente_nombre, cl.apellidos AS cliente_apellidos
      FROM presupuestos pr
      JOIN tareas t ON t.id = pr.tarea_id
      LEFT JOIN usuarios cl ON cl.id = t.cliente_id
      WHERE pr.profesional_id = ?
      ORDER BY pr.creado_en DESC, pr.id DESC
      LIMIT 6`, u.id);

    /* --- aviso de verificación --- */
    let avisoVerif;
    if (p.estado_verificacion === 'pendiente') {
      avisoVerif = html`
        <div class="alert-box">
          <b>Tu identidad está pendiente de verificación.</b>
          <p class="muted">Mientras no verifiquemos tu identidad no puedes enviar presupuestos ni cobrar tus trabajos.
            Sube tu DNI o NIE y un selfie: la revisión tarda menos de 24 horas.</p>
          <a class="btn btn-sm" href="/profesional/verificacion">Verificar mi identidad</a>
        </div>`;
    } else if (p.estado_verificacion === 'rechazado') {
      avisoVerif = html`
        <div class="alert-box">
          <b>No hemos podido verificar tu identidad.</b>
          <p class="muted">${p.notas || 'Revisa que las fotos se vean bien y vuelve a subir la documentación.'}</p>
          <a class="btn btn-sm" href="/profesional/verificacion">Reenviar documentación</a>
        </div>`;
    } else {
      avisoVerif = html`
        <div class="nota-ok">
          <b>Identidad verificada.</b> Ya puedes enviar presupuestos y cerrar trabajos en TrabajoFácil.
        </div>`;
    }

    /* --- KPIs --- */
    const bloqueKpis = html`
      <div class="stats">
        ${R(kpi(kpis.enviados, 'Presupuestos enviados'))}
        ${R(kpi(kpis.aceptados, 'Presupuestos aceptados'))}
        ${R(kpi(fmtEurosCorto(kpis.ingresos), 'Ingresos acumulados'))}
        ${R(kpi(kpis.enCurso, 'Tareas en curso'))}
      </div>`;

    /* --- tareas que encajan --- */
    let bloqueEncajan;
    if (!cats.length) {
      bloqueEncajan = html`
        <div class="vacio">
          <p><b>Todavía no tienes categorías seleccionadas.</b></p>
          <p class="muted">Indica los servicios que ofreces para que te mostremos las tareas que te encajan.</p>
          <a class="btn btn-sm" href="/profesional/perfil">Configurar mis categorías</a>
        </div>`;
    } else if (!encajan.length) {
      bloqueEncajan = html`
        <div class="vacio">
          <p><b>Ahora mismo no hay tareas nuevas en tu ciudad con tus servicios.</b></p>
          <p class="muted">Amplía tu radio de acción o revisa todas las ofertas disponibles.</p>
          <a class="btn btn-sm" href="/profesional/ofertas">Ver todas las ofertas</a>
        </div>`;
    } else {
      bloqueEncajan = encajan.map(t => tarjetaOferta(ctx, t, {
        yaPresupuestada: misPresupuestos.has(t.id),
        distancia: distanciaDe(u, t),
        radioKm: Number(p.radio_km) || 10
      })).join('');
    }

    /* --- últimos presupuestos --- */
    const bloqueUltimos = ultimos.length
      ? html`
        <div class="table-wrap">
          <table class="tabla">
            <thead><tr><th>Tarea</th><th>Cliente</th><th>Precio</th><th>Estado</th><th>Enviado</th></tr></thead>
            <tbody>
              ${R(ultimos.map(r => html`
                <tr>
                  <td>${r.tarea_titulo}</td>
                  <td>${r.cliente_nombre || ''} ${r.cliente_apellidos || ''}</td>
                  <td class="mono">${fmtEurosCorto(r.precio)}</td>
                  <td>${R(pastilla(r.estado, PRESU_ESTADO))}</td>
                  <td class="muted">${tiempoRelativo(r.creado_en)}</td>
                </tr>`).join(''))}
            </tbody>
          </table>
        </div>`
      : html`<div class="vacio"><p>Todavía no has enviado ningún presupuesto.</p>
               <a class="btn btn-sm" href="/profesional/ofertas">Buscar tareas</a></div>`;

    const contenido = html`
      ${R(avisoVerif)}
      ${R(bloqueKpis)}
      <section class="panel">
        <div class="panel-head">
          <h3>Tareas que encajan contigo</h3>
          <a class="btn btn-hollow btn-sm" href="/profesional/ofertas">Ver todas</a>
        </div>
        ${R(bloqueEncajan)}
      </section>
      <section class="panel">
        <div class="panel-head">
          <h3>Mis últimos presupuestos</h3>
          <a class="btn btn-hollow btn-sm" href="/profesional/presupuestos">Ver todos</a>
        </div>
        ${R(bloqueUltimos)}
      </section>`;

    return shell(ctx, {
      titulo: 'Mi panel',
      subtitulo: verificado
        ? 'Estas son tus tareas, presupuestos e ingresos.'
        : 'Completa la verificación para empezar a enviar presupuestos.',
      activo: 'panel',
      contenido
    });
  });

  /* ---------------------------------------------------------------- */
  /* GET /profesional/perfil — formulario de perfil                    */
  /* ---------------------------------------------------------------- */
  router.get('/profesional/perfil', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    const u = ctx.usuario;
    const p = perfilDe(u);
    const misCats = new Set(catsDe(p));
    const cats = q.all('SELECT id,nombre,code,color FROM categorias WHERE activa=1 ORDER BY nombre');

    const bloqueCategorias = cats.map(c => html`
      <label class="check">
        <input type="checkbox" name="categorias" value="${c.id}"${misCats.has(c.id) ? ' checked' : ''}>
        ${R(badgeCategoria(c))}
      </label>`).join('');

    const form = html`
      <form method="post" action="/profesional/perfil" enctype="multipart/form-data">
        <input type="hidden" name="csrf" value="${ctx.csrf}">
        <section class="panel">
          <div class="panel-head"><h3>Datos personales</h3></div>
          <div class="form-grid">
            <div class="campo">
              <label for="perfil_foto">Foto de perfil</label>
              <input type="file" id="perfil_foto" name="foto" accept="image/*">
              <div class="pista">Opcional. Formato JPG o PNG. Si no subes una foto usaremos tu avatar actual.</div>
            </div>
            <div class="campo">
              <label for="perfil_nombre">Nombre <span class="req">*</span></label>
              <input type="text" id="perfil_nombre" name="nombre" value="${u.nombre || ''}" maxlength="80" required>
            </div>
            <div class="campo">
              <label for="perfil_apellidos">Apellidos</label>
              <input type="text" id="perfil_apellidos" name="apellidos" value="${u.apellidos || ''}" maxlength="80">
            </div>
            <div class="campo">
              <label for="perfil_telefono">Teléfono</label>
              <input type="text" id="perfil_telefono" name="telefono" value="${u.telefono || ''}" maxlength="30" placeholder="600 00 00 00">
            </div>
            <div class="campo">
              <label for="perfil_cp">Código postal</label>
              <input type="text" id="perfil_cp" name="cp" value="${u.cp || ''}" maxlength="10" placeholder="28001">
            </div>
            <div class="campo">
              <label for="perfil_bio">Sobre mí</label>
              <textarea id="perfil_bio" name="bio" maxlength="800" placeholder="Cuéntanos tu experiencia, los servicios que ofreces y tu zona de trabajo.">${u.bio || ''}</textarea>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>Datos fiscales</h3></div>
          <div class="form-grid">
            <div class="campo">
              <label for="perfil_titularidad">Titularidad</label>
              <select id="perfil_titularidad" name="titularidad">
                <option value="autonomo"${p.titularidad === 'autonomo' ? ' selected' : ''}>Autónomo/a (persona física)</option>
                <option value="empresa"${p.titularidad === 'empresa' ? ' selected' : ''}>Empresa (persona jurídica)</option>
              </select>
            </div>
            <div class="campo">
              <label for="perfil_nif">NIF / CIF</label>
              <input type="text" id="perfil_nif" name="nif" value="${p.nif || ''}" maxlength="20" placeholder="12345678Z">
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>Trabajo y disponibilidad</h3></div>
          <div class="form-grid">
            <div class="campo">
              <label for="perfil_precio">Precio por hora (€)</label>
              <input type="number" id="perfil_precio" name="precio_hora" step="0.5" min="0" value="${p.precio_hora || ''}" placeholder="15">
            </div>
            <div class="campo">
              <label for="perfil_radio">Radio de acción (km)</label>
              <input type="number" id="perfil_radio" name="radio_km" step="1" min="1" max="200" value="${p.radio_km || 10}" required>
            </div>
            <div class="campo">
              <label class="check">
                <input type="hidden" name="disponible" value="0">
                <input type="checkbox" name="disponible" value="1"${Number(p.disponible) ? ' checked' : ''}>
                <span>Estoy disponible para aceptar trabajos</span>
              </label>
              <div class="pista">Mientras no estés disponible no aparecerás entre los profesionales activos.</div>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>Servicios que ofrezco</h3></div>
          <div class="form-grid">
            ${R(bloqueCategorias)}
          </div>
          <div class="pista">Selecciona todas las categorías en las que puedes trabajar. Solo te mostraremos tareas de estos servicios.</div>
        </section>

        <div class="acciones">
          <button class="btn" type="submit">Guardar perfil</button>
          <a class="btn btn-hollow" href="/profesional">Cancelar</a>
        </div>
      </form>`;

    return shell(ctx, {
      titulo: 'Mi perfil',
      subtitulo: 'Estos datos son los que ven los clientes cuando les envías un presupuesto.',
      activo: 'perfil',
      contenido: form
    });
  });

  /* ---------------------------------------------------------------- */
  /* POST /profesional/perfil — guardar perfil                         */
  /* ---------------------------------------------------------------- */
  router.post('/profesional/perfil', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    if (!exigirCsrf(ctx)) return;
    const u = ctx.usuario;
    const b = ctx.body || {};

    const nombre = texto(b.nombre, 80);
    if (!nombre) {
      flash(ctx.res, 'Escribe tu nombre para poder guardar el perfil.', 'error');
      return { redirigir: '/profesional/perfil' };
    }
    const apellidos = texto(b.apellidos, 80);
    const telefono = texto(b.telefono, 30);
    const bio = texto(b.bio, 800);
    const cp = texto(b.cp, 10);
    if (cp && !/^\d{5}$/.test(cp)) {
      flash(ctx.res, 'El código postal debe tener 5 dígitos.', 'error');
      return { redirigir: '/profesional/perfil' };
    }
    const titularidad = texto(b.titularidad, 20) === 'empresa' ? 'empresa' : 'autonomo';
    const nif = texto(b.nif, 20);
    const precioHora = num(b.precio_hora, 0);
    if (precioHora < 0) {
      flash(ctx.res, 'El precio por hora no puede ser negativo.', 'error');
      return { redirigir: '/profesional/perfil' };
    }
    const radioKm = Math.round(num(b.radio_km, 10));
    if (!(radioKm >= 1 && radioKm <= 200)) {
      flash(ctx.res, 'El radio de acción debe estar entre 1 y 200 km.', 'error');
      return { redirigir: '/profesional/perfil' };
    }

    /* categorías válidas */
    const pedidas = lista(b.categorias).map(Number).filter(n => Number.isInteger(n) && n > 0);
    const validas = pedidas.length
      ? q.all(`SELECT id FROM categorias WHERE id IN (${pedidas.map(() => '?').join(',')})`, ...pedidas).map(c => c.id)
      : [];
    if (!validas.length) {
      flash(ctx.res, 'Selecciona al menos un servicio que ofrezcas.', 'error');
      return { redirigir: '/profesional/perfil' };
    }

    /* foto opcional */
    let avatar = u.avatar || '';
    const foto = archivoDe(ctx, 'foto');
    if (foto) {
      try {
        avatar = '/contenido/' + await guardarArchivo(foto, 'avatares');
      } catch (e) {
        console.error('No se pudo guardar la foto de perfil:', e);
        flash(ctx.res, 'No pudimos guardar tu foto. El resto de cambios sí se ha aplicado.', 'error');
      }
    }

    /* ubicación a partir del código postal */
    let ciudadId = u.ciudad_id ?? null;
    let lat = u.lat ?? null;
    let lng = u.lng ?? null;
    if (cp) {
      const c = q.get('SELECT * FROM codigos_postales WHERE cp=?', cp);
      if (c) {
        ciudadId = q.get('SELECT id FROM ciudades WHERE nombre=?', c.ciudad)?.id ?? ciudadId;
        lat = c.lat; lng = c.lng;
      }
    }

    q.run(
      `UPDATE usuarios SET nombre=?, apellidos=?, telefono=?, bio=?, cp=?, ciudad_id=?, lat=?, lng=?, avatar=?, actualizado_en=?
       WHERE id=?`,
      nombre, apellidos, telefono, bio, cp, ciudadId, lat, lng, avatar, ahora(), u.id
    );

    const p = perfilDe(u);
    if (!q.get('SELECT usuario_id FROM profesionales WHERE usuario_id=?', u.id)) {
      q.run(
        `INSERT INTO profesionales (usuario_id,titularidad,nif,precio_hora,categorias,estado_verificacion,disponible,radio_km,desde,formado_en)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        u.id, titularidad, nif, precioHora, JSON.stringify(validas), 'pendiente',
        marcado(b.disponible) ? 1 : 0, radioKm, ahora().slice(0, 10), ahora()
      );
    } else {
      q.run(
        `UPDATE profesionales SET titularidad=?, nif=?, precio_hora=?, categorias=?, disponible=?, radio_km=?
         WHERE usuario_id=?`,
        titularidad, nif, precioHora, JSON.stringify(validas), marcado(b.disponible) ? 1 : 0, radioKm, u.id
      );
    }

    flash(ctx.res, 'Perfil guardado correctamente.', 'ok');
    return { redirigir: '/profesional/perfil' };
  });

  /* ---------------------------------------------------------------- */
  /* GET /profesional/verificacion                                    */
  /* ---------------------------------------------------------------- */
  router.get('/profesional/verificacion', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    const u = ctx.usuario;
    const p = perfilDe(u);
    const estado = p.estado_verificacion || 'pendiente';

    const pasos = [
      { n: 1, t: 'Prepara tu DNI o NIE', d: 'Una foto nítida de la parte frontal y, si la tiene, del reverso. También puedes subir un PDF.' },
      { n: 2, t: 'Hazte un selfie', d: 'Una foto tuya con el documento al lado, de frente y con buena luz.' },
      { n: 3, t: 'Revisión en 24 h', d: 'Nuestro equipo comprueba los datos. Recibirás un aviso en cuanto esté todo correcto.' }
    ];
    const bloquePasos = pasos.map(s => html`
      <div class="tarjeta-paso">
        <span class="paso-pt ${estado === 'aprobado' ? 'hecho' : s.n === 1 ? 'actual' : ''}">${s.n}</span>
        <b>${s.t}</b>
        <p class="muted">${s.d}</p>
      </div>`).join('');

    let estadoHtml;
    if (estado === 'aprobado') {
      estadoHtml = html`
        <div class="nota-ok">
          <b>Identidad verificada.</b> Tu documentación fue revisada y aprobada${p.verificado_en ? ` el ${fechaCorta(p.verificado_en)}` : ''}.
          Puedes enviar presupuestos y cerrar trabajos.
        </div>`;
    } else if (estado === 'rechazado') {
      estadoHtml = html`
        <div class="alert-box">
          <b>No hemos podido verificar tu identidad.</b>
          <p class="muted">${p.notas || 'Las imágenes no se leían con suficiente claridad. Vuelve a subirlas.'}</p>
        </div>`;
    } else {
      estadoHtml = html`
        <div class="alert-box">
          <b>Verificación en curso.</b>
          <p class="muted">Hemos recibido tu documentación y está pendiente de revisión. Puedes volver a subirla si crees que hay algún error.</p>
        </div>`;
    }

    const docs = q.all('SELECT * FROM documentos WHERE usuario_id=? ORDER BY creado_en DESC LIMIT 8', u.id);
    const bloqueDocs = docs.length
      ? html`
        <div class="table-wrap">
          <table class="tabla">
            <thead><tr><th>Tipo</th><th>Archivo</th><th>Estado</th><th>Recibido</th></tr></thead>
            <tbody>
              ${R(docs.map(d => html`
                <tr>
                  <td>${d.tipo === 'identidad' ? 'Identidad' : d.tipo}</td>
                  <td class="muted">${d.archivo || '—'}</td>
                  <td>${R(pastilla(d.estado, { pendiente: VERIF_ESTADO.pendiente, aprobado: VERIF_ESTADO.aprobado, rechazado: VERIF_ESTADO.rechazado }))}</td>
                  <td class="muted">${fechaCorta(d.creado_en)}</td>
                </tr>`).join(''))}
            </tbody>
          </table>
        </div>`
      : html`<div class="vacio"><p>Todavía no has enviado ninguna documentación.</p></div>`;

    const form = html`
      <form method="post" action="/profesional/verificacion" enctype="multipart/form-data">
        <input type="hidden" name="csrf" value="${ctx.csrf}">
        <section class="panel">
          <div class="panel-head"><h3>Documentación de identidad</h3></div>
          <div class="form-grid">
            <div class="campo">
              <label for="verif_tipo">Tipo de documento</label>
              <select id="verif_tipo" name="documento_tipo" required>
                <option value="dni"${p.documento_tipo === 'dni' ? ' selected' : ''}>DNI</option>
                <option value="nie"${p.documento_tipo === 'nie' ? ' selected' : ''}>NIE</option>
              </select>
            </div>
            <div class="campo">
              <label for="verif_numero">Número de documento <span class="req">*</span></label>
              <input type="text" id="verif_numero" name="documento_numero" value="${p.documento_numero || ''}" maxlength="20" placeholder="12345678Z" required>
            </div>
            <div class="campo">
              <label for="verif_frente">Frontal del documento <span class="req">*</span></label>
              <input type="file" id="verif_frente" name="documento_frente" accept="image/*,application/pdf" required>
              <div class="pista">Foto o PDF del anverso de tu DNI o NIE.</div>
            </div>
            <div class="campo">
              <label for="verif_reverso">Reverso del documento</label>
              <input type="file" id="verif_reverso" name="documento_reverso" accept="image/*,application/pdf">
              <div class="pista">Opcional: el reverso del DNI.</div>
            </div>
            <div class="campo">
              <label for="verif_selfie">Selfie con el documento <span class="req">*</span></label>
              <input type="file" id="verif_selfie" name="selfie" accept="image/*" required>
              <div class="pista">Una foto tuya con el documento al lado, de frente y con buena luz.</div>
            </div>
          </div>
        </section>
        <div class="acciones">
          <button class="btn" type="submit">Enviar para revisión</button>
          <a class="btn btn-hollow" href="/profesional">Cancelar</a>
        </div>
      </form>`;

    const contenido = html`
      ${R(estadoHtml)}
      <section class="panel">
        <div class="panel-head"><h3>Cómo funciona la verificación</h3></div>
        <div class="form-grid">${R(bloquePasos)}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h3>Enviar mi documentación</h3></div>
        ${R(form)}
      </section>
      <section class="panel">
        <div class="panel-head"><h3>Documentación enviada</h3></div>
        ${R(bloqueDocs)}
      </section>`;

    return shell(ctx, {
      titulo: 'Verificación de identidad',
      subtitulo: 'Solo los profesionales verificados pueden enviar presupuestos.',
      activo: 'verificacion',
      contenido
    });
  });

  /* ---------------------------------------------------------------- */
  /* POST /profesional/verificacion                                   */
  /* ---------------------------------------------------------------- */
  router.post('/profesional/verificacion', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    if (!exigirCsrf(ctx)) return;
    const u = ctx.usuario;
    const b = ctx.body || {};

    const tipo = texto(b.documento_tipo, 10).toLowerCase();
    if (!['dni', 'nie'].includes(tipo)) {
      flash(ctx.res, 'Indica si tu documento es un DNI o un NIE.', 'error');
      return { redirigir: '/profesional/verificacion' };
    }
    const numero = texto(b.documento_numero, 20).toUpperCase();
    if (numero.length < 5) {
      flash(ctx.res, 'Escribe el número de tu documento de identidad.', 'error');
      return { redirigir: '/profesional/verificacion' };
    }

    const frente = archivoDe(ctx, 'documento_frente');
    const reverso = archivoDe(ctx, 'documento_reverso');
    const selfie = archivoDe(ctx, 'selfie');
    if (!frente) {
      flash(ctx.res, 'Sube la parte frontal de tu documento.', 'error');
      return { redirigir: '/profesional/verificacion' };
    }
    if (!selfie) {
      flash(ctx.res, 'Sube un selfie con el documento al lado.', 'error');
      return { redirigir: '/profesional/verificacion' };
    }

    let rutaFrente, rutaReverso, rutaSelfie;
    try {
      rutaFrente = await guardarArchivo(frente, 'documentos');
      rutaReverso = reverso ? await guardarArchivo(reverso, 'documentos') : '';
      rutaSelfie = await guardarArchivo(selfie, 'documentos');
    } catch (e) {
      console.error('No se pudieron guardar los documentos:', e);
      flash(ctx.res, 'No pudimos guardar tus ficheros. Inténtalo de nuevo.', 'error');
      return { redirigir: '/profesional/verificacion' };
    }

    const existe = q.get('SELECT usuario_id FROM profesionales WHERE usuario_id=?', u.id);
    if (!existe) {
      q.run(
        `INSERT INTO profesionales (usuario_id,titularidad,nif,precio_hora,categorias,estado_verificacion,disponible,radio_km,desde,formado_en)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        u.id, 'autonomo', '', 0, '[]', 'pendiente', 1, 10, ahora().slice(0, 10), ahora()
      );
    }
    q.run(
      `UPDATE profesionales SET documento_tipo=?, documento_numero=?, documento_frente=?, documento_reverso=?,
         selfie=?, estado_verificacion='pendiente', verificado_en=NULL, revisado_por=NULL
       WHERE usuario_id=?`,
      tipo, numero, rutaFrente, rutaReverso, rutaSelfie, u.id
    );

    /* registro de la documentación enviada */
    q.run(
      `INSERT INTO documentos (usuario_id,tipo,archivo,estado,creado_en) VALUES (?,?,?,?,?)`,
      u.id, 'identidad', rutaFrente, 'pendiente', ahora()
    );

    /* aviso al equipo de administración */
    const admin = q.get("SELECT id FROM usuarios WHERE rol='admin' ORDER BY id LIMIT 1");
    if (admin) {
      q.run(
        `INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,0,?)`,
        admin.id, 'verificacion', 'Nueva verificación de identidad pendiente',
        `${u.nombre} ${u.apellidos || ''} (${u.email}) ha enviado su ${tipo.toUpperCase()} ${numero}. Revisa los ficheros subidos.`,
        'web', ahora()
      );
    } else {
      q.run(
        `INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,0,?)`,
        u.id, 'verificacion', 'Documentación enviada',
        'Hemos recibido tu documentación. En cuanto haya un revisor disponible se validará tu identidad.',
        'web', ahora()
      );
    }

    flash(ctx.res, 'Documentación enviada. Tu verificación está en revisión.', 'ok');
    return { redirigir: '/profesional/verificacion' };
  });

  /* ---------------------------------------------------------------- */
  /* GET /profesional/disponibilidad                                   */
  /* ---------------------------------------------------------------- */
  router.get('/profesional/disponibilidad', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    const u = ctx.usuario;
    const p = perfilDe(u);
    const disponible = Number(p.disponible) === 1;

    const form = html`
      <form method="post" action="/profesional/disponibilidad">
        <input type="hidden" name="csrf" value="${ctx.csrf}">
        <section class="panel">
          <div class="panel-head"><h3>Estado de disponibilidad</h3></div>
          <div class="form-grid">
            <div class="campo">
              <label class="check">
                <input type="hidden" name="disponible" value="0">
                <input type="checkbox" name="disponible" value="1"${disponible ? ' checked' : ''}>
                <span>Estoy disponible para aceptar trabajos</span>
              </label>
              <div class="pista">Si te desmarcas, los clientes dejarán de verte como disponible, aunque puedes seguir presupuestando.</div>
            </div>
            <div class="campo">
              <label for="disp_radio">Radio de acción (km)</label>
              <input type="number" id="disp_radio" name="radio_km" step="1" min="1" max="200" value="${p.radio_km || 10}" required>
              <div class="pista">Distancia máxima a la que te desplazas para trabajar, entre 1 y 200 km.</div>
            </div>
          </div>
        </section>
        <div class="acciones">
          <button class="btn" type="submit">Guardar cambios</button>
          <a class="btn btn-hollow" href="/profesional">Volver al panel</a>
        </div>
      </form>`;

    const resumen = html`
      <div class="resumen">
        <dl>
          <dt>Estado</dt><dd>${disponible ? 'Disponible' : 'No disponible'}</dd>
          <dt>Radio de acción</dt><dd>${p.radio_km || 10} km</dd>
          <dt>Ciudad</dt><dd>${u.ciudad_nombre || 'Sin ciudad indicada'}</dd>
          <dt>Precio por hora</dt><dd>${p.precio_hora ? fmtEurosCorto(p.precio_hora) + '/h' : 'Sin fijar'}</dd>
        </dl>
      </div>`;

    const contenido = html`
      ${R(resumen)}
      ${R(form)}
      <section class="panel">
        <div class="panel-head"><h3>Consejo</h3></div>
        <p class="muted">Ampliar tu radio de acción te muestra más tareas, pero los clientes suelen necesitar profesionales cercanos.
        Un radio de entre 10 y 20 km funciona bien en la mayoría de ciudades.</p>
      </section>`;

    return shell(ctx, {
      titulo: 'Disponibilidad',
      subtitulo: 'Decide cuándo puedes aceptar trabajos y hasta dónde te desplazas.',
      activo: 'disponibilidad',
      contenido
    });
  });

  /* ---------------------------------------------------------------- */
  /* POST /profesional/disponibilidad                                  */
  /* ---------------------------------------------------------------- */
  router.post('/profesional/disponibilidad', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    if (!exigirCsrf(ctx)) return;
    const u = ctx.usuario;
    const b = ctx.body || {};

    const radioKm = Math.round(num(b.radio_km, 10));
    if (!(radioKm >= 1 && radioKm <= 200)) {
      flash(ctx.res, 'El radio de acción debe estar entre 1 y 200 km.', 'error');
      return { redirigir: '/profesional/disponibilidad' };
    }
    const disponible = marcado(b.disponible) ? 1 : 0;

    if (!q.get('SELECT usuario_id FROM profesionales WHERE usuario_id=?', u.id)) {
      q.run(
        `INSERT INTO profesionales (usuario_id,titularidad,nif,precio_hora,categorias,estado_verificacion,disponible,radio_km,desde,formado_en)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        u.id, 'autonomo', '', 0, '[]', 'pendiente', disponible, radioKm, ahora().slice(0, 10), ahora()
      );
    } else {
      q.run('UPDATE profesionales SET disponible=?, radio_km=? WHERE usuario_id=?', disponible, radioKm, u.id);
    }

    flash(ctx.res, disponible ? 'Ya estás disponible para recibir tareas.' : 'Has marcado tu perfil como no disponible.', 'ok');
    return { redirigir: '/profesional/disponibilidad' };
  });

  /* ---------------------------------------------------------------- */
  /* GET /profesional/ofertas                                          */
  /* ---------------------------------------------------------------- */
  router.get('/profesional/ofertas', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    const u = ctx.usuario;
    const p = perfilDe(u);
    const cats = catsDe(p);
    const radioKm = Number(p.radio_km) || 10;

    /* filtros */
    const categoriasTodas = q.all('SELECT id,nombre FROM categorias WHERE activa=1 ORDER BY nombre');
    const ciudadesTodas = q.all('SELECT id,nombre FROM ciudades WHERE activa=1 ORDER BY nombre');

    let catFiltro = null;
    const qCat = texto(ctx.query.categoria, 40);
    if (qCat) {
      if (/^\d+$/.test(qCat)) catFiltro = Number(qCat);
      else {
        const c = q.get('SELECT id FROM categorias WHERE slug=?', qCat);
        catFiltro = c ? c.id : -1;
      }
    }
    let ciudadFiltro = null;
    let soloMiCiudad = false;
    const qCiudad = texto(ctx.query.ciudad, 40);
    if (qCiudad === 'mia') {
      soloMiCiudad = true;
      if (u.ciudad_id) ciudadFiltro = u.ciudad_id;
    } else if (qCiudad) {
      if (/^\d+$/.test(qCiudad)) ciudadFiltro = Number(qCiudad);
      else {
        const c = q.get('SELECT id FROM ciudades WHERE slug=?', qCiudad);
        ciudadFiltro = c ? c.id : -1;
      }
    }

    const ofertas = tareasQueEncajan(u, cats, {
      soloCategoria: catFiltro, soloCiudad: ciudadFiltro, soloMiCiudad, limite: 40
    }).map(t => ({ ...t, distancia: distanciaDe(u, t) }));

    ofertas.sort((a, b) => {
      if (a.distancia !== null && b.distancia !== null) return a.distancia - b.distancia;
      if (a.distancia === null) return 1;
      if (b.distancia === null) return -1;
      return 0;
    });

    const misPresupuestos = new Map(
      q.all('SELECT tarea_id, estado FROM presupuestos WHERE profesional_id=?', u.id)
        .map(r => [r.tarea_id, r.estado])
    );

    const filtros = html`
      <form class="filtros" method="get" action="/profesional/ofertas">
        <div class="chips">
          <label class="campo">
            <span>Categoría</span>
            <select name="categoria">
              <option value="">Todas las categorías</option>
              ${R(categoriasTodas.map(c => html`<option value="${c.id}"${catFiltro === c.id ? ' selected' : ''}>${c.nombre}</option>`).join(''))}
            </select>
          </label>
          <label class="campo">
            <span>Ciudad</span>
            <select name="ciudad">
              <option value="">Todas las ciudades</option>
              <option value="mia"${soloMiCiudad ? ' selected' : ''}>Mi ciudad</option>
              ${R(ciudadesTodas.map(c => html`<option value="${c.id}"${ciudadFiltro === c.id ? ' selected' : ''}>${c.nombre}</option>`).join(''))}
            </select>
          </label>
          <button class="btn btn-sm" type="submit">Filtrar</button>
          <a class="btn btn-hollow btn-sm" href="/profesional/ofertas">Limpiar filtros</a>
        </div>
      </form>`;

    let listaOfertas;
    if (!cats.length) {
      listaOfertas = html`
        <div class="vacio">
          <p><b>Sin categorías seleccionadas.</b></p>
          <p class="muted">Configura los servicios que ofreces para que te mostremos ofertas.</p>
          <a class="btn btn-sm" href="/profesional/perfil">Configurar mis categorías</a>
        </div>`;
    } else if (!ofertas.length) {
      listaOfertas = html`
        <div class="vacio">
          <p><b>No hay ofertas con estos filtros.</b></p>
          <p class="muted">Prueba a quitar el filtro de ciudad o a ampliar tu radio de acción.</p>
          <a class="btn btn-sm" href="/profesional/ofertas">Ver todas las ofertas</a>
        </div>`;
    } else {
      listaOfertas = ofertas.map(t => tarjetaOferta(ctx, t, {
        yaPresupuestada: misPresupuestos.has(t.id),
        distancia: t.distancia,
        radioKm
      })).join('');
    }

    const contenido = html`
      ${R(filtros)}
      <p class="muted">${ofertas.length} oferta(s) encontrada(s) para tus categorías.</p>
      ${R(listaOfertas)}`;

    return shell(ctx, {
      titulo: 'Ofertas de trabajo',
      subtitulo: 'Tareas publicadas que encajan con los servicios que ofreces.',
      activo: 'ofertas',
      contenido
    });
  });

  /* ---------------------------------------------------------------- */
  /* POST /tareas/:id/presupuesto — enviar presupuesto                 */
  /* ---------------------------------------------------------------- */
  router.post('/tareas/:id/presupuesto', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    if (!exigirCsrf(ctx)) return;
    const u = ctx.usuario;
    const id = Number(ctx.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      flash(ctx.res, 'La tarea indicada no es válida.', 'error');
      return { redirigir: '/profesional/ofertas' };
    }
    const tarea = q.get('SELECT * FROM tareas WHERE id=?', id);
    if (!tarea || tarea.estado !== 'publicada') {
      flash(ctx.res, 'Esa tarea ya no está disponible.', 'error');
      return { redirigir: '/profesional/ofertas' };
    }
    if (tarea.cliente_id === u.id) {
      flash(ctx.res, 'No puedes presupuestar una tarea publicada por ti mismo.', 'error');
      return { redirigir: '/profesional/ofertas' };
    }

    const p = perfilDe(u);
    if (p.estado_verificacion !== 'aprobado') {
      flash(ctx.res, 'Necesitas tener la identidad verificada para enviar presupuestos.', 'error');
      return { redirigir: '/profesional/verificacion' };
    }

    const ya = q.get("SELECT COUNT(*) AS n FROM presupuestos WHERE tarea_id=? AND profesional_id=? AND estado!='retirado'", id, u.id);
    if (ya.n > 0) {
      flash(ctx.res, 'Ya has enviado un presupuesto para esta tarea.', 'error');
      return { redirigir: '/profesional/presupuestos' };
    }

    const precio = num(ctx.body?.precio, 0);
    if (!(precio > 0)) {
      flash(ctx.res, 'Indica el precio de tu presupuesto.', 'error');
      return { redirigir: '/profesional/ofertas' };
    }
    const horas = Math.max(0.5, num(ctx.body?.horas, 1));
    const mensaje = texto(ctx.body?.mensaje, 1000);

    /* saldo de tokens: sin 10 tokens no se puede enviar el presupuesto */
    const saldo = saldoTokens(u.id);
    if (saldo < TOKENS_PRESUPUESTO) {
      flash(ctx.res, `Necesitas ${TOKENS_PRESUPUESTO} tokens (${fmtEuros(eurosDeTokens(TOKENS_PRESUPUESTO))}) para enviar un presupuesto. Compra tokens en tu monedero.`, 'error');
      return { redirigir: '/profesional/tokens' };
    }

    const ins = q.run(
      `INSERT INTO presupuestos (tarea_id,profesional_id,precio,horas,mensaje,estado,creado_en) VALUES (?,?,?,?,?,?,?)`,
      id, u.id, Math.round(precio * 100) / 100, horas, mensaje, 'enviado', ahora()
    );
    const presuId = ins.id;

    /* cobro del coste del presupuesto */
    const cobro = gastarTokens(u.id, presuId, `Presupuesto para «${tarea.titulo}»`);
    if (!cobro.ok) {
      q.run('DELETE FROM presupuestos WHERE id=?', presuId);
      flash(ctx.res, 'No hemos podido cobrar los tokens del presupuesto. Inténtalo de nuevo.', 'error');
      return { redirigir: '/profesional/ofertas' };
    }

    q.run(
      `INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,0,?)`,
      tarea.cliente_id, 'presupuesto',
      `Nuevo presupuesto para «${tarea.titulo}»`,
      `${u.nombre} ${u.apellidos || ''} ha enviado un presupuesto de ${fmtEurosCorto(precio)} por ${horas} h.`,
      'web', ahora()
    );

    flash(ctx.res, `Presupuesto enviado. Has gastado ${TOKENS_PRESUPUESTO} tokens (${fmtEuros(eurosDeTokens(TOKENS_PRESUPUESTO))}). Si el cliente no lo acepta, te devolvemos ${TOKENS_REEMBOLSO}.`, 'ok');
    return { redirigir: '/profesional/presupuestos' };
  });

  /* ---------------------------------------------------------------- */
  /* POST /tareas/:id/presupuesto/retirar — retirar presupuesto        */
  /* ---------------------------------------------------------------- */
  router.post('/tareas/:id/presupuesto/retirar', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    if (!exigirCsrf(ctx)) return;
    const u = ctx.usuario;
    const id = Number(ctx.params.id);

    const presu = q.get('SELECT * FROM presupuestos WHERE tarea_id=? AND profesional_id=?', id, u.id);
    if (!presu) {
      flash(ctx.res, 'No tienes ningún presupuesto en esa tarea.', 'error');
      return { redirigir: '/profesional/presupuestos' };
    }
    if (presu.estado !== 'enviado') {
      flash(ctx.res, 'Solo puedes retirar presupuestos que aún no han sido respondidos.', 'error');
      return { redirigir: '/profesional/presupuestos' };
    }

    q.run("UPDATE presupuestos SET estado='retirado', responde_en=? WHERE id=?", ahora(), presu.id);

    /* al retirar el presupuesto se devuelven 5 de los 10 tokens */
    const dev = reembolsarTokens(u.id, presu.id, 'Presupuesto retirado');
    const mensaje = dev.ok
      ? `Has retirado tu presupuesto. Te devolvemos ${TOKENS_REEMBOLSO} de los ${TOKENS_PRESUPUESTO} tokens que habías gastado.`
      : 'Has retirado tu presupuesto.';
    q.run(
      `INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,0,?)`,
      u.id, 'info', 'Presupuesto retirado', mensaje, 'web', ahora()
    );

    flash(ctx.res, dev.ok
      ? `Presupuesto retirado. Te devolvemos ${TOKENS_REEMBOLSO} tokens.`
      : 'Presupuesto retirado.', 'ok');
    return { redirigir: '/profesional/presupuestos' };
  });

  /* ---------------------------------------------------------------- */
  /* GET /profesional/presupuestos                                     */
  /* ---------------------------------------------------------------- */
  router.get('/profesional/presupuestos', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    const u = ctx.usuario;

    const filas = q.all(`
      SELECT pr.*, t.titulo AS tarea_titulo, t.estado AS tarea_estado,
             c.nombre AS categoria_nombre, ci.nombre AS ciudad_nombre,
             cl.nombre AS cliente_nombre, cl.apellidos AS cliente_apellidos
      FROM presupuestos pr
      JOIN tareas t ON t.id = pr.tarea_id
      LEFT JOIN categorias c ON c.id = t.categoria_id
      LEFT JOIN ciudades ci ON ci.id = t.ciudad_id
      LEFT JOIN usuarios cl ON cl.id = t.cliente_id
      WHERE pr.profesional_id = ?
      ORDER BY CASE pr.estado WHEN 'aceptado' THEN 0 WHEN 'enviado' THEN 1 WHEN 'rechazado' THEN 2 ELSE 3 END,
               pr.creado_en DESC, pr.id DESC`, u.id);

    /* gasto en tokens de cada presupuesto */
    const movTokens = new Map();
    for (const m of q.all(
      "SELECT presupuesto_id,tipo FROM tokens_movimientos WHERE usuario_id=? AND presupuesto_id IS NOT NULL", u.id
    )) {
      if (!movTokens.has(m.presupuesto_id)) movTokens.set(m.presupuesto_id, []);
      movTokens.get(m.presupuesto_id).push(m.tipo);
    }
    const txtTokens = new Map();
    for (const [pid, tipos] of movTokens) {
      if (!tipos.includes('presupuesto')) continue;
      txtTokens.set(pid, tipos.includes('reembolso')
        ? `${TOKENS_PRESUPUESTO} tokens · devueltos ${TOKENS_REEMBOLSO}`
        : `${TOKENS_PRESUPUESTO} tokens`);
    }

    const cuerpo = filas.length
      ? html`
        <div class="table-wrap">
          <table class="tabla">
            <thead>
              <tr><th>Tarea</th><th>Cliente</th><th>Ciudad</th><th>Precio</th><th>Horas</th><th>Estado</th><th>Enviado</th><th>Tokens</th><th></th></tr>
            </thead>
            <tbody>
              ${R(filas.map(f => html`
                <tr>
                  <td><b>${f.tarea_titulo}</b><br><span class="muted">${f.categoria_nombre || ''}</span></td>
                  <td>${f.cliente_nombre || ''} ${f.cliente_apellidos || ''}</td>
                  <td>${f.ciudad_nombre || '—'}</td>
                  <td class="mono">${fmtEurosCorto(f.precio)}</td>
                  <td>${f.horas}</td>
                  <td>${R(pastilla(f.estado, PRESU_ESTADO))}</td>
                  <td class="muted">${fechaCorta(f.creado_en)}</td>
                  <td class="muted">${txtTokens.get(f.id) || '—'}</td>
                  <td class="row-actions">
                    ${f.estado === 'enviado'
                      ? R(html`<form method="post" action="/tareas/${f.tarea_id}/presupuesto/retirar">
                                 <input type="hidden" name="csrf" value="${ctx.csrf}">
                                 <button class="btn btn-hollow btn-sm" type="submit">Retirar</button>
                               </form>`)
                      : ''}
                    <a class="btn btn-hollow btn-sm" href="/tareas-publicas/${f.tarea_id}">Ver tarea</a>
                  </td>
                </tr>`).join(''))}
            </tbody>
          </table>
        </div>
        ${R(filas.some(f => f.estado === 'enviado')
          ? html`<p class="muted">Si el cliente acepta tu presupuesto, la tarea pasará a "en curso" y podrás cobrarla desde tu monedero.</p>`
          : '')}`
      : html`
        <div class="vacio">
          <p><b>Todavía no has enviado ningún presupuesto.</b></p>
          <p class="muted">Busca tareas que encajen con tus servicios y envía tu primera propuesta.</p>
          <a class="btn btn-sm" href="/profesional/ofertas">Ver ofertas</a>
        </div>`;

    return shell(ctx, {
      titulo: 'Mis presupuestos',
      subtitulo: 'Todas tus propuestas y su estado.',
      activo: 'presupuestos',
      contenido: cuerpo
    });
  });

  /* ---------------------------------------------------------------- */
  /* GET /profesional/mensajes — conversaciones                         */
  /* ---------------------------------------------------------------- */
  router.get('/profesional/mensajes', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    const u = ctx.usuario;

    const filas = q.all(`
      SELECT m.id, m.tarea_id, m.emisor_id, m.destinatario_id, m.cuerpo, m.leido, m.creado_en,
             t.titulo AS tarea_titulo
      FROM mensajes m
      JOIN tareas t ON t.id = m.tarea_id
      WHERE m.emisor_id = ? OR m.destinatario_id = ?
      ORDER BY m.creado_en DESC, m.id DESC
      LIMIT 400`, u.id, u.id);

    const hilosMap = new Map();
    for (const m of filas) {
      const otro = m.emisor_id === u.id ? m.destinatario_id : m.emisor_id;
      const clave = `${m.tarea_id}:${otro}`;
      if (!hilosMap.has(clave)) {
        hilosMap.set(clave, {
          tarea_id: m.tarea_id, otro, titulo: m.tarea_titulo,
          ultimo: m, sinLeer: 0, mensajes: 0
        });
      }
      const h = hilosMap.get(clave);
      h.mensajes++;
      if (m.destinatario_id === u.id && !m.leido) h.sinLeer++;
      if (String(m.creado_en) > String(h.ultimo.creado_en)) h.ultimo = m;
    }

    const hilos = [...hilosMap.values()];
    const otrosIds = [...new Set(hilos.map(h => h.otro))];
    const nombres = new Map();
    if (otrosIds.length) {
      q.all(`SELECT id, nombre, apellidos FROM usuarios WHERE id IN (${otrosIds.map(() => '?').join(',')})`, ...otrosIds)
        .forEach(x => nombres.set(x.id, `${x.nombre} ${x.apellidos || ''}`.trim()));
    }

    const cuerpo = hilos.length
      ? html`
        <div class="table-wrap">
          <table class="tabla">
            <thead><tr><th>Cliente</th><th>Tarea</th><th>Último mensaje</th><th>Recibido</th><th></th></tr></thead>
            <tbody>
              ${R(hilos.map(h => html`
                <tr>
                  <td><b>${nombres.get(h.otro) || 'Cliente'}</b></td>
                  <td>${h.titulo}</td>
                  <td>${recorte(h.ultimo.cuerpo, 90)}</td>
                  <td class="muted">${tiempoRelativo(h.ultimo.creado_en)}</td>
                  <td class="row-actions">
                    ${h.sinLeer ? R(html`<span class="pill-estado" style="${bg('#307cf0')}">${h.sinLeer} sin leer</span>`) : ''}
                    <a class="btn btn-hollow btn-sm" href="/profesional/mensajes/${h.tarea_id}">Abrir</a>
                  </td>
                </tr>`).join(''))}
            </tbody>
          </table>
        </div>`
      : html`
        <div class="vacio">
          <p><b>No tienes conversaciones todavía.</b></p>
          <p class="muted">Cuando envíes un presupuesto o un cliente te escriba sobre una tarea, aparecerá aquí.</p>
          <a class="btn btn-sm" href="/profesional/presupuestos">Ver mis presupuestos</a>
        </div>`;

    return shell(ctx, {
      titulo: 'Mensajes',
      subtitulo: 'Conversaciones con los clientes sobre tus trabajos.',
      activo: 'mensajes',
      contenido: cuerpo
    });
  });

  /* ---------------------------------------------------------------- */
  /* GET /profesional/mensajes/:id — hilo                              */
  /* ---------------------------------------------------------------- */
  router.get('/profesional/mensajes/:id', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    const u = ctx.usuario;
    const tareaId = Number(ctx.params.id);
    if (!Number.isInteger(tareaId) || tareaId <= 0) {
      flash(ctx.res, 'Esa conversación no existe.', 'error');
      return { redirigir: '/profesional/mensajes' };
    }
    const tarea = participaEnTarea(u, tareaId);
    if (!tarea) {
      flash(ctx.res, 'No tienes acceso a esa conversación.', 'error');
      return { redirigir: '/profesional/mensajes' };
    }

    const mensajes = q.all(
      'SELECT * FROM mensajes WHERE tarea_id=? ORDER BY creado_en ASC, id ASC', tareaId
    );
    const otro = destinatarioDe(u, tarea, tareaId);
    const otroUser = otro ? q.get('SELECT id, nombre, apellidos FROM usuarios WHERE id=?', otro) : null;

    /* marcar como leídos los recibidos */
    q.run('UPDATE mensajes SET leido=1 WHERE tarea_id=? AND destinatario_id=? AND leido=0', tareaId, u.id);

    const burbujas = mensajes.map(m => html`
      <div class="msg${m.emisor_id === u.id ? ' prof' : ''}">
        <div>${m.cuerpo}</div>
        <small class="muted">${tiempoRelativo(m.creado_en)}</small>
      </div>`).join('');

    const form = otro
      ? html`
        <form method="post" action="/profesional/mensajes/${tareaId}">
          <input type="hidden" name="csrf" value="${ctx.csrf}">
          <div class="campo">
            <label for="msg_cuerpo">Escribe tu mensaje</label>
            <textarea id="msg_cuerpo" name="cuerpo" maxlength="2000" placeholder="Hola, te escribo para confirmar los detalles del trabajo." required></textarea>
          </div>
          <div class="acciones">
            <button class="btn" type="submit">Enviar mensaje</button>
            <a class="btn btn-hollow" href="/profesional/mensajes">Volver a los mensajes</a>
          </div>
        </form>`
      : html`<div class="alert-box"><p>No hay con quién mantener esta conversación.</p></div>`;

    const contenido = html`
      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>${tarea.titulo}</h3>
            <p class="muted">${otroUser ? `Conversación con ${otroUser.nombre} ${otroUser.apellidos || ''}` : 'Conversación'}</p>
          </div>
          <a class="btn btn-hollow btn-sm" href="/profesional/mensajes">Todos los mensajes</a>
        </div>
        <div class="hilo">${mensajes.length ? R(burbujas) : R(html`<p class="muted">Todavía no hay mensajes en esta conversación.</p>`)}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h3>Responder</h3></div>
        ${R(form)}
      </section>`;

    return shell(ctx, {
      titulo: 'Conversación',
      subtitulo: tarea.titulo,
      activo: 'mensajes',
      contenido
    });
  });

  /* ---------------------------------------------------------------- */
  /* POST /profesional/mensajes/:id — responder                        */
  /* ---------------------------------------------------------------- */
  router.post('/profesional/mensajes/:id', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    if (!exigirCsrf(ctx)) return;
    const u = ctx.usuario;
    const tareaId = Number(ctx.params.id);
    if (!Number.isInteger(tareaId) || tareaId <= 0) {
      flash(ctx.res, 'Esa conversación no existe.', 'error');
      return { redirigir: '/profesional/mensajes' };
    }
    const tarea = participaEnTarea(u, tareaId);
    if (!tarea) {
      flash(ctx.res, 'No tienes acceso a esa conversación.', 'error');
      return { redirigir: '/profesional/mensajes' };
    }
    const cuerpo = texto(ctx.body?.cuerpo, 2000);
    if (!cuerpo) {
      flash(ctx.res, 'Escribe tu mensaje antes de enviarlo.', 'error');
      return { redirigir: `/profesional/mensajes/${tareaId}` };
    }
    const otro = destinatarioDe(u, tarea, tareaId);
    if (!otro) {
      flash(ctx.res, 'No hay con quién mantener esta conversación.', 'error');
      return { redirigir: '/profesional/mensajes' };
    }

    q.run(
      'INSERT INTO mensajes (tarea_id,emisor_id,destinatario_id,cuerpo,leido,creado_en) VALUES (?,?,?,?,0,?)',
      tareaId, u.id, otro, cuerpo, ahora()
    );
    q.run(
      `INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,0,?)`,
      otro, 'mensaje', `Nuevo mensaje de ${u.nombre}`, recorte(cuerpo, 160), 'web', ahora()
    );

    flash(ctx.res, 'Mensaje enviado.', 'ok');
    return { redirigir: `/profesional/mensajes/${tareaId}` };
  });

  /* ---------------------------------------------------------------- */
  /* GET /profesional/ingresos — monedero                              */
  /* ---------------------------------------------------------------- */
  router.get('/profesional/ingresos', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    const u = ctx.usuario;

    const bruto = q.get(
      "SELECT COALESCE(SUM(monto),0) AS s FROM transacciones WHERE usuario_id=? AND tipo='pago_profesional' AND estado='completada'",
      u.id
    ).s;
    const retirado = q.get(
      "SELECT COALESCE(SUM(monto),0) AS s FROM transacciones WHERE usuario_id=? AND tipo='retirada' AND estado IN ('completada','pendiente')",
      u.id
    ).s;
    const saldo = Math.round((bruto - retirado) * 100) / 100;

    const historial = q.all(
      'SELECT * FROM transacciones WHERE usuario_id=? ORDER BY creado_en DESC, id DESC LIMIT 100', u.id
    );

    const resumen = html`
      <div class="stats">
        ${R(kpi(fmtEurosCorto(saldo), 'Saldo disponible'))}
        ${R(kpi(fmtEurosCorto(bruto), 'Ingresos acumulados'))}
        ${R(kpi(fmtEurosCorto(retirado), 'Retiradas'))}
        ${R(kpi('100 %', 'Recibes el 100 % del importe (sin comisión)'))}
      </div>
      <div class="resumen">
        <dl>
          <dt>Saldo disponible</dt><dd>${fmtEuros(saldo)}</dd>
          <dt>Ingresos acumulados</dt><dd>${fmtEuros(bruto)}</dd>
          <dt>Retiradas (pendientes y completadas)</dt><dd>${fmtEuros(retirado)}</dd>
          <dt>Recibes el 100 % del importe (sin comisión)</dt><dd>El importe pactado con el cliente es tuyo íntegro</dd>
        </dl>
      </div>`;

    const form = html`
      <form method="post" action="/profesional/ingresos/retirar">
        <input type="hidden" name="csrf" value="${ctx.csrf}">
        <div class="form-grid">
          <div class="campo">
            <label for="ing_monto">Importe a retirar (€)</label>
            <input type="number" id="ing_monto" name="monto" step="0.01" min="1" max="${saldo > 0 ? saldo : 0}" value="${saldo > 0 ? saldo.toFixed(2) : ''}" required>
            <div class="pista">Solicitudes de retirada pendientes de pago en un plazo máximo de 3 días laborables.</div>
          </div>
        </div>
        <div class="acciones">
          <button class="btn" type="submit"${saldo > 0 ? '' : ' disabled'}>Solicitar retirada</button>
        </div>
      </form>`;

    const bloqueHistorial = historial.length
      ? html`
        <div class="table-wrap">
          <table class="tabla">
            <thead><tr><th>Concepto</th><th>Importe</th><th>Comisión</th><th>Estado</th><th>Fecha</th><th>Referencia</th></tr></thead>
            <tbody>
              ${R(historial.map(t => html`
                <tr>
                  <td><b>${t.descripcion || tipoTx(t.tipo)}</b><br><span class="muted">${tipoTx(t.tipo)}</span></td>
                  <td class="mono">${fmtEurosCorto(t.monto)}</td>
                  <td class="mono">${t.comision ? fmtEurosCorto(t.comision) : '—'}</td>
                  <td>${R(pastilla(t.estado, { pendiente: { txt: 'Pendiente', color: '#f0aa28' }, completada: { txt: 'Completada', color: '#2ea378' }, revertida: { txt: 'Revertida', color: '#e45252' } }))}</td>
                  <td class="muted">${fechaCorta(t.creado_en)}</td>
                  <td class="mono muted">${t.referencia || '—'}</td>
                </tr>`).join(''))}
            </tbody>
          </table>
        </div>`
      : html`<div class="vacio"><p>Todavía no tienes movimientos en el monedero.</p></div>`;

    const contenido = html`
      ${R(resumen)}
      <section class="panel">
        <div class="panel-head"><h3>Solicitar una retirada</h3></div>
        ${R(form)}
      </section>
      <section class="panel">
        <div class="panel-head"><h3>Histórico de movimientos</h3></div>
        ${R(bloqueHistorial)}
      </section>`;

    return shell(ctx, {
      titulo: 'Ingresos',
      subtitulo: 'Tu monedero: cobros y retiradas.',
      activo: 'ingresos',
      contenido
    });
  });

  /* ---------------------------------------------------------------- */
  /* POST /profesional/ingresos/retirar — solicitud de retirada        */
  /* ---------------------------------------------------------------- */
  const retirar = async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    if (!exigirCsrf(ctx)) return;
    const u = ctx.usuario;

    const bruto = q.get(
      "SELECT COALESCE(SUM(monto),0) AS s FROM transacciones WHERE usuario_id=? AND tipo='pago_profesional' AND estado='completada'",
      u.id
    ).s;
    const retirado = q.get(
      "SELECT COALESCE(SUM(monto),0) AS s FROM transacciones WHERE usuario_id=? AND tipo='retirada' AND estado IN ('completada','pendiente')",
      u.id
    ).s;
    const saldo = Math.round((bruto - retirado) * 100) / 100;

    const monto = Math.round(num(ctx.body?.monto, 0) * 100) / 100;
    if (!(monto > 0)) {
      flash(ctx.res, 'Indica el importe que quieres retirar.', 'error');
      return { redirigir: '/profesional/ingresos' };
    }
    if (monto > saldo) {
      flash(ctx.res, 'No puedes retirar más dinero del que tienes disponible.', 'error');
      return { redirigir: '/profesional/ingresos' };
    }

    q.run(
      `INSERT INTO transacciones (tipo,usuario_id,tarea_id,monto,comision,estado,referencia,descripcion,creado_en)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      'retirada', u.id, null, monto, 0, 'pendiente',
      'RET-' + randomUUID().slice(0, 8).toUpperCase(),
      'Retirada solicitada por el profesional', ahora()
    );

    flash(ctx.res, `Solicitud de retirada de ${fmtEurosCorto(monto)} registrada. La pagaremos en 3 días laborables.`, 'ok');
    return { redirigir: '/profesional/ingresos' };
  };
  router.post('/profesional/ingresos/retirar', retirar);
  router.post('/profesional/ingresos', retirar);

  /* ---------------------------------------------------------------- */
  /* GET /profesional/tokens — monedero de tokens                       */
  /* ---------------------------------------------------------------- */
  router.get('/profesional/tokens', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    const u = ctx.usuario;
    const saldo = saldoTokens(u.id);
    const movimientos = movimientosTokens(u.id);

    const bloqueKpis = html`
      <div class="stats">
        ${R(kpi(saldo, 'Tokens disponibles'))}
        ${R(kpi(fmtEuros(eurosDeTokens(saldo)), 'Equivalente en euros'))}
        ${R(kpi(`${TOKENS_PRESUPUESTO} tokens · ${fmtEuros(eurosDeTokens(TOKENS_PRESUPUESTO))}`, 'Coste de un presupuesto'))}
      </div>`;

    /* --- paquetes de compra --- */
    const filasPaquetes = PAQUETES.map(p => html`
      <tr>
        <td><b>${p.tokens} tokens</b></td>
        <td class="mono">${fmtEuros(p.euros)}</td>
        <td class="row-actions">
          <form method="post" action="/profesional/tokens/comprar">
            <input type="hidden" name="csrf" value="${ctx.csrf}">
            <input type="hidden" name="tokens" value="${p.tokens}">
            <button class="btn btn-sm" type="submit">Comprar ${p.tokens} tokens · ${fmtEuros(p.euros)}</button>
          </form>
        </td>
      </tr>`).join('');

    const bloquePaquetes = html`
      <div class="table-wrap">
        <table class="tabla">
          <thead><tr><th>Paquete</th><th>Precio</th><th></th></tr></thead>
          <tbody>${R(filasPaquetes)}</tbody>
        </table>
      </div>`;

    /* --- reglas del modelo --- */
    const bloqueReglas = html`
      <section class="panel">
        <div class="panel-head"><h3>Cómo funciona</h3></div>
        <ul>
          <li>10 tokens = 1 €.</li>
          <li>Enviar un presupuesto a una tarea cuesta ${TOKENS_PRESUPUESTO} tokens.</li>
          <li>Si el cliente no acepta tu presupuesto, te devolvemos ${TOKENS_REEMBOLSO} tokens.</li>
          <li>Si el cliente lo acepta, no se devuelve ninguno.</li>
          <li>Recibes el 100 % del importe del trabajo: no cobramos comisión.</li>
        </ul>
      </section>`;

    /* --- histórico de movimientos --- */
    const filasMovimientos = movimientos.map(m => html`
      <tr>
        <td class="muted">${fechaCorta(m.creado_en)}</td>
        <td>${tipoMovTokens(m.tipo)}</td>
        <td class="mono">${cantidadConSigno(m.cantidad)}</td>
        <td class="mono">${m.euros ? fmtEuros(m.euros) : '—'}</td>
        <td>${m.descripcion || '—'}</td>
      </tr>`).join('');

    const bloqueHistorial = movimientos.length
      ? html`
        <div class="table-wrap">
          <table class="tabla">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Euros</th><th>Descripción</th></tr></thead>
            <tbody>${R(filasMovimientos)}</tbody>
          </table>
        </div>`
      : html`<div class="vacio"><p>Todavía no has comprado ni gastado tokens.</p></div>`;

    const contenido = html`
      ${R(bloqueKpis)}
      ${R(bloqueReglas)}
      <section class="panel">
        <div class="panel-head"><h3>Comprar tokens</h3></div>
        ${R(bloquePaquetes)}
        <p class="pista">El cobro es simulado en este prototipo: se anota en tu monedero y no se mueven fondos reales.</p>
      </section>
      <section class="panel">
        <div class="panel-head"><h3>Histórico de tokens</h3></div>
        ${R(bloqueHistorial)}
      </section>`;

    return shell(ctx, {
      titulo: 'Tokens',
      subtitulo: 'Tu monedero de tokens: compras, presupuestos y devoluciones.',
      activo: 'tokens',
      contenido
    });
  });

  /* ---------------------------------------------------------------- */
  /* POST /profesional/tokens/comprar — comprar tokens                  */
  /* ---------------------------------------------------------------- */
  router.post('/profesional/tokens/comprar', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    if (!exigirCsrf(ctx)) return;
    const u = ctx.usuario;

    const tokens = Math.floor(Number(ctx.body?.tokens));
    const paquete = PAQUETES.find(p => p.tokens === tokens);
    if (!paquete) {
      flash(ctx.res, 'Ese paquete de tokens no existe.', 'error');
      return { redirigir: '/profesional/tokens' };
    }

    const r = comprarTokens(u.id, tokens, `Compra de ${tokens} tokens (${fmtEuros(paquete.euros)})`);
    if (!r.ok) {
      flash(ctx.res, 'No hemos podido completar la compra de tokens.', 'error');
      return { redirigir: '/profesional/tokens' };
    }

    flash(ctx.res, `Has comprado ${tokens} tokens (${fmtEuros(paquete.euros)}). Saldo disponible: ${r.saldo} tokens (${fmtEuros(eurosDeTokens(r.saldo))}).`, 'ok');
    return { redirigir: '/profesional/tokens' };
  });

  /* ---------------------------------------------------------------- */
  /* GET /profesional/ranking — tabla de posición                       */
  /* ---------------------------------------------------------------- */
  router.get('/profesional/ranking', async (ctx) => {
    if (!exigirRol(ctx, 'profesional', 'admin')) return;
    const u = ctx.usuario;

    const filas = q.all(`
      SELECT u.id, u.nombre, u.apellidos, u.avatar, u.ciudad_id,
             p.precio_hora, p.estado_verificacion, p.categorias,
             ci.nombre AS ciudad_nombre,
             COUNT(o.id) AS opiniones, AVG(o.puntuacion) AS media
      FROM profesionales p
      JOIN usuarios u ON u.id = p.usuario_id
      LEFT JOIN opiniones o ON o.profesional_id = u.id
      LEFT JOIN ciudades ci ON ci.id = u.ciudad_id
      WHERE p.estado_verificacion = 'aprobado'
      GROUP BY u.id
      ORDER BY (media IS NULL), media DESC, opiniones DESC, u.nombre ASC
      LIMIT 100`);

    const miIndice = filas.findIndex(f => f.id === u.id);
    const miFila = miIndice >= 0 ? filas[miIndice] : null;

    const bloquePosicion = miFila
      ? html`
        <div class="stats">
          ${R(kpi(`#${miIndice + 1}`, 'Tu posición'))}
          ${R(kpi(miFila.media ? Number(miFila.media).toFixed(1) : '—', 'Tu valoración media'))}
          ${R(kpi(miFila.opiniones, 'Tus opiniones'))}
          ${R(kpi(fmtEurosCorto(miFila.precio_hora || 0) + '/h', 'Tu precio por hora'))}
        </div>`
      : html`
        <div class="alert-box">
          <b>Todavía no apareces en el ranking.</b>
          <p class="muted">Solo se listan los profesionales con la identidad verificada y al menos una opinión.</p>
          <a class="btn btn-sm" href="/profesional/verificacion">Verificar mi identidad</a>
        </div>`;

    const cuerpo = filas.length
      ? html`
        ${R(bloquePosicion)}
        <section class="panel">
          <div class="panel-head"><h3>Posiciones</h3></div>
          <div class="table-wrap">
            <table class="tabla">
              <thead><tr><th>#</th><th>Profesional</th><th>Ciudad</th><th>Valoración</th><th>Opiniones</th><th>Precio/hora</th><th></th></tr></thead>
              <tbody>
                ${R(filas.map((f, i) => html`
                  <tr${f.id === u.id ? R(' style="background:var(--verde-liq)"') : ''}>
                    <td class="mono">${i + 1}</td>
                    <td>
                      <b>${f.nombre} ${f.apellidos || ''}</b>
                      ${f.id === u.id ? R(html`<span class="pill-estado" style="${bg('#2ea378')}">Tu posición</span>`) : ''}
                    </td>
                    <td>${f.ciudad_nombre || '—'}</td>
                    <td><span class="estrellas">${estrellas(f.media || 0)}</span> <span class="muted">${f.media ? Number(f.media).toFixed(1) : '—'}</span></td>
                    <td>${f.opiniones}</td>
                    <td class="mono">${f.precio_hora ? fmtEurosCorto(f.precio_hora) : '—'}</td>
                    <td class="row-actions"><a class="btn btn-hollow btn-sm" href="/t/${f.id}">Ver perfil</a></td>
                  </tr>`).join(''))}
              </tbody>
            </table>
          </div>
        </section>`
      : html`
        ${R(bloquePosicion)}
        <div class="vacio"><p>Todavía no hay profesionales verificados con opiniones valoradas.</p></div>`;

    return shell(ctx, {
      titulo: 'Ranking',
      subtitulo: 'Los profesionales mejor valorados de TrabajoFácil.',
      activo: 'ranking',
      contenido: cuerpo
    });
  });
}

/* ------------------------------------------------------------------ */
/* Texto de los tipos de transacción                                 */
/* ------------------------------------------------------------------ */
function tipoTx(tipo) {
  return {
    recarga: 'Recarga',
    pago_cliente: 'Pago de cliente',
    pago_profesional: 'Trabajo cobrado',
    compra_tokens: 'Compra de tokens',
    retirada: 'Retirada'
  }[tipo] || 'Movimiento';
}
