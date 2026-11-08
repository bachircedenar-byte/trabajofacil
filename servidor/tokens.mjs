/* ==========================================================================
   TrabajoFácil — monedero de tokens
   --------------------------------------------------------------------------
   TrabajoFácil actúa de intermediario entre el profesional y quien tiene el
   problema. El profesional no paga comisión por el trabajo terminado: la
   recibe íntegra. Lo que paga es una tasa por participar, medida en tokens:

     · 10 tokens = 1 € (los tokens se compran en la página de TrabajoFácil)
     · enviar un presupuesto a una tarea cuesta 10 tokens
     · si ese presupuesto NO se acepta, se devuelven 5 tokens (la mitad)
     · si se acepta, no se devuelve ninguno

   La tabla `tokens_movimientos` es el libro mayor del monedero: una fila por
   cada compra, cada presupuesto enviado y cada devolución. El saldo es la
   suma de `cantidad` del usuario. Los tokens consumidos (los que se gastan
   en presupuestos) son el ingreso de la plataforma.
   ========================================================================== */
import { q, ahora } from './db.mjs';

/* --- reglas del modelo ------------------------------------------------ */
export const PRECIO_TOKEN = 0.10;             // 1 token = 0,10 € → 10 tokens = 1 €
export const TOKENS_PRESUPUESTO = 10;          // coste de enviar un presupuesto
export const TOKENS_REEMBOLSO = 5;             // devolución si no se acepta

/* Paquetes de la tienda. Todos respetan la equivalencia 10 tokens = 1 €. */
export const PAQUETES = [
  { tokens: 10,  euros: 1 },
  { tokens: 50,  euros: 5 },
  { tokens: 100, euros: 10 },
  { tokens: 250, euros: 25 }
];

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */

/** Saldo de tokens de un usuario. */
export function saldoTokens(usuarioId) {
  const v = q.get('SELECT COALESCE(SUM(cantidad),0) AS v FROM tokens_movimientos WHERE usuario_id=?', usuarioId);
  return Number(v ? v.v : 0) || 0;
}

/** Saldo y su equivalencia en euros. */
export function resumenTokens(usuarioId) {
  const tokens = saldoTokens(usuarioId);
  return { tokens, euros: eurosDeTokens(tokens), pendiente: eurosDeTokens(TOKENS_PRESUPUESTO - tokens) };
}

/** Convierte tokens a euros (10 tokens = 1 €). */
export function eurosDeTokens(tokens) {
  return Math.round(Number(tokens || 0) * PRECIO_TOKEN * 100) / 100;
}

/** Convierte euros a tokens (1 € = 10 tokens). */
export function tokensDeEuros(euros) {
  return Math.round(Number(euros || 0) / PRECIO_TOKEN);
}

/** Historial de movimientos de tokens del usuario. */
export function movimientosTokens(usuarioId, limite = 100) {
  return q.all(
    `SELECT m.*, t.titulo AS tarea_titulo
     FROM tokens_movimientos m
     LEFT JOIN presupuestos p ON p.id = m.presupuesto_id
     LEFT JOIN tareas t ON t.id = p.tarea_id
     WHERE m.usuario_id = ?
     ORDER BY m.creado_en DESC, m.id DESC
     LIMIT ?`, usuarioId, limite);
}

/** Total de tokens consumidos por toda la plataforma (ingreso de TrabajoFácil). */
export function tokensConsumidos() {
  const v = q.get("SELECT COALESCE(SUM(-cantidad),0) AS v FROM tokens_movimientos WHERE tipo='presupuesto'");
  return Number(v ? v.v : 0) || 0;
}

/** Tokens comprados por toda la plataforma (importe cobrado, no todo consumido). */
export function tokensComprados() {
  const v = q.get("SELECT COALESCE(SUM(cantidad),0) AS v FROM tokens_movimientos WHERE tipo='compra'");
  return Number(v ? v.v : 0) || 0;
}

/** Movimientos de tokens de toda la plataforma (para el panel de administración). */
export function movimientosGlobales(limite = 200) {
  return q.all(
    `SELECT m.*, u.nombre, u.apellidos, u.email, t.titulo AS tarea_titulo
     FROM tokens_movimientos m
     JOIN usuarios u ON u.id = m.usuario_id
     LEFT JOIN presupuestos p ON p.id = m.presupuesto_id
     LEFT JOIN tareas t ON t.id = p.tarea_id
     ORDER BY m.creado_en DESC, m.id DESC
     LIMIT ?`, limite);
}

/* ------------------------------------------------------------------ */
/* Operaciones                                                         */
/* ------------------------------------------------------------------ */

