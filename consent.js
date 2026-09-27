/* Battcakes — consentimiento de cookies y etiqueta de Google Ads
 * - La etiqueta de Google (gtag.js, cuenta AW-18477119821) SOLO se carga si el visitante acepta las cookies
 *   (consentimiento previo, expreso y revocable, conforme a la Ley 29733 y su Reglamento D.S. 016-2024-JUS).
 * - Usa Google Consent Mode v2: los permisos parten en "denied" y pasan a "granted" al aceptar.
 * - Registra como conversión cada clic en un enlace o botón de WhatsApp.
 * - La decisión se guarda 6 meses en el navegador (localStorage) y puede cambiarse desde "Preferencias de cookies" en el pie de página.
 */
(function () {
  'use strict';
  var GADS_ID = 'AW-18477119821';
  // Etiqueta de conversión de Google Ads (Objetivos → Conversiones → tu acción "Contacto por WhatsApp" → Configurar etiqueta manualmente).
  // Es la parte que va después de la barra en send_to: 'AW-18477119821/XXXXXXXXXXXXXXXXXXX'. Déjala vacía hasta tenerla.
  var CONVERSION_LABEL = '';

  var KEY = 'battcakes-consent';
  var VERSION = 1;                       // súbelo si cambias las categorías o el texto del aviso
  var MAX_AGE = 180 * 24 * 60 * 60 * 1000; // 6 meses

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  // Consent Mode v2: por defecto todo denegado hasta que la persona decida.
  gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied'
  });

  function leer() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && v.v === VERSION && typeof v.ads === 'boolean' && Date.now() - v.ts < MAX_AGE) return v;
    } catch (e) {}
    return null;
  }
  function guardar(ads) {
    try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ads: !!ads, ts: Date.now() })); } catch (e) {}
  }

  var cargado = false;
  function cargarGoogle() {
    if (cargado) return;
    cargado = true;
    gtag('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GADS_ID;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', GADS_ID);
  }
  function retirarConsentimiento() {
    gtag('consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    // Borra las cookies de Google Ads del dominio que estén al alcance del navegador.
    ['_gcl_au', '_gcl_aw', '_gcl_gb', '_gcl_dc', '_gac_gb_' + GADS_ID.replace('AW-', '')].forEach(function (n) {
      document.cookie = n + '=; Max-Age=0; path=/; domain=.battcakes.com';
      document.cookie = n + '=; Max-Age=0; path=/';
    });
  }

  // Conversión: cualquier clic en WhatsApp (enlaces wa.me y el botón del cotizador).
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('a[href*="wa.me"], .btn-wsp, .whatsapp-float, .wa-float') : null;
    if (!t || !cargado) return;
    gtag('event', 'contacto_whatsapp', { event_category: 'contacto', event_label: t.getAttribute('href') || 'cotizador' });
    if (CONVERSION_LABEL) gtag('event', 'conversion', { send_to: GADS_ID + '/' + CONVERSION_LABEL });
  }, true);

  /* ---------------- Aviso de cookies ---------------- */
  var CSS = '.bc-cookies{position:fixed;left:16px;right:16px;bottom:16px;z-index:1200;max-width:460px;margin:auto;background:#fff;color:#33123F;border:1px solid rgba(90,20,108,.18);border-radius:22px;box-shadow:0 24px 60px rgba(71,17,85,.28);padding:20px 22px;font-family:"Segoe UI",Arial,sans-serif;font-size:14.5px;line-height:1.55}' +
    '@media(min-width:900px){.bc-cookies{left:24px;right:auto;bottom:24px}}' +
    '.bc-cookies:focus{outline:none}.bc-cookies h2{font-size:1.05rem;margin:0 0 8px;font-family:Georgia,serif;color:#33123F}.bc-cookies p{margin:0 0 14px}.bc-cookies a{color:#5A146C;font-weight:700}' +
    '.bc-cookies .bc-acciones{display:flex;flex-wrap:wrap;gap:10px}.bc-cookies button{flex:1 1 140px;min-height:44px;border-radius:999px;font:inherit;font-weight:800;font-size:14px;cursor:pointer;padding:10px 16px;border:1px solid rgba(90,20,108,.28);background:#fff;color:#5A146C}' +
    '.bc-cookies button.bc-aceptar{background:linear-gradient(135deg,#5A146C,#8A3FA5);color:#fff;border-color:transparent}.bc-cookies button:hover{transform:translateY(-1px)}.bc-cookies button:focus-visible{outline:3px solid #BC7CD4;outline-offset:2px}' +
    'html[data-theme="dark"] .bc-cookies{background:#301240;color:#F8F2FB;border-color:rgba(188,124,212,.25)}html[data-theme="dark"] .bc-cookies h2{color:#F8F2FB}html[data-theme="dark"] .bc-cookies a{color:#DCB4EF}html[data-theme="dark"] .bc-cookies button{background:#190823;color:#DCB4EF;border-color:rgba(188,124,212,.3)}html[data-theme="dark"] .bc-cookies button.bc-aceptar{background:linear-gradient(135deg,#8A3FA5,#DCB4EF);color:#190823}' +
    '@media print{.bc-cookies{display:none!important}}';

  var aviso = null;
  function mostrarAviso(reabrir) {
    if (aviso) { aviso.hidden = false; return; }
    if (!document.getElementById('bc-cookies-css')) {
      var st = document.createElement('style'); st.id = 'bc-cookies-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    var actual = leer();
    aviso = document.createElement('section');
    aviso.className = 'bc-cookies';
    aviso.setAttribute('role', 'dialog');
    aviso.setAttribute('aria-labelledby', 'bc-cookies-t');
    aviso.setAttribute('aria-describedby', 'bc-cookies-d');
    aviso.innerHTML =
      '<h2 id="bc-cookies-t">🍪 Cookies de anuncios</h2>' +
      '<p id="bc-cookies-d">Con tu permiso usamos la etiqueta de <strong>Google Ads</strong> para saber si nuestros anuncios te trajeron hasta aquí y mostrarte anuncios relevantes. No se activa nada hasta que aceptes; puedes cambiar de opinión cuando quieras. <a href="/privacidad#cookies">Política de cookies</a>' +
      (reabrir && actual ? ' · Preferencia actual: <strong>' + (actual.ads ? 'aceptadas' : 'rechazadas') + '</strong>' : '') + '</p>' +
      '<div class="bc-acciones"><button type="button" class="bc-rechazar">Rechazar</button><button type="button" class="bc-aceptar">Aceptar</button></div>';
    document.body.appendChild(aviso);
    aviso.querySelector('.bc-aceptar').addEventListener('click', function () { guardar(true); cargarGoogle(); cerrar(); });
    aviso.querySelector('.bc-rechazar').addEventListener('click', function () { guardar(false); retirarConsentimiento(); cerrar(); });
    aviso.tabIndex = -1;
    aviso.focus({ preventScroll: true });
  }
  function cerrar() { if (aviso) aviso.hidden = true; }

  var decision = leer();
  if (decision) {
    if (decision.ads) cargarGoogle();
  } else {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mostrarAviso(false); });
    else mostrarAviso(false);
  }

  // "Preferencias de cookies" en el pie de página (cualquier elemento con data-cookies)
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-cookies]') : null;
    if (!t) return;
    e.preventDefault();
    if (aviso) { aviso.remove(); aviso = null; }
    mostrarAviso(true);
  });
  window.battcakesCookies = function () { if (aviso) { aviso.remove(); aviso = null; } mostrarAviso(true); };
})();
