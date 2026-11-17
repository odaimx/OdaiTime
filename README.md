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

### Despliegue automático

Cada push a `main` que pasa el CI se despliega solo en staging. Configura estos secretos en **GitHub → Settings → Secrets and variables → Actions → New repository secret**:

| Secreto | Valor |
|---|---|
| `STAGING_HOST` | IP o dominio del VPS |
| `STAGING_USER` | `deploy` |
| `STAGING_SSH_KEY` | Llave privada; su llave pública va en `/home/deploy/.ssh/authorized_keys` |
| `STAGING_PORT` | Opcional, si SSH no usa el puerto 22 |

## Convenciones

- Todas las fechas se guardan en UTC (`timestamptz`). La zona horaria se aplica por sucursal.
- Las migraciones se aplican solas al arrancar la API (`alembic upgrade head`).
- Los cambios entran por Pull Request y el CI debe pasar antes de fusionar.
