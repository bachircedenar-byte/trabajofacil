/* ==========================================================================
   TrabajoFácil — datos de demostración
   Mismo esquema que usa el marketplace original (código de 2 letras, color
   con familia tonal, precio medio por hora, slug de servicio y lista de
   sinónimos para el buscador). Contenido propio.
   ========================================================================== */

const CATEGORIAS = [
  // --- Limpieza (familia turquesa) ---
  { nombre:"Limpieza de hogar",      codigo:"LH", color:"rgba(0,172,181,1)",   precio:12.5,  slug:"limpieza-de-hogar",
    keywords:["limpieza casa","limpiadora","limpieza por horas","persona de limpieza","limpieza a domicilio","empresa limpieza hogar","señora limpieza","limpiadores"] },
  { nombre:"Limpieza de baños",      codigo:"LB", color:"rgba(0,172,181,.78)", precio:14,    slug:"limpieza-de-banos",
    keywords:["limpieza WC","azulejos","baño limpio","desinfectar baño","limpieza baños casa"] },
  { nombre:"Limpieza de oficinas",   codigo:"LO", color:"rgba(0,172,181,.56)", precio:13,    slug:"limpieza-de-oficinas",
    keywords:["limpieza oficina","limpieza empresa","mantenimiento oficina","limpieza despachos"] },
  { nombre:"Limpieza a fondo",       codigo:"LF", color:"rgba(0,172,181,.34)", precio:18,    slug:"limpieza-a-fondo",
    keywords:["limpieza general","limpieza profunda","desempolvar casa","limpieza fin de obra"] },

  // --- Reparaciones (familia naranja) ---
  { nombre:"Manitas a domicilio",    codigo:"MD", color:"rgba(255,138,76,1)",   precio:15,    slug:"manitas-a-domicilio",
    keywords:["manitas","reparaciones casa","arreglos en casa","electricista","fontanero","pequeñas reparaciones","colgar cuadros"] },
  { nombre:"Fontanería",             codigo:"FO", color:"rgba(255,138,76,.78)", precio:18,    slug:"fontaneria",
    keywords:["fontanero","grifo","calefacción","fuga de agua","cambiar grifo","sanitarios"] },
  { nombre:"Pintura",                codigo:"PI", color:"rgba(255,138,76,.56)", precio:16,    slug:"pintura-a-domicilio",
    keywords:["pintor","pintura casa","pintar habitaciones","pintura piso","barniz"] },
  { nombre:"Montaje de muebles",     codigo:"MM", color:"rgba(255,138,76,.34)", precio:14,    slug:"montaje-de-muebles",
    keywords:["montador muebles","ensamblar muebles","muebles ikea","colgar muebles","mover muebles"] },

  // --- Mudanzas (familia azul) ---
  { nombre:"Mudanzas",               codigo:"MU", color:"rgba(48,124,240,1)",   precio:22,    slug:"mudanzas",
    keywords:["mudanza","traslado casa","mudarse","camion mudanza","precio mudanza"] },
  { nombre:"Transporte de muebles",  codigo:"TM", color:"rgba(48,124,240,.78)", precio:18,    slug:"transporte-de-muebles",
    keywords:["furgoneta","transportar sofá","trasladar muebles","vehiculo mudanza","cama"] },
  { nombre:"Recoger y repartir",     codigo:"RR", color:"rgba(48,124,240,.56)", precio:13,    slug:"recoger-y-repartir",
    keywords:["recados","mandar paquetes","repartos","corrieras","recogida en casa"] },
  { nombre:"Montaje y desmontaje",   codigo:"MD2",color:"rgba(48,124,240,.34)", precio:17,    slug:"montaje-y-desmontaje",
    keywords:["desmontar muebles","montar estanterías","medidas de muebles","muebles de oficina"] },

  // --- Informática (familia violeta) ---
  { nombre:"Informática y tecnología",codigo:"IT",color:"rgba(124,92,230,1)",   precio:20,    slug:"informatica-y-tecnologia",
    keywords:["informatico","reparar ordenador","soporte informatico","windows","portatil no arranca"] },
  { nombre:"Instalación de redes",   codigo:"IR", color:"rgba(124,92,230,.78)", precio:19,    slug:"instalacion-de-redes",
    keywords:["wifi","instalar router","red domestica","amplificador","conectar impresora"] },
  { nombre:"Sintonización y Tv",     codigo:"ST", color:"rgba(124,92,230,.56)", precio:15,    slug:"sintonizacion-tv",
    keywords:["sintonizar tv","antena","television","canales"] },
  { nombre:"Ciberseguridad",        codigo:"CS", color:"rgba(124,92,230,.34)", precio:24,    slug:"ciberseguridad",
    keywords:["virus informatico","seguridad informatica","copias de seguridad","phishing"] },

  // --- Mascotas y cuidado (familia rosa) ---
  { nombre:"Cuidado de mascotas",    codigo:"CM", color:"rgba(230,86,150,1)",   precio:13,    slug:"cuidado-de-mascotas",
    keywords:["cuidador de perros","pasear perro","cuidar gato","pet sitting","cuidado animales"] },
  { nombre:"Cuidado de personas",    codigo:"CP", color:"rgba(230,86,150,.78)", precio:16,    slug:"cuidado-de-personas",
    keywords:["cuidador persona mayor","acompañar mayor","cuidar niños","canguro","cuidador"] },
  { nombre:"Paseos y ejerce",       codigo:"PJ", color:"rgba(230,86,150,.56)", precio:12,    slug:"paseos-y-ejercio",
    keywords:["pasear perros","ejercicio senior","acompañamiento"] },

  // --- Eventos (familia ámbar) ---
  { nombre:"Eventos y fiestas",      codigo:"EF", color:"rgba(240,170,40,1)",   precio:17,    slug:"eventos-y-fiestas",
    keywords:["montaje de eventos","organizar fiesta","sonido para fiestas","camarero eventos"] },
  { nombre:"Fotografía",             codigo:"FT", color:"rgba(240,170,40,.78)", precio:25,    slug:"fotografia",
    keywords:["fotografo","retratos","fotos de producto","boda"] },
  { nombre:"Peluquería y estética",  codigo:"PE", color:"rgba(240,170,40,.56)", precio:16,    slug:"peluqueria-y-estetica",
    keywords:["peluquero a domicilio","corte de pelo","manicura a domicilio","maquillaje"] }
];

