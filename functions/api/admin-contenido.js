/**
 * Edición del contenido del sitio — Battcakes
 * Cloudflare Pages Function: /api/admin-contenido (uso exclusivo del negocio, cabecera "x-admin-key" = ADMIN_KEY)
 *
 * GET                              → contenido actual + fecha de la última edición de cada sección
 * PUT  { seccion, valor }          → guarda una sección completa (productos | galeria | contacto)
 * POST ?accion=foto  (cuerpo = imagen JPG/PNG/WebP, máx. 5 MB) → sube una foto al bucket R2 y devuelve su ruta
 * DELETE { seccion }               → vuelve una sección a su contenido original (el que trae index.html)
 *
 * Bindings: DB (D1, tabla "contenido" de schema.sql) y, para subir fotos, FOTOS (R2). Sin FOTOS se pueden
 * seguir usando las fotos que ya están en img/.
 */
import { autorizado } from './admin.js';
import { leerContenido, SECCIONES } from './contenido.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
});

const TIPOS_FOTO = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_FOTO = 5 * 1024 * 1024;
const RUTA_FOTO = /^(img\/[a-z0-9-]+\.(webp|png|jpg)|\/api\/foto\/subidas\/[a-z0-9]+\.(webp|png|jpg))$/;
const URL_RED = (dominio) => new RegExp(`^https://(www\\.)?${dominio}/[\\w@./?=&%-]*$`);

async function guardia(request, env) {
  if (!env.ADMIN_KEY) return json({ ok: false, error: 'ADMIN_KEY no configurada.' }, 500);
  if (!autorizado(request, env)) { await new Promise((r) => setTimeout(r, 800)); return json({ ok: false, error: 'No autorizado.' }, 401); }
  if (!env.DB) return json({ ok: false, error: 'Base de datos no configurada.' }, 500);
  return null;
}

export async function onRequestGet({ request, env }) {
  const no = await guardia(request, env); if (no) return no;
  const { contenido, actualizado } = await leerContenido(env);
  let cotizaciones = [];
  try {
    const res = await env.DB.prepare('SELECT codigo, creado_en, detalle, total FROM cotizaciones ORDER BY id DESC LIMIT 50').all();
    cotizaciones = (res.results || []).map((c) => { try { return { ...c, detalle: JSON.parse(c.detalle) }; } catch { return c; } });
  } catch (e) { console.log('Cotizaciones no disponibles:', e.message); }
  return json({ ok: true, contenido, actualizado, cotizaciones, fotos_habilitadas: !!env.FOTOS });
}

export async function onRequestPut({ request, env }) {
  const no = await guardia(request, env); if (no) return no;
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Solicitud inválida.' }, 400); }
  const seccion = body && body.seccion;
  if (!SECCIONES.includes(seccion)) return json({ ok: false, error: 'Sección inválida.' }, 400);
  const { valor, error } = validar(seccion, body.valor);
  if (error) return json({ ok: false, error }, 422);
  const ahora = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO contenido (seccion, valor, actualizado_en) VALUES (?, ?, ?) ON CONFLICT(seccion) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en'
  ).bind(seccion, JSON.stringify(valor), ahora).run();
  return json({ ok: true, seccion, valor, actualizado_en: ahora });
}

export async function onRequestDelete({ request, env }) {
  const no = await guardia(request, env); if (no) return no;
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Solicitud inválida.' }, 400); }
  if (!SECCIONES.includes(body && body.seccion)) return json({ ok: false, error: 'Sección inválida.' }, 400);
  await env.DB.prepare('DELETE FROM contenido WHERE seccion = ?').bind(body.seccion).run();
  const { contenido } = await leerContenido(env);
  return json({ ok: true, seccion: body.seccion, valor: contenido[body.seccion] });
}

