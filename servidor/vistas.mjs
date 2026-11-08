/* ==========================================================================
   TrabajoFácil — motor de vistas (sin dependencias)
   Plantillas con tagged templates: por defecto TODO se escapa.
   Para insertar HTML ya construido se usa raw().
   ========================================================================== */

/* ------------------------------------------------------------------ */
/* Escape y tagged templates                                           */
/* ------------------------------------------------------------------ */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export const raw = s => ({ __raw: String(s ?? '') });

/* ------------------------------------------------------------------ */
/* Versionado de assets                                               */
/* ------------------------------------------------------------------ */
/* El servidor responde los estáticos con max-age=300. Para que un
   despliegue no deje CSS o JS obsoleto en el navegador, cada URL de
   asset lleva ?v=<mtime del fichero>. La versión se deriva del propio
   fichero, así que no hay que acordarse de subirla a mano. */
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR_RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

export function versionAsset(ruta) {
  try {
    return String(Math.floor(statSync(join(DIR_RAIZ, ruta.replace(/^\/+/, ''))).mtimeMs));
  } catch {
    return '0';
  }
}

function render(v) {
  if (v == null || v === false || v === true) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  if (typeof v === 'object' && '__raw' in v) return v.__raw;
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return out;
}

/* ------------------------------------------------------------------ */
/* Utilidades de formato                                              */
/* ------------------------------------------------------------------ */
export const slugify = s => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function fmtEuros(n, decimales = 2) {
  const v = Number(n || 0);
  return v.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }) + ' €';
}

export function fmtEurosCorto(n) {
  const v = Number(n || 0);
  return (Number.isInteger(v) ? v : v.toFixed(2).replace('.', ',')) + ' €';
}

export function fmtFecha(iso, conHora = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  const fecha = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  return conHora ? fecha + ' · ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : fecha;
}

export function fechaCorta(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
}

export function tiempoRelativo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 2592000) return `hace ${Math.floor(diff / 86400)} d`;
  return fechaCorta(iso);
}

export const iniciales = nombre => String(nombre || '?')
  .split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');

export function estrellas(valor) {
  const v = Math.round(Number(valor) || 0);
  return '★'.repeat(Math.max(0, v)) + '☆'.repeat(Math.max(0, 5 - v));
}

export const TAREAS_ESTADO = {
  borrador:    { txt: 'Borrador',    color: '#777' },
  publicada:   { txt: 'Publicada',   color: '#2ea378' },
  en_curso:    { txt: 'En curso',    color: '#307cf0' },
  completada:  { txt: 'Completada',  color: '#7c5ce6' },
  cancelada:   { txt: 'Cancelada',   color: '#e45252' }
};

export const PRESU_ESTADO = {
  enviado:  { txt: 'Enviado',  color: '#307cf0' },
  aceptado: { txt: 'Aceptado', color: '#2ea378' },
  rechazado:{ txt: 'Rechazado',color: '#e45252' },
  retirado: { txt: 'Retirado', color: '#777' }
};

export const VERIF_ESTADO = {
  pendiente: { txt: 'Pendiente', color: '#f0aa28' },
  aprobado:  { txt: 'Aprobado', color: '#2ea378' },
  rechazado: { txt: 'Rechazado', color: '#e45252' }
};

