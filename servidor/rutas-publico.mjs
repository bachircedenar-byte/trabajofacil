/* ==========================================================================
   TrabajoFácil — rutas públicas
   Portada, catálogo de servicios, landings SEO (servicio y servicio × ciudad),
   fichas de profesionales, tareas públicas, precios, legal y API del buscador.
   ========================================================================== */
import { q } from './db.mjs';
import {
  esc, fmtEurosCorto, fmtFecha, tiempoRelativo,
  estrellas, layout, tarjetaProfesional, tarjetaTarea
} from './vistas.mjs';

/* ------------------------------------------------------------------ */
/* Consultas reutilizables                                             */
/* ------------------------------------------------------------------ */
const SQL_PROF = `
  SELECT u.id, u.nombre, u.apellidos, u.avatar, u.bio, u.ciudad_id,
         p.precio_hora, p.estado_verificacion, p.categorias, p.radio_km, p.disponible, p.titularidad,
         ci.nombre AS ciudad,
         (SELECT AVG(puntuacion) FROM opiniones o WHERE o.profesional_id = u.id) AS valoracion,
         (SELECT COUNT(*)        FROM opiniones o WHERE o.profesional_id = u.id) AS opiniones,
         (SELECT COUNT(*)        FROM presupuestos pr WHERE pr.profesional_id = u.id AND pr.estado='aceptado') AS trabajos
  FROM usuarios u
  JOIN profesionales p ON p.usuario_id = u.id
  LEFT JOIN ciudades ci ON ci.id = u.ciudad_id
  WHERE u.rol='profesional' AND u.activo=1`;

const SQL_TAREA = `
  SELECT t.*, cat.nombre AS categoria_nombre, cat.slug AS categoria_slug,
         cat.color AS categoria_color, cat.code AS categoria_code,
         ci.nombre AS ciudad_nombre, ci.slug AS ciudad_slug,
         us.nombre AS cliente_nombre,
         (SELECT COUNT(*) FROM presupuestos pr WHERE pr.tarea_id = t.id) AS ofertas
  FROM tareas t
  LEFT JOIN categorias cat ON cat.id = t.categoria_id
  LEFT JOIN ciudades   ci  ON ci.id  = t.ciudad_id
  LEFT JOIN usuarios   us  ON us.id  = t.cliente_id`;

const nombreCompleto = p => `${p.nombre} ${p.apellidos || ''}`.trim();
const titulo = p => (p.apellidos ? `${p.nombre} ${p.apellidos.charAt(0)}.` : p.nombre);

/* Fotos que adjuntó el cliente: tarea_extra.fotos es un array JSON de URLs. */
function fotosDeTarea(tareaId) {
  const extra = q.get('SELECT fotos FROM tarea_extra WHERE tarea_id=?', tareaId);
  try {
    const arr = extra?.fotos ? JSON.parse(extra.fotos) : [];
    return Array.isArray(arr) ? arr.filter(f => typeof f === 'string' && f.trim()) : [];
  } catch {
    return [];
  }
}

/* URL pública de una foto guardada en la carpeta contenido/. */
function urlFoto(ruta) {
  const r = String(ruta || '').trim();
  if (!r) return '';
  if (r.startsWith('/')) return r;
  if (r.startsWith('contenido/')) return '/' + r;
  return '/contenido/' + r.replace(/^\/+/, '');
}

/* ------------------------------------------------------------------ */
/* Buscador (misma lógica de puntuación que el prototipo estático)    */
/* ------------------------------------------------------------------ */
function normalizar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buscarCategorias(texto, limite = 8) {
  const qn = normalizar(texto);
  if (qn.length < 2) return [];
  const terminos = qn.split(' ');
  const out = [];
  for (const cat of q.all('SELECT * FROM categorias WHERE activa=1')) {
    const nombre = normalizar(cat.nombre);
    const claves = (() => { try { return JSON.parse(cat.keywords || '[]').map(normalizar); } catch { return []; } })();
    let puntos = 0;
    if (nombre === qn) puntos += 120;
    else if (nombre.startsWith(qn)) puntos += 90;
    else if (nombre.includes(qn)) puntos += 60;
    for (const t of terminos) {
      if (t.length < 3) continue;
      if (claves.includes(t)) puntos += 40;
      else if (claves.some(k => k.includes(t))) puntos += 18;
      else if (nombre.includes(t)) puntos += 12;
    }
    if (puntos > 0) out.push({ cat, puntos });
  }
  out.sort((a, b) => b.puntos - a.puntos);
  return out.slice(0, limite).map(o => o.cat);
}

/* ------------------------------------------------------------------ */
/* Bloques reutilizables de la portada                                 */
/* ------------------------------------------------------------------ */
function bloqueHero() {
  return `<section class="hero">
  <div class="row"><div class="columns">
    <h1>Valora tu tiempo.<br>Contrata con TrabajoFácil</h1>
    <h3>Dinos qué necesitas y recibirás hasta 4 presupuestos<br>adaptados a ti</h3>
    <div class="buscador" id="buscador">
      <label class="sr" for="busqueda">En qué quieres que te ayudemos</label>
      <input id="busqueda" class="buscador-input" type="text" autocomplete="off" role="combobox"
             aria-expanded="false" aria-controls="sugerencias" aria-autocomplete="list"
             placeholder="En qué quieres que te ayudemos">
      <button class="buscador-limpiar" id="buscadorLimpiar" type="button" hidden aria-label="Borrar búsqueda">&times;</button>
      <div class="sugerencias" id="sugerencias" role="listbox" hidden></div>
    </div>
    <p class="mt-2" style="opacity:.85;font-size:.85rem">
      <a href="/publicar-tarea" style="color:#fff;text-decoration:underline">O publica tu tarea sin buscar</a>
    </p>
  </div></div>
</section>`;
}

function bloqueCifras() {
  const profs = q.get("SELECT COUNT(*) AS n FROM usuarios WHERE rol='profesional' AND activo=1").n;
  const tareas = q.get("SELECT COUNT(*) AS n FROM tareas WHERE estado IN ('publicada','en_curso')").n;
  const valor = q.get('SELECT AVG(puntuacion) AS v FROM opiniones').v || 4.8;
  return `<section class="row"><div class="columns">
    <ul class="cifras">
      <li class="cifra"><strong>${Number(profs).toLocaleString('es-ES')}</strong><span>Profesionales disponibles</span></li>
      <li class="cifra"><strong>${Number(valor).toFixed(1).replace('.', ',')}/5</strong><span>Valoración media</span></li>
      <li class="cifra"><strong>${Number(tareas).toLocaleString('es-ES')}</strong><span>Tareas abiertas</span></li>
    </ul>
  </div></section>`;
}

function bloqueMapa() {
  return `<section class="mapa">
  <div class="row">
    <div class="columns medium-6 large-5">
      <h4>¿Dónde estamos?</h4>
      <p>Profesionales disponibles para ayudarte en lo que necesites, cerca de tu domicilio. Cuéntanos tu código postal y te mostramos los más cercanos.</p>
      <a class="btn" href="/publicar-tarea">Pide presupuesto gratis</a>
    </div>
    <div class="columns medium-6 large-7">
      <div class="mapa-img"><img src="/assets/img/mapa.svg" alt="Mapa de profesionales disponibles en España" width="800" height="450"></div>
    </div>
  </div>
</section>`;
}

