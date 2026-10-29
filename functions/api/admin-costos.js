/**
 * Costos e inventario — Battcakes
 * Cloudflare Pages Function: /api/admin-costos (uso exclusivo del negocio, cabecera "x-admin-key" = ADMIN_KEY)
 *
 * GET  → insumos (con valor de stock), recetas con su costeo, últimos movimientos, factor de precio y reglas del cotizador
 * POST { accion, ... }:
 *   insumos_guardar { insumos: [{ id?, nombre, tipo, unidad, stock_minimo, compra?: { cantidad, costo_total, proveedor, fecha } }] }  (alta o edición en lote)
 *   insumo_borrar   { id }                     (solo si ninguna receta lo usa)
 *   compra          { insumo_id, cantidad, costo_total, proveedor, fecha }  → suma stock y recalcula el costo promedio ponderado
 *   ajuste          { insumo_id, cantidad (+/-), nota }                    → corrige stock (merma, conteo) sin cambiar el promedio
 *   receta_guardar  { receta: { id?, nombre, tipo, vinculo, rinde, unidad, precio_venta, merma_pct, items: [{ insumo_id, cantidad }], notas } }
 *   receta_borrar   { id }
 *   producir        { receta_id, veces }       → descuenta del stock los insumos de la receta × veces
 *   config          { factor }                 → multiplicador del precio sugerido (por defecto 2.5)
 * Cantidades en la unidad base del insumo (g, ml o unidad). Dinero en céntimos.
 */
import { autorizado } from './admin.js';
import { leerContenido } from './contenido.js';
import { costoReceta, ventaReceta, vinculoDe, analizar, FACTOR_DEFECTO } from '../../costeo.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
});

async function guardia(request, env) {
  if (!env.ADMIN_KEY) return json({ ok: false, error: 'ADMIN_KEY no configurada.' }, 500);
  if (!autorizado(request, env)) { await new Promise((r) => setTimeout(r, 800)); return json({ ok: false, error: 'No autorizado.' }, 401); }
  if (!env.DB) return json({ ok: false, error: 'Base de datos no configurada.' }, 500);
  return null;
}

function errorBase(e) {
  console.log('D1 costos error:', e.message);
  if (/no such table/i.test(e.message)) return json({ ok: false, error: 'Faltan las tablas de costos en D1: ejecuta en la consola de D1 el bloque «Costos e inventario» de schema.sql.' }, 500);
  if (/UNIQUE/i.test(e.message)) return json({ ok: false, error: 'Ya existe un insumo con ese nombre.' }, 409);
  return json({ ok: false, error: 'Error de base de datos: ' + e.message }, 500);
}

const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) : '');
const numero = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
const UNIDADES = ['g', 'ml', 'unidad'];

async function leerTodo(env) {
  const [ins, rec, mov, cfg] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM insumos ORDER BY tipo, nombre'),
    env.DB.prepare('SELECT * FROM recetas ORDER BY tipo, nombre'),
    env.DB.prepare('SELECT m.*, i.nombre AS insumo, i.unidad FROM movimientos m LEFT JOIN insumos i ON i.id = m.insumo_id ORDER BY m.id DESC LIMIT 150'),
    env.DB.prepare('SELECT clave, valor FROM costos_config'),
  ]);
  const insumos = ins.results || [];
  const porId = Object.fromEntries(insumos.map((i) => [i.id, i]));
  const config = Object.fromEntries((cfg.results || []).map((c) => [c.clave, c.valor]));
  const factor = Number(config.factor) > 0 ? Number(config.factor) : FACTOR_DEFECTO;
  return { insumos, porId, recetas: rec.results || [], movimientos: mov.results || [], factor };
}

export async function onRequestGet({ request, env }) {
  const no = await guardia(request, env); if (no) return no;
  try {
    const { insumos, porId, recetas, movimientos, factor } = await leerTodo(env);
    const { contenido } = await leerContenido(env);
    const reglas = contenido.cotizador;
    const conCosteo = recetas.map((r) => {
      const receta = { ...r, items: JSON.parse(r.items || '[]') };
      const c = costoReceta(receta, porId);
      const v = vinculoDe(receta, reglas);
      return { ...receta, vinculo_nombre: v ? v.nombre : '', detalle: c.lineas, faltan: c.faltan, ...analizar(c.costo, ventaReceta(receta, reglas), factor) };
    });
    return json({
      ok: true, factor,
      insumos: insumos.map((i) => ({ ...i, valor_stock: Math.round(Math.max(0, i.stock) * i.costo_promedio) })),
      recetas: conCosteo, movimientos, cotizador: reglas,
    });
  } catch (e) { return errorBase(e); }
}