/* ------------------------------------------------------------------ */
/* Capa de aplicación (no existe en el prototipo estático original)   */
/* ------------------------------------------------------------------ */
export function layout({ titulo, descripcion = '', usuario = null, ruta = '/', contenido, ancho = 'normal', scripts = [], flash = null }) {
  const body = ancho === 'ancho' ? 'style="max-width:1400px;margin:0 auto"' : '';
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} — TrabajoFácil</title>
${descripcion ? `<meta name="description" content="${esc(descripcion)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/estilos.css?v=${versionAsset('/assets/css/estilos.css')}">
<link rel="stylesheet" href="/assets/css/app.css?v=${versionAsset('/assets/css/app.css')}">
<link rel="icon" href="/assets/img/marca.svg" type="image/svg+xml">
</head>
<body class="${usuario ? 'sesion-activa rol-' + esc(usuario.rol) : ''}">
${cabecera(usuario, ruta)}
${aviso(flash)}
<main class="${ancho === 'ancho' ? 'ancho' : ''}" ${body}>${contenido}</main>
${pie()}
${scripts.map(s => `<script src="${esc(s)}${s.includes('?') ? '&' : '?'}v=${versionAsset(s)}"></script>`).join('\n')}
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* Parciales                                                           */
/* ------------------------------------------------------------------ */
export function cabecera(usuario, ruta = '/') {
  const nav = usuario
    ? (usuario.rol === 'admin'
      ? [ ['/admin', 'Administración'], ['/tareas-publicas', 'Tareas'] ]
      : usuario.rol === 'profesional'
        ? [ ['/profesional', 'Mi panel'], ['/profesional/ofertas', 'Ofertas'], ['/profesional/mensajes', 'Mensajes'], ['/tareas-publicas', 'Explorar'] ]
        : [ ['/mi-cuenta', 'Mi cuenta'], ['/mi-cuenta/tareas', 'Mis tareas'], ['/mi-cuenta/presupuestos', 'Presupuestos'], ['/mi-cuenta/mensajes', 'Mensajes'] ])
    : [ ['/servicios', 'Servicios'], ['/como-funciona', 'Cómo funciona'], ['/precios', 'Precios'], ['/t', 'Profesionales'] ];

  const enlaces = nav.map(([href, txt]) =>
    `<li><a href="${href}"${ruta === href ? ' aria-current="page"' : ''}>${esc(txt)}</a></li>`).join('');

  const acciones = usuario
    ? `<div class="nav-acciones">
         ${usuario.rol === 'profesional' ? '<a class="btn btn-hollow btn-sm" href="/profesional/verificacion">Verificación</a>' : ''}
         <a class="btn btn-sm" href="${usuario.rol === 'admin' ? '/admin' : '/tareas-publicas'}">${usuario.rol === 'admin' ? 'Panel' : 'Publicar tarea'}</a>
         <a class="nav-user" href="/salir" title="Cerrar sesión" aria-label="Cerrar sesión">
           <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
             <path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7"/>
           </svg>
         </a>
       </div>`
    : `<div class="nav-acciones">
         <a class="btn btn-hollow btn-sm" href="/hazte-profesional">Hazte profesional</a>
         <a class="btn btn-sm" href="/publicar-tarea">Pide presupuestos</a>
         <a class="nav-user" href="/accede" aria-label="Acceder">
           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
             <circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>
           </svg>
         </a>
       </div>`;

  return `<header class="cabecera-sitio">
  <nav class="navbar row" aria-label="Principal">
    <a class="brand" href="/" aria-label="TrabajoFácil, inicio">
      <img src="/assets/img/marca.svg" alt="" width="38" height="38">
      <span class="marca-texto">trabajo<em>fácil</em></span>
    </a>
    <ul class="nav-links">${enlaces}</ul>
    ${acciones}
    <button class="menu-btn" id="menuBtn" type="button" aria-label="Abrir menú" aria-expanded="false" aria-controls="menuPanel">
      <span></span><span></span><span></span>
    </button>
  </nav>
  <div class="menu-panel" id="menuPanel">
    ${nav.map(([href, txt]) => `<a href="${href}">${esc(txt)}</a>`).join('\n    ')}
    ${usuario ? '<a href="/salir">Cerrar sesión</a>' : '<a href="/accede">Acceder</a><a href="/registro">Crear cuenta</a>'}
  </div>
</header>`;
}

export function aviso(f) {
  if (!f || !f.texto) return '';
  const estilo = f.tipo === 'error' ? 'alerta-error' : (f.tipo === 'aviso' ? 'alerta-aviso' : 'alerta-ok');
  return `<div class="alerta ${estilo}"><div class="row"><div class="columns">${esc(f.texto)}</div></div></div>`;
}

export function pie() {
  const anio = new Date().getFullYear();
  return `<footer class="pie">
  <div class="row">
    <div class="columns large-3">
      <div class="pie-marca">
        <a href="/" style="display:flex;align-items:center;gap:.5rem">
          <img src="/assets/img/marca.svg" alt="" width="34" height="34">
          <span class="marca-texto" style="color:#fff">trabajo<em>fácil</em></span>
        </a>
        <p style="opacity:.75;font-size:.86rem;margin-top:.8rem">Valora tu tiempo. Contrata con gente de confianza, cerca de ti.</p>
      </div>
    </div>
    <div class="columns large-3">
      <h4>TrabajoFácil</h4>
      <ul>
        <li><a href="/como-funciona">Cómo funciona</a></li>
        <li><a href="/servicios">Servicios</a></li>
        <li><a href="/publicar-tarea">Pide presupuestos</a></li>
        <li><a href="/precios">Precios y tokens</a></li>
      </ul>
    </div>
    <div class="columns large-3">
      <h4>Profesionales</h4>
      <ul>
        <li><a href="/hazte-profesional">Hazte profesional</a></li>
        <li><a href="/t">Ver profesionales</a></li>
        <li><a href="/tareas-publicas">Ver tareas</a></li>
      </ul>
      <div class="pagos"><span>Visa</span><span>Mastercard</span><span>Bizum</span></div>
    </div>
    <div class="columns large-3">
      <h4>Legal</h4>
      <ul>
        <li><a href="/aviso-legal">Aviso legal</a></li>
        <li><a href="/aviso-legal#privacidad">Privacidad</a></li>
        <li><a href="/aviso-legal#cookies">Cookies</a></li>
        <li><a href="/aviso-legal#condiciones">Condiciones de uso</a></li>
      </ul>
    </div>
  </div>
  <div class="row"><div class="columns"><div class="pie-abajo">
    <span>© ${anio} TrabajoFácil — Plataforma de servicios por horas</span>
    <span>Publica tu tarea y recibe hasta 4 presupuestos adaptados a ti</span>
  </div></div></div>
</footer>`;
}

/* ------------------------------------------------------------------ */
/* Tarjetas reutilizables                                               */
/* ------------------------------------------------------------------ */
export function badgeCategoria(cat) {
  if (!cat) return '';
  return `<span class="badge-cat" style="background:${esc(cat.color || '#2ea378')}">${esc(cat.code || '')}</span>
          <span>${esc(cat.nombre)}</span>`;
}

export function tarjetaProfesional(p, { mostrarPrecio = true } = {}) {
  return `<a class="tarjeta-prof" href="/t/${p.id}">
    <img class="avatar" src="${esc(p.avatar || '/assets/img/avatar-1.svg')}" alt="" width="64" height="64">
    <div class="datos">
      <b>${esc(p.nombre)}${p.verificado ? ' <span class="tick" title="Identidad verificada">✓</span>' : ''}</b>
      <span class="titulo">${esc(p.titulo || p.ciudad || '')}</span>
      <span class="val"><span class="estrellas">★ ${Number(p.valoracion || 0).toFixed(1)}</span>
        <em>(${p.opiniones || 0} opiniones)</em>${p.ciudad ? ' · ' + esc(p.ciudad) : ''}</span>
    </div>
    ${mostrarPrecio && p.precio_hora ? `<div class="precio">${fmtEurosCorto(p.precio_hora)}<small>/h</small></div>` : ''}
  </a>`;
}

export function tarjetaTarea(t) {
  const est = TAREAS_ESTADO[t.estado] || TAREAS_ESTADO.borrador;
  return `<a class="tarjeta-tarea" href="/tareas-publicas/${t.id}">
    <span class="pill" style="background:${est.color}">${est.txt}</span>
    <b>${esc(t.titulo)}</b>
    <span class="meta">${esc(t.categoria_nombre || '')} · ${esc(t.ciudad_nombre || '')} · ${esc(t.fecha || '')}</span>
    ${t.precio_final ? `<span class="precio">${fmtEurosCorto(t.precio_final)}</span>` : ''}
  </a>`;
}

/* ------------------------------------------------------------------ */
/* Componentes de formulario                                           */
/* ------------------------------------------------------------------ */
export function campo({ nombre, etiqueta, tipo = 'text', valor = '', requerido = false, pista = '', placeholder = '', opciones = null, attrs = '' }) {
  const id = 'c_' + nombre;
  let control;
  if (opciones) {
    control = `<select id="${id}" name="${nombre}" ${requerido ? 'required' : ''} ${attrs}>
      ${opciones.map(o => {
        const v = typeof o === 'string' ? o : o.valor;
        const t = typeof o === 'string' ? o : o.texto;
        return `<option value="${esc(v)}"${String(v) === String(valor) ? ' selected' : ''}>${esc(t)}</option>`;
      }).join('')}
    </select>`;
  } else if (tipo === 'textarea') {
    control = `<textarea id="${id}" name="${nombre}" placeholder="${esc(placeholder)}" ${requerido ? 'required' : ''} ${attrs}>${esc(valor)}</textarea>`;
  } else {
    control = `<input type="${tipo}" id="${id}" name="${nombre}" value="${esc(valor)}" placeholder="${esc(placeholder)}" ${requerido ? 'required' : ''} ${attrs}>`;
  }
  return `<div class="campo"><label for="${id}">${esc(etiqueta)}${requerido ? ' <span class="req">*</span>' : ''}</label>
    ${control}${pista ? `<div class="pista">${pista}</div>` : ''}</div>`;
}

export function checkbox({ nombre, etiqueta, valor = '1', checked = false }) {
  return `<label class="check"><input type="checkbox" name="${esc(nombre)}" value="${esc(valor)}"${checked ? ' checked' : ''}> <span>${esc(etiqueta)}</span></label>`;
}

export function opcionPill({ valor, texto, seleccionado = false, name = '', extra = '' }) {
  return `<span class="opcion${seleccionado ? ' sel' : ''}" data-valor="${esc(valor)}"${name ? ` data-name="${esc(name)}"` : ''} ${extra}>${esc(texto)}</span>`;
}
