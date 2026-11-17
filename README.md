# ODAITIME

Plataforma SaaS de control de asistencia para México, multiempresa y multisucursal, apegada a la LFT y a la STPS. El stack es 100% open source, sin licencias de pago.

| Capa | Tecnología |
|---|---|
| API | Python 3.13 · FastAPI · SQLAlchemy 2 (async) · Alembic |
| Base de datos | PostgreSQL 17 |
| Caché / colas | Valkey 8 (fork BSD de Redis) |
| Frontend | React 19 · Vite · Tailwind CSS 4 · TypeScript |
| Servidor web / HTTPS | Caddy 2 (certificados Let's Encrypt automáticos) |
| Infraestructura | Docker Compose · GitHub Actions |

## Estructura

```
backend/            API FastAPI, migraciones Alembic, pruebas
frontend/           App React + Caddyfile (sirve el front y hace proxy a /api)
scripts/            setup-server.sh (VPS nuevo) y deploy.sh
docker-compose.yml       Stack completo (staging / producción)
docker-compose.dev.yml   Solo PostgreSQL + Valkey para desarrollo local
```

## Desarrollo local

```bash
# 1. Base de datos y caché
docker compose -f docker-compose.dev.yml up -d

# 2. API  →  http://localhost:8000/api/docs
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload

# 3. Frontend  →  http://localhost:5173
cd frontend
npm install
npm run dev
```

Pruebas y lint: `cd backend && pytest && ruff check . && ruff format --check .`

## Servidor de pruebas (staging)

### Primera vez en el VPS

```bash
curl -fsSL https://raw.githubusercontent.com/odaimx/OdaiTime/main/scripts/setup-server.sh | sudo bash
```

El script instala Docker, configura el firewall (22, 80 y 443) y fail2ban, crea el usuario `deploy` y clona el repo en `/opt/odaitime`. Después:

```bash
sudo -u deploy cp /opt/odaitime/.env.example /opt/odaitime/.env
sudo -u deploy nano /opt/odaitime/.env      # contraseñas, SECRET_KEY, DOMAIN
sudo -u deploy /opt/odaitime/scripts/deploy.sh
```

Revisa que todo responda en `http://IP-DEL-SERVIDOR/api/health/ready`.

### Crear el primer superadmin

```bash
cd /opt/odaitime
sudo -u deploy docker compose exec api python -m app.cli crear-superadmin --email tu@odai.mx --nombre "Tu Nombre"
```

Con ese usuario entras a la web y das de alta empresas. Cada empresa nace con su administrador.

### Despliegue automático

Cada push a `main` que pasa el CI se despliega solo en staging. Configura esto en **GitHub → Settings → Environments → `staging`**:

| Secreto | Valor |
|---|---|
| `STAGING_HOST` | IP o dominio del VPS |
| `STAGING_USER` | `deploy` |
| `STAGING_SSH_KEY` | Llave privada; su llave pública va en `/home/deploy/.ssh/authorized_keys` |
| `STAGING_PORT` | Opcional, si SSH no usa el puerto 22 |

## Roles

| Rol | Alcance |
|---|---|
| `superadmin` | Operador del SaaS (Odai): administra empresas y puede operar sobre cualquiera |
| `admin_empresa` | Toda su empresa: sucursales y usuarios |
| `gerente_sucursal` | Solo las sucursales que tiene asignadas |
| `empleado` | Lo propio (checadas en etapas siguientes) |

Todas las consultas se filtran por empresa en el servidor. Un recurso de otra empresa responde 404.

## Checadas

| Forma | Cómo |
|---|---|
| Celular | El empleado (con acceso a la app) entra a su subdominio → **Checar**. Se valida GPS, foto o QR según la configuración. |
| Kiosco | En **Config. checadas › Dispositivos › Agregar** se obtiene un código de 6 dígitos; en la tablet se abre `https://<empresa>.odai.lat/kiosco` y se escribe el código. El kiosco muestra un QR que cambia cada 30 s y un teclado para número + PIN. |
| QR | El empleado apunta la cámara normal de su teléfono al QR del kiosco; se abre `/checar?qr=…` y registra en la sucursal del kiosco. |
| Biométrico | `POST /api/biometrico/registros` con el token del dispositivo (tipo `biometrico`). Preparado; la conexión con cada modelo se configura al final. |
| Manual | Un administrador o gerente la registra en **Checadas**, con motivo obligatorio. |

- GPS y cámara requieren **HTTPS** (no funcionan por `http://IP`).
- Sin internet, el celular guarda la checada con su hora y la envía al reconectar (si la empresa lo permite).
- Las fotos se guardan en el volumen `fotos` (`/app/data/fotos`).
- Cada cambio queda en el **historial** (bitácora tipo Odoo) del registro, con quién, cuándo, valor anterior y nuevo.

## Convenciones

- Todas las fechas se guardan en UTC (`timestamptz`). La zona horaria se aplica por sucursal.
- Las migraciones se aplican solas al arrancar la API (`alembic upgrade head`).
- Los cambios entran por Pull Request y el CI debe pasar antes de fusionar.
