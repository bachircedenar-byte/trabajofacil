# TrabajoFácil — plataforma completa

Marketplace español de servicios por horas. TrabajoFácil pone en contacto a
quien tiene un problema que resolver con profesionales verificados, con un
monedero de tokens que sustituye a la comisión de la plataforma.

Incluye **todo** el ciclo: portada pública con landings SEO, registro con
verificación de identidad, zona privada de cliente, zona privada de profesional,
monedero de tokens y **panel de administración** completo.

> Todo el código, los gráficos, los textos y los datos son **originales**. No se
> Procede de un análisis pasivo de un marketplace competidor y no reutiliza
> ni una línea del código ajeno.

---

## El modelo de negocio: tokens, sin comisión

TrabajoFácil actúa de **intermediario** entre el profesional y quien tiene el
problema. No cobra comisión por trabajo terminado: el profesional recibe el
**100 %** del importe pactado. Lo que cobra es una tasa por participar, medida
en **tokens**:

| Regla | Detalle |
|---|---|
| Precio del token | 10 tokens = 1 € (se compran en la página del profesional) |
| Enviar un presupuesto | cuesta **10 tokens** (1,00 €) |
| El presupuesto **no** se acepta | se devuelven **5 tokens** (0,50 €): el cliente lo rechaza, elige otro o la tarea se cierra sin elegir |
| El presupuesto **se acepta** | no se devuelve **ningún** token |
| Publicar una tarea | **gratis**, sin tokens y sin comisión |
| Comisión por trabajo terminado | **0 €** |

Quien coloca la tarea solo tiene que **demostrar que el trabajo es real**:
verifica su identidad con DNI o NIE (revisión en la cola del admin) y adjunta
al menos **una foto del trabajo a realizar**, que los profesionales ven antes
de presupuestar. Los tokens consumidos son el ingreso de la plataforma: van a
la tabla `tokens_movimientos`, y su consumo se refleja en `/admin/tokens`.

---

## Arrancar

```bash
node servidor/app.mjs
```

→ <http://localhost:4174>

**No hace falta `npm install`.** Cero dependencias: solo módulos nativos de Node
(`node:sqlite`, `node:crypto`, `node:http`, `node:fs`). La base de datos se
crea y se siembra sola en `datos/trabajofacil.db` al arrancar.

Requiere **Node 22.5+** (por `node:sqlite`). Probado en Node 24.

### Cuentas de demostración

| Correo | Contraseña | Rol |
|---|---|---|
| `admin@trabajofacil.es` | `demo1234` | administrador (y cliente para publicar tareas) |
| `cliente@ejemplo.es` | `demo1234` | cliente **verificado** con DNI (puede publicar tareas) |
| `pendiente@ejemplo.es` | `demo1234` | cliente con la verificación **en revisión** (cola del admin) |
| `nuria@ejemplo.es` | `demo1234` | profesional verificada (Madrid) · 100 tokens de partida |
| `radik@ejemplo.es` | `demo1234` | profesional verificado (Barcelona) |
| `rosa@ejemplo.es` | `demo1234` | profesional **pendiente de verificar** (para probar la cola del admin) |

### Prueba automática

Con el servidor ya arrancado:

```bash
node herramientas/probar.mjs            # rutas públicas, API, registro, login, paneles, CSRF
node herramientas/probar-flujo.mjs      # flujo de negocio: tokens, presupuesto, rechazo, aceptación
node herramientas/probar-subida.mjs     # subida de DNI y selfie (profesional y cliente) + aprobación
node herramientas/diagnostico.mjs       # 41 rutas con timeout de 8 s: informa cuál se cuelga
```

Los tres primeros scripts aceptan la URL del servidor como argumento
(`node herramientas/probar.mjs http://localhost:4175`) y `diagnostico.mjs` la lee
de la variable `TF_BASE`, así que se pueden lanzar contra otra instancia para
probar un despliegue.

---

## Variables de entorno

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `PORT` | `4174` | Puerto del servidor |
| `TF_DB` | `datos/trabajofacil.db` | Ruta de la base de datos SQLite |
| `TF_BASE` | `http://localhost:4174` | URL que usa `diagnostico.mjs` |

---

## Estructura

