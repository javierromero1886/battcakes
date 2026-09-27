# battcakes.com — Guía de despliegue (paquete legal y de seguridad)

Este paquete agrega a la web actual las páginas legales, el Libro de Reclamaciones virtual y las mejoras de seguridad. Todo corre en tu stack actual (GitHub → Cloudflare Pages), sin mensualidades.

## 1. Qué contiene

| Archivo | Qué es |
|---|---|
| `index.html` | Tu página actual con: pie de página legal (titular, RUC, IGV, enlaces), aviso en el cotizador, 72 h de anticipación, nota de IGV y alérgenos, leyendas neutras en la galería, íconos SVG propios (ya no carga Font Awesome desde un CDN) y correcciones menores de JS. |
| `terminos.html` | Términos y Condiciones de pedido. |
| `privacidad.html` | Política de Privacidad y Cookies. |
| `libro-de-reclamaciones.html` | Libro de Reclamaciones virtual (formulario + hoja imprimible). |
| `admin-reclamaciones.html` | Panel privado para ver y responder hojas (protegido con clave). |
| `legal.css` | Estilos de las páginas legales (modo claro/oscuro). |
| `functions/api/reclamaciones.js` | Función de Cloudflare Pages: registra hojas en D1 y envía copias por correo. |
| `functions/api/admin.js` | Función del panel: lista hojas y guarda/envía la respuesta. |
| `schema.sql` | Estructura de la base de datos D1 (se ejecuta una sola vez). Incluye el trigger que asigna el número correlativo de cada hoja. |
| `consent.js` | Aviso de cookies (Aceptar/Rechazar) + etiqueta de Google Ads `AW-18477119821` con Consent Mode v2. La etiqueta solo se carga si el visitante acepta; registra como conversión cada clic en WhatsApp. |
| `_headers` | Cabeceras de seguridad (CSP, HSTS, etc.), ya con los dominios de Google Ads permitidos. |
| `robots.txt`, `sitemap.xml` | Indexación (el panel y la API quedan excluidos). |
| `wrangler.toml.example` | Opcional, solo si prefieres declarar la base D1 desde el repo. |

Las páginas usan URLs limpias (`/terminos`, `/privacidad`, `/libro-de-reclamaciones`): Cloudflare Pages las sirve así automáticamente.

## 2. Subir los archivos al repo

1. Copia todos los archivos del paquete a la raíz del repositorio (donde está tu `index.html`), respetando la carpeta `functions/api/`. Reemplaza el `index.html` anterior.
2. Verifica que sigan existiendo `img/` y los favicons que ya tenías (`img/favicon-32.png`, `img/favicon-192.png`, `img/apple-touch-icon.png`).
3. Haz commit y push. Cloudflare Pages desplegará solo. Las páginas legales ya funcionarán; el Libro de Reclamaciones necesita los pasos 3 a 5.

## 3. Crear la base de datos D1 (una sola vez)

En el panel de Cloudflare:

1. **Workers & Pages → D1 SQL Database → Create database**. Nombre: `battcakes-reclamaciones`.
2. Abre la base → pestaña **Console** → pega el contenido de `schema.sql` y ejecútalo. (Si ya habías ejecutado una versión anterior del archivo, ejecuta además `ALTER TABLE reclamaciones ADD COLUMN canal_respuesta TEXT NOT NULL DEFAULT 'correo';` y vuelve a pegar el bloque `CREATE TRIGGER`.)
3. Ve a tu proyecto de Pages → **Settings → Functions → D1 database bindings → Add binding**:
   - Variable name: `DB`
   - D1 database: `battcakes-reclamaciones`
   - Guarda para *Production* (y también para *Preview* si usas previsualizaciones).

Alternativa por terminal (si tienes Node instalado):
```
npx wrangler login
npx wrangler d1 create battcakes-reclamaciones
npx wrangler d1 execute battcakes-reclamaciones --remote --file=schema.sql
```

## 4. Variables de entorno (Pages → Settings → Environment variables)

