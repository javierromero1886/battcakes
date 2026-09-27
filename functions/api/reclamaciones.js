/**
 * Libro de Reclamaciones virtual — Battcakes
 * Cloudflare Pages Function: /api/reclamaciones
 *
 * POST  → registra una hoja de reclamación (numeración correlativa, copia por correo, máximo 5 registros por IP y día)
 * GET   → devuelve una hoja por número + código de verificación (para verla/imprimirla)
 *
 * Variables de entorno (Pages → Settings → Environment variables):
 *   RESEND_API_KEY        (opcional) clave de Resend para enviar copias por correo
 *   MAIL_FROM             (opcional) remitente, p. ej. "Battcakes <reclamaciones@battcakes.com>"
 *   MAIL_TO               (opcional) correo del negocio que recibe cada hoja (por defecto contacto@battcakes.com)
 *   TURNSTILE_SECRET_KEY  (opcional) clave secreta de Cloudflare Turnstile (antispam)
 * Binding D1 (Pages → Settings → Functions → D1 database bindings): DB
 */

const PROVEEDOR = {
  nombre: 'Magaly Battistini Oroche',
  comercial: 'Battcakes',
  ruc: '10460941348',
  domicilio: 'Breña, Lima, Perú',
  email: 'contacto@battcakes.com',
  telefono: '+51 966 694 119',
  web: 'https://battcakes.com',
};

