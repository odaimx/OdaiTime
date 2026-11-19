# Integración de licencias: Odoo (odai.lat) → ODAITIME

El módulo de licencias de Odoo crea las empresas y les asigna o renueva su licencia en
ODAITIME llamando a una API firmada.

## 1. Cómo se reconoce la empresa

Por su **subdominio (`slug`)**: es la parte izquierda de su dirección. `hotelmar.odai.lat` →
`hotelmar`.

- Es único y no cambia, así que es la llave entre Odoo y ODAITIME.
- En Odoo, guárdalo en un campo de la suscripción o del cliente, por ejemplo `x_odaitime_slug`.
- Reglas: de 3 a 40 caracteres, solo minúsculas, números y guiones.
- Hay subdominios reservados (`www`, `app`, `admin`, etc.).
- `referencia_odoo` sirve para guardar el folio de la suscripción o factura y ver en ODAITIME
  de dónde salió la licencia.

## 2. Acceso al servidor

| Dato | Valor |
|---|---|
| URL base | `https://time.odai.lat/api/integracion` (dominio del panel de Odai; cualquier dominio del servidor funciona) |
| Autenticación | Firma HMAC-SHA256 con un secreto compartido. El secreto nunca viaja en la petición. |
| Secreto | Variable `INTEGRACION_SECRETO` en el `.env` del servidor de ODAITIME y el mismo valor en Odoo (parámetro del sistema). Mínimo 32 caracteres. |
| IPs permitidas | `INTEGRACION_IPS` (opcional, recomendado): IP pública del servidor de Odoo. |

Generar el secreto (una vez) y activarlo:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
# en el servidor de ODAITIME:
cd /opt/odaitime
echo 'INTEGRACION_SECRETO=<el secreto>' | sudo tee -a .env > /dev/null
echo 'INTEGRACION_IPS=<IP de odai.lat>' | sudo tee -a .env > /dev/null
sudo docker compose up -d api
```

### Firma de cada petición

Encabezados obligatorios:

| Encabezado | Contenido |
|---|---|
| `X-Odai-Timestamp` | Segundos Unix actuales. Se aceptan ±5 minutos, así que el reloj debe estar sincronizado (NTP). |
| `X-Odai-Nonce` | Texto aleatorio único por petición (16 a 64 caracteres). No se acepta dos veces. |
| `X-Odai-Firma` | `hex(HMAC_SHA256(secreto, mensaje))` |

El `mensaje` son cinco líneas unidas con `\n`:

```
<timestamp>
<nonce>
<MÉTODO en mayúsculas>
<ruta, p. ej. /api/integracion/empresas/hotelmar>
<sha256 en hex del cuerpo exacto que se envía (vacío para GET)>
```

### Ejemplo en Python (Odoo)

```python
import hashlib, hmac, json, secrets, time
import requests

BASE = "https://time.odai.lat"
SECRETO = env["ir.config_parameter"].sudo().get_param("odaitime.secreto")

def odaitime(metodo, ruta, datos=None):
    cuerpo = json.dumps(datos).encode() if datos is not None else b""
    ts, nonce = str(int(time.time())), secrets.token_hex(16)
    mensaje = "\n".join([ts, nonce, metodo, ruta, hashlib.sha256(cuerpo).hexdigest()])
    firma = hmac.new(SECRETO.encode(), mensaje.encode(), hashlib.sha256).hexdigest()
    r = requests.request(
        metodo, BASE + ruta, data=cuerpo or None, timeout=20,
        headers={"Content-Type": "application/json", "X-Odai-Timestamp": ts,
                 "X-Odai-Nonce": nonce, "X-Odai-Firma": firma},
    )
    r.raise_for_status()
    return r.json()