| Variable | Obligatoria | Valor |
|---|---|---|
| `ADMIN_KEY` | Sí | Una contraseña larga (20+ caracteres) que solo conozca el negocio. Es la clave del panel `admin-reclamaciones`. Márcala como *Secret*. |
| `RESEND_API_KEY` | Recomendada | Clave de Resend (paso 5) para enviar copias por correo. Sin ella, la hoja se registra igual y el consumidor la puede imprimir, pero no recibe correo. *Secret*. |
| `MAIL_FROM` | Recomendada | `Battcakes <reclamaciones@battcakes.com>` (el dominio debe estar verificado en Resend). |
| `MAIL_TO` | Opcional | Correo que recibe cada hoja nueva. Por defecto `contacto@battcakes.com`. |
| `TURNSTILE_SECRET_KEY` | Opcional | Clave secreta de Cloudflare Turnstile (antispam). Si la configuras, pon también la *site key* en `libro-de-reclamaciones.html` (atributo `data-sitekey` del `div#turnstile-wrap`). |

Después de agregar variables, vuelve a desplegar (Deployments → Retry deployment) para que las tomen las funciones.

## 5. Correo con Resend (gratis hasta 3 000 correos/mes)

1. Crea una cuenta en https://resend.com y agrega el dominio `battcakes.com` (**Domains → Add domain**).
2. Resend te dará 2–3 registros DNS (DKIM y SPF). Agrégalos en Cloudflare → DNS de battcakes.com. Espera a que Resend marque el dominio como *Verified*.
3. **API Keys → Create API key** (permiso *Sending access*). Copia la clave en `RESEND_API_KEY`.
4. Prueba: registra un reclamo de prueba en `/libro-de-reclamaciones` con tu propio correo. Debes recibir la copia y, en `MAIL_TO`, el aviso.

## 6. Cómo atender un reclamo (flujo diario)

1. Llega un correo "[Libro de Reclamaciones] Nueva hoja N.° 2026-000001".
2. Entra a `https://battcakes.com/admin-reclamaciones`, escribe la `ADMIN_KEY` y pulsa **Cargar hojas**.
3. Abre la hoja, escribe la respuesta formal y pulsa **Guardar respuesta**. La respuesta queda registrada en la hoja (sección 4) y, si dejas marcada la casilla, se envía al correo del consumidor. Si el consumidor pidió respuesta por **WhatsApp o llamada**, respóndele también por ese medio (la ley exige responder por el medio que eligió) y guarda igualmente la respuesta en el panel para que conste en la hoja.
4. Plazo legal: **máximo 15 días hábiles** desde el registro. El panel muestra los días hábiles transcurridos.
5. Conserva las hojas al menos **2 años** (quedan en D1; no las borres). Con el botón **Descargar CSV** del panel obtienes un respaldo completo del libro (ábrelo en Excel); guárdalo de vez en cuando en un lugar seguro.
6. Cada IP puede registrar como máximo 5 hojas por día; para más protección, en Cloudflare → Security → WAF → Rate limiting rules puedes crear una regla gratuita para `/api/*` (por ejemplo, 10 peticiones por minuto).

## 7. Google Ads (etiqueta AW-18477119821) y aviso de cookies

La etiqueta de Google ya está integrada en `consent.js` en todas las páginas, pero **no se carga hasta que el visitante acepta** el aviso de cookies (consentimiento previo, como exige el Reglamento de la Ley 29733). Al aceptar, se activa Consent Mode v2 con `ad_storage`, `ad_user_data` y `ad_personalization` en `granted` y se carga `gtag.js`. Al rechazar, no se carga nada y se borran las cookies `_gcl_*` que existan. El visitante puede cambiar su decisión desde "Preferencias de cookies" en el pie de página; la elección se guarda 6 meses.

