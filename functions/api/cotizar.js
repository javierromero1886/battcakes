/**
 * Cotizador automático — Battcakes
 * Cloudflare Pages Function: /api/cotizar (público)
 *
 * POST { producto, cantidad, pisos, sabor, relleno, acabado, extras[], entrega, fecha: 'AAAA-MM-DD', franja: 'HH:MM', guardar }
 *   → { ok, cotizacion: { lineas[], total, adelanto, saldo, ... } }   (importes en céntimos)
 * Las opciones se envían por posición en las listas de reglas; el precio lo calcula siempre el servidor con las reglas
 * guardadas en /admin (sección "cotizador" de la tabla contenido). Con guardar = true la cotización se registra con un
 * código corto (sin datos personales) para que el negocio la verifique cuando llegue el mensaje de WhatsApp.
 * Una cotización no reserva fecha ni es un pedido: el pedido se confirma por WhatsApp con el adelanto.
 */
import { leerContenido } from './contenido.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const MAX_POR_DIA = 30; // cotizaciones guardadas por IP y día

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Solicitud inválida.' }, 400); }
  const { contenido } = await leerContenido(env);
  const reglas = contenido.cotizador;
  if (!reglas.activo) return json({ ok: false, error: 'El cotizador automático no está disponible. Escríbenos por WhatsApp.' }, 404);
  const r = calcular(reglas, body || {}, Date.now());
  if (r.error) return json({ ok: false, error: r.error }, 422);

  if (body.guardar && env.DB) {
    try {
      const creado_en = new Date().toISOString();
      const ip = request.headers.get('cf-connecting-ip') || '';
      const ip_hash = ip ? await sha256(ip + ':' + creado_en.slice(0, 10)) : null;
      if (ip_hash) {
        const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM cotizaciones WHERE ip_hash = ?').bind(ip_hash).first();
        if (c && Number(c.n) >= MAX_POR_DIA) return json({ ok: true, cotizacion: r.cotizacion });
      }
      const codigo = generarCodigo();
      await env.DB.prepare('INSERT INTO cotizaciones (codigo, creado_en, detalle, total, ip_hash) VALUES (?, ?, ?, ?, ?)')
        .bind(codigo, creado_en, JSON.stringify(r.cotizacion), r.cotizacion.total, ip_hash).run();
      r.cotizacion.codigo = codigo;
    } catch (e) {
      console.log('Cotización no guardada:', e.message);
    }
  }
  return json({ ok: true, cotizacion: r.cotizacion });
}

export async function onRequest({ request }) {
  return json({ ok: false, error: `Método ${request.method} no permitido.` }, 405);
}

/* ---------------- motor ---------------- */

const LIMA_OFFSET_H = 5; // Perú: UTC-5 todo el año (sin horario de verano)

/** Instante UTC (ms) de una fecha y hora de Lima. */
export function instanteLima(fecha, hora) {
  const [a, m, d] = fecha.split('-').map(Number);
  const [h, min] = hora.split(':').map(Number);
  return Date.UTC(a, m - 1, d, h + LIMA_OFFSET_H, min);
}

const opcion = (lista, i) => (Number.isInteger(i) && i >= 0 && i < lista.length ? lista[i] : null);

/** Calcula una cotización. Devuelve { cotizacion } o { error }. Todo en céntimos enteros. */
export function calcular(reglas, s, ahora) {
  if (reglas.pausado) return { error: 'Por ahora no estamos tomando pedidos nuevos. Escríbenos por WhatsApp para consultar.' };
  const prod = reglas.productos.find((p) => p.id === s.producto);
  if (!prod) return { error: 'Elige un producto.' };
  const cantidad = Number(s.cantidad);
  if (!prod.cantidades.includes(cantidad)) return { error: `Elige una cantidad de ${prod.unidad} de la lista.` };
  const pisos = Number(s.pisos) === 2 ? 2 : 1;
  if (pisos === 2 && (!prod.pisos || cantidad < prod.min_2_pisos)) return { error: `Dos pisos solo desde ${prod.min_2_pisos} ${prod.unidad}.` };

  const lineas = [{ concepto: `${prod.nombre} · ${cantidad} ${prod.unidad}`, importe: Math.round((prod.precio_base * cantidad) / prod.cantidad_base) }];
  if (pisos === 2) lineas.push({ concepto: 'Segundo piso', importe: reglas.segundo_piso });

  const elegidos = {};
  if (prod.personalizable) {
    for (const [campo, titulo] of [['sabor', 'sabores'], ['relleno', 'rellenos'], ['acabado', 'acabados']]) {
      const lista = reglas[titulo];
      if (!lista.length) continue;
      const o = opcion(lista, Number(s[campo]));
      if (!o) return { error: `Elige ${campo === 'sabor' ? 'un sabor' : campo === 'relleno' ? 'un relleno' : 'un acabado'}.` };
      elegidos[campo] = o.nombre;
      lineas.push({ concepto: `${campo[0].toUpperCase() + campo.slice(1)}: ${o.nombre}`, importe: o.precio });
    }
  }

  const extras = Array.isArray(s.extras) ? [...new Set(s.extras.map(Number))] : [];
  for (const i of extras) {
    const o = opcion(reglas.extras, i);
    if (!o) return { error: 'Adicional inválido.' };
    lineas.push({ concepto: o.nombre, importe: o.precio });
  }

  const ent = opcion(reglas.entrega, Number(s.entrega));
  if (!ent) return { error: 'Elige cómo recibir tu pedido.' };
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
      producto: prod.nombre, cantidad, unidad: prod.unidad, pisos, ...elegidos, entrega: ent.nombre, fecha, franja,
      lineas, total, adelanto, saldo: total - adelanto, adelanto_pct: reglas.adelanto_pct,
      vence: new Date(vence_ms).toISOString(), nota: reglas.nota,
    },
  };
}

function generarCodigo() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return 'C-' + Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
