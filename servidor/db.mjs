/* ==========================================================================
   TrabajoFácil — base de datos (SQLite nativo de Node, sin dependencias)
   Esquema completo del marketplace: usuarios, profesionales, categorías,
   áreas, ciudades, tareas, presupuestos, mensajes, opiniones, documentos,
   transacciones (monedero), notificaciones y auditoría.
   ========================================================================== */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const rutaDB = process.env.TF_DB || join(raiz, 'datos', 'trabajofacil.db');
mkdirSync(dirname(rutaDB), { recursive: true });

export const db = new DatabaseSync(rutaDB);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

/* ------------------------------------------------------------------ */
/* Esquema                                                            */
/* ------------------------------------------------------------------ */
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  nombre TEXT NOT NULL,
  apellidos TEXT DEFAULT '',
  telefono TEXT DEFAULT '',
  rol TEXT NOT NULL DEFAULT 'cliente',      -- cliente | profesional | admin
  avatar TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  ciudad_id INTEGER,
  cp TEXT DEFAULT '',
  lat REAL, lng REAL,
  activo INTEGER NOT NULL DEFAULT 1,
  email_verificado INTEGER NOT NULL DEFAULT 0,
  token_verificacion TEXT,
  telegram_id TEXT,
  dni_nie TEXT,
  fecha_nacimiento TEXT,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT
);

CREATE TABLE IF NOT EXISTS sesiones (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creado_en TEXT NOT NULL,
  expira_en TEXT NOT NULL,
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  descripcion TEXT DEFAULT '',
  icono TEXT DEFAULT '',
  orden INTEGER DEFAULT 0,
  activa INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  code TEXT DEFAULT '',
  color TEXT DEFAULT 'rgba(0,172,181,1)',
  familia TEXT DEFAULT '',
  area_id INTEGER REFERENCES areas(id),
  precio_medio REAL DEFAULT 0,
  keywords TEXT DEFAULT '[]',
  descripcion TEXT DEFAULT '',
  activa INTEGER NOT NULL DEFAULT 1,
  orden INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ciudades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  slug TEXT NOT NULL,
  provincia TEXT NOT NULL,
  cp TEXT DEFAULT '',
  lat REAL, lng REAL,
  activa INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS codigos_postales (
  cp TEXT PRIMARY KEY,
  ciudad TEXT NOT NULL,
  provincia TEXT NOT NULL,
  lat REAL, lng REAL
);

CREATE TABLE IF NOT EXISTS profesionales (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  titularidad TEXT DEFAULT 'autonomo',
  nif TEXT DEFAULT '',
  precio_hora REAL DEFAULT 0,
  categorias TEXT DEFAULT '[]',
  estado_verificacion TEXT DEFAULT 'pendiente',  -- pendiente|aprobado|rechazado
  documento_tipo TEXT DEFAULT '',
  documento_numero TEXT DEFAULT '',
  documento_frente TEXT DEFAULT '',
  documento_reverso TEXT DEFAULT '',
  selfie TEXT DEFAULT '',
  verificado_en TEXT,
  revisado_por INTEGER,
  desde TEXT,
  disponible INTEGER NOT NULL DEFAULT 1,
  radio_km INTEGER NOT NULL DEFAULT 10,
  notas TEXT DEFAULT '',
 formado_en TEXT
);

CREATE TABLE IF NOT EXISTS tareas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  categoria_id INTEGER REFERENCES categorias(id),
  titulo TEXT DEFAULT '',
  descripcion TEXT DEFAULT '',
  direccion TEXT DEFAULT '',
  cp TEXT DEFAULT '',
  ciudad_id INTEGER REFERENCES ciudades(id),
  lat REAL, lng REAL,
  fecha TEXT DEFAULT '',
  hora TEXT DEFAULT '',
  horas REAL DEFAULT 1,
  frecuencia TEXT DEFAULT 'once',
  tipo_presupuesto TEXT DEFAULT 'cerrado',     -- cerrado | visita
  estado TEXT NOT NULL DEFAULT 'borrador',     -- borrador|publicada|en_curso|completada|cancelada
  profesional_id INTEGER REFERENCES usuarios(id),
  presupuesto_id INTEGER,
  precio_final REAL DEFAULT 0,
  comision REAL DEFAULT 0,
  slug TEXT DEFAULT '',
  creada_en TEXT NOT NULL,
  publicada_en TEXT,
  cerrada_en TEXT
);

CREATE TABLE IF NOT EXISTS presupuestos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  profesional_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  precio REAL NOT NULL,
  horas REAL DEFAULT 1,
  mensaje TEXT DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'enviado',      -- enviado|aceptado|rechazado|retirado
  creado_en TEXT NOT NULL,
  responde_en TEXT
);

CREATE TABLE IF NOT EXISTS mensajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea_id INTEGER REFERENCES tareas(id) ON DELETE CASCADE,
  emisor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  destinatario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cuerpo TEXT NOT NULL,
  leido INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opiniones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea_id INTEGER REFERENCES tareas(id) ON DELETE CASCADE,
  autor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  profesional_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  puntuacion INTEGER NOT NULL,
  comentario TEXT DEFAULT '',
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT DEFAULT 'identidad',
  archivo TEXT DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'pendiente',     -- pendiente|aprobado|rechazado
  revisado_por INTEGER,
  revisado_en TEXT,
  notas TEXT DEFAULT '',
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transacciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,                          -- recarga|pago_cliente|pago_profesional|compra_tokens|retirada
  usuario_id INTEGER REFERENCES usuarios(id),
  tarea_id INTEGER REFERENCES tareas(id),
  monto REAL NOT NULL DEFAULT 0,
  comision REAL NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'completada',   -- pendiente|completada|revertida
  referencia TEXT DEFAULT '',
  descripcion TEXT DEFAULT '',
  creado_en TEXT NOT NULL
);