const AREAS = [
  { titulo:"Trabajos de limpieza",  descripcion:"¿Necesitas ayuda con la limpieza de tu casa u oficina?", slug:"limpieza-de-hogar",    img:"img/area-limpieza.svg" },
  { titulo:"Reparaciones y regain", descripcion:"Reparaciones en el hogar, vehículo y proyectos menores", slug:"manitas-a-domicilio",  img:"img/area-reparaciones.svg" },
  { titulo:"Mudanzas y transporte",  descripcion:"Mudanzas, muebles grandes y transporte de objetos",      slug:"mudanzas",             img:"img/area-mudanzas.svg" },
  { titulo:"Informática y tecnología", descripcion:"Ordenadores, wifi y todo lo que te bloquea el día",   slug:"informatica-y-tecnologia", img:"img/area-informatica.svg" },
  { titulo:"Animales y mascotas",   descripcion:"Cuidar, pasear y acompañar a tu mascota",                slug:"cuidado-de-mascotas",  img:"img/area-mascotas.svg" },
  { titulo:"Fiestas y eventos",     descripcion:"Todo lo que necesitas para que tu evento salga bien",     slug:"eventos-y-fiestas",    img:"img/area-eventos.svg" },
  { titulo:"Oficinas y empresas",   descripcion:"Mantenimiento y servicios para negocios y empresas",   slug:"limpieza-de-oficinas",  img:"img/area-oficinas.svg" },
  { titulo:"Deporte y cuidado personal", descripcion:"Cuida de ti: deporte, masajes y estética a domicilio", slug:"peluqueria-y-estetica", img:"img/area-deporte.svg" },
  { titulo:"Clases particulares",   descripcion:"Idiomas, refuerzo escolar y lo que quieras aprender",    slug:"clases-particulares",  img:"img/area-educacion.svg" },
  { titulo:"Urgencias 24 h",        descripcion:"Para cuando necesitas ayuda ya y sin improvisar",         slug:"urgencias-24h",        img:"img/area-urgencia.svg" },
  { titulo:"Cuidado de personas",   descripcion:"Acompañamiento para mayores, niños o quien lo necesite", slug:"cuidado-de-personas",   img:"img/area-personas.svg" },
  { titulo:"Destacados",            descripcion:"Nuestra selección de los servicios más buscados",         slug:"destacados",           img:"img/area-destacados.svg" }
];

