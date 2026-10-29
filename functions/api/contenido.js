/**
 * Contenido editable del sitio — Battcakes
 * Cloudflare Pages Function: /api/contenido (público, solo lectura)
 *
 * GET → { ok, contenido: { productos, galeria, contacto } }
 * Lo edita el panel /admin (ver admin-contenido.js). Si la tabla está vacía o no existe, devuelve CONTENIDO_BASE,
 * que es exactamente lo que trae index.html escrito a mano (la página funciona igual sin base de datos).
 */

import { normalizar } from '../../motor-cotizador.js';

export const CONTENIDO_BASE = {
  productos: [
    { nombre: 'Torta de Zanahoria', descripcion: 'Bizcocho de zanahoria con nueces, especias y suave frosting de queso crema.', precio: 40, foto: 'img/torta-de-zanahoria.webp', visible: true },
    { nombre: 'Torta de Chocolate', descripcion: 'Bizcocho de chocolate húmedo con ganache de chocolate y acabado brillante.', precio: 38, foto: 'img/torta-de-chocolate.webp', visible: true },
    { nombre: 'Tres Leches', descripcion: 'Suave bizcocho bañado en tres leches, coronado con crema chantilly y cerezas.', precio: 85, foto: 'img/tres-leches.webp', visible: true },
    { nombre: 'Cheesecake', descripcion: 'Cremoso cheesecake con cobertura de frutos rojos y base de galleta artesanal.', precio: 55, foto: 'img/cheesecake.webp', visible: true },
  ],
  galeria: [
    { titulo: 'Torta temática cerveza', foto: 'img/torta-tematica-cerveza.webp', visible: true },
    { titulo: 'Torta temática de fútbol', foto: 'img/torta-tematica-futbol.webp', visible: true },
    { titulo: 'Torta baby shower', foto: 'img/torta-baby-shower.webp', visible: true },
    { titulo: 'Torta temática de estadio', foto: 'img/torta-tematica-estadio.webp', visible: true },
    { titulo: 'Torta chocolate premium', foto: 'img/torta-chocolate-premium.webp', visible: true },
    { titulo: 'Torta corazón', foto: 'img/torta-corazon.webp', visible: true },
    { titulo: 'Torta temática juez', foto: 'img/torta-tematica-juez.webp', visible: true },
    { titulo: 'Torta bautizo', foto: 'img/torta-bautizo.webp', visible: true },
  ],
  contacto: {
    whatsapp: '51966694119',
    email: 'contacto@battcakes.com',
    zona: 'Breña, Lima, Perú (solo a pedido, sin local)',
    horario: 'Lunes a sábado de 9:00 a.m. a 7:00 p.m.',
    instagram: 'https://www.instagram.com/battcakes/',
    facebook: 'https://www.facebook.com/profile.php?id=100057123112930',
    tiktok: 'https://www.tiktok.com/@battcakes',
    anuncio: '',
  },
  // Reglas del cotizador automático (formato en motor-cotizador.js). Importes en céntimos. Valores de ejemplo: revisarlos antes de activar.
  cotizador: {
    version: 2,
    activo: false,
    pausado: false,
    titulo: 'Cotiza tu pedido en línea',
    subtitulo: 'Elige paso a paso y mira el precio al instante.',
    anticipacion_horas: 72,
    adelanto_pct: 60,
    vigencia_horas: 24,
    productos: [
      { id: 'torta', nombre: 'Torta personalizada', descripcion: 'Para cumpleaños, bautizos y celebraciones.', icono: '🎂', foto: 'img/torta-battcakes.webp', unidad: 'porciones', cantidad_base: 20, precio_base: 12000, cantidades: [10, 15, 20, 30, 40, 60], pisos: true, min_2_pisos: 30, recargo_2_pisos: 4500, anticipacion_horas: 72, visible: true },
      { id: 'cupcakes', nombre: 'Cupcakes', descripcion: 'Decorados a juego con tu celebración.', icono: '🧁', foto: '', unidad: 'unidades', cantidad_base: 12, precio_base: 6000, cantidades: [6, 12, 24, 36, 48], pisos: false, min_2_pisos: 0, recargo_2_pisos: 0, anticipacion_horas: 72, visible: true },
      { id: 'brownies', nombre: 'Brownies', descripcion: 'Chocolate intenso, ideales para regalar.', icono: '🍫', foto: '', unidad: 'unidades', cantidad_base: 12, precio_base: 4800, cantidades: [6, 12, 24, 36], pisos: false, min_2_pisos: 0, recargo_2_pisos: 0, anticipacion_horas: 72, visible: true },
    ],
    grupos: [
      { id: 'sabor', titulo: 'Sabor del bizcocho', ayuda: '', tipo: 'uno', obligatorio: true, productos: ['torta'], visible: true, opciones: [
        { nombre: 'Vainilla', descripcion: '', icono: '', color: '#F3E3B5', foto: '', precio: 0, visible: true },
        { nombre: 'Chocolate', descripcion: '', icono: '', color: '#6B3E26', foto: '', precio: 0, visible: true },
        { nombre: 'Zanahoria', descripcion: 'Con nueces y especias', icono: '', color: '#E59A4B', foto: '', precio: 1000, visible: true },
        { nombre: 'Red velvet', descripcion: '', icono: '', color: '#A3242F', foto: '', precio: 1500, visible: true },
      ] },
      { id: 'relleno', titulo: 'Relleno', ayuda: '', tipo: 'uno', obligatorio: true, productos: ['torta'], visible: true, opciones: [
        { nombre: 'Manjar blanco', descripcion: '', icono: '', color: '#D9A86C', foto: '', precio: 0, visible: true },
        { nombre: 'Fudge de chocolate', descripcion: '', icono: '', color: '#4A2A1A', foto: '', precio: 0, visible: true },
        { nombre: 'Frutos rojos', descripcion: '', icono: '', color: '#C2364B', foto: '', precio: 1500, visible: true },
      ] },
      { id: 'acabado', titulo: 'Cobertura', ayuda: '', tipo: 'uno', obligatorio: true, productos: ['torta'], visible: true, opciones: [
        { nombre: 'Buttercream', descripcion: 'Suave y cremosa', icono: '', color: '#FBF1E3', foto: '', precio: 0, visible: true },
        { nombre: 'Ganache de chocolate', descripcion: '', icono: '', color: '#3B2116', foto: '', precio: 1500, visible: true },
        { nombre: 'Fondant', descripcion: 'Acabado liso para diseños', icono: '', color: '#F5ECF8', foto: '', precio: 3000, visible: true },
      ] },
      { id: 'extras', titulo: 'Adicionales', ayuda: 'Opcional: elige los que quieras.', tipo: 'varios', obligatorio: false, productos: [], visible: true, opciones: [
        { nombre: 'Topper personalizado', descripcion: '', icono: '✨', color: '', foto: '', precio: 1500, visible: true },
        { nombre: 'Velas de cumpleaños', descripcion: '', icono: '🕯️', color: '', foto: '', precio: 800, visible: true },
        { nombre: 'Flores de azúcar', descripcion: '', icono: '🌸', color: '', foto: '', precio: 2500, visible: true },
      ] },
    ],
    entrega: [
      { nombre: 'Recojo coordinado', descripcion: 'En Breña, previa coordinación', icono: '🛍️', precio: 0, visible: true },
      { nombre: 'Delivery Breña', descripcion: '', icono: '🛵', precio: 800, visible: true },
      { nombre: 'Delivery Lima Centro, Jesús María, Pueblo Libre', descripcion: '', icono: '🛵', precio: 1200, visible: true },
      { nombre: 'Delivery otros distritos', descripcion: 'Costo a confirmar por WhatsApp', icono: '🚗', precio: 2000, visible: true },
    ],
    franjas: ['10:00', '12:00', '14:00', '16:00', '18:00'],
    fechas_bloqueadas: [],
    nota: 'Precio referencial con IGV incluido. El diseño y el precio final se confirman por WhatsApp; la cotización no reserva fecha.',
  },
};

