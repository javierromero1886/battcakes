-- Libro de Reclamaciones virtual — Battcakes
-- Ejecutar una vez en la base D1 (ver README-despliegue.md)
CREATE TABLE IF NOT EXISTS reclamaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT UNIQUE,
  codigo TEXT NOT NULL,
  creado_en TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('reclamo','queja')),
  nombre TEXT NOT NULL,
  doc_tipo TEXT NOT NULL,
  doc_numero TEXT NOT NULL,
  domicilio TEXT NOT NULL,
  telefono TEXT,
  email TEXT NOT NULL,
  canal_respuesta TEXT NOT NULL DEFAULT 'correo',
  menor INTEGER NOT NULL DEFAULT 0,
  apoderado TEXT,
  bien_tipo TEXT NOT NULL CHECK (bien_tipo IN ('producto','servicio')),
  bien_descripcion TEXT NOT NULL,
  monto REAL,
  detalle TEXT NOT NULL,
  pedido TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  respuesta TEXT,
  respondido_en TEXT,
  email_enviado INTEGER NOT NULL DEFAULT 0,
  respuesta_email_enviado INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_reclamaciones_numero ON reclamaciones (numero);
CREATE INDEX IF NOT EXISTS idx_reclamaciones_estado ON reclamaciones (estado);
CREATE INDEX IF NOT EXISTS idx_reclamaciones_ip ON reclamaciones (ip_hash);

-- Numeración correlativa asignada por la propia base de datos (atómica): AAAA-000001
CREATE TRIGGER IF NOT EXISTS trg_reclamaciones_numero AFTER INSERT ON reclamaciones
BEGIN
  UPDATE reclamaciones
     SET numero = substr(NEW.creado_en, 1, 4) || '-' || printf('%06d', NEW.id)
   WHERE id = NEW.id AND numero IS NULL;
END;

-- Si ya habías ejecutado una versión anterior de este archivo, ejecuta además:
--   ALTER TABLE reclamaciones ADD COLUMN canal_respuesta TEXT NOT NULL DEFAULT 'correo';
--   ALTER TABLE reclamaciones ADD COLUMN respuesta_email_enviado INTEGER NOT NULL DEFAULT 0;
-- (si alguna responde "duplicate column name", esa columna ya existía: ignora el aviso)

-- Contenido editable del sitio desde el panel /admin (productos, galería, contacto). Un registro JSON por sección.
CREATE TABLE IF NOT EXISTS contenido (
  seccion TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

-- Cotizaciones del cotizador automático (sin datos personales). El código va en el mensaje de WhatsApp.
CREATE TABLE IF NOT EXISTS cotizaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  creado_en TEXT NOT NULL,
  detalle TEXT NOT NULL,
  total INTEGER NOT NULL,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_ip ON cotizaciones (ip_hash);

-- ===== Costos e inventario (solo panel /admin; nunca se publica) =====
-- Insumos: stock en la unidad base (g, ml o unidad) y costo promedio ponderado en céntimos por unidad base
-- (fraccionario: S/ 4.50 el kg de harina = 0.45 céntimos por g). Los totales se redondean a céntimos enteros.
CREATE TABLE IF NOT EXISTS insumos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL,
  unidad TEXT NOT NULL CHECK (unidad IN ('g','ml','unidad')),
  stock REAL NOT NULL DEFAULT 0,
  stock_minimo REAL NOT NULL DEFAULT 0,
  costo_promedio REAL NOT NULL DEFAULT 0,
  actualizado_en TEXT NOT NULL
);
-- Movimientos de inventario: compra (suma stock y recalcula el promedio), consumo (producción) y ajuste (+/-).
CREATE TABLE IF NOT EXISTS movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insumo_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('compra','consumo','ajuste')),
  cantidad REAL NOT NULL,
  costo_total INTEGER NOT NULL DEFAULT 0,
  costo_unitario REAL NOT NULL DEFAULT 0,
  proveedor TEXT,
  nota TEXT,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movimientos_insumo ON movimientos (insumo_id);
-- Recetas: insumos por "rinde" (p. ej. 20 porciones). vinculo = 'producto:<id>' u 'opcion:<grupo>:<nombre>' del cotizador,
-- o vacío con precio_venta manual. items = JSON [{ insumo_id, cantidad }].
CREATE TABLE IF NOT EXISTS recetas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  vinculo TEXT NOT NULL DEFAULT '',
  rinde REAL NOT NULL DEFAULT 1,
  unidad TEXT NOT NULL DEFAULT 'porciones',
  precio_venta INTEGER NOT NULL DEFAULT 0,
  merma_pct REAL NOT NULL DEFAULT 0,
  items TEXT NOT NULL DEFAULT '[]',
  notas TEXT,
  actualizado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS costos_config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
