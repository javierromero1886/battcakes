/* Battcakes — motor de precios del cotizador (módulo ES compartido).
 * Lo usan el servidor (functions/api/cotizar.js, que decide el precio que se guarda) y el navegador
 * (cotizador.js, para mostrar el precio al instante sin consultar al servidor en cada cambio).
 * Importes en céntimos enteros.
 *
 * Reglas (versión 2, editables en /admin → Cotizador):
 *   productos[]: { id, nombre, descripcion, icono, foto, unidad, cantidad_base, precio_base, cantidades[], pisos, min_2_pisos,
 *                  recargo_2_pisos, anticipacion_horas, visible }
 *   grupos[]:    { id, titulo, ayuda, tipo: 'uno' | 'varios', obligatorio, productos[] (vacío = todos), visible,
 *                  opciones[]: { nombre, descripcion, icono, color, foto, precio, visible } }
 *   entrega[]:   { nombre, descripcion, icono, precio, visible }
 * Selección: { producto, cantidad, pisos, opciones: { [grupo.id]: [índices] }, entrega, fecha, franja }
 */
const LIMA_OFFSET_H = 5; // Perú: UTC-5 todo el año (sin horario de verano)

/** Instante UTC (ms) de una fecha y hora de Lima. */
export function instanteLima(fecha, hora) {
  const [a, m, d] = fecha.split('-').map(Number);
  const [h, min] = hora.split(':').map(Number);
  return Date.UTC(a, m - 1, d, h + LIMA_OFFSET_H, min);
}

const vis = (o) => o && o.visible !== false;

/** Convierte reglas de la versión 1 (sabores, rellenos, acabados, extras fijos) a la versión 2 y completa valores que falten. */
export function normalizar(r) {
  if (!r || typeof r !== 'object') return r;
  const n = { ...r };
  if (!Array.isArray(n.grupos)) {
    const personal = (n.productos || []).filter((p) => p.personalizable).map((p) => p.id);
    const grupo = (id, titulo, lista, tipo, obligatorio, productos) => ({
      id, titulo, ayuda: '', tipo, obligatorio, productos, visible: true,
      opciones: (lista || []).map((o) => ({ nombre: o.nombre, descripcion: '', icono: '', color: '', foto: '', precio: o.precio, visible: true })),
    });
    n.grupos = [
      grupo('sabor', 'Sabor', n.sabores, 'uno', true, personal),
      grupo('relleno', 'Relleno', n.rellenos, 'uno', true, personal),
      grupo('acabado', 'Acabado', n.acabados, 'uno', true, personal),
      grupo('extras', 'Adicionales', n.extras, 'varios', false, []),
    ].filter((g) => g.opciones.length);
    delete n.sabores; delete n.rellenos; delete n.acabados; delete n.extras;
  }
  n.productos = (n.productos || []).map((p) => ({
    descripcion: '', icono: '', foto: '', visible: true, recargo_2_pisos: n.segundo_piso || 0, ...p,
  }));
  n.entrega = (n.entrega || []).map((e) => ({ descripcion: '', icono: '', visible: true, ...e }));
  delete n.segundo_piso;
  n.titulo = n.titulo || 'Cotiza tu pedido en línea';
  n.subtitulo = n.subtitulo || 'Elige paso a paso y mira el precio al instante.';
  n.version = 2;
  return n;
}

/** Grupos de opciones que se muestran para un producto. */
export function gruposDe(reglas, productoId) {
  return reglas.grupos.filter((g) => vis(g) && (!g.productos.length || g.productos.includes(productoId)) && g.opciones.some(vis));
}

/** Precio de la parte base (producto × cantidad, proporcional a la cantidad base). */
export function precioBase(prod, cantidad) {
  return Math.round((prod.precio_base * cantidad) / prod.cantidad_base);
}