export const SECCIONES = Object.keys(CONTENIDO_BASE);

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
});

/** Lee el contenido guardado; cada sección que falte se completa con CONTENIDO_BASE. */
export async function leerContenido(env) {
  const contenido = structuredClone(CONTENIDO_BASE);
  const actualizado = {};
  if (!env.DB) return { contenido, actualizado };
  try {
    const res = await env.DB.prepare('SELECT seccion, valor, actualizado_en FROM contenido').all();
    for (const r of res.results || []) {
      if (!SECCIONES.includes(r.seccion)) continue;
      try { contenido[r.seccion] = JSON.parse(r.valor); actualizado[r.seccion] = r.actualizado_en; } catch {}
    }
  } catch (e) {
    console.log('Contenido: tabla no disponible:', e.message);
  }
  // Las reglas guardadas con el formato anterior (sabores, rellenos… fijos) se convierten al formato con grupos.
  contenido.cotizador = normalizar(contenido.cotizador);
  return { contenido, actualizado };
}

export async function onRequestGet({ env }) {
  const { contenido } = await leerContenido(env);
  // Caché corta: los cambios del panel se ven en un minuto como máximo.
  return json({ ok: true, contenido }, 200, { 'cache-control': 'public, max-age=60' });
}

export async function onRequest({ request }) {
  return json({ ok: false, error: `Método ${request.method} no permitido.` }, 405, { 'cache-control': 'no-store' });
}
