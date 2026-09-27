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
  email_enviado INTEGER NOT NULL DEFAULT 0
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