const LIMITES = { nombre: 120, domicilio: 200, doc_numero: 20, telefono: 20, email: 120, apoderado: 120, bien_descripcion: 200, detalle: 3000, pedido: 1500 };

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'Base de datos no configurada.' }, 500);
  const url = new URL(request.url);
  const numero = (url.searchParams.get('hoja') || '').trim();
  const codigo = (url.searchParams.get('codigo') || '').trim().toUpperCase();
  if (!/^\d{4}-\d{6}$/.test(numero) || !/^[A-Z0-9]{8}$/.test(codigo)) {
    return json({ ok: false, error: 'Número de hoja o código inválidos.' }, 400);
  }
  const row = await env.DB.prepare(
    `SELECT numero, codigo, creado_en, tipo, nombre, doc_tipo, doc_numero, domicilio, telefono, email, canal_respuesta, menor, apoderado,
            bien_tipo, bien_descripcion, monto, detalle, pedido, estado, respuesta, respondido_en
       FROM reclamaciones WHERE numero = ? AND codigo = ?`
  ).bind(numero, codigo).first();
  if (!row) return json({ ok: false, error: 'No encontramos una hoja con ese número y código.' }, 404);
  return json({ ok: true, hoja: row });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'Base de datos no configurada.' }, 500);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 30000) return json({ ok: false, error: 'La solicitud es demasiado grande.' }, 413);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Solicitud inválida.' }, 400); }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'Solicitud inválida.' }, 400);

  // Honeypot: los bots suelen llenar todos los campos.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return json({ ok: false, error: 'No pudimos procesar la solicitud.' }, 400);
  }

  const ip = request.headers.get('cf-connecting-ip') || '';

  // Verificación Turnstile (solo si está configurada la clave secreta).
  if (env.TURNSTILE_SECRET_KEY) {
    const token = body['cf-turnstile-response'];
    if (!token) return json({ ok: false, error: 'Completa la verificación de seguridad.' }, 400);
    const ver = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
    }).then((r) => r.json()).catch(() => ({ success: false }));
    if (!ver.success) return json({ ok: false, error: 'La verificación de seguridad falló. Inténtalo de nuevo.' }, 400);
  }

  const { data, error } = validar(body);
  if (error) return json({ ok: false, error }, 422);

  const creado_en = new Date().toISOString();
  const codigo = generarCodigo();
  const ip_hash = ip ? await sha256(ip + ':' + creado_en.slice(0, 10)) : null;
  const user_agent = (request.headers.get('user-agent') || '').slice(0, 200);

  // Límite razonable: máximo 5 hojas por IP y día (evita abuso sin bloquear a consumidores reales).
  if (ip_hash) {
    try {
      const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM reclamaciones WHERE ip_hash = ?').bind(ip_hash).first();
      if (c && Number(c.n) >= 5) {
        return json({ ok: false, error: 'Has alcanzado el máximo de registros por hoy. Si necesitas ayuda, escríbenos a contacto@battcakes.com.' }, 429);
      }
    } catch (e) { console.log('Rate limit check error:', e.message); }
  }

  let inserted;
  try {
    inserted = await env.DB.prepare(
      `INSERT INTO reclamaciones (codigo, creado_en, tipo, nombre, doc_tipo, doc_numero, domicilio, telefono, email, canal_respuesta, menor, apoderado,
                                  bien_tipo, bien_descripcion, monto, detalle, pedido, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    ).bind(
      codigo, creado_en, data.tipo, data.nombre, data.doc_tipo, data.doc_numero, data.domicilio, data.telefono, data.email, data.canal_respuesta,
      data.menor ? 1 : 0, data.apoderado, data.bien_tipo, data.bien_descripcion, data.monto, data.detalle, data.pedido, ip_hash, user_agent
    ).first();
  } catch (e) {
    console.log('D1 insert error:', e.message);
    return json({ ok: false, error: 'No pudimos guardar tu hoja. Inténtalo nuevamente en unos minutos.' }, 500);
  }

  // El número correlativo lo asigna el trigger de la base de datos (schema.sql); este UPDATE es solo respaldo
  // por si la base se creó con una versión anterior del esquema sin trigger.
  const id = inserted.id;
  const numero = `${creado_en.slice(0, 4)}-${String(id).padStart(6, '0')}`;
  await env.DB.prepare('UPDATE reclamaciones SET numero = ? WHERE id = ? AND numero IS NULL').bind(numero, id).run();

  const hoja = { ...data, menor: data.menor ? 1 : 0, numero, codigo, creado_en, estado: 'pendiente', respuesta: null, respondido_en: null };

  let email_enviado = false;
  if (env.RESEND_API_KEY) {
    try {
      await enviarCorreos(env, hoja);
      email_enviado = true;
      await env.DB.prepare('UPDATE reclamaciones SET email_enviado = 1 WHERE id = ?').bind(id).run();
    } catch (e) {
      console.log('Email error:', e.message);
    }
  }

  return json({ ok: true, hoja, email_enviado });
}

export async function onRequest({ request }) {
  return json({ ok: false, error: `Método ${request.method} no permitido.` }, 405);
}

/* ---------------- utilidades ---------------- */

function texto(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function validar(b) {
  const d = {};
  d.tipo = b.tipo === 'queja' ? 'queja' : b.tipo === 'reclamo' ? 'reclamo' : null;
  if (!d.tipo) return { error: 'Indica si es un reclamo o una queja.' };

  d.nombre = texto(b.nombre, LIMITES.nombre);
  if (d.nombre.length < 3) return { error: 'Ingresa tu nombre completo.' };

  d.domicilio = texto(b.domicilio, LIMITES.domicilio);
  if (d.domicilio.length < 5) return { error: 'Ingresa tu domicilio.' };

  d.doc_tipo = ['DNI', 'CE', 'Pasaporte'].includes(b.doc_tipo) ? b.doc_tipo : null;
  if (!d.doc_tipo) return { error: 'Tipo de documento inválido.' };
  d.doc_numero = texto(b.doc_numero, LIMITES.doc_numero).toUpperCase();
  if (!/^[A-Z0-9-]{6,20}$/.test(d.doc_numero) || (d.doc_tipo === 'DNI' && !/^\d{8}$/.test(d.doc_numero))) {
    return { error: 'Ingresa un número de documento válido.' };
  }

  d.telefono = texto(b.telefono, LIMITES.telefono) || null;
  d.email = texto(b.email, LIMITES.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return { error: 'Ingresa un correo electrónico válido.' };
  d.canal_respuesta = b.canal_respuesta === 'whatsapp' ? 'whatsapp' : 'correo';
  if (d.canal_respuesta === 'whatsapp' && (!d.telefono || d.telefono.replace(/\D/g, '').length < 6)) {
    return { error: 'Indica un teléfono válido para responderte por WhatsApp o llamada.' };
  }

  d.menor = b.menor === true || b.menor === 'true' || b.menor === 'on';
  d.apoderado = texto(b.apoderado, LIMITES.apoderado) || null;
  if (d.menor && (!d.apoderado || d.apoderado.length < 3)) return { error: 'Indica el nombre de tu madre, padre o apoderado.' };
  if (!d.menor) d.apoderado = null;

  d.bien_tipo = b.bien_tipo === 'servicio' ? 'servicio' : 'producto';
  d.bien_descripcion = texto(b.bien_descripcion, LIMITES.bien_descripcion);
  if (d.bien_descripcion.length < 3) return { error: 'Describe el producto o servicio.' };

  const montoTxt = texto(b.monto, 12).replace(',', '.');
  if (montoTxt === '') d.monto = null;
  else {
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(montoTxt)) return { error: 'Ingresa un monto válido.' };
    d.monto = Number(montoTxt);
  }

  d.detalle = texto(b.detalle, LIMITES.detalle);
  if (d.detalle.length < 20) return { error: 'Describe tu reclamo o queja con más detalle (mínimo 20 caracteres).' };
  d.pedido = texto(b.pedido, LIMITES.pedido);
  if (d.pedido.length < 5) return { error: 'Indica qué solución solicitas.' };

  if (!(b.acepta === true || b.acepta === 'true' || b.acepta === 'on')) return { error: 'Debes aceptar la Política de Privacidad.' };
  return { data: d };
}

function generarCodigo() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fechaLima(iso) {
  try {
    return new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export function plantillaHtml(h) {
  const tipo = h.tipo === 'queja' ? 'Queja' : 'Reclamo';
  const url = `${PROVEEDOR.web}/libro-de-reclamaciones?hoja=${encodeURIComponent(h.numero)}&codigo=${encodeURIComponent(h.codigo)}`;
  const fila = (k, v) => `<tr><td style="padding:6px 10px;color:#555;font-weight:bold;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:6px 10px">${v}</td></tr>`;
  return `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:680px;margin:auto;padding:20px">
  <div style="border-bottom:3px solid #5A146C;padding-bottom:10px;margin-bottom:16px">
    <h1 style="font-size:20px;margin:0;color:#5A146C">Hoja de Reclamación N.° ${esc(h.numero)}</h1>
    <div style="font-size:13px;color:#555">${esc(PROVEEDOR.nombre)} (${esc(PROVEEDOR.comercial)}) · RUC ${esc(PROVEEDOR.ruc)} · ${esc(PROVEEDOR.domicilio)}</div>
    <div style="font-size:13px;color:#555">Fecha de registro: ${esc(fechaLima(h.creado_en))} · Código de verificación: <b>${esc(h.codigo)}</b></div>
  </div>
  <h2 style="font-size:14px;color:#5A146C;text-transform:uppercase;letter-spacing:.06em">1. Identificación del consumidor</h2>
  <table style="border-collapse:collapse;font-size:14px;width:100%">${fila('Nombre', esc(h.nombre))}${fila('Domicilio', esc(h.domicilio))}${fila(esc(h.doc_tipo), esc(h.doc_numero))}${fila('Teléfono', esc(h.telefono || '—'))}${fila('E-mail', esc(h.email))}${fila('Medio de respuesta', h.canal_respuesta === 'whatsapp' ? 'WhatsApp o llamada' : 'Correo electrónico')}${h.menor ? fila('Padre, madre o apoderado', esc(h.apoderado)) : ''}</table>
  <h2 style="font-size:14px;color:#5A146C;text-transform:uppercase;letter-spacing:.06em">2. Identificación del bien contratado</h2>
  <table style="border-collapse:collapse;font-size:14px;width:100%">${fila('Tipo', h.bien_tipo === 'servicio' ? 'Servicio' : 'Producto')}${fila('Monto reclamado', h.monto != null ? 'S/ ' + Number(h.monto).toFixed(2) : '—')}${fila('Descripción', esc(h.bien_descripcion))}</table>
  <h2 style="font-size:14px;color:#5A146C;text-transform:uppercase;letter-spacing:.06em">3. Detalle de la reclamación y pedido del consumidor</h2>
  <table style="border-collapse:collapse;font-size:14px;width:100%">${fila('Tipo', tipo)}${fila('Detalle', esc(h.detalle).replace(/\n/g, '<br>'))}${fila('Pedido', esc(h.pedido).replace(/\n/g, '<br>'))}</table>
  <h2 style="font-size:14px;color:#5A146C;text-transform:uppercase;letter-spacing:.06em">4. Observaciones y acciones adoptadas por el proveedor</h2>
  <p style="font-size:14px;border:1px dashed #999;padding:10px;border-radius:8px">${h.respuesta ? esc(h.respuesta).replace(/\n/g, '<br>') + '<br><small>Fecha de respuesta: ' + esc(fechaLima(h.respondido_en)) + '</small>' : 'Pendiente de respuesta. Plazo máximo: quince (15) días hábiles desde la fecha de registro.'}</p>
  <p style="font-size:13px"><a href="${url}" style="color:#5A146C">Ver o imprimir esta hoja en línea</a></p>
  <p style="font-size:11px;color:#666;border-top:1px solid #ddd;padding-top:10px">RECLAMO: disconformidad relacionada a los productos o servicios. QUEJA: disconformidad no relacionada a los productos o servicios, o malestar o descontento respecto a la atención al público. La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI. El proveedor deberá dar respuesta al reclamo o queja en un plazo no mayor a quince (15) días hábiles.</p>
  </body></html>`;
}

export function plantillaTexto(h) {
  const tipo = h.tipo === 'queja' ? 'Queja' : 'Reclamo';
  return [
    `HOJA DE RECLAMACIÓN N.° ${h.numero}`,
    `${PROVEEDOR.nombre} (${PROVEEDOR.comercial}) · RUC ${PROVEEDOR.ruc} · ${PROVEEDOR.domicilio}`,
    `Fecha de registro: ${fechaLima(h.creado_en)} · Código de verificación: ${h.codigo}`,
    '',
    '1. IDENTIFICACIÓN DEL CONSUMIDOR',
    `Nombre: ${h.nombre}`, `Domicilio: ${h.domicilio}`, `${h.doc_tipo}: ${h.doc_numero}`, `Teléfono: ${h.telefono || '—'}`, `E-mail: ${h.email}`,
    `Medio de respuesta: ${h.canal_respuesta === 'whatsapp' ? 'WhatsApp o llamada' : 'Correo electrónico'}`,
    h.menor ? `Padre, madre o apoderado: ${h.apoderado}` : '',
    '',
    '2. IDENTIFICACIÓN DEL BIEN CONTRATADO',
    `Tipo: ${h.bien_tipo === 'servicio' ? 'Servicio' : 'Producto'}`, `Monto reclamado: ${h.monto != null ? 'S/ ' + Number(h.monto).toFixed(2) : '—'}`, `Descripción: ${h.bien_descripcion}`,
    '',
    '3. DETALLE DE LA RECLAMACIÓN Y PEDIDO DEL CONSUMIDOR',
    `Tipo: ${tipo}`, `Detalle: ${h.detalle}`, `Pedido: ${h.pedido}`,
    '',
    '4. OBSERVACIONES Y ACCIONES ADOPTADAS POR EL PROVEEDOR',
    h.respuesta ? `${h.respuesta}\nFecha de respuesta: ${fechaLima(h.respondido_en)}` : 'Pendiente de respuesta. Plazo máximo: quince (15) días hábiles desde la fecha de registro.',
    '',
    `Ver en línea: ${PROVEEDOR.web}/libro-de-reclamaciones?hoja=${h.numero}&codigo=${h.codigo}`,
    '',
    'La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI. El proveedor deberá dar respuesta al reclamo o queja en un plazo no mayor a quince (15) días hábiles.',
  ].join('\n');
}

export async function enviarResend(env, payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

async function enviarCorreos(env, h) {
  const from = env.MAIL_FROM || `Battcakes <reclamaciones@battcakes.com>`;
  const negocio = env.MAIL_TO || PROVEEDOR.email;
  const html = plantillaHtml(h);
  const text = plantillaTexto(h);
  // Copia para el consumidor
  await enviarResend(env, { from, to: [h.email], reply_to: negocio, subject: `Hoja de Reclamación N.° ${h.numero} — Battcakes`, html, text });
  // Aviso para el negocio, con acceso directo al panel de respuesta
  const aviso = `<p style="font-family:Arial,sans-serif;font-size:14px;background:#F5ECF8;padding:12px;border-radius:8px"><b>Nueva hoja registrada.</b> Plazo máximo de respuesta: 15 días hábiles. El consumidor pidió respuesta por <b>${h.canal_respuesta === 'whatsapp' ? 'WhatsApp o llamada' : 'correo electrónico'}</b>. Responde desde el panel: <a href="${PROVEEDOR.web}/admin-reclamaciones">${PROVEEDOR.web}/admin-reclamaciones</a></p>`;
  await enviarResend(env, { from, to: [negocio], reply_to: h.email, subject: `[Libro de Reclamaciones] Nueva hoja N.° ${h.numero} (${h.tipo === 'queja' ? 'queja' : 'reclamo'})`, html: aviso + html, text: `Nueva hoja registrada. Responde desde ${PROVEEDOR.web}/admin-reclamaciones\n\n` + text });
}
