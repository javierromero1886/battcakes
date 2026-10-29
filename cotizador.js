/* Battcakes — cotizador automático de la página principal (asistente visual por pasos).
 * Solo se monta si en /admin está activado (contenido.cotizador.activo) o con ?vista-previa=cotizador (para revisar antes de activarlo).
 * Reemplaza el formulario simple de WhatsApp. Las opciones, textos y precios salen de las reglas de /admin → Cotizador.
 * El precio en pantalla lo calcula motor-cotizador.js (el mismo motor del servidor); al enviar, /api/cotizar lo recalcula y guarda el código.
 */
window.bcCotizador = function (reglasEntrada, numeroWa, vistaPrevia) {
  'use strict';
  var cont = document.getElementById('formulario-pedido');
  if (!cont || !reglasEntrada || !(reglasEntrada.activo || vistaPrevia)) return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dinero(c) { return 'S/ ' + (c / 100).toFixed(2); }
  var FOTO = /^(img\/[a-z0-9-]+\.(webp|png|jpg)|\/api\/foto\/subidas\/[a-z0-9]+\.(webp|png|jpg))$/;
  var COLOR = /^#[0-9A-Fa-f]{6}$/;
  var vis = function (o) { return o && o.visible !== false; };

  import('/motor-cotizador.js?v=5').then(function (m) { montar(m, m.normalizar(reglasEntrada)); }).catch(function () {});

  function montar(motor, reglas) {
    var aviso = vistaPrevia && !reglas.activo ? '<div class="cz-previa">Vista previa: el cotizador está oculto para los clientes.</div>' : '';
    if (reglas.pausado) {
      cont.innerHTML = aviso + '<div class="cz"><div class="cz-cab"><h3>Pedidos en pausa</h3><p>Por ahora no estamos tomando pedidos nuevos desde la web. Escríbenos por WhatsApp para consultar disponibilidad.</p></div>' +
        '<div class="cz-pie"><span></span><a class="btn-wsp" href="https://wa.me/' + numeroWa + '?text=' + encodeURIComponent('Hola Battcakes, quiero consultar disponibilidad') + '" target="_blank" rel="noopener noreferrer">Escribir por WhatsApp</a></div></div>';
      return;
    }
    var productos = reglas.productos.filter(vis);
    var entregas = reglas.entrega.map(function (e, i) { return { e: e, i: i }; }).filter(function (x) { return vis(x.e); });
    var sel = { producto: null, cantidad: null, pisos: 1, opciones: {}, entrega: entregas.length === 1 ? entregas[0].i : null, fecha: '', franja: reglas.franjas.length === 1 ? reglas.franjas[0] : '', detalles: '' };
    var paso = 0, cotizacion = null, error = '';

    function prod() { return productos.filter(function (p) { return p.id === sel.producto; })[0] || null; }
    function grupos() { return prod() ? motor.gruposDe(reglas, prod().id) : []; }
    function pasos() {
      var l = [{ id: 'producto', titulo: '¿Qué quieres pedir?' }, { id: 'cantidad', titulo: '¿Para cuántos?' }];
      grupos().forEach(function (g) { l.push({ id: 'g:' + g.id, titulo: g.titulo, grupo: g }); });
      l.push({ id: 'entrega', titulo: 'Entrega y fecha' }, { id: 'resumen', titulo: 'Tu cotización' });
      return l;
    }
    function hoyLima(horas) { return new Date(Date.now() + horas * 3600 * 1000 - 5 * 3600 * 1000).toISOString().slice(0, 10); }
    function horasMin() { var p = prod(); return Math.max(reglas.anticipacion_horas, (p && p.anticipacion_horas) || 0); }
    function precioMin(p) { return motor.precioBase(p, p.cantidades[0]); }

    // Total parcial mientras elige (sin fecha): base + pisos + opciones + entrega.
    function estimado() {
      var p = prod(); if (!p || !sel.cantidad) return null;
      var t = motor.precioBase(p, sel.cantidad) + (sel.pisos === 2 ? p.recargo_2_pisos : 0);
      grupos().forEach(function (g) { (sel.opciones[g.id] || []).forEach(function (i) { t += motor.precioOpcion(g.opciones[i], p, sel.cantidad); }); });
      if (sel.entrega != null) t += reglas.entrega[sel.entrega].precio;
      return t;
    }
    function seleccion(guardar) {
      return { producto: sel.producto, cantidad: sel.cantidad, pisos: sel.pisos, opciones: sel.opciones, entrega: sel.entrega, fecha: sel.fecha, franja: sel.franja, guardar: !!guardar };
    }
    function recalcular() {
      var r = motor.calcular(reglas, seleccion(false), Date.now());
      cotizacion = r.cotizacion || null; error = r.error || '';
    }

    function tarjeta(attrs, activa, media, titulo, sub, precio, multiple) {
      return '<button type="button" class="cz-card' + (activa ? ' activa' : '') + '" ' + attrs + ' aria-pressed="' + !!activa + '">' +
        (multiple ? '<span class="cz-check" aria-hidden="true">✓</span>' : '') + media +
        '<span class="cz-card-t">' + esc(titulo) + '</span>' + (sub ? '<span class="cz-card-s">' + esc(sub) + '</span>' : '') +
        (precio != null ? '<span class="cz-card-p">' + precio + '</span>' : '') + '</button>';
    }
    function media(o, grande) {
      if (o.foto && FOTO.test(o.foto)) return '<span class="cz-media' + (grande ? ' grande' : '') + '"><img src="' + esc(o.foto) + '" alt="" loading="lazy"></span>';
      if (o.color && COLOR.test(o.color)) return '<span class="cz-media color" style="background:' + o.color + '">' + esc(o.icono || '') + '</span>';
      return o.icono ? '<span class="cz-media emoji' + (grande ? ' grande' : '') + '">' + esc(o.icono) + '</span>' : '';
    }
    function extra(c) { return c > 0 ? '+ ' + dinero(c) : 'Incluido'; }

    function cuerpo(ps) {
      var p = prod(), ac = ps[paso];
      if (ac.id === 'producto') {
        return '<div class="cz-grid grande">' + productos.map(function (x) {
          return tarjeta('data-producto="' + esc(x.id) + '"', sel.producto === x.id, media(x, true), x.nombre, x.descripcion, 'Desde ' + dinero(precioMin(x)));
        }).join('') + '</div>';
      }
      if (ac.id === 'cantidad') {
        var h = '<div class="cz-grid chico">' + p.cantidades.map(function (c) {
          return tarjeta('data-cantidad="' + c + '"', sel.cantidad === c, '', c + ' ' + p.unidad, '', dinero(motor.precioBase(p, c)));
        }).join('') + '</div>';
        if (p.pisos) {
          var puede = sel.cantidad && sel.cantidad >= p.min_2_pisos;
          h += '<div class="cz-sub">Pisos</div><div class="cz-grid chico">' +
            tarjeta('data-pisos="1"', sel.pisos === 1, '<span class="cz-media emoji">🎂</span>', '1 piso', '', 'Incluido') +
            (puede ? tarjeta('data-pisos="2"', sel.pisos === 2, '<span class="cz-media emoji">🎂🎂</span>', '2 pisos', '', '+ ' + dinero(p.recargo_2_pisos)) :
              '<p class="cz-ayuda">2 pisos disponible desde ' + p.min_2_pisos + ' ' + esc(p.unidad) + '.</p>') + '</div>';
        }
        return h;
      }
      if (ac.grupo) {
        var g = ac.grupo, elegidos = sel.opciones[g.id] || [];
        var porTam = g.opciones.some(function (o) { return vis(o) && o.modo && o.modo !== 'fijo'; });
        return (g.ayuda ? '<p class="cz-ayuda">' + esc(g.ayuda) + '</p>' : g.tipo === 'varios' ? '<p class="cz-ayuda">Puedes elegir varias' + (g.obligatorio ? '' : ' o ninguna') + '.</p>' : '') +
          (porTam ? '<p class="cz-ayuda">Precios para ' + sel.cantidad + ' ' + esc(p.unidad) + '.</p>' : '') +
          '<div class="cz-grid">' + g.opciones.map(function (o, i) {
            if (!vis(o)) return '';
            return tarjeta('data-grupo="' + esc(g.id) + '" data-i="' + i + '"', elegidos.indexOf(i) >= 0, media(o), o.nombre, o.descripcion, extra(motor.precioOpcion(o, p, sel.cantidad)), g.tipo === 'varios');
          }).join('') + '</div>';
      }
      if (ac.id === 'entrega') {
        return (entregas.length > 1 ? '<div class="cz-sub">¿Cómo lo recibes?</div><div class="cz-grid">' + entregas.map(function (x) {
          return tarjeta('data-entrega="' + x.i + '"', sel.entrega === x.i, media(x.e), x.e.nombre, x.e.descripcion, extra(x.e.precio));
        }).join('') + '</div>' : '') +
          '<div class="cz-sub">¿Para cuándo? <small>(mínimo ' + horasMin() + ' h de anticipación)</small></div>' +
          '<div class="cz-fila"><input type="date" id="cz-fecha" min="' + hoyLima(horasMin()) + '" value="' + esc(sel.fecha) + '" aria-label="Fecha de entrega"></div>' +
          '<div class="cz-sub">Horario</div><div class="cz-chips">' + reglas.franjas.map(function (f) {
            return '<button type="button" class="of-chip' + (sel.franja === f ? ' active' : '') + '" data-franja="' + esc(f) + '">' + esc(f) + '</button>';
          }).join('') + '</div>' +
          '<div class="cz-sub">Tema, colores o nombre en la torta <small>(opcional)</small></div>' +
          '<div class="cz-fila"><input type="text" id="cz-detalles" maxlength="200" value="' + esc(sel.detalles) + '" placeholder="Ej.: tema unicornio, colores lila y blanco, «Feliz cumple Sofi»"></div>' +
          (error && sel.fecha ? '<p class="cz-error">' + esc(error) + '</p>' : '');
      }
      // resumen
      var c = cotizacion;
      return '<table class="cz-tabla">' + c.lineas.map(function (l) { return '<tr><td>' + esc(l.concepto) + '</td><td>' + dinero(l.importe) + '</td></tr>'; }).join('') +
        '<tr class="total"><td>Total referencial</td><td>' + dinero(c.total) + '</td></tr>' +
        '<tr><td>Adelanto para confirmar (' + c.adelanto_pct + ' %)</td><td>' + dinero(c.adelanto) + '</td></tr></table>' +
        '<p class="cz-ayuda">Entrega: ' + esc(c.fecha.split('-').reverse().join('/')) + ' a las ' + esc(c.franja) + (sel.detalles ? ' · ' + esc(sel.detalles) : '') + '</p>' +
        '<p class="cz-nota">' + esc(reglas.nota) + '</p>';
    }

    function puedeSeguir(ps) {
      var ac = ps[paso];
      if (ac.id === 'producto') return !!sel.producto;
      if (ac.id === 'cantidad') return !!sel.cantidad;
      if (ac.grupo) return !ac.grupo.obligatorio || (sel.opciones[ac.grupo.id] || []).length > 0;
      if (ac.id === 'entrega') { recalcular(); return !!cotizacion; }
      return true;
    }

    function pintar() {
      var ps = pasos(); if (paso >= ps.length) paso = ps.length - 1;
      if (ps[paso].id === 'resumen' || ps[paso].id === 'entrega') recalcular();
      var est = estimado(), ultimo = ps[paso].id === 'resumen';
      cont.innerHTML = aviso + '<div class="cz">' +
        '<div class="cz-cab"><h3>' + esc(reglas.titulo) + '</h3>' + (reglas.subtitulo ? '<p>' + esc(reglas.subtitulo) + '</p>' : '') +
        '<div class="cz-progreso" aria-hidden="true"><span style="width:' + Math.round(((paso + 1) / ps.length) * 100) + '%"></span></div>' +
        '<div class="cz-paso">Paso ' + (paso + 1) + ' de ' + ps.length + ' · <b>' + esc(ps[paso].titulo) + '</b></div></div>' +
        '<div class="cz-cuerpo">' + cuerpo(ps) + '</div>' +
        '<div class="cz-pie"><div class="cz-total">' + (ultimo && cotizacion ? 'Total <b>' + dinero(cotizacion.total) + '</b>' : est != null ? 'Estimado <b>' + dinero(est) + '</b>' : '') + '</div>' +
        '<div class="cz-botones">' + (paso > 0 ? '<button type="button" class="btn btn-outline" data-nav="-1">Atrás</button>' : '') +
        (ultimo ? '<button type="button" class="btn-wsp" id="cz-enviar">Enviar por WhatsApp</button>' :
          '<button type="button" class="btn btn-primary" data-nav="1"' + (puedeSeguir(ps) ? '' : ' disabled') + '>Siguiente</button>') + '</div></div>' +
        '<p class="cz-legal">Al cotizar aceptas nuestros <a href="/terminos">Términos y Condiciones</a> y nuestra <a href="/privacidad">Política de Privacidad</a>. No guardamos tus datos personales y la cotización no reserva la fecha: el pedido se confirma por WhatsApp con el adelanto.</p></div>';
    }
    function refrescarBoton() {
      var b = cont.querySelector('[data-nav="1"]'); if (b) b.disabled = !puedeSeguir(pasos());
      var err = cont.querySelector('.cz-error'); if (err) err.remove();
      if (error && sel.fecha && pasos()[paso].id === 'entrega') { var p = document.createElement('p'); p.className = 'cz-error'; p.textContent = error; cont.querySelector('.cz-cuerpo').appendChild(p); }
      var t = cont.querySelector('.cz-total'), est = estimado(); if (t && est != null) t.innerHTML = 'Estimado <b>' + dinero(est) + '</b>';
    }

    cont.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !cont.contains(b)) return;
      var p = prod();
      if (b.hasAttribute('data-producto')) {
        var id = b.getAttribute('data-producto');
        if (id !== sel.producto) { sel.producto = id; sel.cantidad = null; sel.pisos = 1; sel.opciones = {}; var np = prod(); if (np.cantidades.indexOf(np.cantidad_base) >= 0) sel.cantidad = np.cantidad_base; }
        paso = 1; pintar(); return;
      }
      if (b.hasAttribute('data-cantidad')) { sel.cantidad = Number(b.getAttribute('data-cantidad')); if (sel.pisos === 2 && sel.cantidad < p.min_2_pisos) sel.pisos = 1; pintar(); return; }
      if (b.hasAttribute('data-pisos')) { sel.pisos = Number(b.getAttribute('data-pisos')); pintar(); return; }
      if (b.hasAttribute('data-grupo')) {
        var gid = b.getAttribute('data-grupo'), i = Number(b.getAttribute('data-i'));
        var g = grupos().filter(function (x) { return x.id === gid; })[0], arr = (sel.opciones[gid] || []).slice(), k = arr.indexOf(i);
        if (g.tipo === 'varios') { if (k >= 0) arr.splice(k, 1); else arr.push(i); } else arr = k >= 0 && !g.obligatorio ? [] : [i];
        sel.opciones[gid] = arr; pintar(); return;
      }
      if (b.hasAttribute('data-entrega')) { sel.entrega = Number(b.getAttribute('data-entrega')); pintar(); return; }
      if (b.hasAttribute('data-franja')) { sel.franja = b.getAttribute('data-franja'); pintar(); return; }
      if (b.hasAttribute('data-nav')) {
        paso = Math.max(0, paso + Number(b.getAttribute('data-nav')));
        pintar(); cont.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
      }
      if (b.id === 'cz-enviar') enviar();
    });
    cont.addEventListener('input', function (e) {
      if (e.target.id === 'cz-detalles') sel.detalles = e.target.value;
      if (e.target.id === 'cz-fecha') { sel.fecha = e.target.value; refrescarBoton(); }
    });
    cont.addEventListener('change', function (e) { if (e.target.id === 'cz-fecha') { sel.fecha = e.target.value; refrescarBoton(); } });

    function mensaje(c) {
      return 'Hola Battcakes, quiero confirmar esta cotización' + (c.codigo ? ' (código ' + c.codigo + ')' : '') + ':\n' +
        c.lineas.map(function (l) { return '• ' + l.concepto + ': ' + dinero(l.importe); }).join('\n') +
        '\nTotal referencial: ' + dinero(c.total) + ' · Adelanto ' + c.adelanto_pct + ' %: ' + dinero(c.adelanto) +
        '\nEntrega: ' + c.fecha.split('-').reverse().join('/') + ' a las ' + c.franja + (sel.detalles.trim() ? '\nDetalles: ' + sel.detalles.trim() : '');
    }
    function enviar() {
      if (!cotizacion) return;
      // Abrir la ventana antes de la llamada evita que el navegador la bloquee como ventana emergente.
      var w = window.open('', '_blank');
      var abrir = function (c) { var url = 'https://wa.me/' + numeroWa + '?text=' + encodeURIComponent(mensaje(c)); if (w) { w.opener = null; w.location.href = url; } else location.href = url; };
      fetch('/api/cotizar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(seleccion(true)) })
        .then(function (r) { return r.json(); })
        .then(function (j) { abrir(j.ok ? j.cotizacion : cotizacion); })
        .catch(function () { abrir(cotizacion); });
    }

    // En móvil, el botón flotante de WhatsApp sube mientras el cotizador está en pantalla para no tapar «Siguiente».
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { document.body.classList.toggle('cz-visible', es[0].isIntersecting); }).observe(cont);
    if (productos.length === 1) { sel.producto = productos[0].id; if (productos[0].cantidades.indexOf(productos[0].cantidad_base) >= 0) sel.cantidad = productos[0].cantidad_base; paso = 1; }
    pintar();
  }
};
