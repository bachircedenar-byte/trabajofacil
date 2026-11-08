/* ==========================================================================
   TrabajoFácil — comportamiento común de la portada
   Buscador tipoahead (equivalente al Bloodhound/typeahead del original:
   coincidencia por sinónimos, badge de color con iniciales, precio medio),
   menú móvil, contadores y bloques de enlaces SEO generados.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- Menú móvil ---------- */
  var btn = document.getElementById('menuBtn');
  var panel = document.getElementById('menuPanel');
  if (btn && panel) {
    btn.addEventListener('click', function () {
      var abierto = panel.classList.toggle('open');
      btn.setAttribute('aria-expanded', abierto ? 'true' : 'false');
    });
  }

  /* ---------- Buscador / typeahead ---------- */
  var input = document.getElementById('busqueda');
  var caja  = document.getElementById('sugerencias');
  var limp  = document.getElementById('buscadorLimpiar');
  var activo = -1;
  var resultados = [];

  function norm(s) {
    return (s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function buscar(texto) {
    var q = norm(texto);
    if (q.length < 3) return [];
    var terms = q.split(' ');
    var out = [];
    CATEGORIAS.forEach(function (cat) {
      var nombre = norm(cat.nombre);
      var claves = cat.keywords.map(norm);
      var puntos = 0;

      if (nombre === q) puntos += 120;
      else if (nombre.indexOf(q) === 0) puntos += 90;
      else if (nombre.indexOf(q) > -1) puntos += 60;

      terms.forEach(function (t) {
        if (t.length < 3) return;
        if (claves.some(function (k) { return k === t; })) puntos += 40;
        else if (claves.some(function (k) { return k.indexOf(t) > -1; })) puntos += 18;
        else if (nombre.indexOf(t) > -1) puntos += 12;
      });

      if (puntos > 0) out.push({ cat: cat, puntos: puntos });
    });
    out.sort(function (a, b) { return b.puntos - a.puntos; });
    return out.slice(0, 7).map(function (o) { return o.cat; });
  }

  function pintar(lista, texto) {
    if (!caja) return;
    if (!lista.length) {
      caja.innerHTML = '<div class="sugerencia vacio">No sabemos qué tipo de servicio sugerirte para '
        + '<strong>' + escapar(texto) + '</strong>. Prueba a elegir entre <a href="publicar-tarea.html">'
        + 'nuestros servicios</a>.</div>';
      caja.hidden = false;
      return;
    }
    caja.innerHTML = lista.map(function (c, i) {
      return '<div class="sugerencia" role="option" data-slug="' + c.slug + '" data-i="' + i + '">'
        + '<span class="badge" style="background:' + c.color + '">' + escapar(c.codigo) + '</span>'
        + '<span>' + escapar(c.nombre) + '</span>'
        + '<small>desde ' + c.precio.toFixed(2).replace('.', ',') + ' €/h</small></div>';
    }).join('');
    caja.hidden = false;
    if (input) input.setAttribute('aria-expanded', 'true');
  }

  function escapar(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function mover(delta) {
    var items = caja ? caja.querySelectorAll('.sugerencia[data-i]') : [];
    if (!items.length) return;
    if (activo >= 0 && items[activo]) items[activo].classList.remove('activa');
    activo = (activo + delta + items.length) % items.length;
    items[activo].classList.add('activa');
    items[activo].scrollIntoView({ block: 'nearest' });
  }

  if (input && caja) {
    input.addEventListener('input', function () {
      var v = input.value;
      if (limp) limp.hidden = !v.length;
      activo = -1;
      if (v.trim().length < 3) { caja.hidden = true; caja.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); return; }
      resultados = buscar(v);
      pintar(resultados, v.trim());
    });

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); mover(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); mover(-1); }
      else if (ev.key === 'Enter') {
        if (activo >= 0 && resultados[activo]) {
          ev.preventDefault();
          ir(resultados[activo].slug);
        } else if (resultados.length) {
          ev.preventDefault();
          ir(resultados[0].slug);
        }
      } else if (ev.key === 'Escape') { caja.hidden = true; }
    });

    caja.addEventListener('click', function (ev) {
      var item = ev.target.closest('.sugerencia[data-slug]');
      if (item) ir(item.getAttribute('data-slug'));
    });

    document.addEventListener('click', function (ev) {
      var cont = document.getElementById('buscador');
      if (cont && !cont.contains(ev.target)) { caja.hidden = true; }
    });

    if (limp) limp.addEventListener('click', function () {
      input.value = ''; limp.hidden = true; caja.hidden = true; resultados = []; input.focus();
    });
  }

  function ir(slug) {
    window.location.href = 'publicar-tarea.html?categoria=' + encodeURIComponent(slug);
  }

  /* ---------- Bloques de enlaces SEO (servicio × población) ---------- */
  var seoServ = document.getElementById('seo-servicios');
  var seoCiu = document.getElementById('seo-ciudades');
  if (seoServ) {
    seoServ.innerHTML = SERVICIOS_TOP.map(function (s) {
      return '<li><a href="publicar-tarea.html?categoria=' + slugDe(s) + '">' + s + ' baratos</a></li>';
    }).join('');
  }
  if (seoCiu) {
    var html = [];
    CIUDADES.forEach(function (c) {
      SERVICIOS_TOP.slice(0, 4).forEach(function (s) {
        html.push('<li><a href="publicar-tarea.html?categoria=' + slugDe(s) + '&ciudad='
          + encodeURIComponent(c.toLowerCase()) + '">' + s + ' en ' + c + ' baratos</a></li>');
      });
    });
    seoCiu.innerHTML = html.join('');
  }

  function slugDe(titulo) {
    var hit = CATEGORIAS.filter(function (c) { return c.nombre === titulo; })[0];
    if (hit) return hit.slug;
    return titulo.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /* ---------- Contadores ---------- */
  var conts = document.querySelectorAll('[data-cuenta]');
  function animar(el) {
    var fin = parseFloat(el.getAttribute('data-cuenta'));
    var dec = parseInt(el.getAttribute('data-decimales') || '0', 10);
    var inicio = null;
    var dur = 1100;
    (function paso() {
      // El timestamp de rAF es el inicio del frame y puede ser ANTERIOR a la llamada:
      // hay que tomar la referencia en el primer callback, no antes.
      if (inicio === null) inicio = performance.now();
      var p = Math.min(1, (performance.now() - inicio) / dur);
      var v = fin * (1 - Math.pow(1 - p, 3));
      el.textContent = (dec ? v.toFixed(1).replace('.', ',') : Math.round(v).toLocaleString('es-ES'));
      if (p < 1) requestAnimationFrame(paso);
    })();
  }
  if (conts.length) {
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { animar(e.target); obs.unobserve(e.target); } });
    }, { threshold: .4 });
    Array.prototype.forEach.call(conts, function (el) { obs.observe(el); });
  }

  /* ---------- Año ---------- */
  var anio = document.getElementById('anio');
  if (anio) anio.textContent = new Date().getFullYear();
})();