export async function onRequestPost({ request, env }) {
  const no = await guardia(request, env); if (no) return no;
  let b;
  try { b = await request.json(); } catch { return json({ ok: false, error: 'Solicitud inválida.' }, 400); }
  const ahora = new Date().toISOString();
  try {
    switch (b && b.accion) {
      case 'insumos_guardar': return await guardarInsumos(env, b.insumos, ahora);
      case 'insumo_borrar': return await borrarInsumo(env, b.id);
      case 'compra': return await compra(env, b, ahora);
      case 'ajuste': return await ajuste(env, b, ahora);
      case 'receta_guardar': return await guardarReceta(env, b.receta, ahora);
      case 'receta_borrar':
        await env.DB.prepare('DELETE FROM recetas WHERE id = ?').bind(Number(b.id)).run();
        return json({ ok: true });
      case 'producir': return await producir(env, b, ahora);
      case 'config': {
        const f = numero(b.factor, 1, 20);
        if (f == null) return json({ ok: false, error: 'El factor debe estar entre 1 y 20.' }, 422);
        await env.DB.prepare('INSERT INTO costos_config (clave, valor) VALUES (\'factor\', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').bind(String(f)).run();
        return json({ ok: true, factor: f });
      }
      default: return json({ ok: false, error: 'Acción inválida.' }, 400);
    }
  } catch (e) { return errorBase(e); }
}

export async function onRequest({ request }) {
  return json({ ok: false, error: `Método ${request.method} no permitido.` }, 405);
}

/* ---------------- acciones ---------------- */

function validarCompra(c, donde) {
  const cantidad = numero(c && c.cantidad, 0.000001, 1e9);
  const costo_total = numero(c && c.costo_total, 0, 1e10);
  if (cantidad == null) return { error: `${donde}: cantidad de compra inválida.` };
  if (costo_total == null || !Number.isInteger(costo_total)) return { error: `${donde}: costo total inválido.` };
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(c.fecha || '')) ? c.fecha : new Date().toISOString().slice(0, 10);
  return { cantidad, costo_total, fecha, proveedor: texto(c.proveedor, 80) || null, nota: texto(c.nota, 200) || null };
}

// Costo promedio ponderado: (stock actual × promedio + costo de la compra) / (stock actual + cantidad comprada).
// Si el stock estaba en cero o negativo, el promedio pasa a ser el de la compra.
function nuevoPromedio(ins, cantidad, costo_total) {
  const stock = Math.max(0, ins.stock);
  return stock > 0 ? (stock * ins.costo_promedio + costo_total) / (stock + cantidad) : costo_total / cantidad;
}

