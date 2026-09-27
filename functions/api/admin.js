/**
 * Panel de respuesta del Libro de Reclamaciones — Battcakes
 * Cloudflare Pages Function: /api/admin (uso exclusivo del negocio)
 *
 * Protegido con la variable de entorno ADMIN_KEY (una contraseña larga que solo conoce el negocio).
 * El panel admin-reclamaciones.html envía esa clave en la cabecera "x-admin-key".
 *
 * GET  /api/admin?estado=pendiente|atendido|todas   → lista de hojas (añade &formato=csv para descargar el libro completo)
 * POST /api/admin  { numero, respuesta }             → registra la respuesta, marca "atendido" y la envía al consumidor por correo
 */
import { plantillaHtml, plantillaTexto, enviarResend } from './reclamaciones.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
});

function autorizado(request, env) {
  const key = request.headers.get('x-admin-key') || '';
  const real = env.ADMIN_KEY || '';
  if (!real || key.length !== real.length) return false;
  // comparación en tiempo constante
  let diff = 0;
  for (let i = 0; i < real.length; i++) diff |= key.charCodeAt(i) ^ real.charCodeAt(i);
  return diff === 0;
}

export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_KEY) return json({ ok: false, error: 'ADMIN_KEY no configurada.' }, 500);
  if (!autorizado(request, env)) { await new Promise((r) => setTimeout(r, 800)); return json({ ok: false, error: 'No autorizado.' }, 401); }
  if (!env.DB) return json({ ok: false, error: 'Base de datos no configurada.' }, 500);
  const url = new URL(request.url);
  const estado = url.searchParams.get('estado') || 'pendiente';
  if (url.searchParams.get('formato') === 'csv') return exportarCsv(env);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
  const where = estado === 'todas' ? '' : 'WHERE estado = ?';
  const stmt = env.DB.prepare(
    `SELECT id, numero, codigo, creado_en, tipo, nombre, doc_tipo, doc_numero, domicilio, telefono, email, canal_respuesta, menor, apoderado,
            bien_tipo, bien_descripcion, monto, detalle, pedido, estado, respuesta, respondido_en, email_enviado
       FROM reclamaciones ${where} ORDER BY id DESC LIMIT ?`
  );
  const res = estado === 'todas' ? await stmt.bind(limit).all() : await stmt.bind(estado, limit).all();
  return json({ ok: true, hojas: res.results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_KEY) return json({ ok: false, error: 'ADMIN_KEY no configurada.' }, 500);
  if (!autorizado(request, env)) { await new Promise((r) => setTimeout(r, 800)); return json({ ok: false, error: 'No autorizado.' }, 401); }
  if (!env.DB) return json({ ok: false, error: 'Base de datos no configurada.' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Solicitud inválida.' }, 400); }
  const numero = String(body.numero || '').trim();
  const respuesta = String(body.respuesta || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 4000);
  if (!/^\d{4}-\d{6}$/.test(numero)) return json({ ok: false, error: 'Número de hoja inválido.' }, 400);
  if (respuesta.length < 10) return json({ ok: false, error: 'Escribe una respuesta (mínimo 10 caracteres).' }, 422);

  const row = await env.DB.prepare('SELECT * FROM reclamaciones WHERE numero = ?').bind(numero).first();
  if (!row) return json({ ok: false, error: 'Hoja no encontrada.' }, 404);

  const respondido_en = new Date().toISOString();
  await env.DB.prepare('UPDATE reclamaciones SET respuesta = ?, respondido_en = ?, estado = ? WHERE numero = ?')
    .bind(respuesta, respondido_en, 'atendido', numero).run();

  const hoja = { ...row, respuesta, respondido_en, estado: 'atendido' };
  let email_enviado = false;
  if (env.RESEND_API_KEY && body.enviar_correo !== false) {
    try {
      const from = env.MAIL_FROM || 'Battcakes <reclamaciones@battcakes.com>';
      const negocio = env.MAIL_TO || 'contacto@battcakes.com';
      await enviarResend(env, {
        from, to: [hoja.email], reply_to: negocio,
        subject: `Respuesta a tu Hoja de Reclamación N.° ${hoja.numero} — Battcakes`,
        html: plantillaHtml(hoja), text: plantillaTexto(hoja),
      });
      email_enviado = true;
    } catch (e) {
      console.log('Email error:', e.message);
    }
  }
  return json({ ok: true, hoja, email_enviado });
}

export async function onRequest({ request }) {
  return json({ ok: false, error: `Método ${request.method} no permitido.` }, 405);
}

// Exporta todas las hojas en CSV (UTF-8 con BOM para que Excel lo abra bien). Sirve como respaldo y para inspecciones.
async function exportarCsv(env) {
  const cols = ['numero', 'creado_en', 'tipo', 'estado', 'nombre', 'doc_tipo', 'doc_numero', 'domicilio', 'telefono', 'email', 'canal_respuesta', 'menor', 'apoderado',
    'bien_tipo', 'bien_descripcion', 'monto', 'detalle', 'pedido', 'respuesta', 'respondido_en', 'email_enviado', 'codigo'];
  const res = await env.DB.prepare(`SELECT ${cols.join(', ')} FROM reclamaciones ORDER BY id ASC`).all();
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lineas = [cols.join(',')].concat((res.results || []).map((r) => cols.map((c) => q(r[c])).join(',')));
  const fecha = new Date().toISOString().slice(0, 10);
  return new Response('\uFEFF' + lineas.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="libro-de-reclamaciones-${fecha}.csv"`,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}
