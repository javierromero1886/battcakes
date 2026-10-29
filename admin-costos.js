/* Battcakes — pestaña «Costos e inventario» del panel /admin.
 * Insumos por tipo (alta en lote), compras con costo promedio ponderado, ajustes, recetas vinculadas al cotizador,
 * costeo vs precio de venta (precio sugerido = costo × factor, por defecto 2.5), simulador del producto final y producción.
 * Todo se guarda al instante en /api/admin-costos (D1). Los cálculos usan costeo.js y motor-cotizador.js.
 */
(function () {
  'use strict';
  var API = '/api/admin-costos';
  var clave = '', datos = null, mods = null, cargado = false;
  var ui = { filtro: '', abierto: null, receta: null, filas: null, bloques: { 'k-inv': true, 'k-costeo': true } };
  var app = function () { return document.getElementById('costos-app'); };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dinero(c) { return 'S/ ' + ((Number(c) || 0) / 100).toFixed(2); }
  function cent(s) { return Math.round((Number(String(s).replace(',', '.')) || 0) * 100); }
  function num(s) { return Number(String(s).replace(',', '.')); }
  // Unidades de compra y de receta por unidad base del insumo (factor a la unidad base).
  var CONV = { g: [['kg', 1000], ['g', 1]], ml: [['L', 1000], ['ml', 1]], unidad: [['unidad', 1], ['docena', 12], ['ciento', 100]] };
  var NOMBRE_UNIDAD = { g: 'gramos (g / kg)', ml: 'mililitros (ml / L)', unidad: 'unidades' };
  function cantidadTxt(c, u) {
    var a = Math.abs(c);
    if (u === 'g' && a >= 1000) return (c / 1000).toLocaleString('es-PE', { maximumFractionDigits: 2 }) + ' kg';
    if (u === 'ml' && a >= 1000) return (c / 1000).toLocaleString('es-PE', { maximumFractionDigits: 2 }) + ' L';
    return c.toLocaleString('es-PE', { maximumFractionDigits: 2 }) + ' ' + (u === 'unidad' ? 'u' : u);
  }
  function costoUnidadTxt(i) { // costo promedio mostrado por kg, L o unidad
    if (!(i.costo_promedio > 0)) return '—';
    return i.unidad === 'unidad' ? dinero(i.costo_promedio) + ' / u' : dinero(i.costo_promedio * 1000) + ' / ' + (i.unidad === 'g' ? 'kg' : 'L');
  }
  function selUnidad(base, attrs, elegido) {
    return '<select ' + attrs + '>' + (CONV[base] || CONV.unidad).map(function (u) { return '<option value="' + u[1] + '"' + (String(u[1]) === String(elegido) ? ' selected' : '') + '>' + u[0] + '</option>'; }).join('') + '</select>';
  }
  function singular(u) { u = String(u || 'unidad'); return u === 'porciones' ? 'porción' : u === 'unidades' ? 'unidad' : u.replace(/es$/, '').replace(/s$/, ''); }
  function pct(v) { return v == null ? '—' : v.toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' %'; }

  function pedir(cuerpo) {
    var o = { method: cuerpo ? 'POST' : 'GET', headers: { 'x-admin-key': clave } };
    if (cuerpo) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(cuerpo); }
    return fetch(API, o).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Respuesta inválida del servidor (' + r.status + ').' }; }); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || 'Error'); return j; });
  }
  function aviso(t, err) { ui.msg = { t: t, err: !!err }; var m = document.getElementById('k-msg'); if (m) { m.textContent = t; m.className = 'form-status' + (err ? ' err' : ' ok'); } }
  function accion(cuerpo, ok) {
    aviso('Guardando…');
    return pedir(cuerpo).then(function () { return recargar(); }).then(function () { aviso(ok || 'Guardado.'); })
      .catch(function (e) { aviso(e.message, true); throw e; });
  }
  function recargar() { return pedir(null).then(function (j) { datos = j; pintar(); }); }

  window.bcCostos = function (k) {
    clave = k;
    if (cargado) return;
    cargado = true;
    var css = document.createElement('style');
    css.textContent = '.ktabla{width:100%;border-collapse:collapse;font-size:.9rem}.ktabla th{text-align:left;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:6px;border-bottom:1px solid var(--line)}.ktabla td{padding:7px 6px;border-bottom:1px solid var(--line);vertical-align:middle}.ktabla td.n{text-align:right;white-space:nowrap}.ktabla tr.bajo td:first-child{border-left:4px solid #E0A100}.ktabla tr.tipo td{background:var(--accent-soft);font-weight:800;font-size:.85rem}' +
      '.kkpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:6px 0 4px}.kkpi{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px}.kkpi b{display:block;font-size:1.35rem;color:var(--accent)}.kkpi span{font-size:.82rem;color:var(--muted)}' +
      '.kform{display:flex;flex-wrap:wrap;gap:8px;align-items:end;background:var(--bg);border:1px dashed var(--line);border-radius:12px;padding:10px;margin:6px 0}.kform label{display:grid;gap:3px;font-size:.78rem;font-weight:700;color:var(--muted)}' +
      '.kform input,.kform select,.ktabla input,.ktabla select{padding:7px 9px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--text);font:inherit;font-size:.88rem;min-width:0}' +
      '.kok{color:#0B5F32;font-weight:800}.kno{color:#B00020;font-weight:800}.kchips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.kchips button[aria-pressed=true]{background:var(--accent);color:#fff;border-color:var(--accent)}' +
      '.kscroll{overflow-x:auto}.ksim{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}@media(max-width:860px){.ksim{grid-template-columns:1fr}}';
    document.head.appendChild(css);
    Promise.all([import('/costeo.js?v=1'), import('/motor-cotizador.js?v=5')]).then(function (m) { mods = { costeo: m[0], motor: m[1] }; return recargar(); })
      .catch(function (e) { app().innerHTML = '<p class="form-status err">' + esc(e.message) + '</p>'; cargado = false; });
    enlazar();
  };

  function bloque(id, titulo, cuerpo) {
    return '<details class="qbloque" data-kb="' + id + '"' + (ui.bloques[id] ? ' open' : '') + '><summary>' + titulo + '</summary><div class="qcuerpo">' + cuerpo + '</div></details>';
  }

  /* ---------------- pintar ---------------- */
  function pintar() {
    var ins = datos.insumos, rec = datos.recetas;
    var valor = ins.reduce(function (t, i) { return t + i.valor_stock; }, 0);
    var bajos = ins.filter(function (i) { return i.stock_minimo > 0 && i.stock <= i.stock_minimo; });
    var malas = rec.filter(function (r) { return r.cumple === false; });
    app().innerHTML =
      '<div class="kkpis"><div class="kkpi"><b>' + dinero(valor) + '</b><span>Valor del inventario (a costo promedio)</span></div>' +
      '<div class="kkpi"><b>' + ins.length + '</b><span>Insumos registrados</span></div>' +
      '<div class="kkpi"><b' + (bajos.length ? ' style="color:#B26A00"' : '') + '>' + bajos.length + '</b><span>Insumos en o bajo el mínimo</span></div>' +
      '<div class="kkpi"><b' + (malas.length ? ' style="color:#B00020"' : '') + '>' + malas.length + ' / ' + rec.length + '</b><span>Recetas con precio bajo ' + esc(datos.factor) + '× costo</span></div></div>' +
      '<p><span id="k-msg" class="form-status' + (ui.msg ? (ui.msg.err ? ' err' : ' ok') : '') + '" role="status">' + esc(ui.msg ? ui.msg.t : '') + '</span></p>' +
      bloque('k-inv', '1 · Inventario de insumos', inventario()) +
      bloque('k-alta', '2 · Agregar varios insumos', alta()) +
      bloque('k-rec', '3 · Recetas (' + rec.length + ')', recetas()) +
      bloque('k-costeo', '4 · Costeo y margen de ganancia', costeo()) +
      bloque('k-sim', '5 · Simulador del producto final', simulador()) +
      bloque('k-mov', '6 · Movimientos de inventario', movimientos());
    if (ui.receta) calcularEditor();
    calcularSimulador();
  }

  function tipos() { var s = {}; datos.insumos.forEach(function (i) { s[i.tipo] = 1; }); return Object.keys(s).sort(); }

  function inventario() {
    var ts = tipos();
    if (!datos.insumos.length) return '<p class="ayuda">Aún no hay insumos. Agrégalos en «Agregar varios insumos».</p>';
    var lista = datos.insumos.filter(function (i) { return !ui.filtro || i.tipo === ui.filtro; });
    var h = '<div class="kchips"><button class="mini" type="button" data-kf="" aria-pressed="' + !ui.filtro + '">Todos</button>' + ts.map(function (t) {
      return '<button class="mini" type="button" data-kf="' + esc(t) + '" aria-pressed="' + (ui.filtro === t) + '">' + esc(t) + '</button>';
    }).join('') + '</div><div class="kscroll"><table class="ktabla"><thead><tr><th>Insumo</th><th class="n">Stock</th><th class="n">Mínimo</th><th class="n">Costo promedio</th><th class="n">Valor</th><th></th></tr></thead><tbody>';
    var tipoAnt = null;
    lista.forEach(function (i) {
      if (i.tipo !== tipoAnt) { h += '<tr class="tipo"><td colspan="6">' + esc(i.tipo) + '</td></tr>'; tipoAnt = i.tipo; }
      var bajo = i.stock_minimo > 0 && i.stock <= i.stock_minimo;
      h += '<tr class="' + (bajo ? 'bajo' : '') + '"><td><b>' + esc(i.nombre) + '</b>' + (bajo ? ' <small class="kno">reponer</small>' : '') + '</td><td class="n">' + cantidadTxt(i.stock, i.unidad) + '</td><td class="n">' + (i.stock_minimo ? cantidadTxt(i.stock_minimo, i.unidad) : '—') + '</td>' +
        '<td class="n">' + costoUnidadTxt(i) + '</td><td class="n">' + dinero(i.valor_stock) + '</td>' +
        '<td class="n"><button class="mini" type="button" data-kab="compra:' + i.id + '">+ Compra</button> <button class="mini" type="button" data-kab="ajuste:' + i.id + '">Ajuste</button> <button class="mini" type="button" data-kab="editar:' + i.id + '">Editar</button> <button class="mini peligro" type="button" data-kdel-ins="' + i.id + '" aria-label="Eliminar">✕</button></td></tr>';
      if (ui.abierto && Number(ui.abierto.split(':')[1]) === i.id) h += '<tr><td colspan="6">' + formInsumo(ui.abierto.split(':')[0], i) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function formInsumo(tipo, i) {
    var hoy = new Date().toISOString().slice(0, 10);
    if (tipo === 'compra') return '<div class="kform" data-kform="compra" data-id="' + i.id + '"><b style="width:100%">Compra de ' + esc(i.nombre) + '</b>' +
      '<label>Cantidad<input name="cantidad" type="number" min="0" step="any" style="width:110px"></label><label>Unidad' + selUnidad(i.unidad, 'name="conv"', (CONV[i.unidad] || CONV.unidad)[0][1]) + '</label>' +
      '<label>Costo total S/<input name="costo" type="number" min="0" step="0.01" style="width:110px"></label><label>Proveedor<input name="proveedor" maxlength="80" style="width:150px"></label>' +
      '<label>Fecha<input name="fecha" type="date" value="' + hoy + '"></label><button class="btn btn-primary" type="button" data-kenviar>Registrar compra</button><button class="mini" type="button" data-kcerrar>Cancelar</button>' +
      '<small class="ayuda" style="width:100%;margin:0">El costo promedio se recalcula ponderando el stock actual (' + cantidadTxt(i.stock, i.unidad) + ' a ' + costoUnidadTxt(i) + ') con esta compra.</small></div>';
    if (tipo === 'ajuste') return '<div class="kform" data-kform="ajuste" data-id="' + i.id + '"><b style="width:100%">Ajuste de ' + esc(i.nombre) + ' (stock actual ' + cantidadTxt(i.stock, i.unidad) + ')</b>' +
      '<label>Sumar (+) o restar (−)<input name="cantidad" type="number" step="any" style="width:120px" placeholder="-250"></label><label>Unidad' + selUnidad(i.unidad, 'name="conv"', 1) + '</label>' +
      '<label>Motivo<input name="nota" maxlength="200" placeholder="Merma, conteo físico…" style="width:220px"></label><button class="btn btn-primary" type="button" data-kenviar>Guardar ajuste</button><button class="mini" type="button" data-kcerrar>Cancelar</button></div>';
    return '<div class="kform" data-kform="editar" data-id="' + i.id + '"><b style="width:100%">Editar ' + esc(i.nombre) + '</b>' +
      '<label>Nombre<input name="nombre" value="' + esc(i.nombre) + '" maxlength="80"></label><label>Tipo<input name="tipo" value="' + esc(i.tipo) + '" maxlength="40" list="k-tipos"></label>' +
      '<label>Stock mínimo<input name="minimo" type="number" min="0" step="any" value="' + esc(i.stock_minimo / ((CONV[i.unidad] || CONV.unidad)[0][1])) + '" style="width:100px"></label><label>Unidad' + selUnidad(i.unidad, 'name="conv"', (CONV[i.unidad] || CONV.unidad)[0][1]) + '</label>' +
      '<button class="btn btn-primary" type="button" data-kenviar>Guardar</button><button class="mini" type="button" data-kcerrar>Cancelar</button>' + datalistTipos() + '</div>';
  }
  function datalistTipos() {
    var base = ['Harinas y polvos', 'Azúcares', 'Lácteos', 'Huevos', 'Chocolates y cacao', 'Frutas', 'Frutos secos', 'Grasas', 'Decoración', 'Empaques', 'Otros'];
    var todos = base.concat(tipos().filter(function (t) { return base.indexOf(t) < 0; }));
    return '<datalist id="k-tipos">' + todos.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist>';
  }

  function filaVacia(tipo) { return { tipo: tipo || '', nombre: '', unidad: 'g', minimo: '', cantidad: '', conv: 1000, costo: '', proveedor: '' }; }
  function alta() {
    if (!ui.filas) ui.filas = [filaVacia(), filaVacia(), filaVacia()];
    return '<p class="ayuda">Llena una fila por insumo (puedes cargar varios del mismo tipo a la vez). Si ya lo tienes en stock, indica la compra inicial: cantidad y cuánto pagaste en total; así se calcula su costo. Ej.: Harina, 5 kg, S/ 22.50 → S/ 4.50 por kg.</p>' +
      '<div class="kscroll"><table class="ktabla"><thead><tr><th>Tipo</th><th>Insumo</th><th>Se mide en</th><th>Stock mínimo</th><th>Compra inicial</th><th>Unidad</th><th>Costo total S/</th><th>Proveedor</th><th></th></tr></thead><tbody>' +
      ui.filas.map(function (f, k) {
        var conv = CONV[f.unidad] || CONV.unidad;
        return '<tr data-kfila="' + k + '"><td><input data-kc="tipo" value="' + esc(f.tipo) + '" list="k-tipos" placeholder="Lácteos" style="width:130px"></td>' +
          '<td><input data-kc="nombre" value="' + esc(f.nombre) + '" placeholder="Leche entera" style="width:150px"></td>' +
          '<td><select data-kc="unidad">' + Object.keys(NOMBRE_UNIDAD).map(function (u) { return '<option value="' + u + '"' + (u === f.unidad ? ' selected' : '') + '>' + NOMBRE_UNIDAD[u] + '</option>'; }).join('') + '</select></td>' +
          '<td><input data-kc="minimo" type="number" min="0" step="any" value="' + esc(f.minimo) + '" placeholder="' + conv[0][0] + '" style="width:80px"></td>' +
          '<td><input data-kc="cantidad" type="number" min="0" step="any" value="' + esc(f.cantidad) + '" style="width:80px"></td>' +
          '<td>' + selUnidad(f.unidad, 'data-kc="conv"', f.conv) + '</td>' +
          '<td><input data-kc="costo" type="number" min="0" step="0.01" value="' + esc(f.costo) + '" style="width:90px"></td>' +
          '<td><input data-kc="proveedor" value="' + esc(f.proveedor) + '" maxlength="80" style="width:120px"></td>' +
          '<td><button class="mini peligro" type="button" data-kquitar="' + k + '" aria-label="Quitar fila">✕</button></td></tr>';
      }).join('') + '</tbody></table></div>' + datalistTipos() +
      '<div class="barra"><button class="mini" type="button" data-kmas="1">+ 1 fila</button><button class="mini" type="button" data-kmas="5">+ 5 filas</button>' +
      '<button class="btn btn-primary" type="button" data-kalta>Guardar insumos</button><small class="ayuda" style="margin:0">El stock mínimo se indica en ' + 'kg, L o unidades (te avisa cuándo reponer).</small></div>';
  }

  function opcionesVinculo(actual) {
    var q = mods.motor.normalizar(datos.cotizador);
    var h = '<option value="">Sin vínculo (precio de venta manual)</option><optgroup label="Productos del cotizador">' + q.productos.map(function (p) {
      var v = 'producto:' + p.id; return '<option value="' + esc(v) + '"' + (v === actual ? ' selected' : '') + '>' + esc(p.nombre) + ' (base)</option>';
    }).join('') + '</optgroup>';
    q.grupos.forEach(function (g) {
      h += '<optgroup label="' + esc(g.titulo) + '">' + g.opciones.map(function (o) {
        var v = 'opcion:' + g.id + ':' + o.nombre; return '<option value="' + esc(v) + '"' + (v === actual ? ' selected' : '') + '>' + esc(o.nombre) + '</option>';
      }).join('') + '</optgroup>';
    });
    return h;
  }
  function selInsumo(actual) {
    var h = '<option value="">Elige insumo…</option>', t = null;
    datos.insumos.forEach(function (i) {
      if (i.tipo !== t) { if (t !== null) h += '</optgroup>'; h += '<optgroup label="' + esc(i.tipo) + '">'; t = i.tipo; }
      h += '<option value="' + i.id + '"' + (Number(actual) === i.id ? ' selected' : '') + '>' + esc(i.nombre) + '</option>';
    });
    return h + (t !== null ? '</optgroup>' : '');
  }

  function recetas() {
    var h = '<p class="ayuda">Cada receta indica los insumos para lo que <b>rinde</b> (p. ej. 20 porciones de bizcocho). Vincúlala a un producto u opción del cotizador para compararla con su precio de venta. Para una torta completa, crea la receta del bizcocho (producto) y las de cada relleno o cobertura (opciones): el simulador las suma.</p>';
    if (ui.receta) return h + editorReceta();
    h += '<button class="btn btn-primary" type="button" data-knueva>+ Nueva receta</button>';
    if (!datos.recetas.length) return h + '<p class="ayuda" style="margin-top:10px">Aún no hay recetas.</p>';
    return h + '<div class="kscroll" style="margin-top:10px"><table class="ktabla"><thead><tr><th>Receta</th><th>Vinculada a</th><th class="n">Rinde</th><th class="n">Costo</th><th class="n">Costo / unidad</th><th></th></tr></thead><tbody>' +
      datos.recetas.map(function (r) {
        return '<tr><td><b>' + esc(r.nombre) + '</b><br><small style="color:var(--muted)">' + esc(r.tipo) + (r.faltan.length ? ' · <span class="kno">sin costo: ' + esc(r.faltan.join(', ')) + '</span>' : '') + '</small></td>' +
          '<td>' + (r.vinculo_nombre ? esc(r.vinculo_nombre) : r.vinculo ? '<span class="kno">vínculo no encontrado</span>' : '<small>Precio manual</small>') + '</td>' +
          '<td class="n">' + esc(r.rinde) + ' ' + esc(r.unidad) + '</td><td class="n">' + dinero(r.costo) + '</td><td class="n">' + dinero(r.costo / r.rinde) + '</td>' +
          '<td class="n"><button class="mini" type="button" data-keditar="' + r.id + '">Editar</button> <button class="mini" type="button" data-kproducir="' + r.id + '" title="Descontar del stock">Producir</button> <button class="mini peligro" type="button" data-kdel-rec="' + r.id + '" aria-label="Eliminar">✕</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function editorReceta() {
    var r = ui.receta;
    return '<div class="qtarjeta"><div class="qrej">' +
      '<label class="qc ancho2"><span>Nombre</span><input data-kr="nombre" value="' + esc(r.nombre) + '" maxlength="80" placeholder="Bizcocho de vainilla"></label>' +
      '<label class="qc"><span>Tipo</span><input data-kr="tipo" value="' + esc(r.tipo) + '" maxlength="40" placeholder="Bizcochos, Rellenos…"></label>' +
      '<label class="qc"><span>Merma (%)</span><input data-kr="merma_pct" type="number" min="0" max="100" step="any" value="' + esc(r.merma_pct) + '"></label>' +
      '<label class="qc ancho2"><span>Vinculada a (cotizador)</span><select data-kr="vinculo">' + opcionesVinculo(r.vinculo) + '</select></label>' +
      '<label class="qc"><span>Rinde</span><input data-kr="rinde" type="number" min="0" step="any" value="' + esc(r.rinde) + '"></label>' +
      '<label class="qc"><span>Unidad</span><input data-kr="unidad" value="' + esc(r.unidad) + '" maxlength="20"></label>' +
      (r.vinculo ? '' : '<label class="qc"><span>Precio de venta (S/) por lo que rinde</span><input data-kr="precio_venta" type="number" min="0" step="0.5" value="' + esc(r.precio_venta / 100) + '"></label>') +
      '</div><h4 style="margin:14px 0 6px">Insumos</h4><div class="kscroll"><table class="ktabla"><thead><tr><th>Insumo</th><th>Cantidad</th><th>Unidad</th><th class="n">Costo</th><th></th></tr></thead><tbody>' +
      r.items.map(function (it, k) {
        var ins = datos.insumos.filter(function (i) { return i.id === Number(it.insumo_id); })[0];
        return '<tr data-kitem="' + k + '"><td><select data-ki="insumo_id">' + selInsumo(it.insumo_id) + '</select></td>' +
          '<td><input data-ki="cant" type="number" min="0" step="any" value="' + esc(it.cant) + '" style="width:100px"></td>' +
          '<td>' + (ins ? selUnidad(ins.unidad, 'data-ki="conv"', it.conv) : '—') + '</td><td class="n" data-kcosto="' + k + '">—</td>' +
          '<td><button class="mini peligro" type="button" data-kqitem="' + k + '" aria-label="Quitar">✕</button></td></tr>';
      }).join('') + '</tbody></table></div><button class="mini" type="button" data-kaitem>+ Insumo</button>' +
      '<div id="k-resumen-receta" style="margin-top:12px"></div>' +
      '<div class="barra"><button class="btn btn-primary" type="button" data-kguardar-rec>Guardar receta</button><button class="btn btn-outline" type="button" data-kcancelar-rec>Cancelar</button></div></div>';
  }
  function recetaDesdeEditor() {
    var r = ui.receta;
    return {
      id: r.id || null, nombre: r.nombre, tipo: r.tipo, vinculo: r.vinculo, rinde: num(r.rinde), unidad: r.unidad,
      precio_venta: r.vinculo ? 0 : Math.round(num(r.precio_venta)), merma_pct: num(r.merma_pct) || 0, notas: r.notas || '',
      items: r.items.filter(function (it) { return it.insumo_id && num(it.cant) > 0; }).map(function (it) { return { insumo_id: Number(it.insumo_id), cantidad: num(it.cant) * Number(it.conv || 1) }; }),
    };
  }
  function porId() { var m = {}; datos.insumos.forEach(function (i) { m[i.id] = i; }); return m; }
  function calcularEditor() {
    var r = recetaDesdeEditor(), ids = porId();
    ui.receta.items.forEach(function (it, k) {
      var celda = app().querySelector('[data-kcosto="' + k + '"]'), ins = ids[it.insumo_id];
      if (celda) celda.textContent = ins && num(it.cant) > 0 ? dinero(num(it.cant) * Number(it.conv || 1) * ins.costo_promedio) : '—';
    });
    var c = mods.costeo.costoReceta(r, ids), venta = mods.costeo.ventaReceta(r, datos.cotizador), a = mods.costeo.analizar(c.costo, venta, datos.factor);
    var el = document.getElementById('k-resumen-receta'); if (!el) return;
    el.innerHTML = '<div class="kkpis">' +
      '<div class="kkpi"><b>' + dinero(c.costo) + '</b><span>Costo de materiales' + (r.merma_pct ? ' (con ' + r.merma_pct + ' % de merma)' : '') + '</span></div>' +
      '<div class="kkpi"><b>' + dinero(r.rinde > 0 ? c.costo / r.rinde : 0) + '</b><span>Costo por ' + esc(singular(ui.receta.unidad)) + '</span></div>' +
      '<div class="kkpi"><b>' + dinero(venta) + '</b><span>Precio de venta ' + (r.vinculo ? '(cotizador, ' + r.rinde + ' ' + esc(r.unidad) + ')' : '(manual)') + '</span></div>' +
      '<div class="kkpi"><b>' + dinero(a.sugerido) + '</b><span>Precio sugerido (' + esc(datos.factor) + '× costo)</span></div>' +
      '<div class="kkpi"><b class="' + (a.cumple === false ? 'kno' : 'kok') + '">' + pct(a.margen_pct) + '</b><span>Margen · ganancia ' + dinero(a.ganancia) + (a.multiplicador ? ' · ' + a.multiplicador + '× costo' : '') + '</span></div></div>' +
      (c.faltan.length ? '<p class="kno">Sin costo registrado: ' + esc(c.faltan.join(', ')) + ' (registra una compra).</p>' : '');
  }

  function costeo() {
    var h = '<div class="barra" style="margin-top:0"><label class="check-inline">Precio sugerido = costo de materiales × <input id="k-factor" type="number" min="1" max="20" step="0.1" value="' + esc(datos.factor) + '" style="width:80px;padding:6px 8px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text)"></label><button class="mini" type="button" data-kfactor>Aplicar</button></div>' +
      '<p class="ayuda">Margen = (precio − costo) ÷ precio. Con ' + esc(datos.factor) + '× el costo, el margen sobre materiales es ' + pct(Math.round((1 - 1 / datos.factor) * 1000) / 10) + '. El costo es solo de materiales (insumos y empaques): la mano de obra, el gas y el delivery salen de ese margen. Precios con IGV incluido.</p>';
    if (!datos.recetas.length) return h + '<p class="ayuda">Crea recetas para ver su costeo.</p>';
    return h + '<div class="kscroll"><table class="ktabla"><thead><tr><th>Receta</th><th class="n">Rinde</th><th class="n">Costo</th><th class="n">Precio venta</th><th class="n">Sugerido ' + esc(datos.factor) + '×</th><th class="n">Ganancia</th><th class="n">Margen</th><th class="n">× costo</th><th>Estado</th></tr></thead><tbody>' +
      datos.recetas.map(function (r) {
        var dif = r.venta - r.sugerido;
        return '<tr><td><b>' + esc(r.nombre) + '</b><br><small style="color:var(--muted)">' + esc(r.vinculo_nombre || 'Precio manual') + '</small></td><td class="n">' + esc(r.rinde) + ' ' + esc(r.unidad) + '</td>' +
          '<td class="n">' + dinero(r.costo) + '</td><td class="n">' + dinero(r.venta) + '</td><td class="n">' + dinero(r.sugerido) + '</td><td class="n">' + dinero(r.ganancia) + '</td>' +
          '<td class="n">' + pct(r.margen_pct) + '</td><td class="n">' + (r.multiplicador == null ? '—' : r.multiplicador + '×') + '</td>' +
          '<td>' + (r.cumple == null ? '<small>Sin costo</small>' : r.cumple ? '<span class="kok">✓ OK</span>' : '<span class="kno">Sube ' + dinero(-dif) + '</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // Simulador: un producto del cotizador con sus opciones → costo (recetas escaladas) vs precio del cotizador.
  var sim = { producto: '', cantidad: 0, opciones: {} };
  function simulador() {
    var q = mods.motor.normalizar(datos.cotizador);
    if (!sim.producto && q.productos[0]) { sim.producto = q.productos[0].id; sim.cantidad = q.productos[0].cantidad_base; }
    var p = q.productos.filter(function (x) { return x.id === sim.producto; })[0];
    if (!p) return '<p class="ayuda">El cotizador no tiene productos.</p>';
    if (p.cantidades.indexOf(sim.cantidad) < 0) sim.cantidad = p.cantidades.indexOf(p.cantidad_base) >= 0 ? p.cantidad_base : p.cantidades[0];
    return '<p class="ayuda">Arma un pedido como lo haría un cliente y mira su costo de materiales contra el precio del cotizador (sin delivery).</p><div class="ksim"><div>' +
      '<div class="kform"><label>Producto<select data-ksim="producto">' + q.productos.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === p.id ? ' selected' : '') + '>' + esc(x.nombre) + '</option>'; }).join('') + '</select></label>' +
      '<label>Cantidad<select data-ksim="cantidad">' + p.cantidades.map(function (c) { return '<option value="' + c + '"' + (c === sim.cantidad ? ' selected' : '') + '>' + c + ' ' + esc(p.unidad) + '</option>'; }).join('') + '</select></label></div>' +
      mods.motor.gruposDe(q, p.id).map(function (g) {
        var sel = sim.opciones[g.id] || [];
        return '<div style="margin:8px 0"><b style="font-size:.9rem">' + esc(g.titulo) + '</b><div class="qchecks" style="margin-top:4px">' + g.opciones.map(function (o, i) {
          return o.visible === false ? '' : '<label class="check-inline"><input type="' + (g.tipo === 'uno' ? 'radio' : 'checkbox') + '" name="ksim-' + esc(g.id) + '" data-ksimg="' + esc(g.id) + '" value="' + i + '"' + (sel.indexOf(i) >= 0 ? ' checked' : '') + '> ' + esc(o.nombre) + '</label>';
        }).join('') + '</div></div>';
      }).join('') + '</div><div id="k-sim-res"></div></div>';
  }
  function calcularSimulador() {
    var el = document.getElementById('k-sim-res'); if (!el || !mods) return;
    var q = mods.motor.normalizar(datos.cotizador), p = q.productos.filter(function (x) { return x.id === sim.producto; })[0]; if (!p) return;
    var recs = datos.recetas.map(function (r) { return r; });
    var c = mods.costeo.costoProductoFinal(sim, q, recs, porId());
    var venta = mods.motor.precioBase(p, sim.cantidad);
    mods.motor.gruposDe(q, p.id).forEach(function (g) { (sim.opciones[g.id] || []).forEach(function (i) { venta += mods.motor.precioOpcion(g.opciones[i], p, sim.cantidad); }); });
    var a = mods.costeo.analizar(c.costo, venta, datos.factor), faltan = c.partes.filter(function (x) { return x.sinReceta; });
    el.innerHTML = '<table class="ktabla"><thead><tr><th>Parte</th><th class="n">Costo materiales</th></tr></thead><tbody>' + c.partes.map(function (x) {
      return '<tr><td>' + esc(x.concepto) + (x.sinReceta ? ' <small class="kno">sin receta</small>' : '') + '</td><td class="n">' + (x.sinReceta ? '—' : dinero(x.costo)) + '</td></tr>';
    }).join('') + '<tr><td><b>Costo total</b></td><td class="n"><b>' + dinero(c.costo) + '</b></td></tr>' +
      '<tr><td>Precio en el cotizador</td><td class="n"><b>' + dinero(venta) + '</b></td></tr>' +
      '<tr><td>Precio sugerido (' + esc(datos.factor) + '× costo)</td><td class="n">' + dinero(a.sugerido) + '</td></tr>' +
      '<tr><td>Ganancia sobre materiales</td><td class="n ' + (a.cumple === false ? 'kno' : 'kok') + '">' + dinero(a.ganancia) + ' · ' + pct(a.margen_pct) + '</td></tr></tbody></table>' +
      (faltan.length ? '<p class="ayuda kno">Faltan recetas para: ' + esc(faltan.map(function (x) { return x.concepto; }).join(', ')) + '. El costo real será mayor.</p>' :
        a.cumple === false ? '<p class="kno">El precio está ' + dinero(a.sugerido - venta) + ' por debajo del sugerido.</p>' : a.cumple ? '<p class="kok">El precio cubre ' + esc(datos.factor) + '× el costo de materiales.</p>' : '');
  }

  function movimientos() {
    if (!datos.movimientos.length) return '<p class="ayuda">Sin movimientos.</p>';
    var nombres = { compra: 'Compra', consumo: 'Producción', ajuste: 'Ajuste' };
    return '<div class="kscroll"><table class="ktabla"><thead><tr><th>Fecha</th><th>Tipo</th><th>Insumo</th><th class="n">Cantidad</th><th class="n">Costo</th><th>Detalle</th></tr></thead><tbody>' +
      datos.movimientos.map(function (m) {
        return '<tr><td>' + esc(m.fecha.split('-').reverse().join('/')) + '</td><td>' + nombres[m.tipo] + '</td><td>' + esc(m.insumo || '—') + '</td><td class="n">' + cantidadTxt(m.cantidad, m.unidad) + '</td>' +
          '<td class="n">' + dinero(Math.abs(m.costo_total)) + '</td><td><small>' + esc([m.proveedor, m.nota].filter(Boolean).join(' · ')) + '</small></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------------- eventos ---------------- */
  function enlazar() {
    var raiz = app();
    raiz.addEventListener('toggle', function (e) { var d = e.target.closest && e.target.closest('[data-kb]'); if (d) ui.bloques[d.getAttribute('data-kb')] = d.open; }, true);
    raiz.addEventListener('input', alCambiar);
    raiz.addEventListener('change', alCambiar);
    raiz.addEventListener('click', alClic);
  }
  function alCambiar(e) {
    var t = e.target, fila = t.closest('[data-kfila]');
    if (fila && t.hasAttribute('data-kc')) {
      var f = ui.filas[Number(fila.getAttribute('data-kfila'))], k = t.getAttribute('data-kc');
      f[k] = t.value;
      if (k === 'unidad' && e.type === 'change') { f.conv = (CONV[f.unidad] || CONV.unidad)[0][1]; pintar(); }
      return;
    }
    if (t.hasAttribute('data-kr')) {
      ui.receta[t.getAttribute('data-kr')] = t.getAttribute('data-kr') === 'precio_venta' ? cent(t.value) : t.value;
      if (t.getAttribute('data-kr') === 'vinculo' && e.type === 'change') {
        var q = mods.motor.normalizar(datos.cotizador), v = t.value;
        if (v.indexOf('producto:') === 0) { var p = q.productos.filter(function (x) { return x.id === v.slice(9); })[0]; if (p) { ui.receta.rinde = p.cantidad_base; ui.receta.unidad = p.unidad; if (!ui.receta.nombre) ui.receta.nombre = p.nombre + ' (base)'; } }
        pintar(); return;
      }
      calcularEditor(); return;
    }
    var item = t.closest('[data-kitem]');
    if (item && t.hasAttribute('data-ki')) {
      var it = ui.receta.items[Number(item.getAttribute('data-kitem'))], ki = t.getAttribute('data-ki');
      it[ki] = t.value;
      if (ki === 'insumo_id' && e.type === 'change') { var ins = porId()[t.value]; it.conv = ins ? (ins.unidad === 'unidad' ? 1 : 1) : 1; pintar(); return; }
      calcularEditor(); return;
    }
    if (t.hasAttribute('data-ksim') && e.type === 'change') { sim[t.getAttribute('data-ksim')] = t.getAttribute('data-ksim') === 'cantidad' ? Number(t.value) : t.value; if (t.getAttribute('data-ksim') === 'producto') sim.opciones = {}; pintar(); return; }
    if (t.hasAttribute('data-ksimg') && e.type === 'change') {
      var g = t.getAttribute('data-ksimg');
      sim.opciones[g] = Array.prototype.slice.call(app().querySelectorAll('[data-ksimg="' + g + '"]:checked')).map(function (x) { return Number(x.value); });
      calcularSimulador();
    }
  }
  function alClic(e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-kf')) { ui.filtro = b.getAttribute('data-kf'); pintar(); return; }
    if (b.hasAttribute('data-kab')) { ui.abierto = ui.abierto === b.getAttribute('data-kab') ? null : b.getAttribute('data-kab'); pintar(); return; }
    if (b.hasAttribute('data-kcerrar')) { ui.abierto = null; pintar(); return; }
    if (b.hasAttribute('data-kenviar')) { enviarForm(b.closest('[data-kform]')); return; }
    if (b.hasAttribute('data-kdel-ins')) {
      var ins = porId()[b.getAttribute('data-kdel-ins')];
      if (confirm('¿Eliminar «' + ins.nombre + '» y su historial de movimientos?')) accion({ accion: 'insumo_borrar', id: ins.id }, 'Insumo eliminado.').catch(function () {});
      return;
    }
    if (b.hasAttribute('data-kmas')) { for (var n = Number(b.getAttribute('data-kmas')); n > 0; n--) ui.filas.push(filaVacia(ui.filas.length ? ui.filas[ui.filas.length - 1].tipo : '')); pintar(); return; }
    if (b.hasAttribute('data-kquitar')) { ui.filas.splice(Number(b.getAttribute('data-kquitar')), 1); if (!ui.filas.length) ui.filas.push(filaVacia()); pintar(); return; }
    if (b.hasAttribute('data-kalta')) { guardarAlta(); return; }
    if (b.hasAttribute('data-knueva')) { ui.receta = { nombre: '', tipo: '', vinculo: '', rinde: 1, unidad: 'porciones', precio_venta: 0, merma_pct: 0, items: [{ insumo_id: '', cant: '', conv: 1 }] }; ui.bloques['k-rec'] = true; pintar(); return; }
    if (b.hasAttribute('data-keditar')) {
      var r = datos.recetas.filter(function (x) { return x.id === Number(b.getAttribute('data-keditar')); })[0], ids = porId();
      ui.receta = { id: r.id, nombre: r.nombre, tipo: r.tipo, vinculo: r.vinculo, rinde: r.rinde, unidad: r.unidad, precio_venta: r.precio_venta, merma_pct: r.merma_pct, notas: r.notas,
        items: r.items.map(function (it) { var i = ids[it.insumo_id], c = i ? (CONV[i.unidad] || CONV.unidad) : CONV.unidad, big = c[0][1]; var usarBig = big > 1 && it.cantidad >= big && i.unidad !== 'unidad'; return { insumo_id: it.insumo_id, cant: usarBig ? it.cantidad / big : it.cantidad, conv: usarBig ? big : 1 }; }) };
      pintar(); return;
    }
    if (b.hasAttribute('data-kaitem')) { ui.receta.items.push({ insumo_id: '', cant: '', conv: 1 }); pintar(); return; }
    if (b.hasAttribute('data-kqitem')) { ui.receta.items.splice(Number(b.getAttribute('data-kqitem')), 1); pintar(); return; }
    if (b.hasAttribute('data-kcancelar-rec')) { ui.receta = null; pintar(); return; }
    if (b.hasAttribute('data-kguardar-rec')) { accion({ accion: 'receta_guardar', receta: recetaDesdeEditor() }, 'Receta guardada.').then(function () { ui.receta = null; pintar(); }).catch(function () {}); return; }
    if (b.hasAttribute('data-kdel-rec')) {
      var rr = datos.recetas.filter(function (x) { return x.id === Number(b.getAttribute('data-kdel-rec')); })[0];
      if (confirm('¿Eliminar la receta «' + rr.nombre + '»?')) accion({ accion: 'receta_borrar', id: rr.id }, 'Receta eliminada.').catch(function () {});
      return;
    }
    if (b.hasAttribute('data-kproducir')) {
      var rp = datos.recetas.filter(function (x) { return x.id === Number(b.getAttribute('data-kproducir')); })[0];
      var veces = prompt('¿Cuántas veces preparaste «' + rp.nombre + '» (rinde ' + rp.rinde + ' ' + rp.unidad + ')? Se descontarán sus insumos del stock.', '1');
      if (veces && num(veces) > 0) accion({ accion: 'producir', receta_id: rp.id, veces: num(veces) }, 'Producción registrada: stock descontado.').catch(function () {});
      return;
    }
    if (b.hasAttribute('data-kfactor')) { accion({ accion: 'config', factor: num(document.getElementById('k-factor').value) }, 'Factor actualizado.').catch(function () {}); }
  }

  function campo(form, n) { var el = form.querySelector('[name="' + n + '"]'); return el ? el.value : ''; }
  function enviarForm(form) {
    var tipo = form.getAttribute('data-kform'), id = Number(form.getAttribute('data-id')), conv = Number(campo(form, 'conv')) || 1;
    if (tipo === 'compra') {
      var cant = num(campo(form, 'cantidad'));
      if (!(cant > 0) || campo(form, 'costo') === '') { aviso('Indica la cantidad y el costo total de la compra.', true); return; }
      accion({ accion: 'compra', insumo_id: id, cantidad: cant * conv, costo_total: cent(campo(form, 'costo')), proveedor: campo(form, 'proveedor'), fecha: campo(form, 'fecha') }, 'Compra registrada y costo promedio actualizado.')
        .then(function () { ui.abierto = null; pintar(); }).catch(function () {});
    } else if (tipo === 'ajuste') {
      accion({ accion: 'ajuste', insumo_id: id, cantidad: num(campo(form, 'cantidad')) * conv, nota: campo(form, 'nota') }, 'Ajuste guardado.').then(function () { ui.abierto = null; pintar(); }).catch(function () {});
    } else {
      var i = porId()[id];
      accion({ accion: 'insumos_guardar', insumos: [{ id: id, nombre: campo(form, 'nombre'), tipo: campo(form, 'tipo'), unidad: i.unidad, stock_minimo: num(campo(form, 'minimo') || 0) * conv }] }, 'Insumo actualizado.')
        .then(function () { ui.abierto = null; pintar(); }).catch(function () {});
    }
  }
  function guardarAlta() {
    var filas = ui.filas.filter(function (f) { return f.nombre.trim(); });
    if (!filas.length) { aviso('Escribe al menos un insumo.', true); return; }
    var lista = filas.map(function (f) {
      var conv = Number(f.conv) || 1, big = (CONV[f.unidad] || CONV.unidad)[0][1];
      var x = { nombre: f.nombre, tipo: f.tipo, unidad: f.unidad, stock_minimo: (num(f.minimo) || 0) * big };
      if (num(f.cantidad) > 0) x.compra = { cantidad: num(f.cantidad) * conv, costo_total: cent(f.costo), proveedor: f.proveedor };
      return x;
    });
    accion({ accion: 'insumos_guardar', insumos: lista }, lista.length + ' insumo(s) guardado(s).').then(function () { ui.filas = null; pintar(); }).catch(function () {});
  }
})();