Para medir conversiones (clics en WhatsApp):
1. En Google Ads → **Objetivos → Conversiones → Nueva acción de conversión → Sitio web**, crea una acción manual del tipo "Contacto" llamada, por ejemplo, *Contacto por WhatsApp* (categoría Contacto, valor opcional, recuento "Una").
2. En "Configurar etiqueta manualmente" verás `send_to: 'AW-18477119821/XXXXXXXXXXXX'`. Copia solo la parte posterior a la barra.
3. Pégala en `consent.js`, en la constante `CONVERSION_LABEL = ''`. Desde ese momento cada clic en un enlace o botón de WhatsApp envía la conversión (solo para visitantes que aceptaron cookies).
4. El botón "Probar instalación" de Google Ads solo dará verde si tú aceptas las cookies en tu propia visita (así funciona el consentimiento previo). Es normal.

**Cloudflare Web Analytics** (sin cookies) puede seguir activo en Pages → **Metrics / Web Analytics → Enable**; no requiere consentimiento y ya está declarado en la política. No agregues Google Analytics, Meta Pixel u otras herramientas sin sumarlas primero al aviso de cookies y a la Política de Privacidad.

## 8. Seguridad del dominio y cuentas (una vez)

- Cloudflare → SSL/TLS: **Always Use HTTPS** activado, **Minimum TLS 1.2**, HSTS habilitado (Edge Certificates → HSTS).
- Cloudflare → Security: **Bot Fight Mode** activado. Scrape Shield → **Email Address Obfuscation** activado.
- Cloudflare → DNS: activar **DNSSEC**. Registros de correo para evitar suplantación:
  - Si envías correo con Resend/Google: usa los SPF/DKIM que te den y agrega `_dmarc` TXT: `v=DMARC1; p=quarantine; rua=mailto:contacto@battcakes.com`.
  - Si el dominio no envía correo: TXT `@` = `v=spf1 -all` y `_dmarc` TXT = `v=DMARC1; p=reject`.
- GoDaddy: auto-renovación del dominio, bloqueo de transferencia, privacidad WHOIS y 2FA.
- 2FA en Cloudflare, GitHub, Meta Business, TikTok y Google. WhatsApp Business con verificación en dos pasos.

## 9. Datos que conviene completar cuando los tengas

- **Domicilio fiscal completo** (calle y número en Breña): hoy las páginas muestran "Breña, Lima, Perú". El Reglamento del Libro de Reclamaciones pide la dirección del establecimiento en el aviso y en la hoja; cuando quieras mostrar la dirección exacta, reemplázala en `terminos.html`, `privacidad.html`, `libro-de-reclamaciones.html`, `index.html` (pie de página) y en la constante `PROVEEDOR` de `functions/api/reclamaciones.js`.
- **Código de inscripción del banco de datos** ante la ANPDP: cuando lo obtengas, agrégalo en la sección 1 de `privacidad.html` ("Somos el titular del banco de datos personales «Clientes», inscrito con el código RNPDP-…").

## 10. Pendientes fuera de la web

- Inscribir el banco de datos "Clientes" en el Registro Nacional de Protección de Datos Personales (ANPDP – MINJUSDH), declarando el flujo transfronterizo (WhatsApp/Meta, Cloudflare, Resend).
- Registrar la marca **Battcakes** en INDECOPI (clase 30).
- Enviar las fotos de la galería con logos de equipos o marcas para difuminarlos (las leyendas ya se cambiaron a "temática de fútbol" / "temática de estadio").
- Revisar el texto final del nuevo Reglamento del Libro de Reclamaciones (PCM, en consulta pública desde julio 2026) por si añade campos.

## 11. Probar en local (opcional)

```
npm install -g wrangler
cp wrangler.toml.example wrangler.toml     # y pon cualquier database_id para pruebas locales
echo "ADMIN_KEY=clave-de-prueba" > .dev.vars
npx wrangler d1 execute battcakes-reclamaciones --local --file=schema.sql
npx wrangler pages dev . --port 8788
```
Abre http://127.0.0.1:8788/libro-de-reclamaciones. Borra `wrangler.toml` y `.dev.vars` antes de subir al repo (o agrégalos a `.gitignore`).
