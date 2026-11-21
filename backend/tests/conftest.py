"""Las pruebas usan la base de datos real de DATABASE_URL (en CI, el servicio de Postgres
con las migraciones aplicadas). Cada prueba empieza con las tablas vacías."""

import tempfile

import pytest
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis
from sqlalchemy import text

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.main import app
from app.models import Rol, Usuario

PASSWORD = "Secreta123!"

# Las fotos de las pruebas van a una carpeta temporal.
get_settings().fotos_dir = tempfile.mkdtemp(prefix="odaitime-fotos-")


@pytest.fixture(autouse=True)
async def limpiar_bd():
    async with SessionLocal() as db:
        await db.execute(
            text(
                "TRUNCATE config_sistema, tokens_acceso, categoria_registros, categorias, "
                "config_correo, config_whatsapp, "
                "tareas, claves_nomina, festivo_designados, empresa_festivos, "
                "solicitudes_vacaciones, incidencias, "
                "politica_asistencia, "
                "actividades, passkeys_celular, celulares_vinculados, avisos_aceptados, "
                "checadas, "
                "asignaciones_obra, obras, "
                "dispositivos, config_checadas, "
                "asignaciones_turno, empleados, turno_dias, turnos, sesiones, "
                "usuario_sucursales, usuarios, sucursales, empresas CASCADE"
            )
        )
        await db.commit()
    async with Redis.from_url(get_settings().redis_url) as r:
        await r.flushdb()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def crear_superadmin(email: str = "root@odai.mx") -> None:
    async with SessionLocal() as db:
        db.add(
            Usuario(
                email=email,
                nombre="Root",
                password_hash=hash_password(PASSWORD),
                rol=Rol.SUPERADMIN,
            )
        )
        await db.commit()


async def login(client: AsyncClient, email: str, password: str = PASSWORD) -> dict:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def auth(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.fixture
async def superadmin(client) -> dict:
    await crear_superadmin()
    return auth(await login(client, "root@odai.mx"))


async def crear_empresa(client, sa_headers, nombre: str, admin_email: str) -> dict:
    r = await client.post(
        "/api/empresas",
        headers=sa_headers,
        json={
            "nombre": f"Empresa {nombre}",
            "admin": {"nombre": f"Admin {nombre}", "email": admin_email, "password": PASSWORD},
        },
    )
    assert r.status_code == 201, r.text
    return r.json()