const TASKERS = [
  { id:17954, nombre:"Nuria S.",      categoria:"limpieza-de-hogar",   ciudad:"Madrid",        provincia:"Madrid",         valoracion:4.9, opiniones:126, precio:14, verificado:true,  desde:2019, img:"img/avatar-1.svg", titulo:"Limpieza de homes y oficinas · Madrid Centro" },
  { id:11830, nombre:"Radik I.",     categoria:"manitas-a-domicilio", ciudad:"Barcelona",     provincia:"Cataluña",       valoracion:4.8, opiniones:89,  precio:16, verificado:true,  desde:2021, img:"img/avatar-2.svg", titulo:"Manitas y montajes · Barcelona" },
  { id:409564,nombre:"Miguel V.",     categoria:"informatica-y-tecnologia", ciudad:"Valencia", provincia:"Valencia",   valoracion:5.0, opiniones:64,  precio:22, verificado:true,  desde:2022, img:"img/avatar-3.svg", titulo:"Soporte informático y redes · Valencia" },
  { id:81204, nombre:"Carmen L.",     categoria:"cuidado-de-mascotas", ciudad:"Sevilla",       provincia:"Andalucía",      valoracion:4.7, opiniones:43,  precio:12, verificado:true,  desde:2023, img:"img/avatar-4.svg", titulo:"Cuidado y paseos de mascotas · Sevilla" },
  { id:52118, nombre:"Adrián P.",     categoria:"fontaneria",          ciudad:"Bilbao",        provincia:"País Vasco",     valoracion:4.6, opiniones:31,  precio:19, verificado:false, desde:2024, img:"img/avatar-5.svg", titulo:"Fontanería y calefacción · Bilbao" },
  { id:73390, nombre:"Sara M.",       categoria:"clases-particulares", ciudad:"Zaragoza",      provincia:"Aragón",         valoracion:4.9, opiniones:57,  precio:15, verificado:true,  desde:2020, img:"img/avatar-6.svg", titulo:"Inglés y apoyo escolar · Zaragoza" },
  { id:61022, nombre:"Diego R.",      categoria:"mudanzas",             ciudad:"Málaga",        provincia:"Andalucía",      valoracion:4.4, opiniones:22,  precio:21, verificado:true,  desde:2024, img:"img/avatar-7.svg", titulo:"Mudanzas y transporte · Málaga" },
  { id:45771, nombre:"Lucía F.",      categoria:"peluqueria-y-estetica",ciudad:"A Coruña",      provincia:"Galicia",        valoracion:4.8, opiniones:38,  precio:17, verificado:true,  desde:2022, img:"img/avatar-8.svg", titulo:"Peluquería a domicilio · A Coruña" }
];

const TESTIMONIOS = [
  { nombre:"Nuria S.",  texto:"Llegó antes de la hora prevista para conocer el trabajo. Dejó todo perfecto y avisaba cuando terminaba. Totalmente recomendable.", img:"img/avatar-1.svg" },
  { nombre:"Radik I.",  texto:"Encantado con Radik, persona estupenda y excelente trabajador. Volveremos a contar con él sin duda.", img:"img/avatar-2.svg" },
  { nombre:"Miguel V.", texto:"Resolvió el problema con muy poca vuelta: rápido, claro y con un precio razonable. Sin duda lo recomiendo.", img:"img/avatar-3.svg" }
];

const CIUDADES = ["Madrid","Barcelona","Valencia","Sevilla","Bilbao","Zaragoza","Málaga","A Coruña","Murcia","Palma","Alicante","Vigo"];

const SERVICIOS_TOP = [
  "Limpieza de hogar","Manitas a domicilio","Montaje de muebles","Mudanzas","Pintura a domicilio",
  "Fontanería","Informática y tecnología","Cuidado de mascotas","Clases particulares","Eventos y fiestas"
];