function bloqueServicios() {
  const areas = q.all('SELECT * FROM areas WHERE activa=1 ORDER BY orden');
  const cats = q.all('SELECT * FROM categorias WHERE activa=1 ORDER BY orden');
  const tarjetas = areas.map(a => {
    const sub = cats.filter(c => c.area_id === a.id);
    const primera = sub[0];
    return `<div class="tarjeta"><a href="/servicios-de-${esc(a.slug)}" style="background-image:url('/assets/img/area-${esc(a.icono)}.svg')">
      <span class="precio">${primera ? 'desde ' + fmtEurosCorto(primera.precio_medio) + '/h' : ''}</span>
      <h3>${esc(a.nombre)}</h3>
      <p>${esc(a.descripcion)}</p></a></div>`;
  }).join('');
  return `<section class="servicios" id="servicios">
  <div class="row"><div class="columns"><h2>¿En qué podemos ayudarte?</h2></div></div>
  <div class="row"><div class="columns"><div class="tarjetas">${tarjetas}</div></div></div>
</section>`;
}

function bloqueComoFunciona() {
  return `<section class="como-funciona" id="como-funciona">
  <div class="row"><div class="columns"><h2>¿Cómo funciona?</h2></div></div>
  <div class="row">
    <div class="columns medium-6 large-4"><div class="paso">
      <span class="num">1</span><h3>Cuéntanos qué necesitas</h3>
      <p>Elige un servicio y dinos cómo y cuándo te podemos ayudar. Tarda menos de 2 minutos.</p>
    </div></div>
    <div class="columns medium-6 large-4"><div class="paso">
      <span class="num">2</span><h3>Escoge un profesional</h3>
      <p>Recibe hasta 4 presupuestos y elige por precio, cercanía o reputación. Tú decides.</p>
    </div></div>
    <div class="columns medium-6 large-4"><div class="paso">
      <span class="num">3</span><h3>Disfruta de tu tiempo</h3>
      <p>Pagas online de forma segura y valoras el trabajo. Así los mejores reciben más tareas.</p>
    </div></div>
  </div>
</section>`;
}

function bloquePorque() {
  const items = [
    ['M32 6 L54 16v16c0 14-9.5 22-22 26C19.5 54 10 46 10 32V16z|M23 32l6.5 6.5L42 26', 'Seguro', 'Todos los profesionales están verificados con documento de identidad y el pago queda protegido hasta que el trabajo está hecho.'],
    ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18|M20 33l8 8 16-18', 'Rápido', 'Dinos qué necesitas, dónde y en menos de 5 minutos tienes las primeras respuestas.'],
    ['M14 22h36M14 32h36M14 42h22|M48 43a8 8 0 1 0 0 16 8 8 0 0 0 0-16|M44 43l3 3 5-6', 'Negociable', 'Los profesionales envían su presupuesto y tú eliges. El precio final lo acordáis vosotros.'],
    ['M8 18h48v32H8z|M8 28h48|M22 38h8', 'Pago online', 'Pagas con tarjeta o Bizum cuando aceptes el presupuesto. Sin efectivo y sin sorpresas.']
  ];
  const htmlItems = items.map(([d, t, p]) => `<div class="columns large-3"><div class="item">
      <svg viewBox="0 0 64 64" fill="none" stroke="#2ea378" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        ${d.split('|').map(x => `<path d="${x}"/>`).join('')}
      </svg><h3>${t}</h3><p>${p}</p></div></div>`).join('');
  return `<section class="porque" id="por-que">
  <div class="row"><div class="columns"><h4>¿Por qué TrabajoFácil?</h4></div></div>
  <div class="row">${htmlItems}</div>
</section>`;
}

function bloqueTestimonios() {
  const ops = q.all(`
    SELECT o.*, u.nombre, u.apellidos, u.avatar, cat.nombre AS cat_nombre
    FROM opiniones o
    JOIN usuarios u ON u.id = o.autor_id
    LEFT JOIN categorias cat ON cat.id = (SELECT categoria_id FROM tareas t WHERE t.id = o.tarea_id)
    ORDER BY o.creado_en DESC LIMIT 3`);
  if (!ops.length) return '';
  const tarjetas = ops.map(o => `<div class="columns medium-4"><div class="testimonio">
      <img src="${esc(o.avatar || '/assets/img/avatar-1.svg')}" alt="" width="150" height="150">
      <div class="nombre">${esc(o.nombre)} ${esc((o.apellidos || '').charAt(0) + '.')}</div>
      <blockquote>“${esc(o.comentario)}”</blockquote>
    </div></div>`).join('');
  return `<section class="testimonios">
  <div class="row"><div class="columns"><h3>Nuestros clientes opinan</h3></div></div>
  <div class="row">${tarjetas}</div>
</section>`;
}

function bloqueCta() {
  return `<section class="banner-cta" id="cta">
  <div class="row"><div class="columns">
    <h4>Conviértete en profesional</h4>
    <p>Ofrecete para hacer el trabajo que te gusta, cerca de ti. Publica tu perfil, marca tu precio y elige tus tareas.</p>
    <a class="boton-linea" href="/hazte-profesional">Date de alta</a>
  </div></div>
</section>`;
}

function bloqueColaboradores() {
  const marcas = ['Seguros hogar', 'Muebles', 'Electrodomésticos', 'Bricolaje', 'Alquiler de vans', 'Formación'];
  return `<section class="colaboradores">
  <div class="row"><div class="columns">
    <h3>Colaboraciones</h3>
    <div class="marcas">${marcas.map(m => `<span class="marca">${m}</span>`).join('')}</div>
  </div></div>
</section>`;
}

function bloqueEnlacesSeo() {
  const cats = q.all('SELECT * FROM categorias WHERE activa=1 ORDER BY precio_medio DESC LIMIT 10');
  const ciudades = q.all('SELECT * FROM ciudades WHERE activa=1 ORDER BY nombre LIMIT 12');
  const top = cats.map(c => `<li><a href="/servicios-de-${esc(c.slug)}">${esc(c.nombre)} baratos</a></li>`).join('');
  const combo = [];
  for (const ci of ciudades) {
    for (const c of cats.slice(0, 4)) {
      combo.push(`<li><a href="/servicios-de-${esc(c.slug)}-en-${esc(ci.slug)}">${esc(c.nombre)} en ${esc(ci.nombre)} baratos</a></li>`);
    }
  }
  return `<section class="enlaces-seo">
  <div class="row">
    <div class="columns medium-6 large-3"><h4>Principales servicios</h4><ul>${top}</ul></div>
    <div class="columns medium-6 large-9"><h4>Servicios más demandados por población</h4><ul>${combo.join('')}</ul></div>
  </div>
</section>`;
}