```
trabajofacil/
├── servidor/
│   ├── app.mjs             arranque, middleware, estáticos
│   ├── db.mjs              esquema SQLite + seed + hash scrypt
│   ├── vistas.mjs          motor de plantillas (tagged templates) + parcials
│   ├── auth.mjs            sesiones, cookies, roles, CSRF, flash, verificación de cliente
│   ├── router.mjs          micro-router, multipart, estáticos
│   ├── tokens.mjs          monedero de tokens: comprar, gastar, reembolsar
│   ├── rutas-publico.mjs   portada, catálogo, landings SEO, profesionales, tareas, precios, legal, API
│   ├── rutas-cuenta.mjs    registro, login, perfil, tareas, presupuestos, chat, facturación
│   ├── rutas-profesional.mjs onboarding, verificación, ofertas, presupuestos, ingresos, tokens
│   └── rutas-admin.mjs     back-office completo
├── assets/
│   ├── css/estilos.css     sistema de diseño (tokens + componentes del clon)
│   ├── css/app.css         capa de aplicación (tablas, paneles, barra lateral)
│   ├── js/publico.js       buscador del hero
│   └── img/*.svg           24 gráficos generados
├── herramientas/
│   ├── probar.mjs          prueba de integración end-to-end
│   ├── probar-flujo.mjs    prueba del flujo de negocio con tokens
│   ├── probar-subida.mjs   prueba de subida de documentos y verificación
│   ├── diagnostico.mjs     comprueba que ninguna ruta se cuelga (41 rutas)
│   ├── generar-assets.mjs  generador de SVG
│   └── servidor.mjs        servidor estático para la maqueta
├── maqueta-estatica/       versión previa (sin backend), por si quieres compararla
├── datos/                  base de datos SQLite (se crea sola)
├── contenido/              subidas: DNI/NIE, selfies, fotos del trabajo, avatars
└── pruebas/                vista de escritorio en iframes para revisar maquetación
```

---

## Qué replica cada parte del original

| Funcionalidad | Cómo está resuelta | Dónde |
|---|---|---|
| Portada con hero, buscador, 12 áreas, mapa, testimonios | Igual, con datos reales de la BD | `rutas-publico.mjs` |
| Buscador Bloodhound/typeahead sobre `/c/keywords` | API `/api/buscar` con la misma puntuación por sinónimos | `rutas-publico.mjs` + `publico.js` |
| `Categoría {nombre, code, color, familia, avgPrice, slug, keywords}` | Tabla `categorias`, mismos campos | `db.mjs` |
| Landings `/servicios-de-{servicio}` y `…-en-{ciudad}` | Generadas desde el mismo modelo, con sitemap | `rutas-publico.mjs` |
| Stepper de 10 pasos con borrador en servidor | Guardado en la tabla `tareas` (estado `borrador`) | `rutas-cuenta.mjs` |
| Borrador de tarea (CP, frecuencia, fecha, hora, horas, flexibilidad, transportes, descripción, fotos) | Mismos campos | `db.mjs` → tabla `tareas` |
| Perfil público `/t/{id}` con valoración y opiniones | Igual, calculadas desde `opiniones` | `rutas-publico.mjs` |
| Verificación de identidad del profesional | Subida de documento + selfie y **cola de revisión en el admin** | `rutas-profesional.mjs` + `rutas-admin.mjs` |
| "Recibe hasta 4 presupuestos" | `presupuestos` con estados enviado/aceptado/rechazado | `db.mjs` |
| Comisión de la plataforma | **Retirada**: la plataforma cobra 10 tokens (1 €) por presupuesto enviado y devuelve 5 si no se acepta; sobre el trabajo no cobra comisión | `tokens.mjs` |
| Avisos y notificaciones | Tabla `notificaciones` | `db.mjs` |

---

## Decisiones de diseño

**Servidor renderizado, no SPA.** El original sirve HTML y su mayor activo es el
SEO programático. Renderizar en servidor (con plantillas propias y sin
dependencias) mantiene esa ventaja y hace que cada URL sea indexable.

**Monedero simulado, en euros y en tokens.** No se mueven fondos reales: los
importes se registran en la tabla `transacciones`. Cuando el cliente acepta un
presupuesto se anotan dos asientos (cargo al cliente y abono **íntegro** al
profesional: la plataforma ya no cobra comisión por el trabajo). Los tokens se
llevan en su propio libro mayor, `tokens_movimientos`, y los gestiona
`servidor/tokens.mjs`: `comprarTokens()`, `gastarTokens()` (10 tokens al
presupuestar), `reembolsarTokens()` (5 de vuelta si no se acepta, idempotente)
y `reembolsarPendientes()` (los presupuestos que se quedan fuera cuando el
cliente elige otro). Para producción, el punto de sustitución es
`tokens.mjs` (comprarTokens) → pasarela tipo Stripe Connect, y
`rutas-cuenta.mjs` (aceptar presupuesto) → pago real al profesional.

**Verificación de identidad manual, también para el cliente.** El profesional
sube DNI/NIE y selfie; la fila queda en `documentos` con estado `pendiente` y
aparece en `/admin/verificaciones`. El cliente hace lo mismo en
`/mi-cuenta/verificacion`: su fila va a la tabla `verificaciones` y **no puede
publicar una tarea hasta que el admin la aprueba** (`clienteVerificado()` en
`auth.mjs`). Además tiene que adjuntar al menos **una foto del trabajo a
realizar**, que es la prueba de que la oferta es real. En producción, esto se
sustituye por un proveedor KYC (Idemia, Veriff, Onfido) manteniendo la misma cola.

