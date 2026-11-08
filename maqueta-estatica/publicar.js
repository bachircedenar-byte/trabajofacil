/* ==========================================================================
   TrabajoFácil — publicación de tarea (stepper)
   Flujo de publicación de una tarea por pasos:
   código postal → frecuencia → fecha → hora → nº de horas → flexibilidad
   de fecha → flexibilidad de hora → transportes cercanos → descripción →
   fotos → taskers recomendados → confirmación.
   El original persiste cada paso en el servidor (borrador con id); aquí el
   estado vive en memoria y en el hash para poder recargar.
   ========================================================================== */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var zona   = document.getElementById('zonaPaso');
  var ind    = document.getElementById('pasosInd');

  var estado = {
    servicio: params.get('categoria') || '',
    cp: '', ciudad: '', provincia: '',
    frecuencia: 'once', dias: [], diasConsecutivos: 1,
    fecha: '', hora: '10', minuto: '00',
    horas: 2, flexFecha: 'si', flexHora: 'cualquiera',
    transportes: [], descripcion: '', fotos: []
  };

  var CIUDADES = {
    '28001': ['Madrid', 'Madrid'], '28013': ['Madrid', 'Madrid'], '08001': ['Barcelona', 'Cataluña'],
    '46001': ['Valencia', 'Valencia'], '41001': ['Sevilla', 'Andalucía'], '48001': ['Bilbao', 'País Vasco'],
    '50001': ['Zaragoza', 'Aragón'], '29001': ['Málaga', 'Andalucía'], '15001': ['A Coruña', 'Galicia'],
    '30001': ['Murcia', 'Murcia'], '07001': ['Palma', 'Baleares'], '03001': ['Alicante', 'Comunidad Valenciana']
  };

  var DIAS_SEM = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  /* ---------------- utilidades ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function catActual() {
    return CATEGORIAS.filter(function (c) { return c.slug === estado.servicio; })[0] || null;
  }
  function euros(n) { return Number(n).toFixed(2).replace('.', ',') + ' €'; }

  /* ---------------- definición de pasos ---------------- */
  var pasos = [
    { id: 'servicio', titulo: 'Elige el servicio', validar: function () { return !!estado.servicio; } },
    { id: 'cp',       titulo: 'Código postal',    validar: function () { return /^\d{5}$/.test(estado.cp); } },
    { id: 'frec',     titulo: 'Frecuencia',       validar: function () {
        if (estado.frecuencia === 'consecutiva') return estado.diasConsecutivos > 0;
        if (estado.frecuencia === 'semanal' || estado.frecuencia === 'quincenal') return estado.dias.length > 0;
        return true; } },
    { id: 'fecha',    titulo: 'Fecha',            validar: function () { return !!estado.fecha; } },
    { id: 'hora',     titulo: 'Hora',             validar: function () { return !!estado.hora; } },
    { id: 'horas',    titulo: 'Nº de horas',      validar: function () { return estado.horas > 0; } },
    { id: 'flexF',    titulo: 'Flexibilidad',     validar: function () { return !!estado.flexFecha; } },
    { id: 'flexH',    titulo: 'Horario flexible', validar: function () { return !!estado.flexHora; } },
    { id: 'trans',    titulo: 'Transportes',      validar: function () { return estado.transportes.length > 0; } },
    { id: 'desc',     titulo: 'Descripción',      validar: function () { return estado.descripcion.trim().length >= 10; } },
    { id: 'fotos',    titulo: 'Fotos',            validar: function () { return true; } },
    { id: 'resumen',  titulo: 'Resumen',          validar: function () { return true; } },
    { id: 'listo',    titulo: 'Listo',             validar: function () { return true; } }
  ];

  var indice = 0;
  if (estado.servicio) indice = 1;
  cargarHash();

  /* ---------------- pintado ---------------- */
  function pintar() {
    var paso = pasos[indice];

    ind.innerHTML = pasos.map(function (p, i) {
      var cls = i < indice ? 'hecho' : (i === indice ? 'actual' : '');
      return '<span class="paso-pt ' + cls + '" title="' + esc(p.titulo) + '">' + (i + 1) + '</span>';
    }).join('');

    zona.innerHTML = cuerpo(paso);
    enlazar(paso);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    guardar();
  }

  function cabecera(titulo, ayuda) {
    return '<div class="tarjeta-paso"><h2>' + esc(titulo) + '</h2>'
      + (ayuda ? '<div class="nota-ok">' + ayuda + '</div>' : '') + '<div id="cuerpoPaso"></div>'
      + '<div class="stepper-nav"><button class="btn-fantasma" id="btnAtras" type="button">Atrás</button>'
      + '<button class="btn" id="btnSiguiente" type="button">Continuar</button></div></div>';
  }

  function cuerpo(paso) {
    switch (paso.id) {
      case 'servicio': return cabecera('¿Qué necesitas?', 'Elige la categoría. Podrás revisarla antes de publicar.');
      case 'cp':       return cabecera('¿Cuál es tu código postal?', 'Lo usamos para encontrar profesionales cerca de ti y mostrarte el precio de tu zona.');
      case 'frec':     return cabecera('¿Con qué frecuencia necesitas el servicio?');
      case 'fecha':    return cabecera('¿Cuándo se va a realizar la tarea?');
      case 'hora':     return cabecera('¿A qué hora quieres que empiece?');
      case 'horas':    return cabecera('¿Número de horas estimadas?', 'El profesional confirma las horas reales al aceptar la tarea.');
      case 'flexF':    return cabecera('¿Eres flexible con la fecha?');
      case 'flexH':    return cabecera('¿Eres flexible con la hora?');
      case 'trans':    return cabecera('¿Qué transportes hay cercanos a tu domicilio?', 'Nos sirve para calcular la distancia real al profesional.');
      case 'desc':     return cabecera('Háblanos sobre los detalles de tu tarea', 'Cuanto más claro, más exactos serán los presupuestos.');
      case 'fotos':    return cabecera('Confirma la subida', 'Las fotos permiten presupuestar sin necesidad de visita.');
      case 'resumen':  return '';
      case 'listo':    return '';
    }
    return '';
  }

  /* ---------------- cada paso ---------------- */
  function enlazar(paso) {
    var atras = document.getElementById('btnAtras');
    var sig   = document.getElementById('btnSiguiente');
    if (atras) atras.addEventListener('click', function () {
      if (indice > 0) { indice--; pintar(); }
    });
    if (sig) sig.addEventListener('click', function () {
      if (!paso.validar()) { error('Revisa los datos de este paso para continuar.'); return; }
      if (indice < pasos.length - 1) { indice++; pintar(); }
    });

    switch (paso.id) {
      case 'servicio': pasoServicio(); break;
      case 'cp':       pasoCp(); break;
      case 'frec':     pasoFrec(); break;
      case 'fecha':    pasoFecha(); break;
      case 'hora':     pasoHora(); break;
      case 'horas':    pasoHoras(); break;
      case 'flexF':    pasoFlexFecha(); break;
      case 'flexH':    pasoFlexHora(); break;
      case 'trans':    pasoTransportes(); break;
      case 'desc':     pasoDesc(); break;
      case 'fotos':    pasoFotos(); break;
      case 'resumen':  pasoResumen(); break;
      case 'listo':    pasoListo(); break;
    }
  }

  function error(msg) {
    var c = document.getElementById('cuerpoPaso');
    if (!c) return;
    var d = c.querySelector('.error');
    if (d) d.remove();
    var p = document.createElement('div');
    p.className = 'error';
    p.style.cssText = 'background:#fdecec;border-left:3px solid #e45252;padding:.8rem 1rem;border-radius:0 3px 3px 0;font-size:.88rem;margin-bottom:1rem';
    p.textContent = msg;
    c.insertBefore(p, c.firstChild);
  }

  /* 1 · servicio ------------------------------------------------------ */
  function pasoServicio() {
    var c = document.getElementById('cuerpoPaso');
    c.innerHTML = '<div class="opciones" style="flex-direction:column;align-items:stretch">'
      + CATEGORIAS.map(function (cat) {
          return '<label class="opcion' + (cat.slug === estado.servicio ? ' sel' : '') + '" data-slug="' + cat.slug + '" '
            + 'style="display:flex;align-items:center;gap:.7rem;border-radius:var(--radio);padding:.6rem .8rem">'
            + '<span class="badge" style="background:' + cat.color + ';color:#fff;width:30px;height:30px;border-radius:6px;'
            + 'display:inline-flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700">'
            + esc(cat.codigo) + '</span><span style="flex:1">' + esc(cat.nombre) + '</span>'
            + '<small style="color:var(--texto-3)">desde ' + euros(cat.precio) + '/h</small></label>';
        }).join('') + '</div>';
    c.querySelectorAll('.opcion').forEach(function (el) {
      el.addEventListener('click', function () {
        estado.servicio = el.getAttribute('data-slug');
        c.querySelectorAll('.opcion').forEach(function (o) { o.classList.remove('sel'); });
        el.classList.add('sel');
      });
    });
  }

  /* 2 · código postal ------------------------------------------------ */
  function pasoCp() {
    var c = document.getElementById('cuerpoPaso');
    c.innerHTML =
      '<div class="campo"><label for="cp">Código postal</label>'
      + '<input type="text" id="cp" inputmode="numeric" maxlength="5" placeholder="28001" value="' + esc(estado.cp) + '">'
      + '<div class="pista">Datos de ejemplo: 28001, 08001, 46001, 41001, 48001, 50001, 29001…</div></div>'
      + '<div id="geo"></div>';
    var input = document.getElementById('cp');
    var geo = document.getElementById('geo');
    input.addEventListener('input', function () {
      estado.cp = input.value.replace(/\D/g, '');
      geo.innerHTML = '';
      if (CIUDADES[estado.cp]) {
        var d = CIUDADES[estado.cp];
        estado.ciudad = d[0]; estado.provincia = d[1];
        geo.innerHTML = '<div class="nota-ok"><b>' + esc(d[0]) + '</b> (' + esc(d[1]) + ') — hemos encontrado '
          + 'profesionales disponibles en tu zona.</div>';
      } else if (estado.cp.length === 5) {
        geo.innerHTML = '<div class="pista">No recognise ese código. Prueba con uno de los de ejemplo.</div>';
      }
    });
    if (estado.cp.length === 5) input.dispatchEvent(new Event('input'));
  }

  /* 3 · frecuencia --------------------------------------------------- */
  function pasoFrec() {
    var c = document.getElementById('cuerpoPaso');
    function pintarExtra() {
      var extra = document.getElementById('frecExtra');
      if (estado.frecuencia === 'consecutiva') {
        extra.innerHTML = '<div class="campo"><label>Indica el número de días</label>'
          + '<div class="opciones"><button class="opcion" data-d="-1" type="button">−</button>'
          + '<span class="opcion sel" id="nDias" style="pointer-events:none">' + estado.diasConsecutivos + '</span>'
          + '<button class="opcion" data-d="1" type="button">+</button></div></div>';
        extra.querySelectorAll('[data-d]').forEach(function (b) {
          b.addEventListener('click', function () {
            estado.diasConsecutivos = Math.max(1, Math.min(30, estado.diasConsecutivos + parseInt(b.getAttribute('data-d'), 10)));
            pintarExtra();
          });
        });
      } else if (estado.frecuencia === 'semanal' || estado.frecuencia === 'quincenal') {
        extra.innerHTML = '<div class="campo"><label>Elige el/los días</label><div class="opciones">'
          + DIAS_SEM.map(function (d, i) {
              return '<span class="opcion' + (estado.dias.indexOf(i) > -1 ? ' sel' : '') + '" data-dia="' + i + '">' + d + '</span>';
            }).join('') + '</div></div>';
        extra.querySelectorAll('[data-dia]').forEach(function (el) {
          el.addEventListener('click', function () {
            var i = parseInt(el.getAttribute('data-dia'), 10);
            var pos = estado.dias.indexOf(i);
            if (pos > -1) estado.dias.splice(pos, 1); else estado.dias.push(i);
            el.classList.toggle('sel');
          });
        });
      } else {
        extra.innerHTML = '<div class="pista">La recibirás una sola vez, en la fecha que indiques.</div>';
      }
    }
    c.innerHTML = '<div class="campo"><label>Frecuencia del servicio</label><div class="opciones">'
      + [['once', 'Solamente una vez'], ['consecutiva', 'Días consecutivos'],
         ['semanal', 'Cada semana'], ['quincenal', 'Cada dos semanas']]
        .map(function (o) {
          return '<span class="opcion' + (estado.frecuencia === o[0] ? ' sel' : '') + '" data-f="' + o[0] + '">' + o[1] + '</span>';
        }).join('') + '</div></div><div id="frecExtra"></div>'
      + '<div class="nota-ok">Si pruebas el primer día y no te convence, te buscamos a otra persona sin coste.</div>';
    c.querySelectorAll('[data-f]').forEach(function (el) {
      el.addEventListener('click', function () {
        estado.frecuencia = el.getAttribute('data-f');
        c.querySelectorAll('[data-f]').forEach(function (o) { o.classList.remove('sel'); });
        el.classList.add('sel');
        pintarExtra();
      });
    });
    pintarExtra();
  }

  /* 4 · fecha -------------------------------------------------------- */
  function pasoFecha() {
    var c = document.getElementById('cuerpoPaso');
    var hoy = new Date().toISOString().slice(0, 10);
    c.innerHTML = '<div class="campo"><label for="f">Fecha de realización de la tarea</label>'
      + '<input type="date" id="f" min="' + hoy + '" value="' + esc(estado.fecha) + '"></div>';
    document.getElementById('f').addEventListener('change', function () { estado.fecha = this.value; });
  }

  /* 5 · hora --------------------------------------------------------- */
  function pasoHora() {
    var c = document.getElementById('cuerpoPaso');
    var horas = []; for (var h = 8; h <= 23; h++) horas.push('<option value="' + h + '"' + (String(h) === estado.hora ? ' selected' : '') + '>' + h + '</option>');
    var min = ['00', '15', '30', '45'].map(function (m) {
      return '<option value="' + m + '"' + (m === estado.minuto ? ' selected' : '') + '>' + m + '</option>';
    }).join('');
    c.innerHTML = '<div class="campo"><label>Hora de inicio</label><div style="display:flex;gap:.6rem">'
      + '<select id="hh" style="max-width:120px">' + horas.join('') + '</select>'
      + '<span style="align-self:center;color:var(--texto-3)">:</span>'
      + '<select id="mm" style="max-width:120px">' + min + '</select></div></div>';
    document.getElementById('hh').addEventListener('change', function () { estado.hora = this.value; });
    document.getElementById('mm').addEventListener('change', function () { estado.minuto = this.value; });
  }

  /* 6 · nº horas ----------------------------------------------------- */
  function pasoHoras() {
    var c = document.getElementById('cuerpoPaso');
    c.innerHTML = '<div class="campo"><label>Número de horas estimadas</label>'
      + '<div class="opciones"><button class="opcion" data-h="-1" type="button">−</button>'
      + '<span class="opcion sel" id="nHoras" style="pointer-events:none">' + estado.horas + '</span>'
      + '<button class="opcion" data-h="1" type="button">+</button></div>'
      + '<div class="pista">Estimación orientativa: los profesionales confirmarán las horas reales al aceptar.</div></div>';
    c.querySelectorAll('[data-h]').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.horas = Math.max(1, Math.min(24, estado.horas + parseInt(b.getAttribute('data-h'), 10)));
        document.getElementById('nHoras').textContent = estado.horas;
      });
    });
  }

  /* 7 · flexibilidad de fecha ---------------------------------------- */
  function pasoFlexFecha() {
    var c = document.getElementById('cuerpoPaso');
    c.innerHTML = '<div class="campo"><label>¿Eres flexible con la fecha que has indicado?</label><div class="opciones">'
      + '<span class="opcion' + (estado.flexFecha === 'si' ? ' sel' : '') + '" data-v="si">Sí</span>'
      + '<span class="opcion' + (estado.flexFecha === 'no' ? ' sel' : '') + '" data-v="no">No</span></div></div>';
    c.querySelectorAll('[data-v]').forEach(function (el) {
      el.addEventListener('click', function () {
        estado.flexFecha = el.getAttribute('data-v');
        c.querySelectorAll('[data-v]').forEach(function (o) { o.classList.remove('sel'); });
        el.classList.add('sel');
      });
    });
  }

  /* 8 · flexibilidad de hora ----------------------------------------- */
  function pasoFlexHora() {
    var c = document.getElementById('cuerpoPaso');
    var ops = [['manana', 'Sí, sólo por la mañana (8–14 h)'], ['tarde', 'Sí, sólo por la tarde (14–21 h)'],
               ['cualquiera', 'Sí, a cualquier hora'], ['no', 'No es flexible']];
    c.innerHTML = '<div class="campo"><label>¿Eres flexible con la hora?</label><div class="opciones" style="flex-direction:column;align-items:stretch">'
      + ops.map(function (o) {
          return '<span class="opcion' + (estado.flexHora === o[0] ? ' sel' : '') + '" data-v="' + o[0] + '">' + o[1] + '</span>';
        }).join('') + '</div></div>';
    c.querySelectorAll('[data-v]').forEach(function (el) {
      el.addEventListener('click', function () {
        estado.flexHora = el.getAttribute('data-v');
        c.querySelectorAll('[data-v]').forEach(function (o) { o.classList.remove('sel'); });
        el.classList.add('sel');
      });
    });
  }

  /* 9 · transportes -------------------------------------------------- */
  function pasoTransportes() {
    var c = document.getElementById('cuerpoPaso');
    var ops = [['bus', 'Autobús'], ['tren', 'Tren'], ['metro', 'Metro'], ['tranvia', 'Tranvía'], ['coche', 'Coche']];
    c.innerHTML = '<div class="campo"><label>Transportes cercanos a tu domicilio</label><div class="opciones">'
      + ops.map(function (o) {
          return '<span class="opcion' + (estado.transportes.indexOf(o[0]) > -1 ? ' sel' : '') + '" data-t="' + o[0] + '">' + o[1] + '</span>';
        }).join('') + '</div>'
      + '<div class="pista">Si sólo te queda el coche como opción, el profesional te quedará más lejos.</div></div>';
    c.querySelectorAll('[data-t]').forEach(function (el) {
      el.addEventListener('click', function () {
        var t = el.getAttribute('data-t');
        var pos = estado.transportes.indexOf(t);
        if (pos > -1) estado.transportes.splice(pos, 1); else estado.transportes.push(t);
        el.classList.toggle('sel');
      });
    });
  }

  /* 10 · descripción -------------------------------------------------- */
  function pasoDesc() {
    var c = document.getElementById('cuerpoPaso');
    c.innerHTML = '<div class="campo"><label for="d">Descripción de la tarea</label>'
      + '<textarea id="d" placeholder="Ej.: Piso de 80 m² en 4º piso con ascensor. Necesito limpieza a fondo de cocina y dos baños, y fregar el suelo.">' + esc(estado.descripcion) + '</textarea>'
      + '<div class="pista" id="contD">Mínimo 10 caracteres.</div></div>';
    var ta = document.getElementById('d');
    ta.addEventListener('input', function () {
      estado.descripcion = ta.value;
      document.getElementById('contD').textContent = ta.value.length + ' caracteres escritos.';
    });
  }

  /* 11 · fotos -------------------------------------------------------- */
  function pasoFotos() {
    var c = document.getElementById('cuerpoPaso');
    c.innerHTML = '<div class="campo"><label>Subir imagen</label>'
      + '<input type="file" id="fotos" accept="image/*" multiple>'
      + '<div class="pista">Las fotos permiten un presupuesto cerrado sin visita. En la demo se simulan.</div></div>'
      + '<div id="listaFotos" class="opciones"></div>';
    document.getElementById('fotos').addEventListener('change', function () {
      estado.fotos = Array.prototype.slice.call(this.files).map(function (f) { return f.name; });
      document.getElementById('listaFotos').innerHTML = estado.fotos.length
        ? estado.fotos.map(function (n) { return '<span class="opcion sel">' + esc(n) + '</span>'; }).join('')
        : '<span class="pista">Sin fotos: el profesional tendrá que desplazarse para ver el trabajo.</span>';
    });
  }

  /* 12 · resumen + taskers ------------------------------------------- */
  function pasoResumen() {
    var cat = catActual();
    zona.innerHTML = '<div class="tarjeta-paso"><h2>Revisa tu solicitud</h2>'
      + '<div class="resumen"><dl>'
      + '<dt>Servicio</dt><dd>' + esc(cat ? cat.nombre : '—') + '</dd>'
      + '<dt>Ubicación</dt><dd>' + esc(estado.cp) + ' · ' + esc(estado.ciudad || '—') + ' (' + esc(estado.provincia || '—') + ')</dd>'
      + '<dt>Frecuencia</dt><dd>' + esc(frecTexto()) + '</dd>'
      + '<dt>Fecha</dt><dd>' + esc(estado.fecha || '—') + '</dd>'
      + '<dt>Hora</dt><dd>' + esc(estado.hora + ':' + estado.minuto) + '</dd>'
      + '<dt>Horas estimadas</dt><dd>' + estado.horas + ' h</dd>'
      + '<dt>Flexibilidad fecha</dt><dd>' + (estado.flexFecha === 'si' ? 'Sí' : 'No') + '</dd>'
      + '<dt>Flexibilidad hora</dt><dd>' + esc(flexTexto()) + '</dd>'
      + '<dt>Transportes</dt><dd>' + esc(estado.transportes.map(function (t) {
          return { bus: 'Autobús', tren: 'Tren', metro: 'Metro', tranvia: 'Tranvía', coche: 'Coche' }[t];
        }).join(', ') || '—') + '</dd>'
      + '<dt>Fotos</dt><dd>' + (estado.fotos.length ? estado.fotos.length + ' imagen(es)' : 'Sin fotos') + '</dd>'
      + '</dl></div>'
      + '<div class="nota-ok" style="margin-top:1.2rem"><b>4 presupuestos</b> — Enviaremos tu solicitud a los profesionales '
      + 'disponibles en ' + esc(estado.ciudad || 'tu zona') + ' y te avisaremos en cuanto respondan.</div>'
      + '<h3 style="margin-top:1.4rem">Profesionales que podrían ayudarte</h3>'
      + '<div class="taskers-mini">' + taskersHTML() + '</div>'
      + '<div class="stepper-nav"><button class="btn-fantasma" id="btnAtras" type="button">Atrás</button>'
      + '<button class="btn" id="btnSiguiente" type="button">Publicar tarea</button></div></div>';

    document.getElementById('btnAtras').addEventListener('click', function () { indice--; pintar(); });
    document.getElementById('btnSiguiente').addEventListener('click', function () { indice++; pintar(); });
    ind.innerHTML = pasos.map(function (p, i) {
      var cls = i < indice ? 'hecho' : (i === indice ? 'actual' : '');
      return '<span class="paso-pt ' + cls + '">' + (i + 1) + '</span>';
    }).join('');
  }

  function taskersHTML() {
    return TASKERS.slice(0, 4).map(function (t) {
      return '<div class="tasker-mini"><img src="assets/' + t.img + '" alt="">'
        + '<div class="datos"><b>' + esc(t.nombre) + '</b>'
        + '<span>' + esc(t.titulo) + ' · ' + esc(t.ciudad) + '</span></div>'
        + '<div style="text-align:right"><b style="color:var(--verde)">' + euros(t.precio) + '/h</b>'
        + '<span style="display:block;font-size:.78rem;color:#e8a33d">★ ' + t.valoracion.toFixed(1) + ' (' + t.opiniones + ')</span></div></div>';
    }).join('');
  }

  function frecTexto() {
    if (estado.frecuencia === 'once') return 'Una sola vez';
    if (estado.frecuencia === 'consecutiva') return estado.diasConsecutivos + ' días consecutivos';
    if (estado.frecuencia === 'semanal') return 'Cada semana (' + estado.dias.map(function (i) { return DIAS_SEM[i]; }).join(', ') + ')';
    return 'Cada dos semanas (' + estado.dias.map(function (i) { return DIAS_SEM[i]; }).join(', ') + ')';
  }
  function flexTexto() {
    return { manana: 'Sólo mañana (8–14 h)', tarde: 'Sólo tarde (14–21 h)', cualquiera: 'A cualquier hora', no: 'No flexible' }[estado.flexHora];
  }

  /* 13 · listo -------------------------------------------------------- */
  function pasoListo() {
    var cat = catActual();
    zona.innerHTML = '<div class="tarjeta-paso centro">'
      + '<div style="width:64px;height:64px;border-radius:50%;background:var(--verde-liq);color:var(--verde);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;font-size:32px">✓</div>'
      + '<h2>¡Tarea publicada!</h2>'
      + '<p class="intro">Ya la hemos enviado a los profesionales de <b>' + esc(estado.ciudad || 'tu zona') + '</b>. '
      + 'Recibirás hasta 4 presupuestos y podrás elegir libremente el que más te convenga.</p>'
      + '<div class="nota-ok" style="text-align:left"><b>' + esc(cat ? cat.nombre : '') + '</b> · '
      + esc(estado.fecha) + ' a las ' + esc(estado.hora + ':' + estado.minuto) + ' · ' + estado.horas + ' h'
      + '<br>' + esc(estado.descripcion) + '</div>'
      + '<p style="font-size:.82rem;color:var(--texto-3)">Te avisaremos por notificación cuando llegue el primer presupuesto. '
      + 'En esta demo no se envía nada de verdad.</p>'
      + '<a class="btn" href="index.html">Volver al inicio</a>'
      + '<a class="btn btn-hollow" style="margin-left:.5rem" href="#">Ver mis tareas</a>'
      + '</div>';
    ind.innerHTML = pasos.map(function (p, i) {
      return '<span class="paso-pt ' + (i <= indice ? 'hecho' : '') + '">' + (i + 1) + '</span>';
    }).join('');
  }

  /* ---------------- persistencia en el hash ---------------- */
  function b64dec(s) {
    return decodeURIComponent(Array.prototype.map.call(atob(s), function (c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
  }

  function cargarHash() {
    var h = (location.hash || '').replace('#', '');
    if (!h) return false;
    try {
      var obj = JSON.parse(b64dec(h));
      for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) estado[k] = obj[k]; }
      if (typeof obj.indice === 'number') indice = Math.max(0, Math.min(pasos.length - 1, obj.indice));
      return true;
    } catch (e) { return false; }
  }

  function guardar() {
    var copia = JSON.parse(JSON.stringify(estado));
    copia.indice = indice;
    try { history.replaceState(null, '', '#' + btoa(unescape(encodeURIComponent(JSON.stringify(copia))))); } catch (e) {}
  }

  /* ---------------- arranque ---------------- */
  var anio = document.getElementById('anio');
  if (anio) anio.textContent = new Date().getFullYear();
  pintar();
})();