/* Monedero de tokens del profesional. 10 tokens = 1 €.
   tipo: compra (+) | presupuesto (-) | reembolso (+)
   Los tokens consumidos son el ingreso de la plataforma: ya no se cobra
   comisión por trabajo terminado. */
CREATE TABLE IF NOT EXISTS tokens_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,                          -- compra|presupuesto|reembolso
  cantidad INTEGER NOT NULL,                   -- positivo entra, negativo sale
  presupuesto_id INTEGER REFERENCES presupuestos(id) ON DELETE SET NULL,
  euros REAL NOT NULL DEFAULT 0,               -- importe pagado (solo compras)
  descripcion TEXT DEFAULT '',
  creado_en TEXT NOT NULL
);

/* Verificación de identidad de los clientes: obligatoria para publicar
   una tarea, para que la oferta sea real. */
CREATE TABLE IF NOT EXISTS verificaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendiente',    -- pendiente|aprobado|rechazado
  documento_tipo TEXT DEFAULT '',
  documento_numero TEXT DEFAULT '',
  documento_frente TEXT DEFAULT '',
  documento_reverso TEXT DEFAULT '',
  selfie TEXT DEFAULT '',
  revisado_por INTEGER,
  revisado_en TEXT,
  notas TEXT DEFAULT '',
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT DEFAULT 'info',
  titulo TEXT NOT NULL,
  cuerpo TEXT DEFAULT '',
  canal TEXT DEFAULT 'web',
  leido INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER REFERENCES usuarios(id),
  accion TEXT NOT NULL,
  entidad TEXT DEFAULT '',
  entidad_id INTEGER,
  detalle TEXT DEFAULT '',
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS landings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,                          -- servicio | servicio_ciudad
  categoria_id INTEGER REFERENCES categorias(id),
  ciudad_id INTEGER REFERENCES ciudades(id),
  slug TEXT NOT NULL UNIQUE,
  activa INTEGER NOT NULL DEFAULT 1,
  generada_en TEXT
);