export async function onRequestPost({ request, env }) {
  const no = await guardia(request, env); if (no) return no;
  if (new URL(request.url).searchParams.get('accion') !== 'foto') return json({ ok: false, error: 'Acción inválida.' }, 400);
  if (!env.FOTOS) return json({ ok: false, error: 'Subida de fotos no configurada (falta el binding R2 "FOTOS").' }, 500);
  const tipo = (request.headers.get('content-type') || '').split(';')[0].trim();
  const ext = TIPOS_FOTO[tipo];
  if (!ext) return json({ ok: false, error: 'Formato no permitido. Usa JPG, PNG o WebP.' }, 415);
  if (Number(request.headers.get('content-length') || 0) > MAX_FOTO) return json({ ok: false, error: 'La foto pesa más de 5 MB.' }, 413);
  const datos = await request.arrayBuffer();
  if (datos.byteLength === 0 || datos.byteLength > MAX_FOTO) return json({ ok: false, error: 'La foto está vacía o pesa más de 5 MB.' }, 413);
  if (!firmaValida(new Uint8Array(datos, 0, Math.min(12, datos.byteLength)), ext)) return json({ ok: false, error: 'El archivo no es una imagen válida.' }, 415);
  const nombre = `subidas/${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
  await env.FOTOS.put(nombre, datos, { httpMetadata: { contentType: tipo } });
  return json({ ok: true, foto: `/api/foto/${nombre}` });
}

export async function onRequest({ request }) {
  return json({ ok: false, error: `Método ${request.method} no permitido.` }, 405);
}

/* ---------------- validación ---------------- */

function texto(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

// Comprueba los primeros bytes del archivo para que no se suba otra cosa disfrazada de imagen.
function firmaValida(b, ext) {
  if (ext === 'jpg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === 'png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  return String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP';
}

function validar(seccion, v) {
  if (seccion === 'productos') {
    if (!Array.isArray(v) || v.length > 24) return { error: 'Lista de productos inválida (máximo 24).' };
    const valor = [];
    for (const [i, p] of v.entries()) {
      const n = i + 1;
      const item = {
        nombre: texto(p && p.nombre, 60),
        descripcion: texto(p && p.descripcion, 220),
        precio: Number(p && p.precio),
        foto: texto(p && p.foto, 120),
        visible: !!(p && p.visible),
      };
      if (item.nombre.length < 2) return { error: `Producto ${n}: falta el nombre.` };
      if (!Number.isFinite(item.precio) || item.precio < 0 || item.precio > 99999) return { error: `Producto ${n}: precio inválido.` };
      item.precio = Math.round(item.precio * 100) / 100;
      if (!RUTA_FOTO.test(item.foto)) return { error: `Producto ${n}: foto inválida.` };
      valor.push(item);
    }
    return { valor };
  }
  if (seccion === 'galeria') {
    if (!Array.isArray(v) || v.length > 40) return { error: 'Galería inválida (máximo 40 fotos).' };
    const valor = [];
    for (const [i, g] of v.entries()) {
      const item = { titulo: texto(g && g.titulo, 60), foto: texto(g && g.foto, 120), visible: !!(g && g.visible) };
      if (item.titulo.length < 2) return { error: `Foto ${i + 1}: falta el título.` };
      if (!RUTA_FOTO.test(item.foto)) return { error: `Foto ${i + 1}: ruta de foto inválida.` };
      valor.push(item);
    }
    return { valor };
  }
  if (seccion === 'cotizador') return validarCotizador(v);
  // contacto
  if (!v || typeof v !== 'object') return { error: 'Datos de contacto inválidos.' };
  const c = {
    whatsapp: texto(v.whatsapp, 15).replace(/\D/g, ''),
    email: texto(v.email, 120).toLowerCase(),
    zona: texto(v.zona, 120),
    horario: texto(v.horario, 120),
    instagram: texto(v.instagram, 200),
    facebook: texto(v.facebook, 200),
    tiktok: texto(v.tiktok, 200),
    anuncio: texto(v.anuncio, 200),
  };
  if (!/^51\d{9}$/.test(c.whatsapp)) return { error: 'WhatsApp: usa el formato 51 + 9 dígitos (p. ej. 51966694119).' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) return { error: 'Correo inválido.' };
  if (c.zona.length < 3 || c.horario.length < 3) return { error: 'Completa la zona y el horario.' };
  if (c.instagram && !URL_RED('instagram\\.com').test(c.instagram)) return { error: 'Instagram: pega el enlace completo (https://www.instagram.com/...).' };
  if (c.facebook && !URL_RED('facebook\\.com').test(c.facebook)) return { error: 'Facebook: pega el enlace completo (https://www.facebook.com/...).' };
  if (c.tiktok && !URL_RED('tiktok\\.com').test(c.tiktok)) return { error: 'TikTok: pega el enlace completo (https://www.tiktok.com/...).' };
  return { valor: c };
}

const entero = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

// Reglas del cotizador automático. Importes en céntimos enteros (el panel convierte desde soles).
function validarCotizador(v) {
  if (!v || typeof v !== 'object') return { error: 'Reglas del cotizador inválidas.' };
  const c = {
    activo: !!v.activo,
    pausado: !!v.pausado,
    anticipacion_horas: entero(v.anticipacion_horas, 0, 720),
    adelanto_pct: entero(v.adelanto_pct, 0, 100),
    vigencia_horas: entero(v.vigencia_horas, 1, 720),
    segundo_piso: entero(v.segundo_piso, 0, 9999999),
    nota: texto(v.nota, 300),
  };
  if (c.anticipacion_horas == null) return { error: 'Anticipación: entre 0 y 720 horas.' };
  if (c.adelanto_pct == null) return { error: 'Adelanto: entre 0 y 100 %.' };
  if (c.vigencia_horas == null) return { error: 'Vigencia: entre 1 y 720 horas.' };
  if (c.segundo_piso == null) return { error: 'Recargo de segundo piso inválido.' };

  if (!Array.isArray(v.productos) || !v.productos.length || v.productos.length > 20) return { error: 'Agrega entre 1 y 20 productos al cotizador.' };
  c.productos = [];
  const ids = new Set();
  for (const [i, p] of v.productos.entries()) {
    const n = i + 1;
    const item = {
      id: texto(p && p.id, 30).toLowerCase(),
      nombre: texto(p && p.nombre, 60),
      unidad: p && p.unidad === 'porciones' ? 'porciones' : 'unidades',
      cantidad_base: entero(p && p.cantidad_base, 1, 1000),
      precio_base: entero(p && p.precio_base, 0, 9999999),
      cantidades: Array.isArray(p && p.cantidades) ? [...new Set(p.cantidades.map(Number))].filter((x) => Number.isInteger(x) && x > 0 && x <= 1000).sort((a, b) => a - b).slice(0, 20) : [],
      personalizable: !!(p && p.personalizable),
      pisos: !!(p && p.pisos),
      min_2_pisos: entero(p && p.min_2_pisos, 0, 1000) || 0,
      anticipacion_horas: entero(p && p.anticipacion_horas, 0, 720) || 0,
    };
    if (!/^[a-z0-9-]{2,30}$/.test(item.id) || ids.has(item.id)) return { error: `Producto ${n}: identificador inválido o repetido.` };
    ids.add(item.id);
    if (item.nombre.length < 2) return { error: `Producto ${n}: falta el nombre.` };
    if (item.cantidad_base == null || item.precio_base == null) return { error: `Producto ${n}: cantidad o precio base inválidos.` };
    if (!item.cantidades.length) return { error: `Producto ${n}: indica al menos una cantidad.` };
    c.productos.push(item);
  }

  for (const lista of ['sabores', 'rellenos', 'acabados', 'extras', 'entrega']) {
    const arr = Array.isArray(v[lista]) ? v[lista] : [];
    if (arr.length > 30) return { error: `${lista}: máximo 30 opciones.` };
    c[lista] = [];
    for (const o of arr) {
      const item = { nombre: texto(o && o.nombre, 80), precio: entero(o && o.precio, 0, 9999999) };
      if (item.nombre.length < 2 || item.precio == null) return { error: `${lista}: cada opción necesita nombre y precio válido.` };
      c[lista].push(item);
    }
  }
  if (!c.entrega.length) return { error: 'Agrega al menos una forma de entrega (recojo o delivery).' };

  c.franjas = (Array.isArray(v.franjas) ? v.franjas : []).map((x) => texto(x, 5)).filter((x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x));
  c.franjas = [...new Set(c.franjas)].sort();
  if (!c.franjas.length) return { error: 'Agrega al menos un horario de entrega (HH:MM).' };
  c.fechas_bloqueadas = [...new Set((Array.isArray(v.fechas_bloqueadas) ? v.fechas_bloqueadas : []).map((x) => texto(x, 10)).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort().slice(0, 366);
  return { valor: c };
}
