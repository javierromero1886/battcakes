/**
 * Fotos subidas desde el panel — Battcakes
 * Cloudflare Pages Function: /api/foto/subidas/<archivo>  → sirve la imagen guardada en el bucket R2 (binding FOTOS)
 */
export async function onRequestGet({ params, env }) {
  const ruta = Array.isArray(params.ruta) ? params.ruta.join('/') : String(params.ruta || '');
  if (!env.FOTOS || !/^subidas\/[a-z0-9]+\.(webp|png|jpg)$/.test(ruta)) return new Response('No encontrado', { status: 404 });
  const obj = await env.FOTOS.get(ruta);
  if (!obj) return new Response('No encontrado', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      // El nombre de cada foto es único y nunca se reemplaza, así que se puede guardar en caché un año.
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
