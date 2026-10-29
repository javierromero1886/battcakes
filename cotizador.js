/* Battcakes — cotizador automático de la página principal.
 * Solo se monta si en /admin está activado (contenido.cotizador.activo). Reemplaza el formulario simple de WhatsApp.
 * El precio lo calcula /api/cotizar con las reglas del panel; aquí solo se arman las opciones y se muestra el resultado.
 */
window.bcCotizador = function (reglas, numeroWa) {
  'use strict';
  var cont = document.getElementById('formulario-pedido');
  if (!cont || !reglas || !reglas.activo) return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dinero(c) { return 'S/ ' + (c / 100).toFixed(2); }
  function extraPrecio(c) { return c > 0 ? ' (+' + dinero(c) + ')' : ''; }
  function chips(nombre, lista, multiple) {
    return '<div class="of-chips" data-grupo="' + nombre + '">' + lista.map(function (o, i) {
      return '<button type="button" class="of-chip' + (!multiple && i === 0 ? ' active' : '') + '" data-i="' + i + '" aria-pressed="' + (!multiple && i === 0) + '">' + esc(o.nombre) + extraPrecio(o.precio) + '</button>';
    }).join('') + '</div>';
  }
  function paso(n, titulo, html, extra) { return '<div class="of-step"' + (extra || '') + '><div class="of-step-title">' + n + ' · ' + titulo + '</div>' + html + '</div>'; }

  if (reglas.pausado) {
    cont.innerHTML = '<div class="of-preview"><div class="of-preview-title">Pedidos en pausa</div><p>Por ahora no estamos tomando pedidos nuevos desde la web. Escríbenos por WhatsApp para consultar disponibilidad.</p></div>' +
      '<div class="of-send"><a class="btn-wsp" href="https://wa.me/' + numeroWa + '?text=' + encodeURIComponent('Hola Battcakes, quiero consultar disponibilidad') + '" target="_blank" rel="noopener noreferrer">Escribir por WhatsApp</a></div>';
    return;
  }

  // Fecha mínima según la anticipación (el servidor vuelve a validar con la hora exacta).
  var horasMin = reglas.anticipacion_horas;
  function minFecha(h) { var d = new Date(Date.now() + h * 3600 * 1000 - 5 * 3600 * 1000); return d.toISOString().slice(0, 10); }

  cont.innerHTML =
    paso(1, '¿Qué quieres pedir?', chips('producto', reglas.productos.map(function (p) { return { nombre: p.nombre, precio: 0 }; }), false)) +
    paso(2, '¿Cuánto?', '<div class="of-row"><div class="order-field"><label for="q-cantidad">Cantidad</label><select id="q-cantidad"></select></div><div class="order-field" id="q-pisos-wrap"><label for="q-pisos">Pisos</label><select id="q-pisos"><option value="1">1 piso</option><option value="2">2 pisos (+' + dinero(reglas.segundo_piso) + ')</option></select></div></div>') +
    (reglas.sabores.length ? paso(3, 'Sabor', chips('sabor', reglas.sabores, false), ' data-personal') : '') +
    (reglas.rellenos.length ? paso(3, 'Relleno', chips('relleno', reglas.rellenos, false), ' data-personal') : '') +
    (reglas.acabados.length ? paso(3, 'Acabado', chips('acabado', reglas.acabados, false), ' data-personal') : '') +
    (reglas.extras.length ? paso(4, 'Adicionales (opcional)', chips('extras', reglas.extras, true)) : '') +
    paso(5, 'Entrega', '<div class="of-row"><div class="order-field"><label for="q-entrega">Recojo o delivery</label><select id="q-entrega">' + reglas.entrega.map(function (o, i) { return '<option value="' + i + '">' + esc(o.nombre) + extraPrecio(o.precio) + '</option>'; }).join('') + '</select></div>' +
      '<div class="order-field"><label for="q-fecha">Fecha (mínimo <span id="q-horas">' + horasMin + '</span> h)</label><input id="q-fecha" type="date"></div>' +
      '<div class="order-field"><label for="q-franja">Horario</label><select id="q-franja">' + reglas.franjas.map(function (f) { return '<option>' + esc(f) + '</option>'; }).join('') + '</select></div>' +
      '<div class="order-field"><label for="q-detalles">Tema, colores o nombre (opcional)</label><input id="q-detalles" type="text" maxlength="200"></div></div>') +
    '<div class="of-preview" aria-live="polite"><div class="of-preview-title">Tu cotización</div><div id="q-resultado"><p>Elige la fecha para ver el precio.</p></div></div>' +
    '<div class="of-send"><button type="button" class="btn-wsp" id="q-enviar" disabled>Enviar cotización por WhatsApp</button><span class="of-note">' + esc(reglas.nota) + '</span></div>' +
    '<p class="of-note" style="margin-top:14px">Al cotizar aceptas nuestros <a href="/terminos">Términos y Condiciones</a> y nuestra <a href="/privacidad">Política de Privacidad</a>. La cotización no guarda tus datos personales ni reserva la fecha: el pedido se confirma por WhatsApp con el adelanto.</p>';

  var sel = { producto: 0, sabor: 0, relleno: 0, acabado: 0, extras: [] };
  var ultima = null, temporizador = null, secuencia = 0;
  var $ = function (id) { return document.getElementById(id); };
  function producto() { return reglas.productos[sel.producto]; }

  function actualizarProducto() {
    var p = producto();
    $('q-cantidad').innerHTML = p.cantidades.map(function (c) { return '<option value="' + c + '"' + (c === p.cantidad_base ? ' selected' : '') + '>' + c + ' ' + esc(p.unidad) + '</option>'; }).join('');
    $('q-pisos-wrap').hidden = !p.pisos;
    if (!p.pisos) $('q-pisos').value = '1';
    cont.querySelectorAll('[data-personal]').forEach(function (s) { s.hidden = !p.personalizable; });
    var h = Math.max(horasMin, p.anticipacion_horas || 0);
    $('q-horas').textContent = h;
    $('q-fecha').min = minFecha(h);
  }

  cont.addEventListener('click', function (e) {
    var b = e.target.closest('.of-chip'); if (!b) return;
    var g = b.parentNode.getAttribute('data-grupo'), i = Number(b.getAttribute('data-i'));
    if (g === 'extras') {
      var k = sel.extras.indexOf(i);
      if (k >= 0) sel.extras.splice(k, 1); else sel.extras.push(i);
      b.classList.toggle('active', k < 0); b.setAttribute('aria-pressed', String(k < 0));
    } else {
      sel[g] = i;
      b.parentNode.querySelectorAll('.of-chip').forEach(function (c) { c.classList.toggle('active', c === b); c.setAttribute('aria-pressed', String(c === b)); });
      if (g === 'producto') actualizarProducto();
    }
    pedirPrecio();
  });
  ['q-cantidad', 'q-pisos', 'q-entrega', 'q-fecha', 'q-franja'].forEach(function (id) { $(id).addEventListener('change', pedirPrecio); });

  function seleccion(guardar) {
    return {
      producto: producto().id, cantidad: Number($('q-cantidad').value), pisos: Number($('q-pisos').value),
      sabor: sel.sabor, relleno: sel.relleno, acabado: sel.acabado, extras: sel.extras,
      entrega: Number($('q-entrega').value), fecha: $('q-fecha').value, franja: $('q-franja').value, guardar: !!guardar,
    };
  }
  function llamar(guardar) {
    return fetch('/api/cotizar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(seleccion(guardar)) })
      .then(function (r) { return r.json(); });
  }
  function pedirPrecio() {
    clearTimeout(temporizador);
    ultima = null; $('q-enviar').disabled = true;
    if (!$('q-fecha').value) { $('q-resultado').innerHTML = '<p>Elige la fecha para ver el precio.</p>'; return; }
    temporizador = setTimeout(function () {
      var n = ++secuencia;
      $('q-resultado').innerHTML = '<p>Calculando…</p>';
      llamar(false).then(function (j) {
        if (n !== secuencia) return;
        if (!j.ok) { $('q-resultado').innerHTML = '<p style="color:#B00020">' + esc(j.error) + '</p>'; return; }
        ultima = j.cotizacion; $('q-enviar').disabled = false; pintar(ultima);
      }).catch(function () { if (n === secuencia) $('q-resultado').innerHTML = '<p>No pudimos calcular el precio. Escríbenos por WhatsApp.</p>'; });
    }, 250);
  }
  function pintar(c) {
    $('q-resultado').innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:14px">' + c.lineas.map(function (l) {
      return '<tr><td style="padding:3px 0">' + esc(l.concepto) + '</td><td style="text-align:right;white-space:nowrap">' + dinero(l.importe) + '</td></tr>';
    }).join('') + '<tr><td style="padding-top:8px;border-top:1px solid rgba(90,20,108,.2)"><b>Total referencial</b></td><td style="text-align:right;padding-top:8px;border-top:1px solid rgba(90,20,108,.2)"><b>' + dinero(c.total) + '</b></td></tr>' +
      '<tr><td>Adelanto para confirmar (' + c.adelanto_pct + ' %)</td><td style="text-align:right">' + dinero(c.adelanto) + '</td></tr></table>';
  }
  function mensaje(c) {
    var det = $('q-detalles').value.trim();
    var f = c.fecha.split('-');
    return 'Hola Battcakes, quiero confirmar esta cotización' + (c.codigo ? ' (código ' + c.codigo + ')' : '') + ':\n' +
      c.lineas.map(function (l) { return '• ' + l.concepto + ': ' + dinero(l.importe); }).join('\n') +
      '\nTotal referencial: ' + dinero(c.total) + ' · Adelanto ' + c.adelanto_pct + ' %: ' + dinero(c.adelanto) +
      '\nEntrega: ' + f[2] + '/' + f[1] + '/' + f[0] + ' a las ' + c.franja + (det ? '\nDetalles: ' + det : '');
  }
  $('q-enviar').addEventListener('click', function () {
    if (!ultima) return;
    // Abrir la ventana antes de la llamada evita que el navegador la bloquee como ventana emergente.
    var w = window.open('', '_blank');
    llamar(true).then(function (j) {
      var c = j.ok ? j.cotizacion : ultima;
      var url = 'https://wa.me/' + numeroWa + '?text=' + encodeURIComponent(mensaje(c));
      if (w) { w.opener = null; w.location.href = url; } else location.href = url;
    }).catch(function () {
      var url = 'https://wa.me/' + numeroWa + '?text=' + encodeURIComponent(mensaje(ultima));
      if (w) w.location.href = url; else location.href = url;
    });
  });

  actualizarProducto();
};