/** Calcula una cotización. Devuelve { cotizacion } o { error }. Todo en céntimos enteros. */
export function calcular(reglasEntrada, s, ahora) {
  const reglas = normalizar(reglasEntrada);
  if (reglas.pausado) return { error: 'Por ahora no estamos tomando pedidos nuevos. Escríbenos por WhatsApp para consultar.' };
  const prod = reglas.productos.find((p) => p.id === s.producto && vis(p));
  if (!prod) return { error: 'Elige un producto.' };
  const cantidad = Number(s.cantidad);
  if (!prod.cantidades.includes(cantidad)) return { error: `Elige una cantidad de ${prod.unidad} de la lista.` };
  const pisos = Number(s.pisos) === 2 ? 2 : 1;
  if (pisos === 2 && (!prod.pisos || cantidad < prod.min_2_pisos)) return { error: `Dos pisos solo desde ${prod.min_2_pisos} ${prod.unidad}.` };

  const lineas = [{ concepto: `${prod.nombre} · ${cantidad} ${prod.unidad}`, importe: precioBase(prod, cantidad) }];
  if (pisos === 2) lineas.push({ concepto: 'Segundo piso', importe: prod.recargo_2_pisos });

  const elegidos = {};
  const sel = s.opciones && typeof s.opciones === 'object' ? s.opciones : {};
  for (const g of gruposDe(reglas, prod.id)) {
    const crudos = Array.isArray(sel[g.id]) ? sel[g.id] : sel[g.id] != null ? [sel[g.id]] : [];
    const idx = [...new Set(crudos.map(Number))];
    if (g.tipo === 'uno' && idx.length > 1) return { error: `${g.titulo}: elige solo una opción.` };
    if (g.obligatorio && !idx.length) return { error: `Elige ${g.titulo.toLowerCase()}.` };
    const nombres = [];
    for (const i of idx) {
      const o = Number.isInteger(i) ? g.opciones[i] : null;
      if (!vis(o)) return { error: `${g.titulo}: opción no disponible.` };
      nombres.push(o.nombre);
      lineas.push({ concepto: g.tipo === 'uno' ? `${g.titulo}: ${o.nombre}` : o.nombre, importe: o.precio });
    }
    if (nombres.length) elegidos[g.titulo] = nombres.join(', ');
  }

  const ent = Number.isInteger(Number(s.entrega)) ? reglas.entrega[Number(s.entrega)] : null;
  if (!vis(ent)) return { error: 'Elige cómo recibir tu pedido.' };
  lineas.push({ concepto: ent.nombre, importe: ent.precio });

  const fecha = String(s.fecha || '');
  const franja = String(s.franja || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha + 'T00:00:00Z'))) return { error: 'Elige la fecha de entrega.' };
  if (!reglas.franjas.includes(franja)) return { error: 'Elige un horario de entrega.' };
  if (reglas.fechas_bloqueadas.includes(fecha)) return { error: 'Esa fecha no está disponible. Elige otra.' };
  const entrega_ms = instanteLima(fecha, franja);
  const horas = Math.max(reglas.anticipacion_horas, prod.anticipacion_horas || 0);
  if (entrega_ms - ahora < horas * 3600 * 1000) return { error: `Necesitamos al menos ${horas} horas de anticipación. Elige una fecha posterior.` };

  const total = lineas.reduce((t, l) => t + l.importe, 0);
  const adelanto = Math.ceil((total * reglas.adelanto_pct) / 100);
  const vence_ms = Math.min(ahora + reglas.vigencia_horas * 3600 * 1000, entrega_ms - horas * 3600 * 1000);
  return {
    cotizacion: {
      producto: prod.nombre, cantidad, unidad: prod.unidad, pisos, opciones: elegidos, entrega: ent.nombre, fecha, franja,
      lineas, total, adelanto, saldo: total - adelanto, adelanto_pct: reglas.adelanto_pct,
      vence: new Date(vence_ms).toISOString(), nota: reglas.nota,
    },
  };
}
