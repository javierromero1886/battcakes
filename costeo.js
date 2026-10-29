/* Battcakes — costeo de recetas (módulo ES compartido por functions/api/admin-costos.js y el panel /admin).
 * Solo contiene la lógica de cálculo; los costos reales están en D1 y solo los entrega /api/admin-costos con ADMIN_KEY.
 * Dinero en céntimos. El costo por unidad base de un insumo puede ser fraccionario (céntimos por g/ml); los totales se redondean.
 */
import { normalizar, precioBase, precioOpcion } from './motor-cotizador.js';

export const FACTOR_DEFECTO = 2.5; // precio sugerido = costo de materiales × factor

/** Costo de materiales de una receta (por su rinde), con merma. Devuelve { costo, lineas[], faltan[] }. */
export function costoReceta(receta, insumosPorId) {
  const lineas = [];
  const faltan = [];
  let total = 0;
  for (const it of receta.items || []) {
    const ins = insumosPorId[it.insumo_id];
    if (!ins) { faltan.push('insumo eliminado'); continue; }
    if (!(ins.costo_promedio > 0)) faltan.push(ins.nombre);
    const c = Number(it.cantidad) * ins.costo_promedio;
    total += c;
    lineas.push({ insumo: ins.nombre, cantidad: Number(it.cantidad), unidad: ins.unidad, costo: Math.round(c) });
  }
  const costo = Math.round(total * (1 + (Number(receta.merma_pct) || 0) / 100));
  return { costo, lineas, faltan };
}

/** Busca en las reglas del cotizador el producto u opción vinculado a una receta. */
export function vinculoDe(receta, reglasEntrada) {
  const reglas = normalizar(reglasEntrada);
  const v = String(receta.vinculo || '');
  if (v.startsWith('producto:')) {
    const prod = reglas.productos.find((p) => p.id === v.slice(9));
    return prod ? { tipo: 'producto', prod, nombre: prod.nombre } : null;
  }
  if (v.startsWith('opcion:')) {
    const [, gid, ...resto] = v.split(':');
    const nombre = resto.join(':');
    const g = reglas.grupos.find((x) => x.id === gid);
    const o = g && g.opciones.find((x) => x.nombre === nombre);
    if (!o) return null;
    const prod = reglas.productos.find((p) => g.productos.length ? p.id === g.productos[0] : true) || reglas.productos[0];
    return { tipo: 'opcion', grupo: g, opcion: o, prod, nombre: `${g.titulo}: ${o.nombre}` };
  }
  return null;
}

/** Precio de venta para la cantidad que rinde la receta (desde el cotizador si está vinculada; si no, el precio manual). */
export function ventaReceta(receta, reglas) {
  const v = vinculoDe(receta, reglas);
  const rinde = Number(receta.rinde) || 1;
  if (v && v.tipo === 'producto') return precioBase(v.prod, rinde);
  if (v && v.tipo === 'opcion') return precioOpcion(v.opcion, v.prod, rinde);
  return Number(receta.precio_venta) || 0;
}

/** Compara costo y venta: precio sugerido (costo × factor), ganancia, margen y si cumple el factor. */
export function analizar(costo, venta, factor) {
  const f = Number(factor) > 0 ? Number(factor) : FACTOR_DEFECTO;
  const sugerido = Math.ceil(costo * f);
  const ganancia = venta - costo;
  return {
    costo, venta, sugerido, ganancia,
    margen_pct: venta > 0 ? Math.round((ganancia / venta) * 1000) / 10 : null,
    multiplicador: costo > 0 ? Math.round((venta / costo) * 100) / 100 : null,
    cumple: costo > 0 ? venta >= sugerido : null,
  };
}

/** Costeo completo de un producto final del cotizador: receta del producto + recetas de las opciones elegidas, escaladas a la cantidad. */
export function costoProductoFinal(sel, reglasEntrada, recetas, insumosPorId) {
  const reglas = normalizar(reglasEntrada);
  const prod = reglas.productos.find((p) => p.id === sel.producto);
  if (!prod) return null;
  const cantidad = Number(sel.cantidad) || prod.cantidad_base;
  const partes = [];
  const parte = (vinculo, concepto) => {
    const r = recetas.find((x) => x.vinculo === vinculo);
    if (!r) { partes.push({ concepto, costo: 0, sinReceta: true }); return; }
    const c = costoReceta(r, insumosPorId);
    partes.push({ concepto, costo: Math.round((c.costo * cantidad) / (Number(r.rinde) || 1)), faltan: c.faltan });
  };
  parte('producto:' + prod.id, `${prod.nombre} · ${cantidad} ${prod.unidad}`);
  for (const g of reglas.grupos) {
    for (const i of (sel.opciones && sel.opciones[g.id]) || []) {
      const o = g.opciones[i];
      if (o) parte(`opcion:${g.id}:${o.nombre}`, `${g.titulo}: ${o.nombre}`);
    }
  }
  return { costo: partes.reduce((t, p) => t + p.costo, 0), partes };
}
