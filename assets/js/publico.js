/* ==========================================================================
   TrabajoFácil — buscador de la portada (servido por el backend)
   Consulta a /api/buscar con la misma lógica de sinónimos del original.
   ========================================================================== */
(function () {
  'use strict';

  var input = document.getElementById('busqueda');
  var caja = document.getElementById('sugerencias');
  var limp = document.getElementById('buscadorLimpiar');
  if (!input || !caja) return;

  var activo = -1;
  var resultados = [];
  var temporizador = null;

  function normalizar(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function pintar(lista, texto) {
    if (!lista.length) {
      caja.innerHTML = '<div class="sugerencia vacio">No hay resultados para <strong>'
        + escapar(texto) + '</strong>. Prueba con <a href="/servicios">nuestros servicios</a>.</div>';
      caja.hidden = false;
      return;
    }
    caja.innerHTML = lista.map(function (c, i) {
      return '<a class="sugerencia" role="option" href="' + c.url + '" data-i="' + i + '">'
        + '<span class="badge" style="background:' + c.color + '">' + escapar(c.code) + '</span>'
        + '<span>' + escapar(c.nombre) + '</span>'
        + '<small>desde ' + Number(c.precio).toFixed(2).replace('.', ',') + ' €/h</small></a>';
    }).join('');
    caja.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function buscar(texto) {
    fetch('/api/buscar?q=' + encodeURIComponent(texto))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (input.value.trim() !== texto) return;   // llegó una respuesta obsoleta
        resultados = data;
        pintar(data, texto);
      })
      .catch(function () { caja.hidden = true; });
  }

  function mover(delta) {
    var items = caja.querySelectorAll('.sugerencia[data-i]');
    if (!items.length) return;
    if (activo >= 0 && items[activo]) items[activo].classList.remove('activa');
    activo = (activo + delta + items.length) % items.length;
    items[activo].classList.add('activa');
    items[activo].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', function () {
    var v = input.value;
    if (limp) limp.hidden = !v.length;
    activo = -1;
    clearTimeout(temporizador);
    if (v.trim().length < 3) {
      caja.hidden = true; caja.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    temporizador = setTimeout(function () { buscar(v.trim()); }, 140);
  });

  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); mover(1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); mover(-1); }
    else if (ev.key === 'Escape') { caja.hidden = true; }
  });

  if (limp) limp.addEventListener('click', function () {
    input.value = ''; limp.hidden = true; caja.hidden = true; resultados = []; input.focus();
  });

  document.addEventListener('click', function (ev) {
    var cont = document.getElementById('buscador');
    if (cont && !cont.contains(ev.target)) caja.hidden = true;
  });

  /* menú móvil */
  var btn = document.getElementById('menuBtn');
  var panel = document.getElementById('menuPanel');
  if (btn && panel) {
    btn.addEventListener('click', function () {
      var abierto = panel.classList.toggle('open');
      btn.setAttribute('aria-expanded', abierto ? 'true' : 'false');
    });
  }
})();