odaitime("GET", "/api/integracion/ping")                      # probar la firma
odaitime("PUT", "/api/integracion/empresas/hotelmar", {...})   # asignar o renovar licencia
```

## 3. Endpoints

| Método | Ruta | Para qué |
|---|---|---|
| `GET` | `/api/integracion/ping` | Probar el acceso y la firma |
| `GET` | `/api/integracion/empresas/{slug}` | Consultar la licencia y el estado actuales |
| `PUT` | `/api/integracion/empresas/{slug}` | Crear la empresa (si no existe) o actualizar su licencia o estado |

El `PUT` es idempotente: puede repetirse con los mismos datos. Solo cambia los campos que se
envían.

## 4. Campos que graba Odoo en cada empresa

| Campo | Tipo | Notas |
|---|---|---|
| `nombre` | texto | **Obligatorio al crear.** Nombre comercial. |
| `razon_social` | texto | Opcional. |
| `rfc` | texto | Opcional; único entre empresas. |
| `max_empleados` | entero | Empleados activos permitidos. |
| `max_usuarios` | entero | Usuarios que su administrador puede dar de alta. No cuentan el administrador ni los empleados con portal. Por omisión, 5. |
| `licencia_vence` | fecha `YYYY-MM-DD` | Al pasar esta fecha la empresa ya no puede entrar y se le dice que la licencia venció. `null` = sin vencimiento. |
| `periodicidad` | `mensual` · `bimestral` · `trimestral` · `semestral` · `anual` | Cómo se cobra la renta. |
| `estado` | `corriendo` · `suspendida` · `eliminada` | `suspendida`: nadie de la empresa entra (usuarios, portal ni checadores) y se le muestra el motivo. `eliminada`: igual, y sus datos se purgan pasados `RETENCION_DIAS` (90 por omisión). |
| `motivo_suspension` | texto (300) | Se le muestra a la empresa al intentar entrar. Se borra al volver a `corriendo`. |
| `demo` | booleano | Empresa de prueba: el pie de página muestra "Licencia demo". |
| `referencia_odoo` | texto (100) | Folio de la suscripción o factura. |
| `administrador` | `{ "nombre", "email" }` | **Solo al crear.** Se crea el único administrador de la empresa y se le manda por correo el enlace para crear su contraseña. Si no hay correo saliente, la respuesta trae `enlace_administrador` para mandarlo a mano. |

### Respuesta

```json
{
  "slug": "hotelmar", "url": "https://hotelmar.odai.lat", "nombre": "Hotel Mar",
  "estado": "corriendo", "motivo_suspension": null,
  "max_empleados": 40, "max_usuarios": 5, "empleados_activos": 12,
  "licencia_vence": "2027-01-31", "periodicidad": "mensual",
  "demo": false, "referencia_odoo": "SUB-0042",
  "bloqueada": false, "mensaje_bloqueo": null,
  "creada": false, "enlace_administrador": null
}
```

## 5. Flujos típicos

**Venta nueva (prueba de 15 días):**

```json
PUT /api/integracion/empresas/hotelmar
{ "nombre": "Hotel Mar", "max_empleados": 20, "licencia_vence": "2026-12-03",
  "demo": true, "administrador": { "nombre": "Lucía Mar", "email": "lucia@hotelmar.mx" } }
```

**Pasa a producción al facturar:**

```json
PUT /api/integracion/empresas/hotelmar
{ "demo": false, "max_empleados": 40, "licencia_vence": "2027-01-31",
  "periodicidad": "mensual", "referencia_odoo": "SUB-0042" }
```

**Renovación pagada:** `{ "licencia_vence": "2027-02-28", "estado": "corriendo" }`

**Falta de pago:** `{ "estado": "suspendida", "motivo_suspension": "Pago pendiente de noviembre" }`

**Cancelación:** `{ "estado": "eliminada", "motivo_suspension": "Cancelación del servicio" }`

## 6. Errores

| Código | Significado |
|---|---|
| 401 | Firma inválida, petición vencida (reloj desfasado) o nonce repetido |
| 403 | IP no permitida |
| 404 | `GET` de una empresa que no existe |
| 409 | RFC o correo del administrador ya usados |
| 422 | Datos inválidos (p. ej. falta `nombre` al crear o el subdominio no es válido) |
| 503 | Integración no configurada (`INTEGRACION_SECRETO` vacío) |

## 7. Purga de empresas eliminadas

En el servidor, un cron diario borra definitivamente las empresas que llevan más de
`RETENCION_DIAS` eliminadas:

```bash
# crontab -e  (todos los días a las 3:15)
15 3 * * * cd /opt/odaitime && docker compose exec -T api python -m app.purgar
```
