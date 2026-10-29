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
  return json({ ok: true, contenido, actualizado, fotos_habilitadas: !!env.FOTOS });
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