**CSRF por double-submit.** Cookie `tf_csrf` + campo `csrf` en todos los
formularios. `exigirCsrf(ctx)` aborta la petición si no coincide.

**Contraseñas con scrypt** (`node:crypto`), sin bcrypt ni dependencias.

**Assets versionados por `mtime`.** El servidor responde los estáticos con
`max-age=300`, así que cada URL de CSS o JS lleva `?v=<mtime del fichero>`
(`versionAsset()` en `vistas.mjs`). La versión se deriva del propio archivo:
un despliegue invalida la caché sin tocar código.

**Grid centrado sin márgenes negativos.** `.row` es el contenedor de página:
`max-width: var(--max)` + `margin: 0 auto` + `padding: 0 .5rem`. El canal
entre columnas se consigue con el `padding` de `.columns`, nunca con márgenes
negativos: al combinarlos, el `margin-left/right` anulaba el `margin: 0 auto`
y dejaba la columna de 1200 px pegada al borde izquierdo en pantallas anchas
(el contenido se veía "corrido hacia un lado"). Las secciones a sangre (hero,
cabecera, pie) se resuelven con `.row.full` o con elementos fuera de `.row`.
Las páginas de panel (`main.ancho`) añaden `max-width:1400px; margin:0 auto`
en línea, igual que `.app-shell` en `app.css`.

**Datos de demostración coherentes.** La siembra crea 14 usuarios (1 admin,
2 clientes y 11 profesionales), 9 tareas, 24 presupuestos y 3 profesionales
pendientes de verificar. Cada tarea en curso o completada tiene **un solo
presupuesto aceptado**, un profesional asignado y su precio final, con los dos
asientos de monedero correspondientes. Cada presupuesto enviado tiene su cargo
de 10 tokens, los rechazados tienen su devolución de 5 y los aceptados no
devuelven nada. Cada tarea lleva su foto del trabajo. Los ficheros de
identidad y de fotos de demostración son SVG generados por el propio servidor:
son marcadores de posición, no documentos ni fotografías reales.

---

## Modelo de datos

```
usuarios ──┬── profesionales ── documentos
           ├── sesiones
           ├── verificaciones   (DNI/NIE del cliente, para publicar tareas)
           ├── tareas ──┬── presupuestos
           │           ├── mensajes
           │           └── opiniones
           ├── transacciones    (monedero en euros)
           ├── tokens_movimientos (monedero en tokens)
           ├── notificaciones
           └── auditoria

tareas ──── tarea_extra (pasos del asistente, fotos del trabajo)
areas ──── categorias ──── (tasks)
ciudades ─ codigos_postales
landings  (seo programático generado)
```

---

## Lo que falta para producción

1. **Pagos reales** — sustituir el monedero simulado por una entidad de pago
   regulada, con PSD2/SCA, split payment y reparto de IVA. La compra de tokens
   (`tokens.mjs`) es el punto de sustitución.
2. **KYC externo** — el bypass manual de identidad no es suficiente para emitir
   factura o para servicios regulados.
3. **Correo y notificaciones** — ahora todo queda en la tabla `notificaciones`;
   falta email transaccional, push y (como en el original) Telegram.
4. **API REST y apps móviles** — hoy no hay API de datos; el original tampoco la
   tiene y sus apps scrapean el HTML.
5. **Moderación de contenido** — reseñas y mensajes sin reporte ni bloqueo, y
   sin automatismo que detecte ofertas falsas a partir de la foto del trabajo.
6. **SEO a escala** — el generador de landings del admin crea las combinaciones
   servicio × ciudad, pero falta trocear los sitemaps e indexar por lotes.
7. **Texto legal revisado** — `aviso-legal.html` es una plantilla.
8. **Tests unitarios** — hay más de 100 comprobaciones de integración (ver
   «Prueba automática»), pero no hay framework de tests unitarios ni cobertura
   por medida ni por ruta de error.

---

## Nota legal sobre la ingeniería inversa

El análisis se hizo **en pasivo** sobre superficies públicas (HTML, CSS, JS,
sitemaps, cabeceras HTTP y un endpoint JSON de catálogo). No se sondearon rutas
autenticadas, no se crearon cuentas y no se enviaron formularios reales.

En la UE, la Directiva 2019/790 (DSM, arts. 6 y 11.1.d) prevé la excepción de
copia para fines de investigación y análisis cuando el acceso es lícito. Aun
así, para uso comercial evita: la marca y el logotipo, las fotografías, los
textos, los listados de taskers, los ~90 términos SEO por categoría y el
scraping masivo de sitemaps. El **modelo de datos y la arquitectura** sí son
reutilizables.
