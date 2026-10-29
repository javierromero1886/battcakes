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
import { calcular } from '../../motor-cotizador.js';

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