/* ------------------------------------------------------------------ */
/* Rutas                                                                */
/* ------------------------------------------------------------------ */
export function registrarPublico(router) {

  /* ---------------- portada ---------------- */
  router.get('/', async (ctx) => {
    const contenido = bloqueHero() + bloqueCifras() + bloqueMapa() + bloqueServicios()
      + bloqueComoFunciona() + bloquePorque() + bloqueTestimonios() + bloqueCta()
      + bloqueColaboradores() + bloqueEnlacesSeo();
    return layout({
      titulo: 'Valora tu tiempo. Contrata con gente de confianza',
      descripcion: 'Encuentra a quien te eche una mano con limpieza, mudanzas, reparaciones, informática y más. Pide hasta 4 presupuestos y elige el mejor.',
      usuario: ctx.usuario, ruta: '/', contenido,
      scripts: ['/assets/js/publico.js']
    });
  });

  /* ---------------- catálogo de servicios ---------------- */
  router.get('/servicios', async (ctx) => {
    const areas = q.all('SELECT * FROM areas WHERE activa=1 ORDER BY orden');
    const cats = q.all('SELECT * FROM categorias WHERE activa=1 ORDER BY orden');
    const bloques = areas.map(a => {
      const sub = cats.filter(c => c.area_id === a.id);
      if (!sub.length) return '';
      return `<div class="panel serv-panel">
        <h3><a href="/servicios-de-${esc(a.slug)}">${esc(a.nombre)}</a></h3>
        <p class="muted">${esc(a.descripcion)}</p>
        <ul class="serv-lista">${sub.map(c => `<li>
          <a href="/servicios-de-${esc(c.slug)}"><span class="badge-cat" style="background:${esc(c.color)}">${esc(c.code)}</span> ${esc(c.nombre)}</a>
          <span class="precio">${fmtEurosCorto(c.precio_medio)}/h</span></li>`).join('')}</ul>
      </div>`;
    }).join('');
    return layout({
      titulo: 'Todos los servicios', descripcion: 'Catálogo completo de servicios por horas disponibles en TrabajoFácil.',
      usuario: ctx.usuario, ruta: '/servicios',
      contenido: `<div class="row"><div class="columns">
        <h1>Todos los servicios</h1>
        <p class="muted">${cats.length} servicios en ${areas.length} áreas. Publica tu tarea y recibe hasta 4 presupuestos.</p>
      </div></div>
      <div class="row"><div class="columns">${bloques}</div></div>`
    });
  });

  /* ---------------- landing SEO servicio × ciudad (ANTES que /servicios-de-:slug) ------- */
  router.get('/servicios-de-:slug-en-:ciudad', async (ctx) => {
    const cat = q.get('SELECT * FROM categorias WHERE slug=? AND activa=1', ctx.params.slug)
             || q.get('SELECT * FROM areas WHERE slug=? AND activa=1', ctx.params.slug);
    const ciudad = q.get('SELECT * FROM ciudades WHERE slug=? AND activa=1', ctx.params.ciudad);
    if (!cat || !ciudad) return null;

    const profs = q.all(`${SQL_PROF} AND p.estado_verificacion='aprobado' AND (ci.slug=? OR u.ciudad_id IS NULL) LIMIT 6`, ciudad.slug);
    const tareas = q.all(`${SQL_TAREA} WHERE t.estado='publicada' AND t.ciudad_id=? ORDER BY t.creada_en DESC LIMIT 6`, ciudad.id);
    const esArea = !!cat.descripcion && !('precio_medio' in cat);
    const precio = cat.precio_medio ? `desde ${fmtEurosCorto(cat.precio_medio)}/h` : '';

    const contenido = `<div class="row"><div class="columns">
      <nav class="migas"><a href="/">Inicio</a> › <a href="/servicios">Servicios</a> › ${esc(cat.nombre)} en ${esc(ciudad.nombre)}</nav>
      <h1>${esc(cat.nombre)} en ${esc(ciudad.nombre)}</h1>
      <p class="intro">${esArea ? esc(cat.descripcion) : esc(cat.nombre + ' en ' + ciudad.nombre + '. Encuentra profesionales verificados, compara presupuestos y contrata el que mejor te encaje.')}</p>
      <div class="acciones">
        <a class="btn" href="/publicar-tarea?categoria=${esc(cat.slug)}">Pedir presupuesto en ${esc(ciudad.nombre)}</a>
        <a class="btn btn-hollow" href="/t/taskers-${esc(cat.slug)}">Ver profesionales</a>
      </div>
      ${precio ? `<p class="muted mt-2">Precio medio de referencia: <b>${precio}</b></p>` : ''}
    </div></div>

    <div class="row"><div class="columns">
      <div class="panel">
        <h3>Profesionales disponibles en ${esc(ciudad.nombre)}</h3>
        ${profs.length ? `<div class="taskers-mini">${profs.map(p => `
          <a class="tasker-mini" href="/t/${p.id}">
            <img src="${esc(p.avatar || '/assets/img/avatar-1.svg')}" alt="" width="52" height="52">
            <div class="datos"><b>${esc(titulo(p))} <span class="tick">✓</span></b>
              <span>${esc(p.ciudad || ciudad.nombre)} · ★ ${Number(p.valoracion || 0).toFixed(1)} (${p.opiniones || 0})</span></div>
            <span style="color:var(--verde);font-weight:700">${fmtEurosCorto(p.precio_hora)}/h</span></a>`).join('')}</div>`
          : '<p class="vacio">Todavía no hay profesionales verificados en esta población. Publica tu tarea y te contactaremos en cuanto haya uno disponible.</p>'}
      </div>
    </div></div>

    <div class="row"><div class="columns">
      <div class="panel">
        <h3>Tareas recientes en ${esc(ciudad.nombre)}</h3>
        ${tareas.length ? `<div class="taskers-mini">${tareas.map(t => `<a class="tasker-mini" href="/tareas-publicas/${t.id}">
          <div class="datos"><b>${esc(t.titulo)}</b><span>${esc(t.categoria_nombre || '')} · ${esc(t.fecha || '')} · ${t.ofertas} oferta(s)</span></div></a>`).join('')}</div>`
          : '<p class="vacio">No hay tareas abiertas en esta población ahora mismo.</p>'}
      </div>
    </div></div>

    <div class="row"><div class="columns">
      <div class="panel"><h3>Preguntas frecuentes</h3>
        ${[['¿Cuánto cuesta ' + cat.nombre.toLowerCase() + ' en ' + ciudad.nombre + '?',
            'El precio depende de las horas y del profesional. La referencia media es ' + (cat.precio_medio ? fmtEurosCorto(cat.precio_medio) + ' por hora' : 'la que marcan los profesionales al publicar su presupuesto') + ', y siempre recibes hasta 4 ofertas para comparar.'],
           ['¿Puedo pedir presupuesto sin pagar nada?',
            'Sí. Publicar la tarea y recibir ofertas es gratuito. Solo pagas cuando aceptas un presupuesto.'],
           ['¿Cómo sé si el profesional es de fiar?',
            'Verificamos su documento de identidad antes de publicar su perfil, y cada tarea terminada genera una valoración pública.']]
          .map(f => `<div class="faq"><b>${esc(f[0])}</b><p>${esc(f[1])}</p></div>`).join('')}
      </div>
    </div></div>`;

    return layout({
      titulo: `${cat.nombre} en ${ciudad.nombre}`, descripcion: `${cat.nombre} en ${ciudad.nombre}. Pide hasta 4 presupuestos y elige el mejor.`,
      usuario: ctx.usuario, ruta: '/servicios', contenido, ancho: 'ancho'
    });
  });

  /* ---------------- landing de servicio ---------------- */
  router.get('/servicios-de-:slug', async (ctx) => {
    const cat = q.get('SELECT * FROM categorias WHERE slug=? AND activa=1', ctx.params.slug)
             || q.get('SELECT * FROM areas WHERE slug=? AND activa=1', ctx.params.slug);
    if (!cat) return null;
    const esArea = !('precio_medio' in cat);
    const cats = esArea
      ? q.all('SELECT * FROM categorias WHERE area_id=? AND activa=1 ORDER BY orden', cat.id)
      : [];
    const profs = q.all(`${SQL_PROF} AND p.estado_verificacion='aprobado' LIMIT 8`);
    const ciudades = q.all('SELECT * FROM ciudades WHERE activa=1 ORDER BY nombre LIMIT 12');
    const media = esArea
      ? (q.get('SELECT AVG(precio_medio) AS v FROM categorias WHERE area_id=?', cat.id).v || 0)
      : (cat.precio_medio || 0);

    const contenido = `<div class="row"><div class="columns">
      <nav class="migas"><a href="/">Inicio</a> › <a href="/servicios">Servicios</a> › ${esc(cat.nombre)}</nav>
      <h1>${esc(cat.nombre)}</h1>
      <p class="intro">${esc(cat.descripcion || (esArea ? 'Encuentra profesionales verificados y compara presupuestos.' : 'Encuentra profesionales verificados y compara hasta 4 presupuestos.'))}</p>
      <div class="acciones">
        <a class="btn" href="/publicar-tarea${esArea && cats.length ? '?categoria=' + esc(cats[0].slug) : ''}">Pedir presupuesto</a>
        ${esArea ? `<a class="btn btn-hollow" href="/t">Ver profesionales</a>` : `<a class="btn btn-hollow" href="/t/taskers-${esc(cat.slug)}">Ver profesionales de este servicio</a>`}
      </div>
      ${media ? `<p class="muted mt-2">Precio medio de referencia: <b>${fmtEurosCorto(media)}</b> por hora</p>` : ''}
    </div></div>

    ${esArea && cats.length ? `<div class="row"><div class="columns"><div class="panel">
      <h3>Servicios dentro de ${esc(cat.nombre)}</h3>
      <ul class="serv-lista">${cats.map(c => `<li>
        <a href="/servicios-de-${esc(c.slug)}"><span class="badge-cat" style="background:${esc(c.color)}">${esc(c.code)}</span> ${esc(c.nombre)}</a>
        <span class="precio">${fmtEurosCorto(c.precio_medio)}/h</span></li>`).join('')}</ul>
    </div></div></div>` : ''}

    <div class="row"><div class="columns"><div class="panel">
      <h3>Profesionales verificados</h3>
      ${profs.length ? `<div class="taskers-mini">${profs.map(p => `
        <a class="tasker-mini" href="/t/${p.id}">
          <img src="${esc(p.avatar || '/assets/img/avatar-1.svg')}" alt="" width="52" height="52">
          <div class="datos"><b>${esc(titulo(p))} <span class="tick">✓</span></b>
            <span>${esc(p.ciudad || '')} · ★ ${Number(p.valoracion || 0).toFixed(1)} (${p.opiniones || 0})</span></div>
          <span style="color:var(--verde);font-weight:700">${fmtEurosCorto(p.precio_hora)}/h</span></a>`).join('')}</div>`
        : '<p class="vacio">Todavía no hay profesionales verificados en este servicio.</p>'}
    </div></div></div>

    <div class="row"><div class="columns"><div class="panel">
      <h3>En ${esc(cat.nombre.toLowerCase())} cerca de ti</h3>
      <div class="chips">${ciudades.map(ci => `<a class="chip" href="/servicios-de-${esc(cat.slug)}-en-${esc(ci.slug)}">${esc(ci.nombre)}</a>`).join('')}</div>
    </div></div></div>`;

    return layout({
      titulo: cat.nombre, descripcion: cat.descripcion || `${cat.nombre}: precios, profesionales verificados y presupuestos.`,
      usuario: ctx.usuario, ruta: '/servicios', contenido, ancho: 'ancho'
    });
  });

  /* ---------------- profesionales ---------------- */
  router.get('/t', async (ctx) => {
    const catSlug = ctx.query.categoria;
    const ciudad = ctx.query.ciudad;
    let sql = `${SQL_PROF} AND p.estado_verificacion='aprobado'`;
    const args = [];
    if (catSlug) { const c = q.get('SELECT id FROM categorias WHERE slug=?', catSlug); if (c) { sql += " AND p.categorias LIKE ?"; args.push('%"' + c.id + '"%'); } }
    if (ciudad) { sql += ' AND ci.slug=?'; args.push(ciudad); }
    const profs = q.all(sql, ...args);
    const cats = q.all('SELECT * FROM categorias WHERE activa=1 ORDER BY nombre');
    const ciudades = q.all('SELECT * FROM ciudades WHERE activa=1 ORDER BY nombre');

    const contenido = `<div class="row"><div class="columns">
      <h1>Profesionales disponibles</h1>
      <p class="intro">${profs.length} profesional(es) verificado(s). Todos han pasado la revisión de identidad.</p>
      <form class="filtros" method="get" action="/t">
        <select name="categoria">
          <option value="">Todos los servicios</option>
          ${cats.map(c => `<option value="${esc(c.slug)}"${catSlug === c.slug ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('')}
        </select>
        <select name="ciudad">
          <option value="">Todas las ciudades</option>
          ${ciudades.map(c => `<option value="${esc(c.slug)}"${ciudad === c.slug ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('')}
        </select>
        <button class="btn btn-sm" type="submit">Filtrar</button>
      </form>
    </div></div>
    <div class="row"><div class="columns">
      <div class="grid-prof">
        ${profs.length ? profs.map(p => tarjetaProfesional(p)).join('') : '<p class="vacio">No hay profesionales que cumplan estos filtros.</p>'}
      </div>
    </div></div>`;
    return layout({ titulo: 'Profesionales', usuario: ctx.usuario, ruta: '/t', contenido });
  });

  router.get('/t/taskers-:slug', async (ctx) => {
    const cat = q.get('SELECT * FROM categorias WHERE slug=? AND activa=1', ctx.params.slug);
    if (!cat) return null;
    const profs = q.all(`${SQL_PROF} AND p.estado_verificacion='aprobado' AND p.categorias LIKE ?`, '%"' + cat.id + '"%');
    const contenido = `<div class="row"><div class="columns">
      <nav class="migas"><a href="/">Inicio</a> › <a href="/servicios">Servicios</a> › ${esc(cat.nombre)}</nav>
      <h1>${esc(cat.nombre)}: profesionales ytaskers</h1>
      <p class="intro">${profs.length} profesional(es) de ${esc(cat.nombre.toLowerCase())} disponibles.</p>
      <div class="acciones"><a class="btn" href="/publicar-tarea?categoria=${esc(cat.slug)}">Publica tu tarea</a></div>
    </div></div>
    <div class="row"><div class="columns">
      <div class="grid-prof">${profs.length ? profs.map(p => tarjetaProfesional(p)).join('') : '<p class="vacio">Aún no hay profesionales verificados en este servicio.</p>'}</div>
    </div></div>`;
    return layout({ titulo: `${cat.nombre} — profesionales`, usuario: ctx.usuario, ruta: '/t', contenido });
  });

  router.get('/t/:id', async (ctx) => {
    const p = q.get(`${SQL_PROF} AND u.id=?`, ctx.params.id);
    if (!p) return null;
    const cats = p.categorias ? (() => { try { return JSON.parse(p.categorias); } catch { return []; } })() : [];
    const misCats = cats.length ? q.all(`SELECT * FROM categorias WHERE id IN (${cats.map(() => '?').join(',')})`, ...cats) : [];
    const ops = q.all(`
      SELECT o.*, u.nombre, u.apellidos, u.avatar, t.titulo AS tarea_titulo
      FROM opiniones o JOIN usuarios u ON u.id=o.autor_id
      LEFT JOIN tareas t ON t.id=o.tarea_id
      WHERE o.profesional_id=? ORDER BY o.creado_en DESC LIMIT 10`, p.id);

    const contenido = `<div class="row"><div class="columns">
      <div class="perfil-cab">
        <img src="${esc(p.avatar || '/assets/img/avatar-1.svg')}" alt="" width="132" height="132">
        <div>
          <h1>${esc(titulo(p))} ${p.estado_verificacion === 'aprobado' ? '<span class="tick">✓</span>' : ''}</h1>
          <div class="estrellas">${estrellas(p.valoracion || 0)} <span class="muted">${Number(p.valoracion || 0).toFixed(1)} · ${p.opiniones || 0} opiniones</span></div>
          <div class="meta">${esc(p.ciudad || '')} · En TrabajoFácil desde ${esc((p.desde || '').slice(0, 10))}</div>
          <div class="etiquetas">
            ${p.estado_verificacion === 'aprobado' ? '<span class="etiqueta">Identidad verificada</span>' : '<span class="etiqueta warn">Identidad pendiente de verificar</span>'}
            ${misCats.map(c => `<a class="etiqueta" href="/servicios-de-${esc(c.slug)}">${esc(c.nombre)}</a>`).join('')}
          </div>
        </div>
      </div>
    </div></div>

    <div class="row">
      <div class="columns medium-7 large-8">
        <div class="panel">
          <h3>Datos</h3>
          <div class="factores">
            <div><b>${fmtEurosCorto(p.precio_hora)}</b><span>Precio por hora</span></div>
            <div><b>${p.opiniones || 0}</b><span>Opiniones</span></div>
            <div><b>${Number(p.valoracion || 0).toFixed(1)}/5</b><span>Valoración media</span></div>
            <div><b>${p.trabajos || 0}</b><span>Trabajos aceptados</span></div>
          </div>
        </div>
        <div class="panel">
          <h3>Sobre ${esc(p.nombre)}</h3>
          <p class="muted">${esc(p.bio || 'Profesional verificado por TrabajoFácil. Los clientes valoran la puntualidad, la calidad del trabajo y la claridad en los presupuestos.')}</p>
          <p class="muted">Titularidad: ${esc(p.titularidad || 'autónomo')} · Radio de acción: ${p.radio_km || 10} km</p>
        </div>
        <div class="panel">
          <h3>Opiniones (${p.opiniones || 0})</h3>
          ${ops.length ? ops.map(o => `<div class="opinion">
            <div class="quien">${esc(o.nombre)} ${esc((o.apellidos || '').charAt(0) + '.')}</div>
            <div class="fecha">${estrellas(o.puntuacion)} · ${esc(tiempoRelativo(o.creado_en))}</div>
            <p>${esc(o.comentario)}</p></div>`).join('')
            : '<p class="vacio">Todavía no tiene opiniones públicas.</p>'}
          <p class="mt-2"><a href="/t/${p.id}/reviews">Ver todas las opiniones</a> · <a href="/t/${p.id}/aboutme">Sobre mí</a></p>
        </div>
      </div>
      <div class="columns medium-5 large-4">
        <div class="panel">
          <h3>Contratar</h3>
          <p class="muted">Pide un presupuesto y ${esc(p.nombre)} lo recibirá directamente.</p>
          <a class="btn btn-block" href="/publicar-tarea${misCats.length ? '?categoria=' + esc(misCats[0].slug) : ''}">Pedir presupuesto</a>
          ${!ctx.usuario ? '<p class="muted mt-2"><a href="/accede">Accede</a> o <a href="/registro">crea una cuenta</a> para continuar.</p>' : ''}
        </div>
      </div>
    </div>`;
    return layout({ titulo: `${titulo(p)} — profesional`, usuario: ctx.usuario, ruta: '/t', contenido });
  });

  router.get('/t/:id/reviews', async (ctx) => {
    const p = q.get(`${SQL_PROF} AND u.id=?`, ctx.params.id);
    if (!p) return null;
    const ops = q.all(`
      SELECT o.*, u.nombre, u.apellidos, u.avatar FROM opiniones o
      JOIN usuarios u ON u.id=o.autor_id WHERE o.profesional_id=? ORDER BY o.creado_en DESC`, p.id);
    const contenido = `<div class="row"><div class="columns">
      <nav class="migas"><a href="/t/${p.id}">${esc(titulo(p))}</a> › Opiniones</nav>
      <h1>Opiniones de ${esc(titulo(p))}</h1>
      <p class="intro">${Number(p.valoracion || 0).toFixed(1)}/5 · ${p.opiniones || 0} opiniones verificadas</p>
    </div></div>
    <div class="row"><div class="columns"><div class="panel">
      ${ops.length ? ops.map(o => `<div class="opinion">
        <div class="quien">${esc(o.nombre)} ${esc((o.apellidos || '').charAt(0) + '.')}</div>
        <div class="fecha">${estrellas(o.puntuacion)} · ${esc(fmtFecha(o.creado_en))}</div>
        <p>${esc(o.comentario)}</p></div>`).join('')
        : '<p class="vacio">Todavía no hay opiniones.</p>'}
    </div></div></div>`;
    return layout({ titulo: `Opiniones de ${titulo(p)}`, usuario: ctx.usuario, ruta: '/t', contenido });
  });

  router.get('/t/:id/aboutme', async (ctx) => {
    const p = q.get(`${SQL_PROF} AND u.id=?`, ctx.params.id);
    if (!p) return null;
    const cats = p.categorias ? (() => { try { return JSON.parse(p.categorias); } catch { return []; } })() : [];
    const misCats = cats.length ? q.all(`SELECT * FROM categorias WHERE id IN (${cats.map(() => '?').join(',')})`, ...cats) : [];
    const contenido = `<div class="row"><div class="columns">
      <nav class="migas"><a href="/t/${p.id}">${esc(titulo(p))}</a> › Sobre mí</nav>
      <h1>Sobre ${esc(p.nombre)}</h1>
      <div class="panel">
        <p>${esc(p.bio || 'Profesional verificado por TrabajoFácil.')}</p>
        <h3>Servicios</h3>
        <div class="chips">${misCats.map(c => `<a class="chip" href="/servicios-de-${esc(c.slug)}">${esc(c.nombre)}</a>`).join('') || '<span class="muted">—</span>'}</div>
        <h3 class="mt-2">Zona de trabajo</h3>
        <p class="muted">${esc(p.ciudad || 'Sin ciudad')}${p.radio_km ? ' · hasta ' + p.radio_km + ' km' : ''}</p>
      </div>
    </div></div>`;
    return layout({ titulo: `Sobre ${titulo(p)}`, usuario: ctx.usuario, ruta: '/t', contenido });
  });

  /* ---------------- tareas públicas ---------------- */
  router.get('/tareas-publicas', async (ctx) => {
    const cat = ctx.query.categoria;
    const ciudad = ctx.query.ciudad;
    let sql = `${SQL_TAREA} WHERE t.estado IN ('publicada','en_curso')`;
    const args = [];
    if (cat) { const c = q.get('SELECT id FROM categorias WHERE slug=?', cat); if (c) { sql += ' AND t.categoria_id=?'; args.push(c.id); } }
    if (ciudad) { const c = q.get('SELECT id FROM ciudades WHERE slug=?', ciudad); if (c) { sql += ' AND t.ciudad_id=?'; args.push(c.id); } }
    const tareas = q.all(sql + ' ORDER BY t.creada_en DESC LIMIT 60', ...args);
    const cats = q.all('SELECT * FROM categorias WHERE activa=1 ORDER BY nombre');
    const ciudades = q.all('SELECT * FROM ciudades WHERE activa=1 ORDER BY nombre');

    const contenido = `<div class="row"><div class="columns">
      <h1>Tareas publicadas</h1>
      <p class="intro">${tareas.length} tarea(s) abiertas. Puedes总额的 directamente a los profesionales de una zona.</p>
      <form class="filtros" method="get" action="/tareas-publicas">
        <select name="categoria"><option value="">Todos los servicios</option>
          ${cats.map(c => `<option value="${esc(c.slug)}"${cat === c.slug ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
        <select name="ciudad"><option value="">Todas las ciudades</option>
          ${ciudades.map(c => `<option value="${esc(c.slug)}"${ciudad === c.slug ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
        <button class="btn btn-sm" type="submit">Filtrar</button>
      </form>
    </div></div>
    <div class="row"><div class="columns">
      <div class="grid-tareas">${tareas.length ? tareas.map(t => tarjetaTarea(t)).join('') : '<p class="vacio">No hay tareas con esos filtros.</p>'}</div>
    </div></div>`;
    return layout({ titulo: 'Tareas publicadas', usuario: ctx.usuario, ruta: '/tareas-publicas', contenido });
  });

  router.get('/tareas-publicas/:id', async (ctx) => {
    const t = q.get(`${SQL_TAREA} WHERE t.id=?`, ctx.params.id);
    if (!t) return null;
    const cats = t.categoria_slug ? q.all('SELECT * FROM categorias WHERE area_id=(SELECT area_id FROM categorias WHERE slug=?) AND activa=1 LIMIT 8', t.categoria_slug) : [];
    const fotos = fotosDeTarea(t.id).map(urlFoto).filter(Boolean);
    const verif = t.cliente_id ? q.get("SELECT estado FROM verificaciones WHERE usuario_id=?", t.cliente_id) : null;
    const clienteVerificado = !!verif && verif.estado === 'aprobado';
    const contenido = `<div class="row"><div class="columns">
      <nav class="migas"><a href="/tareas-publicas">Tareas</a> › ${esc(t.categoria_nombre || 'Tarea')}</nav>
      <h1>${esc(t.titulo)}</h1>
      <p class="intro">${esc(t.categoria_nombre || '')} · ${esc(t.ciudad_nombre || '')} · ${esc(fmtFecha(t.fecha))}</p>
      ${clienteVerificado ? '<p class="mt-2"><span class="pill-estado" style="background:var(--verde)">✓ Cliente verificado</span></p>' : ''}
    </div></div>
    <div class="row"><div class="columns">
      <div class="panel">
        <h3>Descripción</h3>
        <p>${esc(t.descripcion)}</p>
        <div class="factores mt-2">
          <div><b>${t.horas || 1} h</b><span>Horas estimadas</span></div>
          <div><b>${esc(t.hora || '—')}</b><span>Hora de inicio</span></div>
          <div><b>${t.ofertas || 0}</b><span>Ofertas recibidas</span></div>
        </div>
        <div class="acciones mt-2">
          <a class="btn" href="/publicar-tarea${t.categoria_slug ? '?categoria=' + esc(t.categoria_slug) : ''}">Quiero un trabajo así</a>
        </div>
      </div>
    </div></div>
    ${fotos.length ? `<div class="row"><div class="columns"><div class="panel">
      <h3>Fotos del trabajo</h3>
      <p class="muted">El cliente adjuntó fotos del trabajo: la oferta es real.</p>
      <div class="doc-galeria mt-2">
        ${fotos.map((f, i) => `<figure class="doc-foto">
          <a href="${esc(f)}" target="_blank" rel="noopener"><img src="${esc(f)}" alt="Foto del trabajo ${i + 1}" loading="lazy"></a>
          <figcaption>Foto ${i + 1} · <a href="${esc(f)}" target="_blank" rel="noopener">Abrir</a></figcaption>
        </figure>`).join('')}
      </div>
    </div></div></div>` : ''}
    ${cats.length ? `<div class="row"><div class="columns"><div class="panel">
      <h3>Servicios relacionados</h3>
      <div class="chips">${cats.map(c => `<a class="chip" href="/servicios-de-${esc(c.slug)}">${esc(c.nombre)}</a>`).join('')}</div>
    </div></div></div>` : ''}`;
    return layout({ titulo: t.titulo, descripcion: t.descripcion, usuario: ctx.usuario, ruta: '/tareas-publicas', contenido });
  });

  /* ---------------- páginas de contenido ---------------- */
  router.get('/como-funciona', async (ctx) => {
    const contenido = `<div class="row"><div class="columns">
      <h1>Cómo funciona</h1>
      <p class="intro">Publicar una tarea es gratis. Solo pagas cuando aceptas un presupuesto.</p>
    </div></div>
    <div class="row"><div class="columns">
      ${[['Publica tu tarea', 'Verificamos tu identidad con DNI/NIE y te pedimos una foto del trabajo. Elige el servicio, indica código postal, fecha, horas y describe qué necesitas. Tarda menos de 2 minutos.', '1'],
         ['Recibe hasta 4 presupuestos', 'Solo los profesionales verificados y disponibles en tu zona ven tu tarea. Comparas precio, cercanía y valoración.', '2'],
         ['Elige y paga online', 'Aceptas el presupuesto que prefieras, acordas el precio por chat y pagas de forma segura. El profesional cobra el importe íntegro pactado contigo.', '3'],
         ['Valora el trabajo', 'Al terminar, valoras al profesional. Esa valoración es pública y es lo que sostiene la confianza del marketplace.', '4']]
        .map(f => `<div class="columns medium-6 large-3"><div class="panel centro">
          <span class="num-bola">${f[2]}</span><h3>${f[0]}</h3><p class="muted">${f[1]}</p></div></div>`).join('')}
    </div></div>
    <div class="row"><div class="columns"><div class="panel">
      <h3>Para los profesionales</h3>
      <p class="muted">Publica tu perfil, marca tu precio por hora y elige las tareas que te interesan. Te llega un aviso en cuanto hay una cerca de ti.
      <a href="/hazte-profesional">Date de alta como profesional</a>.</p>
    </div></div></div>
    <div class="row"><div class="columns"><div class="panel">
      <h3>El monedero de tokens</h3>
      <p class="muted">Para participar en el marketplace, el profesional compra tokens. Cada presupuesto que envías cuesta <b>10 tokens (1,00 €)</b>. Si el cliente no acepta tu presupuesto, te devolvemos <b>5 tokens (0,50 €)</b>, la mitad de lo gastado; si lo acepta, no se devuelve ninguno. El precio del trabajo lo pactas tú con el cliente y cobras el <b>100 %</b> de ese importe.</p>
      <div class="acciones">
        <a class="btn btn-hollow" href="/precios">Ver precios</a>
        <a class="btn btn-hollow" href="/hazte-profesional">Hazte profesional</a>
      </div>
    </div></div></div>`;
    return layout({ titulo: 'Cómo funciona', usuario: ctx.usuario, ruta: '/como-funciona', contenido });
  });

  router.get('/precios', async (ctx) => {
    const cats = q.all('SELECT * FROM categorias WHERE activa=1 ORDER BY precio_medio ASC');
    const contenido = `<div class="row"><div class="columns">
      <h1>Precios</h1>
      <p class="intro">Publicar una tarea es <b>gratis</b>. La única tasa de TrabajoFácil son los tokens que gasta el profesional al enviar presupuestos: <b>10 tokens = 1,00 €</b>.</p>
    </div></div>
    <div class="row"><div class="columns">
      <div class="panel">
        <h3>Si tienes un problema que resolver</h3>
        <p>Publicar una tarea es <b>gratis</b>: sin tokens, sin comisión y sin coste por recibir presupuestos. Antes de publicar verificamos tu identidad con DNI/NIE y te pedimos al menos una foto del trabajo, para que la oferta sea real. Solo pagas cuando contratas, y el precio lo pactas directamente con el profesional.</p>
        <div class="acciones"><a class="btn" href="/publicar-tarea">Publica tu tarea gratis</a></div>
      </div>
      <div class="panel">
        <h3>Si eres profesional</h3>
        <p>Cada presupuesto que envías cuesta <b>10 tokens (1,00 €)</b>. Si el cliente no lo acepta te devolvemos <b>5 tokens (0,50 €)</b>, la mitad; si lo acepta, no se devuelve ninguno. Y recibes el <b>100 % del importe pactado</b> con el cliente, sin comisión de plataforma.</p>
        <div class="acciones"><a class="btn" href="/hazte-profesional">Hazte profesional</a></div>
      </div>
    </div></div>
    <div class="row"><div class="columns"><div class="panel">
      <h3>Reglas y equivalencia en euros</h3>
      <div class="table-wrap"><table class="tabla">
        <thead><tr><th>Regla</th><th>Tokens</th><th>Equivalente</th></tr></thead>
        <tbody>
          <tr><td>Publicar una tarea (cliente)</td><td>0</td><td><b>0,00 €</b></td></tr>
          <tr><td>Enviar un presupuesto (profesional)</td><td>10</td><td><b>1,00 €</b></td></tr>
          <tr><td>Devolución si el presupuesto no se acepta</td><td>5</td><td><b>0,50 €</b></td></tr>
          <tr><td>Comisión sobre el importe del trabajo</td><td>0</td><td><b>0 €</b></td></tr>
          <tr><td>Importe que recibe el profesional</td><td>—</td><td><b>100 % de lo pactado</b></td></tr>
        </tbody>
      </table></div>
    </div></div></div>
    <div class="row"><div class="columns"><div class="panel">
      <h3>Precios medios de referencia</h3>
      <div class="table-wrap"><table class="tabla">
        <thead><tr><th>Servicio</th><th>Precio medio por hora</th><th></th></tr></thead>
        <tbody>${cats.map(c => `<tr>
          <td><span class="badge-cat" style="background:${esc(c.color)}">${esc(c.code)}</span> ${esc(c.nombre)}</td>
          <td><b>${fmtEurosCorto(c.precio_medio)}</b></td>
          <td><a href="/publicar-tarea?categoria=${esc(c.slug)}">Pedir presupuesto</a></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div></div></div>
    <div class="row"><div class="columns"><div class="panel">
      <h3>Ejemplo de cómo se calcula</h3>
      <p class="muted">Una tarea de 3 horas a 18 €/h son 54 €. El profesional cobra los <b>54 €</b> íntegros: TrabajoFácil no cobra comisión sobre el importe del trabajo. La única tasa es la del profesional por enviar su presupuesto (10 tokens = 1,00 €), y recupera 5 tokens si el cliente no elige su presupuesto.</p>
    </div></div></div>`;
    return layout({
      titulo: 'Precios',
      descripcion: 'Publicar una tarea es gratis. Cada presupuesto enviado cuesta 10 tokens (1,00 €) y no hay comisión sobre el importe del trabajo.',
      usuario: ctx.usuario, ruta: '/precios', contenido
    });
  });

  router.get('/hazte-profesional', async (ctx) => {
    const contenido = `<div class="row"><div class="columns">
      <nav class="migas"><a href="/">Inicio</a> › Hazte profesional</nav>
      <h1>Hazte profesional en TrabajoFácil</h1>
      <p class="intro">Encuentra tareas cerca de ti, marca tu precio y cobra de forma segura.</p>
    </div></div>
    <div class="row">
      <div class="columns medium-6 large-4"><div class="panel">
        <h3>1 · Regístrate</h3>
        <p class="muted">Crea una cuenta de profesional: son 2 minutos y no tiene coste.</p>
        <a class="btn btn-block" href="/registro?rol=profesional">Crear cuenta de profesional</a>
      </div></div>
      <div class="columns medium-6 large-4"><div class="panel">
        <h3>2 · Verifica tu identidad</h3>
        <p class="muted">Sube tu DNI/NIE y un selfie. Un administrador lo revisa y tu perfil recibe el sello de verificado.</p>
        <a class="btn btn-block btn-hollow" href="/profesional/verificacion">Verificar identidad</a>
      </div></div>
      <div class="columns medium-6 large-4"><div class="panel">
        <h3>3 · Gana dinero</h3>
        <p class="muted">Recibe avisos de tareas nuevas y cobra en tu monedero. Sin cuota de alta ni cuota mensual.</p>
        <a class="btn btn-block btn-hollow" href="/tareas-publicas">Ver tareas abiertas</a>
      </div></div>
    </div>
    <div class="row"><div class="columns"><div class="panel">
      <h3>Lo que nos preguntáis</h3>
      ${[['¿Tengo que pagar por estar de alta?', 'No. No hay cuota de alta ni cuota mensual. Solo gastas tokens al enviar presupuestos y no hay comisión sobre el trabajo que realizas.'],
         ['¿Cuánto cuesta enviar un presupuesto?', 'Cada presupuesto que envías cuesta 10 tokens (1,00 €). Si el cliente no elige tu presupuesto, te devolvemos 5 tokens (0,50 €), la mitad; si lo acepta, no se devuelve ninguno.'],
         ['¿Cuándo me pagan?', 'El importe se ingresa en tu monedero en cuanto el cliente acepta tu presupuesto, y puedes retirarlo cuando quieras.'],
         ['¿Cómo sé que me pagarán?', 'El cliente paga el importe pactado al aceptar tu presupuesto y tú cobras el 100 % de esa cantidad, sin comisión de plataforma.']]
        .map(f => `<div class="faq"><b>${f[0]}</b><p class="muted">${f[1]}</p></div>`).join('')}
    </div></div></div>
    <div class="row"><div class="columns"><div class="panel">
      <h3>Cuánto cuesta participar</h3>
      <p class="muted">Enviar un presupuesto cuesta <b>10 tokens (1,00 €)</b>. Si el cliente no lo elige, te devolvemos <b>5 tokens (0,50 €)</b>, la mitad de lo gastado; si lo acepta, no se devuelve ninguno. No hay comisión sobre el trabajo: cobras el <b>importe íntegro</b> que pactas con el cliente (100 %).</p>
      <div class="acciones">
        <a class="btn" href="/precios">Ver el detalle de precios</a>
        <a class="btn btn-hollow" href="/registro?rol=profesional">Crear cuenta de profesional</a>
      </div>
    </div></div></div>`;
    return layout({ titulo: 'Hazte profesional', usuario: ctx.usuario, ruta: '/hazte-profesional', contenido });
  });

  router.get('/aviso-legal', async (ctx) => {
    const contenido = `<div class="aviso">
      <h1>Aviso legal, privacidad y cookies</h1>
      <div class="nota-ok"><b>Prototipo de demostración.</b> No es un servicio real: los datos son de prueba, no se procesan pagos y las verificaciones no se revisan fuera de este entorno. Este texto es una plantilla y debe revisarla un profesional jurídico antes de publicarse.</div>
      <h2>1. Titular</h2>
      <p>TrabajoFácil es una plataforma de intermediación entre clientes y profesionales de servicios por horas. Titular: [RAZÓN SOCIAL], con domicilio en [DOMICILIO] y NIF/CIF [NIF]. Contacto: [EMAIL].</p>
      <h2 id="condiciones">2. Condiciones de uso</h2>
      <p>TrabajoFácil es un <b>intermediario</b>: pone en contacto a clientes y profesionales. La relación contractual que nace de la contratación de un servicio es <b>entre el cliente y el profesional</b>, sin intervención de la plataforma en la ejecución material del trabajo.</p>
      <p>El profesional verificado responde del cumplimiento del servicio y de la exactitud de la información que publica. El cliente responde de la veracidad de los datos de la tarea y del pago.</p>
      <h2 id="privacidad">3. Política de privacidad</h2>
      <p>Los datos personales se tratan con la base jurídica que corresponda: <b>interés legítimo</b> para la gestión de la plataforma, <b>consentimiento</b> para las comunicaciones comerciales y la documentación identificativa de los profesionales, y <b>ejecución del contrato</b> para los datos necesarios para publicar y ejecutar una tarea.</p>
      <p>Los perfiles públicos de los profesionales (nombre, foto, categoría, valoración y ciudad) se publican con su consentimiento, son de acceso público y pueden ser objeto de solicitud de supresión. Los documentos de identidad (DNI/NIE y selfie) se tratan con base jurídica de <b>consentimiento exprés</b>, se guardan en un directorio de acceso restringido y solo son visibles para el personal administrador tasked de la revisión.</p>
      <p>Responsable del tratamiento: [RAZÓN SOCIAL]. Delegado de protección de datos: [CONTACTO DPD]. Los derechos de acceso, rectificación, supresión, limitación, portabilidad y oposición se ejercen en [EMAIL].</p>
      <h2 id="cookies">4. Política de cookies</h2>
      <p>La aplicación usa dos cookies estrictamente técnicas: la cookie de sesión (httpOnly, para mantener la sesión iniciada) y un token CSRF. No se instalan cookies de analítica, píxeles de terceros ni banners de consentimiento. Una versión de producción exigiría un gestor de consentimiento previo para las cookies no esenciales.</p>
      <h2>5. Propiedad intelectual</h2>
      <p>El código, los gráficos y los textos de este prototipo son originales. El diseño está documentado en el informe interno del proyecto y se limitó a observación pasiva de superficies públicas. No se ha reutilizado código, imágenes, marca ni contenido de terceros.</p>
      <h2>6. Pagos y facturación</h2>
      <p>El monedero de este prototipo es <b>simulado</b>: los importes y los tokens se registran en la base de datos y <b>no se mueven fondos reales</b>. En este entorno la plataforma cobra una tasa en tokens por <b>enviar presupuestos</b> (10 tokens = 1 €); si el presupuesto no se acepta se devuelven 5 tokens y, si se acepta, no se devuelve ninguno. TrabajoFácil <b>no cobra comisión</b> sobre el importe de los trabajos: el profesional recibe el 100 % de lo pactado con el cliente. El cliente <b>publica sus tareas sin coste</b>, sin tokens y sin comisión. En producción los pagos se realizarían a través de una entidad de pago regulada, con autenticación fuerte del cliente (PSD2/SCA) y separación de fondos entre la plataforma, el profesional y las retenciones fiscales aplicables.</p>
      <h2>7. Legislación aplicable</h2>
      <p>La Ley 34/2002, de Servicios de la Información y la Comunicación Electrónica; el RGPD (UE) 2016/679 y la LOPDGDD; la Ley 10/2010 de Servicios de Pago; y la normativa de consumo y de defensa del usuario.</p>
    </div>`;
    return layout({ titulo: 'Aviso legal', usuario: ctx.usuario, ruta: '/aviso-legal', contenido });
  });

  /* ---------------- API ---------------- */
  router.get('/api/buscar', async (ctx) => {
    const res = buscarCategorias(ctx.query.q || '');
    return {
      json: res.map(c => ({
        nombre: c.nombre, code: c.code, color: c.color, precio: c.precio_medio,
        slug: c.slug, url: '/publicar-tarea?categoria=' + c.slug
      }))
    };
  });

  router.get('/api/categorias', async (ctx) => {
    return { json: q.all('SELECT id,nombre,slug,code,color,precio_medio,area_id FROM categorias WHERE activa=1 ORDER BY nombre') };
  });

  router.get('/api/profesionales', async (ctx) => {
    return { json: q.all(`${SQL_PROF} AND p.estado_verificacion='aprobado' LIMIT 50`) };
  });

  router.get('/api/tareas', async (ctx) => {
    return { json: q.all(`${SQL_TAREA} WHERE t.estado='publicada' ORDER BY t.creada_en DESC LIMIT 50`) };
  });

  /* ---------------- sitemap ---------------- */
  router.get('/sitemap.xml', async (ctx) => {
    const urls = ['/', '/servicios', '/como-funciona', '/precios', '/hazte-profesional', '/t', '/tareas-publicas'];
    for (const a of q.all('SELECT slug FROM areas WHERE activa=1')) urls.push('/servicios-de-' + a.slug);
    for (const c of q.all('SELECT slug FROM categorias WHERE activa=1')) urls.push('/servicios-de-' + c.slug);
    for (const c of q.all('SELECT slug FROM categorias WHERE activa=1 LIMIT 40')) {
      for (const ci of q.all('SELECT slug FROM ciudades WHERE activa=1 LIMIT 12')) {
        urls.push(`/servicios-de-${c.slug}-en-${ci.slug}`);
      }
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${'https://trabajofacil.es' + u}</loc></url>`).join('\n')}
</urlset>`;
    ctx.res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    ctx.res.end(xml);
    return undefined;
  });
}