/**
 * Compra de tokens. Se anota el movimiento de tokens y el cobro en euros
 * en `transacciones` (tipo `compra_tokens`), que es el ingreso de la
 * plataforma. En producción este cobro sería el punto de sustitución por
 * una pasarela de pago (Stripe Connect, Redsys, Bizum…).
 * @returns {{ok: boolean, saldo?: number, motivo?: string}}
 */
export function comprarTokens(usuarioId, tokens, descripcion = '') {
  const n = Math.floor(Number(tokens));
  if (!Number.isInteger(n) || n <= 0) return { ok: false, motivo: 'cantidad_invalida' };
  if (n > 10000) return { ok: false, motivo: 'cantidad_excesiva' };

  const euros = eurosDeTokens(n);
  const ts = ahora();

  q.run(
    `INSERT INTO tokens_movimientos (usuario_id,tipo,cantidad,presupuesto_id,euros,descripcion,creado_en)
     VALUES (?,?,?,?,?,?,?)`,
    usuarioId, 'compra', n, null, euros,
    descripcion || `Compra de ${n} tokens (${euros.toFixed(2).replace('.', ',')} €)`, ts);

  q.run(
    `INSERT INTO transacciones (tipo,usuario_id,tarea_id,monto,comision,estado,referencia,descripcion,creado_en)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    'compra_tokens', usuarioId, null, euros, 0, 'completada',
    `TOK-${Date.now().toString(36).toUpperCase()}`,
    `Compra de ${n} tokens`, ts);

  return { ok: true, saldo: saldoTokens(usuarioId), euros };
}

/**
 * Cobra el coste de enviar un presupuesto (10 tokens).
 * Si el saldo no llega, no se cobra nada y la operación falla.
 * @returns {{ok: boolean, saldo?: number, motivo?: string}}
 */
export function gastarTokens(usuarioId, presupuestoId, descripcion = '') {
  const saldo = saldoTokens(usuarioId);
  if (saldo < TOKENS_PRESUPUESTO) {
    return { ok: false, motivo: 'saldo_insuficiente', saldo };
  }
  q.run(
    `INSERT INTO tokens_movimientos (usuario_id,tipo,cantidad,presupuesto_id,euros,descripcion,creado_en)
     VALUES (?,?,?,?,?,?,?)`,
    usuarioId, 'presupuesto', -TOKENS_PRESUPUESTO, presupuestoId, 0,
    descripcion || `Presupuesto enviado a una tarea`, ahora());
  return { ok: true, saldo: saldoTokens(usuarioId) };
}

/**
 * Devuelve la mitad de los tokens (5) cuando el presupuesto no se acepta:
 * el cliente lo rechaza, elige otro o la tarea se cierra sin elegir.
 * Es idempotente: nunca se devuelve dos veces por el mismo presupuesto.
 * @returns {{ok: boolean, cantidad?: number}}
 */
export function reembolsarTokens(usuarioId, presupuestoId, descripcion = '') {
  if (!presupuestoId) return { ok: false, cantidad: 0 };
  const ya = q.get(
    "SELECT COUNT(*) AS n FROM tokens_movimientos WHERE presupuesto_id=? AND tipo='reembolso'",
    presupuestoId);
  if (ya && ya.n > 0) return { ok: false, cantidad: 0 };

  q.run(
    `INSERT INTO tokens_movimientos (usuario_id,tipo,cantidad,presupuesto_id,euros,descripcion,creado_en)
     VALUES (?,?,?,?,?,?,?)`,
    usuarioId, 'reembolso', TOKENS_REEMBOLSO, presupuestoId, 0,
    descripcion || 'Presupuesto no aceptado: devolución de la mitad', ahora());
  return { ok: true, cantidad: TOKENS_REEMBOLSO };
}

/**
 * Devuelve 5 tokens a cada profesional con un presupuesto pendiente que
 * deja de estar en juego (el cliente elige otro o cierra la tarea).
 * @returns {number} número de presupuestos reembolsados
 */
export function reembolsarPendientes(tareaId, motivo = 'La tarea se cerró sin elegir este presupuesto') {
  const pend = q.all(
    "SELECT id, profesional_id FROM presupuestos WHERE tarea_id=? AND estado='enviado'", tareaId);
  let n = 0;
  for (const p of pend) {
    const r = reembolsarTokens(p.profesional_id, p.id, motivo);
    if (r.ok) {
      q.run("UPDATE presupuestos SET estado='rechazado', responde_en=? WHERE id=?", ahora(), p.id);
      q.run(
        `INSERT INTO notificaciones (usuario_id,tipo,titulo,cuerpo,canal,leido,creado_en) VALUES (?,?,?,?,?,0,?)`,
        p.profesional_id, 'info', 'Presupuesto no seleccionado',
        `${motivo}. Te devolvemos ${TOKENS_REEMBOLSO} de los ${TOKENS_PRESUPUESTO} tokens.`,
        'web', ahora());
      n++;
    }
  }
  return n;
}