CREATE INDEX IF NOT EXISTS idx_tareas_cliente   ON tareas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_tareas_prof      ON tareas(profesional_id);
CREATE INDEX IF NOT EXISTS idx_tareas_estado     ON tareas(estado);
CREATE INDEX IF NOT EXISTS idx_presu_tarea       ON presupuestos(tarea_id);
CREATE INDEX IF NOT EXISTS idx_presu_prof        ON presupuestos(profesional_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_tarea    ON mensajes(tarea_id);
CREATE INDEX IF NOT EXISTS idx_opin_prof         ON opiniones(profesional_id);
/* Tabla auxiliar: la tabla tareas no tiene columnas para días, flexibilidad,
   transportes ni fotos. */
CREATE TABLE IF NOT EXISTS tarea_extra (
  tarea_id INTEGER PRIMARY KEY REFERENCES tareas(id) ON DELETE CASCADE,
  pasos TEXT DEFAULT '[]',
  dias TEXT DEFAULT '[]',
  repeticiones INTEGER DEFAULT 0,
  flexibilidad_fecha TEXT DEFAULT 'no',
  flexibilidad_hora TEXT DEFAULT 'cualquiera',
  transportes TEXT DEFAULT '[]',
  fotos TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_notif_usuario     ON notificaciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_tokens_usuario     ON tokens_movimientos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_tokens_presupuesto ON tokens_movimientos(presupuesto_id);
CREATE INDEX IF NOT EXISTS idx_verif_usuario      ON verificaciones(usuario_id);
`);

/* ------------------------------------------------------------------ */
/* Helpers de consulta                                                */
/* ------------------------------------------------------------------ */
export const q = {
  all(sql, ...p) { return db.prepare(sql).all(...p); },
  get(sql, ...p) { return db.prepare(sql).get(...p); },
  run(sql, ...p) { const r = db.prepare(sql).run(...p); return { cambios: Number(r.changes), id: Number(r.lastInsertRowid) }; }
};

export const ahora = () => new Date().toISOString();

/* La plataforma NO cobra comisión por trabajo terminado: el profesional
   recibe el 100 % del importe pactado. El ingreso de TrabajoFácil son los
   tokens que el profesional compra para poder enviar presupuestos
   (ver servidor/tokens.mjs). Las columnas `comision` de `tareas` y
   `transacciones` se conservan por trazabilidad y quedan a 0. */

/* ------------------------------------------------------------------ */
/* Catálogo: las 12 áreas del original                                 */
/* ------------------------------------------------------------------ */
const AREAS = [
  ['Trabajos de limpieza', 'trabajos-de-limpieza', '¿Necesitas ayuda con la limpieza de tu casa u oficina?', 'limpieza'],
  ['Reparaciones y oficios', 'reparaciones-y-bricolaje', 'Reparaciones en el hogar, vehículo y proyectos menores', 'reparaciones'],
  ['Mudanzas y transportes', 'mudanzas-y-transportes', 'Mudanzas, muebles grandes y transporte de objetos', 'mudanzas'],
  ['Informática y tecnología', 'informatica-y-tecnologia', 'Ordenadores, wifi y todo lo que te bloquea el día', 'informatica'],
  ['Animales y mascotas', 'animales-y-mascotas', 'Cuidar, pasear y acompañar a tu mascota', 'mascotas'],
  ['Fiestas y eventos', 'fiestas-y-eventos', 'Todo lo que necesitas para que tu evento salga bien', 'eventos'],
  ['Oficinas y empresas', 'oficinas-y-empresas', 'Mantenimiento y servicios para negocios y empresas', 'oficinas'],
  ['Deporte y cuidado personal', 'deporte-y-cuidado-personal', 'Cuida de ti: deporte, masajes y estética a domicilio', 'deporte'],
  ['Clases particulares', 'clases-particulares', 'Idiomas, refuerzo escolar y lo que quieras aprender', 'educacion'],
  ['Servicios de urgencia 24 h', 'servicios-de-urgencia-24h', 'Para cuando necesitas ayuda ya y sin improvisar', 'urgencia'],
  ['Cuidado de personas', 'cuidado-personas', 'Acompañamiento para mayores, niños o quien lo necesite', 'personas'],
  ['Destacados', 'destacados', 'Nuestra selección de los servicios más buscados', 'destacados']
];

/* Familias de categoría: cada familia comparte tono y baja alfa por nivel */
const CATEGORIAS = [
  ['Limpieza de hogar', 'limpieza-de-hogar', 'LH', 'rgba(0,172,181,1)', 'limpieza', 'trabajos-de-limpieza', 12.5,
   ['limpieza casa','limpiadora','limpieza por horas','persona de limpieza','limpieza a domicilio','empresa limpieza hogar','señora limpieza','limpiadores']],
  ['Limpieza de baños', 'limpieza-de-banos', 'LB', 'rgba(0,172,181,.78)', 'limpieza', 'trabajos-de-limpieza', 14,
   ['limpieza WC','azulejos','baño limpio','desinfectar baño','limpieza baños casa']],
  ['Limpieza de oficinas', 'limpieza-de-oficinas', 'LO', 'rgba(0,172,181,.56)', 'limpieza', 'oficinas-y-empresas', 13,
   ['limpieza oficina','limpieza empresa','mantenimiento oficina','limpieza despachos']],
  ['Limpieza a fondo', 'limpieza-a-fondo', 'LF', 'rgba(0,172,181,.34)', 'limpieza', 'trabajos-de-limpieza', 18,
   ['limpieza general','limpieza profunda','desempolvar casa','limpieza fin de obra']],

  ['Manitas a domicilio', 'manitas-a-domicilio', 'MD', 'rgba(255,138,76,1)', 'reparaciones', 'reparaciones-y-bricolaje', 15,
   ['manitas','reparaciones casa','arreglos en casa','electricista','fontanero','pequeñas reparaciones','colgar cuadros']],
  ['Fontanería', 'fontaneria', 'FO', 'rgba(255,138,76,.78)', 'reparaciones', 'reparaciones-y-bricolaje', 18,
   ['fontanero','grifo','calefacción','fuga de agua','cambiar grifo','sanitarios']],
  ['Pintura', 'pintura-a-domicilio', 'PI', 'rgba(255,138,76,.56)', 'reparaciones', 'reparaciones-y-bricolaje', 16,
   ['pintor','pintura casa','pintar habitaciones','pintura piso','barniz']],
  ['Montaje de muebles', 'montaje-de-muebles', 'MM', 'rgba(255,138,76,.34)', 'reparaciones', 'reparaciones-y-bricolaje', 14,
   ['montador muebles','ensamblar muebles','muebles ikea','colgar muebles','mover muebles']],
  ['Carpintería', 'carpinteria', 'CP', 'rgba(255,138,76,.22)', 'reparaciones', 'reparaciones-y-bricolaje', 17,
   ['carpintero','muebles a medida','reparar muebles','puertas de madera']],

  ['Mudanzas', 'mudanzas', 'MU', 'rgba(48,124,240,1)', 'mudanzas', 'mudanzas-y-transportes', 22,
   ['mudanza','traslado casa','mudarse','camion mudanza','precio mudanza']],
  ['Transporte de muebles', 'transporte-de-muebles', 'TM', 'rgba(48,124,240,.78)', 'mudanzas', 'mudanzas-y-transportes', 18,
   ['furgoneta','transportar sofá','trasladar muebles','vehiculo mudanza','cama']],
  ['Recoger y repartir', 'recoger-y-repartir', 'RR', 'rgba(48,124,240,.56)', 'mudanzas', 'mudanzas-y-transportes', 13,
   ['recados','mandar paquetes','repartos','corrieras','recogida en casa']],
  ['Montaje y desmontaje', 'montaje-y-desmontaje', 'MD2', 'rgba(48,124,240,.34)', 'mudanzas', 'mudanzas-y-transportes', 17,
   ['desmontar muebles','montar estanterías','medidas de muebles','muebles de oficina']],

  ['Informática y tecnología', 'informatica-y-tecnologia', 'IT', 'rgba(124,92,230,1)', 'informatica', 'informatica-y-tecnologia', 20,
   ['informatico','reparar ordenador','soporte informatico','windows','portatil no arranca']],
  ['Instalación de redes', 'instalacion-de-redes', 'IR', 'rgba(124,92,230,.78)', 'informatica', 'informatica-y-tecnologia', 19,
   ['wifi','instalar router','red domestica','amplificador','conectar impresora']],
  ['Sintonización de TV', 'sintonizacion-tv', 'ST', 'rgba(124,92,230,.56)', 'informatica', 'informatica-y-tecnologia', 15,
   ['sintonizar tv','antena','television','canales']],
  ['Ciberseguridad', 'ciberseguridad', 'CS', 'rgba(124,92,230,.34)', 'informatica', 'informatica-y-tecnologia', 24,
   ['virus informatico','seguridad informatica','copias de seguridad','phishing']],

  ['Cuidado de mascotas', 'cuidado-de-mascotas', 'CM', 'rgba(230,86,150,1)', 'mascotas', 'animales-y-mascotas', 13,
   ['cuidador de perros','pasear perro','cuidar gato','pet sitting','cuidado animales']],
  ['Paseos y ejercicio', 'paseos-y-ejercio', 'PJ', 'rgba(230,86,150,.56)', 'mascotas', 'animales-y-mascotas', 12,
   ['pasear perros','ejercicio senior','acompañamiento']],
  ['Peluquería y estética', 'peluqueria-y-estetica', 'PE', 'rgba(230,86,150,.34)', 'mascotas', 'deporte-y-cuidado-personal', 16,
   ['peluquero a domicilio','corte de pelo','manicura a domicilio','maquillaje']],

  ['Cuidado de personas', 'cuidado-de-personas', 'CP', 'rgba(90,120,170,1)', 'personas', 'cuidado-personas', 16,
   ['cuidador persona mayor','acompañar mayor','cuidar niños','canguro','cuidador']],
  ['Clases particulares', 'clases-particulares', 'CL', 'rgba(90,120,170,.78)', 'personas', 'clases-particulares', 15,
   ['profesor particular','inglés','refuerzo escolar','idiomas','matemáticas']],

  ['Eventos y fiestas', 'eventos-y-fiestas', 'EF', 'rgba(240,170,40,1)', 'eventos', 'fiestas-y-eventos', 17,
   ['montaje de eventos','organizar fiesta','sonido para fiestas','camarero eventos']],
  ['Fotografía', 'fotografia', 'FT', 'rgba(240,170,40,.78)', 'eventos', 'fiestas-y-eventos', 25,
   ['fotografo','retratos','fotos de producto','boda']],
  ['Catering', 'catering', 'CA', 'rgba(240,170,40,.56)', 'eventos', 'fiestas-y-eventos', 20,
   ['catering','comida para eventos','menu degustacion','cocinero eventos']]
];

const CIUDADES = [
  ['Madrid', 'madrid', 'Madrid', '28001', 40.4168, -3.7038],
  ['Barcelona', 'barcelona', 'Cataluña', '08001', 41.3851, 2.1734],
  ['Valencia', 'valencia', 'Valencia', '46001', 39.4699, -0.3763],
  ['Sevilla', 'sevilla', 'Andalucía', '41001', 37.3891, -5.9845],
  ['Bilbao', 'bilbao', 'País Vasco', '48001', 43.2630, -2.9350],
  ['Zaragoza', 'zaragoza', 'Aragón', '50001', 41.6488, -0.8891],
  ['Málaga', 'malaga', 'Andalucía', '29001', 36.7213, -4.4214],
  ['A Coruña', 'a-coruna', 'Galicia', '15001', 43.3623, -8.4115],
  ['Murcia', 'murcia', 'Murcia', '30001', 37.9922, -1.1307],
  ['Palma', 'palma', 'Baleares', '07001', 39.5696, 2.6502],
  ['Alicante', 'alicante', 'Comunidad Valenciana', '03001', 38.3452, -0.4810],
  ['Vigo', 'vigo', 'Galicia', '36201', 42.2406, -8.7207]
];

const CP_EXTRAS = [
  ['28013','Madrid','Madrid',40.4208,-3.7040],['08003','Barcelona','Cataluña',41.3874,2.1686],
  ['46002','Valencia','Valencia',39.4700,-0.3760],['41003','Sevilla','Andalucía',37.3890,-5.9846],
  ['48001','Bilbao','País Vasco',43.2630,-2.9350],['50001','Zaragoza','Aragón',41.6488,-0.8891],
  ['29007','Málaga','Andalucía',36.7200,-4.4200],['15003','A Coruña','Galicia',43.3623,-8.4115],
  ['30003','Murcia','Murcia',37.9922,-1.1307],['07002','Palma','Baleares',39.5696,2.6502],
  ['03001','Alicante','Comunidad Valenciana',38.3452,-0.4810],['36202','Vigo','Galicia',42.2406,-8.7207],
  ['28004','Madrid','Madrid',40.4160,-3.7020],['08011','Barcelona','Cataluña',41.3851,2.1734]
];

/* ------------------------------------------------------------------ */
/* Seed                                                               */
/* ------------------------------------------------------------------ */

/* Ficheros de demostración de identidad. Son marcadores de posición
   generados por el propio servidor: no contienen datos personales
   ficticios, solo la silueta y el texto que explica qué se está viendo. */
const SVG_DOCUMENTO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 300" width="480" height="300" role="img" aria-label="Documento de identidad de demostración">
<rect width="480" height="300" fill="#f2f5f4"/>
<rect x="24" y="22" width="432" height="252" rx="12" fill="#ffffff" stroke="#d9dedc" stroke-width="2"/>
<rect x="48" y="50" width="64" height="84" rx="6" fill="#eaf5f1"/>
<circle cx="80" cy="80" r="15" fill="#2ea378" opacity=".45"/>
<path d="M57 122c5-15 41-15 46 0z" fill="#2ea378" opacity=".3"/>
<rect x="136" y="56" width="170" height="12" rx="6" fill="#dfe4e2"/>
<rect x="136" y="82" width="250" height="10" rx="5" fill="#e8ecea"/>
<rect x="136" y="104" width="205" height="10" rx="5" fill="#e8ecea"/>
<rect x="48" y="162" width="384" height="12" rx="6" fill="#eef1f0"/>
<rect x="48" y="190" width="290" height="12" rx="6" fill="#eef1f0"/>
<text x="240" y="248" text-anchor="middle" font-family="Montserrat,Arial,sans-serif" font-size="15" fill="#7a8a86">Documento de identidad · fichero de demostración</text>
</svg>`;

const SVG_SELFIE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 400" width="320" height="400" role="img" aria-label="Selfie de identidad de demostración">
<rect width="320" height="400" fill="#f2f5f4"/>
<circle cx="160" cy="146" r="62" fill="#2ea378" opacity=".3"/>
<path d="M64 330c8-58 46-86 96-86s88 28 96 86z" fill="#2ea378" opacity=".3"/>
<text x="160" y="374" text-anchor="middle" font-family="Montserrat,Arial,sans-serif" font-size="14" fill="#7a8a86">Selfie · fichero de demostración</text>
</svg>`;

/* Fotos de demostración del trabajo a realizar. El cliente adjunta al menos
   una para demostrar que la oferta es real; estas son marcadores de posición
   generados por el propio servidor (no fotografías de vivienda ni de personas). */
function svgTrabajo(titulo, tono) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320" width="480" height="320" role="img" aria-label="Foto del trabajo a realizar, fichero de demostración">
<rect width="480" height="320" fill="#eef2f0"/>
<rect x="18" y="18" width="444" height="284" rx="12" fill="#ffffff" stroke="#d9dedc" stroke-width="2"/>
<rect x="44" y="46" width="150" height="110" rx="8" fill="${tono}" opacity=".55"/>
<rect x="214" y="46" width="222" height="14" rx="7" fill="#dfe4e2"/>
<rect x="214" y="72" width="180" height="12" rx="6" fill="#e8ecea"/>
<rect x="214" y="96" width="200" height="12" rx="6" fill="#e8ecea"/>
<rect x="44" y="180" width="392" height="14" rx="7" fill="#eef1f0"/>
<rect x="44" y="206" width="250" height="12" rx="6" fill="#eef1f0"/>
<text x="240" y="266" text-anchor="middle" font-family="Montserrat,Arial,sans-serif" font-size="15" fill="#7a8a86">${titulo}</text>
<text x="240" y="288" text-anchor="middle" font-family="Montserrat,Arial,sans-serif" font-size="12" fill="#9aa8a4">Foto del trabajo · fichero de demostración</text>
</svg>`;
}

function crearFicherosDemo() {
  const dir = join(raiz, 'contenido', 'documentos');
  mkdirSync(dir, { recursive: true });
  const dirTrabajos = join(raiz, 'contenido', 'trabajos');
  mkdirSync(dirTrabajos, { recursive: true });
  const ficheros = [
    ['demo-documento.svg', SVG_DOCUMENTO],
    ['demo-selfie.svg', SVG_SELFIE]
  ];
  for (const [nombre, contenido] of ficheros) {
    const destino = join(dir, nombre);
    if (!existsSync(destino)) writeFileSync(destino, contenido, 'utf8');
  }
  /* Fotos del trabajo a realizar: van a su propia carpeta, igual que las
     que sube un cliente al publicar. */
  const fotos = [
    ['demo-trabajo-1.svg', svgTrabajo('Piso a limpiar', '#2ea378')],
    ['demo-trabajo-2.svg', svgTrabajo('Herramienta a reparar', '#48c0e6')],
    ['demo-trabajo-3.svg', svgTrabajo('Espacio a ordenar', '#f0aa28')]
  ];
  for (const [nombre, contenido] of fotos) {
    const destino = join(dirTrabajos, nombre);
    if (!existsSync(destino)) writeFileSync(destino, contenido, 'utf8');
  }
}

export function sembrar({ silencioso = false } = {}) {
  const yaHay = q.get('SELECT COUNT(*) AS n FROM usuarios').n;
  if (yaHay > 0) return false;

  const t = ahora();
  crearFicherosDemo();

  AREAS.forEach(([nombre, slug, desc, icono], i) => {
    q.run('INSERT INTO areas (nombre,slug,descripcion,icono,orden) VALUES (?,?,?,?,?)', nombre, slug, desc, icono, i);
  });

  CATEGORIAS.forEach(([nombre, slug, code, color, familia, areaSlug, precio, keywords], i) => {
    const area = q.get('SELECT id FROM areas WHERE slug=?', areaSlug);
    q.run(
      'INSERT INTO categorias (nombre,slug,code,color,familia,area_id,precio_medio,keywords,orden) VALUES (?,?,?,?,?,?,?,?,?)',
      nombre, slug, code, color, familia, area ? area.id : null, precio, JSON.stringify(keywords), i
    );
  });

  CIUDADES.forEach(([nombre, slug, provincia, cp, lat, lng]) => {
    q.run('INSERT INTO ciudades (nombre,slug,provincia,cp,lat,lng) VALUES (?,?,?,?,?,?)', nombre, slug, provincia, cp, lat, lng);
  });

  CP_EXTRAS.forEach(([cp, ciudad, provincia, lat, lng]) => {
    q.run('INSERT OR REPLACE INTO codigos_postales (cp,ciudad,provincia,lat,lng) VALUES (?,?,?,?,?)', cp, ciudad, provincia, lat, lng);
  });

  /* --- usuarios de demostración ---
     admin: administración de la plataforma.
     cliente: cliente verificado, puede publicar tareas.
     pendiente: cliente con la verificación en revisión (aparece en la cola
     de verificación del admin).
     el resto: profesionales verificados o pendientes de verificar. */
  const demo = [
    ['admin@trabajofacil.es', 'demo1234', 'Administración', 'TrabajoFácil', 'madrid', 1, 'admin'],
    ['nuria@ejemplo.es', 'demo1234', 'Nuria', 'Serrano', 'madrid', 17954, 'profesional'],
    ['radik@ejemplo.es', 'demo1234', 'Radik', 'Ibáñez', 'barcelona', 11830, 'profesional'],
    ['miguel@ejemplo.es', 'demo1234', 'Miguel', 'Vera', 'valencia', 409564, 'profesional'],
    ['carmen@ejemplo.es', 'demo1234', 'Carmen', 'Luna', 'sevilla', 81204, 'profesional'],
    ['adrian@ejemplo.es', 'demo1234', 'Adrián', 'Prieto', 'bilbao', 52118, 'profesional'],
    ['sara@ejemplo.es', 'demo1234', 'Sara', 'Molina', 'zaragoza', 73390, 'profesional'],
    ['diego@ejemplo.es', 'demo1234', 'Diego', 'Ruiz', 'malaga', 61022, 'profesional'],
    ['lucia@ejemplo.es', 'demo1234', 'Lucía', 'Ferrer', 'a-coruna', 45771, 'profesional'],
    ['rosa@ejemplo.es', 'demo1234', 'Rosa', 'Delgado', 'murcia', 90321, 'profesional'],
    ['pablo@ejemplo.es', 'demo1234', 'Pablo', 'Castro', 'palma', 31207, 'profesional'],
    ['elena@ejemplo.es', 'demo1234', 'Elena', 'Navas', 'alicante', 88450, 'profesional'],
    ['cliente@ejemplo.es', 'demo1234', 'Marta', 'Iglesias', 'valencia', 99101, 'cliente'],
    ['pendiente@ejemplo.es', 'demo1234', 'Óscar', 'Rueda', 'sevilla', 99102, 'cliente']
  ];

  const slug = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
  /* Categorías activas: el reparto es determinista para que la demo sea
     siempre la misma. El profesional n covers las categorías de la tarea n,
     de modo que las ofertas que le encajan existen de verdad. */
  const cats = q.all('SELECT * FROM categorias WHERE activa=1 ORDER BY id');
  let idxPro = 0;
  demo.forEach(([email, pass, nombre, apellidos, ciudadKey, refId, rol]) => {
    const esAdmin = rol === 'admin';
    const ciudad = q.get('SELECT * FROM ciudades WHERE slug=?', ciudadKey);
    const hash = hashSync(pass);
    const r = q.run(
      `INSERT INTO usuarios (email,password,nombre,apellidos,telefono,rol,ciudad_id,cp,lat,lng,activo,email_verificado,creado_en,token_verificacion,dni_nie)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`,
      email, hash, nombre, apellidos, esAdmin ? '+34600000000' : '+346' + String(600000000 + refId % 900000000).slice(0, 9),
      rol,
      ciudad ? ciudad.id : null, ciudad ? ciudad.cp : '', ciudad ? ciudad.lat : null, ciudad ? ciudad.lng : null,
      esAdmin ? 1 : 0, t, esAdmin ? null : 'tok-' + refId, esAdmin ? null : '12345678Z'
    );
    const uid = r.id;

    if (rol === 'profesional') {
      const k = idxPro++;
      const misCats = [0, 7, 13].map(d => cats[(k * 3 + d) % cats.length]).filter(Boolean);
      const precioBase = misCats.length ? (misCats[0].precio_medio || 15) : 15;
      q.run(
        `INSERT INTO profesionales (usuario_id,titularidad,nif,precio_hora,categorias,estado_verificacion,
           documento_tipo,documento_numero,documento_frente,selfie,verificado_en,revisado_por,desde,disponible,radio_km,formado_en)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        uid, 'autonomo', 'B' + String(10000000 + refId), precioBase,
        JSON.stringify(misCats.map(c => c.id)), refId % 3 !== 0 ? 'aprobado' : 'pendiente',
        'dni', '12345678Z', refId % 3 !== 0 ? 'documentos/demo-documento.svg' : '', refId % 3 !== 0 ? 'documentos/demo-selfie.svg' : '',
        refId % 3 !== 0 ? t : null, refId % 3 !== 0 ? 1 : null, t.slice(0, 10), 15, t
      );
      if (refId % 3 !== 0) {
        q.run('INSERT INTO documentos (usuario_id,tipo,archivo,estado,revisado_por,revisado_en,creado_en) VALUES (?,?,?,?,?,?,?)',
          uid, 'identidad', 'documentos/demo-documento.svg', 'aprobado', 1, t, t);
      }
    }
  });

  /* --- verificaciones de identidad de los clientes ---
     Publicar una tarea exige identidad verificada: así la oferta es real. */
  const clienteVerificadoId = q.get("SELECT id FROM usuarios WHERE email='cliente@ejemplo.es'")?.id ?? null;
  const clientePendienteId = q.get("SELECT id FROM usuarios WHERE email='pendiente@ejemplo.es'")?.id ?? null;
  const adminId = q.get("SELECT id FROM usuarios WHERE email='admin@trabajofacil.es'")?.id ?? null;
  if (adminId) {
    /* La cuenta de administración también es cliente en la demo: sus tareas
       salen publicadas con la insignia de cliente verificado. */
    q.run(`INSERT INTO verificaciones (usuario_id,estado,documento_tipo,documento_numero,documento_frente,selfie,revisado_por,revisado_en,creado_en)
           VALUES (?,?,?,?,?,?,?,?,?)`,
      adminId, 'aprobado', 'dni', '12345678Z', 'documentos/demo-documento.svg', 'documentos/demo-selfie.svg', 1, t, t);
  }
  if (clienteVerificadoId) {
    q.run(`INSERT INTO verificaciones (usuario_id,estado,documento_tipo,documento_numero,documento_frente,selfie,revisado_por,revisado_en,creado_en)
           VALUES (?,?,?,?,?,?,?,?,?)`,
      clienteVerificadoId, 'aprobado', 'dni', '12345678Z', 'documentos/demo-documento.svg', 'documentos/demo-selfie.svg', 1, t, t);
  }
  if (clientePendienteId) {
    q.run(`INSERT INTO verificaciones (usuario_id,estado,documento_tipo,documento_numero,documento_frente,selfie,creado_en)
           VALUES (?,?,?,?,?,?,?)`,
      clientePendienteId, 'pendiente', 'dni', '87654321X', 'documentos/demo-documento.svg', 'documentos/demo-selfie.svg', t);
  }

  /* --- monedero de tokens ---
     Cada profesional verificado empieza con 100 tokens (10 €) comprados en
     la plataforma, para que pueda enviar presupuestos desde el primer momento. */
  const profesionalesVerificados = q.all("SELECT usuario_id FROM profesionales WHERE estado_verificacion='aprobado'");
  for (const p of profesionalesVerificados) {
    q.run(
      `INSERT INTO tokens_movimientos (usuario_id,tipo,cantidad,presupuesto_id,euros,descripcion,creado_en)
       VALUES (?,?,?,?,?,?,?)`,
      p.usuario_id, 'compra', 100, null, 10, 'Compra inicial de 100 tokens (10,00 €)', t);
    q.run(
      `INSERT INTO transacciones (tipo,usuario_id,tarea_id,monto,comision,estado,referencia,descripcion,creado_en)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      'compra_tokens', p.usuario_id, null, 10, 0, 'completada', 'TOK-INICIAL', 'Compra inicial de 100 tokens', t);
  }

  /* --- tareas de demostración --- */
  const clientes = q.all("SELECT id FROM usuarios WHERE rol='cliente' OR rol='admin' LIMIT 6");
  
  const TAREAS_TEXTO = [
    ['Limpieza a fondo de piso de 80 m²', 'Piso de 80 m² en 4º con ascensor. Cocina, dos baños y fregado de suelo.'],
    ['Cambiar grifo de la cocina y revisar tuberías', 'El grifo gotea y hay una mancha de humedad detrás del fregadero.'],
    ['Montar estantería de pared y colgar cuadros', 'Estantería de 120 cm y seis cuadros. Tengo las medidas y los anclajes.'],
    ['Clases de inglés a domicilio, nivel B1', 'Adulto, dos sesiones de una hora por semana.'],
    ['Mudanza de un piso de 2 habitaciones en Valencia', 'Una cama, un sofá, dos_armarios y cajas. Hay ascensor.'],
    ['Configurar wifi en casa y dos dispositivos', 'Router nuevo, dos equipos y un portátil.'],
    ['Pasear un golden retriever media hora al día', 'Perro tranquilo, necesita paseos a las 8 y a las 18.'],
    ['Limpieza de oficina de 90 m² dos veces por semana', 'Oficina de 6 desks, sala de reuniones y dos baños.'],
    ['Fregar y pulir suelo de gres', 'Suelo de gres de 60 m² en planta baja con acceso por el portal.']
  ];
  const estados = ['publicada', 'publicada', 'publicada', 'en_curso', 'completada', 'publicada', 'publicada', 'en_curso', 'completada'];
  for (let i = 0; i < TAREAS_TEXTO.length; i++) {
    const [titulo, desc] = TAREAS_TEXTO[i];
    const cli = clientes[i % clientes.length];
    const cat = cats[(i * 3) % cats.length];
    const ciudad = q.get('SELECT * FROM ciudades LIMIT 1 OFFSET ?', i % 12);
    const fecha = new Date(Date.now() + (i + 1) * 86400000).toISOString().slice(0, 10);
    const r = q.run(
      `INSERT INTO tareas (cliente_id,categoria_id,titulo,descripcion,direccion,cp,ciudad_id,lat,lng,fecha,hora,horas,
        frecuencia,tipo_presupuesto,estado,precio_final,comision,slug,creada_en,publicada_en,cerrada_en)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      cli.id, cat.id, titulo, desc, 'CalleEjemplo 1', ciudad.cp, ciudad.id, ciudad.lat, ciudad.lng,
      fecha, ['09:00','10:00','11:30','16:00'][i % 4], [2,3,2,2,5,2,1,4,3][i], 'once',
      i % 4 === 3 ? 'visita' : 'cerrado', estados[i],
      0, 0,
      `${i + 1}-${cat.slug}-en-${ciudad.slug}`,
      t, t, estados[i] === 'completada' ? t : null
    );
    const tareaId = r.id;

    /* Foto del trabajo a realizar: el cliente adjunta al menos una para
       demostrar que la oferta es real. En la demo usamos marcadores SVG. */
    const fotoDemo = `/contenido/trabajos/demo-trabajo-${(i % 3) + 1}.svg`;
    q.run('INSERT OR REPLACE INTO tarea_extra (tarea_id,fotos) VALUES (?,?)', tareaId, JSON.stringify([fotoDemo]));

    // Presupuestos: una tarea solo puede tener UN presupuesto aceptado
    // (el que el cliente elige). El resto quedan enviados esperando.
    // Cada presupuesto enviado cuesta 10 tokens al profesional; si el
    // cliente no lo acepta se le devuelven 5.
    const profs = q.all("SELECT usuario_id FROM profesionales WHERE estado_verificacion='aprobado' LIMIT 4");
    const asignada = estados[i] === 'en_curso' || estados[i] === 'completada';
    let primero = true;
    let aceptado = null;
    profs.forEach((p, j) => {
      if ((i + j) % 3 === 2) return;
      const precio = Math.round(cat.precio_medio * [2, 3, 2.5][j % 3] * 100) / 100;
      const esAceptado = asignada && primero;
      // En las tareas sin ganador, uno de los presupuestos quedó rechazado.
      const esRechazado = !asignada && primero && i % 2 === 0;
      const estadoPresu = esAceptado ? 'aceptado' : esRechazado ? 'rechazado' : 'enviado';
      const presu = q.run(
        `INSERT INTO presupuestos (tarea_id,profesional_id,precio,horas,mensaje,estado,creado_en,responde_en)
         VALUES (?,?,?,?,?,?,?,?)`,
        tareaId, p.usuario_id, precio, [2, 3, 2.5][j % 3],
        'Puedo hacerlo el día acordado con material propio.',
        estadoPresu, t, esAceptado || esRechazado ? t : null
      );
      // 10 tokens por enviar el presupuesto
      q.run(
        `INSERT INTO tokens_movimientos (usuario_id,tipo,cantidad,presupuesto_id,euros,descripcion,creado_en)
         VALUES (?,?,?,?,?,?,?)`,
        p.usuario_id, 'presupuesto', -10, presu.id, 0, `Presupuesto para «${titulo}»`, t);
      if (esRechazado) {
        // No se aceptó: se devuelven 5 tokens
        q.run(
          `INSERT INTO tokens_movimientos (usuario_id,tipo,cantidad,presupuesto_id,euros,descripcion,creado_en)
           VALUES (?,?,?,?,?,?,?)`,
          p.usuario_id, 'reembolso', 5, presu.id, 0, 'Presupuesto no aceptado: devolución de la mitad', t);
      }
      if (esAceptado) aceptado = { id: presu.id, profesional: p.usuario_id, precio };
      primero = false;
    });

    // Tarea asignada: profesional, presupuesto aceptado y precio final.
    // La plataforma NO cobra comisión: el profesional recibe el importe íntegro.
    if (aceptado) {
      q.run('UPDATE tareas SET profesional_id=?, presupuesto_id=?, precio_final=?, comision=0 WHERE id=?',
        aceptado.profesional, aceptado.id, aceptado.precio, tareaId);

      // Al aceptar el presupuesto se anotan los dos asientos: cargo al
      // cliente y abono íntegro al profesional (sin comisión de plataforma).
      q.run(`INSERT INTO transacciones (tipo,usuario_id,tarea_id,monto,comision,estado,referencia,descripcion,creado_en)
             VALUES (?,?,?,?,?,?,?,?,?)`,
        'pago_cliente', cli.id, tareaId, aceptado.precio, 0, 'completada', `tarea-${tareaId}`,
        `Pago de la tarea «${titulo}»`, t);
      q.run(`INSERT INTO transacciones (tipo,usuario_id,tarea_id,monto,comision,estado,referencia,descripcion,creado_en)
             VALUES (?,?,?,?,?,?,?,?,?)`,
        'pago_profesional', aceptado.profesional, tareaId, aceptado.precio, 0, 'completada', `tarea-${tareaId}`,
        `Abono de la tarea «${titulo}»`, t);
    }

    // Mensaje de ejemplo con el profesional asignado (o el primero verificado)
    const otro = q.get("SELECT usuario_id FROM profesionales WHERE estado_verificacion='aprobado' LIMIT 1");
    const profId = aceptado ? aceptado.profesional : (otro ? otro.usuario_id : null);
    if (profId) {
      q.run('INSERT INTO mensajes (tarea_id,emisor_id,destinatario_id,cuerpo,creado_en) VALUES (?,?,?,?,?)',
        tareaId, cli.id, profId, 'Hola, ¿podrías confirmarme si llevas tu propio material?', t);
      q.run('INSERT INTO mensajes (tarea_id,emisor_id,destinatario_id,cuerpo,leido,creado_en) VALUES (?,?,?,?,1,?)',
        tareaId, profId, cli.id, 'Sí, llevo material. ¿Te va bien a las 10:00?', t);
    }

    // Opiniones de la tarea completada, sobre el profesional que la hizo
    if (estados[i] === 'completada' && profId) {
      q.run('INSERT INTO opiniones (tarea_id,autor_id,profesional_id,puntuacion,comentario,creado_en) VALUES (?,?,?,?,?,?)',
        tareaId, cli.id, profId, 5, 'Puntual, profesional y muy cuidado. Repetiría sin duda.', t);
      q.run('INSERT INTO opiniones (tarea_id,autor_id,profesional_id,puntuacion,comentario,creado_en) VALUES (?,?,?,?,?,?)',
        tareaId, profId, cli.id, 5, 'Cliente muy claro en las indicaciones.', t);
    }
  }

  /* --- monedero: saldo inicial de los clientes y una retirada del profesional ---
     Sin esta recarga el saldo del cliente queda en negativo, porque los
     cobros por tarea se anotan contra su monedero. */
  const clientesConSaldo = q.all("SELECT id FROM usuarios WHERE rol='cliente' OR rol='admin'");
  for (const c of clientesConSaldo) {
    q.run(`INSERT INTO transacciones (tipo,usuario_id,monto,comision,estado,referencia,descripcion,creado_en)
           VALUES (?,?,?,?,?,?,?,?)`,
      'recarga', c.id, 200, 0, 'completada', 'recarga-inicial', 'Recarga de saldo inicial', t);
  }
  const profDemo = q.get("SELECT usuario_id FROM profesionales WHERE estado_verificacion='aprobado' LIMIT 1");
  if (profDemo) {
    q.run(`INSERT INTO transacciones (tipo,usuario_id,monto,comision,estado,referencia,descripcion,creado_en)
           VALUES (?,?,?,?,?,?,?,?)`,
      'retirada', profDemo.usuario_id, 20, 0, 'completada', 'retirada-demo', 'Retirada de fondos a cuenta bancaria', t);
  }

  /* --- notificaciones y auditoría --- */
  q.run('INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,creado_en) VALUES (?,?,?,?,?)',
    2, 'info', 'Bienvenido a TrabajoFácil', 'Completa tu perfil para recibir más tareas.', t);
  q.run('INSERT INTO auditoria (admin_id,accion,entidad,entidad_id,detalle,creado_en) VALUES (?,?,?,?,?,?)',
    1, 'seed', 'sistema', null, 'Carga inicial de datos de demostración', t);

  if (!silencioso) console.log('Base de datos sembrada:', rutaDB);
  return true;
}

/* ------------------------------------------------------------------ */
/* Hash de contraseñas (scrypt, sin dependencias)                      */
/* ------------------------------------------------------------------ */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashSync(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verificarPassword(password, almacenado) {
  try {
    const [alg, salt, hash] = String(almacenado).split('$');
    if (alg !== 'scrypt') return false;
    const calc = scryptSync(String(password), salt, 64);
    const orig = Buffer.from(hash, 'hex');
    return calc.length === orig.length && timingSafeEqual(calc, orig);
  } catch { return false; }
}

export { rutaDB };