async function guardarInsumos(env, lista, ahora) {
  if (!Array.isArray(lista) || !lista.length || lista.length > 100) return json({ ok: false, error: 'Envía entre 1 y 100 insumos.' }, 422);
  const stmts = [];
  const nombres = new Set();
  for (const [i, x] of lista.entries()) {
    const donde = `Fila ${i + 1}`;
    const nombre = texto(x && x.nombre, 80), tipo = texto(x && x.tipo, 40) || 'General', unidad = x && x.unidad;
    if (nombre.length < 2) return json({ ok: false, error: `${donde}: falta el nombre.` }, 422);
    if (nombres.has(nombre.toLowerCase())) return json({ ok: false, error: `${donde}: «${nombre}» está repetido.` }, 422);
    nombres.add(nombre.toLowerCase());
    if (!UNIDADES.includes(unidad)) return json({ ok: false, error: `${donde}: unidad inválida.` }, 422);
    const minimo = numero(x.stock_minimo || 0, 0, 1e9);
    if (minimo == null) return json({ ok: false, error: `${donde}: stock mínimo inválido.` }, 422);
    const id = Number(x.id) || null;
    let compraV = null;
    if (x.compra && Number(x.compra.cantidad) > 0) {
      compraV = validarCompra(x.compra, donde);
      if (compraV.error) return json({ ok: false, error: compraV.error }, 422);
    }
    if (id) {
      // La unidad no se cambia si ya hay movimientos (cambiaría el sentido del stock y del promedio).
      stmts.push(env.DB.prepare('UPDATE insumos SET nombre = ?, tipo = ?, stock_minimo = ?, unidad = CASE WHEN EXISTS (SELECT 1 FROM movimientos WHERE insumo_id = ?) THEN unidad ELSE ? END, actualizado_en = ? WHERE id = ?')
        .bind(nombre, tipo, minimo, id, unidad, ahora, id));
    } else if (compraV) {
      stmts.push(env.DB.prepare('INSERT INTO insumos (nombre, tipo, unidad, stock, stock_minimo, costo_promedio, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(nombre, tipo, unidad, compraV.cantidad, minimo, compraV.costo_total / compraV.cantidad, ahora));
      stmts.push(env.DB.prepare("INSERT INTO movimientos (insumo_id, fecha, tipo, cantidad, costo_total, costo_unitario, proveedor, nota, creado_en) VALUES ((SELECT id FROM insumos WHERE nombre = ?), ?, 'compra', ?, ?, ?, ?, ?, ?)")
        .bind(nombre, compraV.fecha, compraV.cantidad, compraV.costo_total, compraV.costo_total / compraV.cantidad, compraV.proveedor, compraV.nota || 'Stock inicial', ahora));
    } else {
      stmts.push(env.DB.prepare('INSERT INTO insumos (nombre, tipo, unidad, stock, stock_minimo, costo_promedio, actualizado_en) VALUES (?, ?, ?, 0, ?, 0, ?)')
        .bind(nombre, tipo, unidad, minimo, ahora));
    }
  }
  await env.DB.batch(stmts); // todo o nada
  return json({ ok: true, guardados: lista.length });
}

async function borrarInsumo(env, id) {
  id = Number(id);
  const rec = await env.DB.prepare('SELECT nombre, items FROM recetas').all();
  const usa = (rec.results || []).filter((r) => { try { return JSON.parse(r.items).some((it) => Number(it.insumo_id) === id); } catch { return false; } });
  if (usa.length) return json({ ok: false, error: `No se puede borrar: lo usan las recetas ${usa.map((r) => '«' + r.nombre + '»').join(', ')}.` }, 409);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM movimientos WHERE insumo_id = ?').bind(id),
    env.DB.prepare('DELETE FROM insumos WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

async function compra(env, b, ahora) {
  const ins = await env.DB.prepare('SELECT * FROM insumos WHERE id = ?').bind(Number(b.insumo_id)).first();
  if (!ins) return json({ ok: false, error: 'Insumo no encontrado.' }, 404);
  const c = validarCompra(b, 'Compra');
  if (c.error) return json({ ok: false, error: c.error }, 422);
  const prom = nuevoPromedio(ins, c.cantidad, c.costo_total);
  await env.DB.batch([
    env.DB.prepare('UPDATE insumos SET stock = stock + ?, costo_promedio = ?, actualizado_en = ? WHERE id = ?').bind(c.cantidad, prom, ahora, ins.id),
    env.DB.prepare("INSERT INTO movimientos (insumo_id, fecha, tipo, cantidad, costo_total, costo_unitario, proveedor, nota, creado_en) VALUES (?, ?, 'compra', ?, ?, ?, ?, ?, ?)")
      .bind(ins.id, c.fecha, c.cantidad, c.costo_total, c.costo_total / c.cantidad, c.proveedor, c.nota, ahora),
  ]);
  return json({ ok: true, costo_promedio: prom });
}

async function ajuste(env, b, ahora) {
  const ins = await env.DB.prepare('SELECT * FROM insumos WHERE id = ?').bind(Number(b.insumo_id)).first();
  if (!ins) return json({ ok: false, error: 'Insumo no encontrado.' }, 404);
  const cantidad = numero(b.cantidad, -1e9, 1e9);
  if (!cantidad) return json({ ok: false, error: 'Indica cuánto sumar (+) o restar (−).' }, 422);
  const nota = texto(b.nota, 200) || 'Ajuste de inventario';
  await env.DB.batch([
    env.DB.prepare('UPDATE insumos SET stock = stock + ?, actualizado_en = ? WHERE id = ?').bind(cantidad, ahora, ins.id),
    env.DB.prepare("INSERT INTO movimientos (insumo_id, fecha, tipo, cantidad, costo_total, costo_unitario, nota, creado_en) VALUES (?, ?, 'ajuste', ?, ?, ?, ?, ?)")
      .bind(ins.id, ahora.slice(0, 10), cantidad, Math.round(cantidad * ins.costo_promedio), ins.costo_promedio, nota, ahora),
  ]);
  return json({ ok: true });
}

async function guardarReceta(env, r, ahora) {
  if (!r || typeof r !== 'object') return json({ ok: false, error: 'Receta inválida.' }, 400);
  const nombre = texto(r.nombre, 80);
  if (nombre.length < 2) return json({ ok: false, error: 'La receta necesita un nombre.' }, 422);
  const rinde = numero(r.rinde, 0.001, 100000);
  if (rinde == null) return json({ ok: false, error: 'Indica cuánto rinde la receta (mayor que 0).' }, 422);
  const merma = numero(r.merma_pct || 0, 0, 100);
  if (merma == null) return json({ ok: false, error: 'Merma: entre 0 y 100 %.' }, 422);
  const precio = numero(r.precio_venta || 0, 0, 1e10);
  if (precio == null || !Number.isInteger(precio)) return json({ ok: false, error: 'Precio de venta inválido.' }, 422);
  const vinculo = texto(r.vinculo, 140);
  if (vinculo && !/^(producto:[a-z0-9-]+|opcion:[a-z0-9-]+:.+)$/.test(vinculo)) return json({ ok: false, error: 'Vínculo con el cotizador inválido.' }, 422);
  const ids = new Set(((await env.DB.prepare('SELECT id FROM insumos').all()).results || []).map((x) => x.id));
  const items = [];
  for (const it of Array.isArray(r.items) ? r.items.slice(0, 60) : []) {
    const id = Number(it && it.insumo_id), cant = numero(it && it.cantidad, 0.000001, 1e9);
    if (!ids.has(id)) return json({ ok: false, error: 'La receta usa un insumo que no existe.' }, 422);
    if (cant == null) return json({ ok: false, error: 'Cada insumo de la receta necesita una cantidad mayor que 0.' }, 422);
    items.push({ insumo_id: id, cantidad: cant });
  }
  if (!items.length) return json({ ok: false, error: 'Agrega al menos un insumo a la receta.' }, 422);
  const vals = [nombre, texto(r.tipo, 40) || 'General', vinculo, rinde, texto(r.unidad, 20) || 'porciones', precio, merma, JSON.stringify(items), texto(r.notas, 500) || null, ahora];
  if (Number(r.id)) {
    if (vinculo) {
      const dup = await env.DB.prepare('SELECT nombre FROM recetas WHERE vinculo = ? AND id <> ?').bind(vinculo, Number(r.id)).first();
      if (dup) return json({ ok: false, error: `Ese producto u opción ya tiene la receta «${dup.nombre}».` }, 409);
    }
    await env.DB.prepare('UPDATE recetas SET nombre = ?, tipo = ?, vinculo = ?, rinde = ?, unidad = ?, precio_venta = ?, merma_pct = ?, items = ?, notas = ?, actualizado_en = ? WHERE id = ?').bind(...vals, Number(r.id)).run();
  } else {
    if (vinculo) {
      const dup = await env.DB.prepare('SELECT nombre FROM recetas WHERE vinculo = ?').bind(vinculo).first();
      if (dup) return json({ ok: false, error: `Ese producto u opción ya tiene la receta «${dup.nombre}».` }, 409);
    }
    await env.DB.prepare('INSERT INTO recetas (nombre, tipo, vinculo, rinde, unidad, precio_venta, merma_pct, items, notas, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(...vals).run();
  }
  return json({ ok: true });
}

async function producir(env, b, ahora) {
  const r = await env.DB.prepare('SELECT * FROM recetas WHERE id = ?').bind(Number(b.receta_id)).first();
  if (!r) return json({ ok: false, error: 'Receta no encontrada.' }, 404);
  const veces = numero(b.veces, 0.01, 1000);
  if (veces == null) return json({ ok: false, error: 'Indica cuántas veces se preparó la receta.' }, 422);
  const items = JSON.parse(r.items || '[]');
  const factorMerma = 1 + (Number(r.merma_pct) || 0) / 100;
  const stmts = [];
  for (const it of items) {
    const cant = it.cantidad * veces * factorMerma;
    stmts.push(env.DB.prepare('UPDATE insumos SET stock = stock - ?, actualizado_en = ? WHERE id = ?').bind(cant, ahora, it.insumo_id));
    stmts.push(env.DB.prepare("INSERT INTO movimientos (insumo_id, fecha, tipo, cantidad, costo_total, costo_unitario, nota, creado_en) SELECT id, ?, 'consumo', ?, CAST(ROUND(? * costo_promedio) AS INTEGER), costo_promedio, ?, ? FROM insumos WHERE id = ?")
      .bind(ahora.slice(0, 10), -cant, cant, `Producción: ${r.nombre} × ${veces}`, ahora, it.insumo_id));
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}
