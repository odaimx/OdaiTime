import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.core.tenant import slugify, tenant_de_host
from app.main import app
from tests.conftest import PASSWORD, crear_empresa

BASE = "odai.test"
ADMIN = f"time.{BASE}"


@pytest.fixture
def con_dominio():
    s = get_settings()
    anterior = (s.base_domain, s.admin_host, s.subdominios_reservados)
    s.base_domain, s.admin_host, s.subdominios_reservados = BASE, ADMIN, "intranet"
    yield
    s.base_domain, s.admin_host, s.subdominios_reservados = anterior


def en(host: str) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url=f"http://{host}")


def test_slugify_y_hosts(con_dominio):
    assert slugify("Hotel Caribe Cancún, S.A. de C.V.") == "hotel-caribe-cancun-s-a-de-c-v"
    assert slugify("Ñu") == "nu-empresa"
    assert slugify("Admin") == "admin-mx"
    assert slugify("Intranet") == "intranet-mx"  # reservado por configuración
    assert tenant_de_host(ADMIN).modo == "base"
    assert tenant_de_host(f"caribe.{BASE}:443").slug == "caribe"
    assert tenant_de_host(BASE).modo == "libre"  # el sitio web de Odai, no es de ningún cliente
    assert tenant_de_host(f"www.{BASE}").modo == "libre"
    assert tenant_de_host("148.113.237.99").modo == "libre"
    assert tenant_de_host(f"a.b.{BASE}").modo == "libre"


async def test_slug_automatico_y_unico(client, superadmin):
    e1 = await crear_empresa(client, superadmin, "Caribe", "a@caribe.mx")
    e2 = await crear_empresa(client, superadmin, "Caribe", "b@caribe.mx")
    assert (e1["slug"], e2["slug"]) == ("empresa-caribe", "empresa-caribe-2")

    r = await client.patch(f"/api/empresas/{e1['id']}", headers=superadmin, json={"slug": "caribe"})
    assert r.json()["slug"] == "caribe"
    r = await client.patch(f"/api/empresas/{e2['id']}", headers=superadmin, json={"slug": "caribe"})
    assert r.status_code == 409
    r = await client.patch(f"/api/empresas/{e2['id']}", headers=superadmin, json={"slug": "api"})
    assert r.status_code == 422


async def test_login_ligado_al_subdominio(client, superadmin, con_dominio):
    a = await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    b = await crear_empresa(client, superadmin, "Sol", "admin@sol.mx")
    cred = {"email": "admin@caribe.mx", "password": PASSWORD}

    async with en(f"{a['slug']}.{BASE}") as c:
        info = (await c.get("/api/tenant")).json()
        assert info == {
            "modo": "tenant",
            "nombre": "Empresa Caribe",
            "slug": a["slug"],
            "dominio": BASE,
            "empresa_id": a["id"],
            "logo_version": None,
        }
        r = await c.post("/api/auth/login", json=cred)
        assert r.status_code == 200
        token = r.json()["access_token"]
        refresh = r.json()["refresh_token"]

    # En el subdominio de otra empresa: credenciales "incorrectas" y el token no sirve.
    async with en(f"{b['slug']}.{BASE}") as c:
        assert (await c.post("/api/auth/login", json=cred)).status_code == 401
        r = await c.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401
        r = await c.post("/api/auth/refresh", json={"refresh_token": refresh})
        assert r.status_code == 401

    # En el panel de Odai: se le indica su dirección.
    async with en(ADMIN) as c:
        assert (await c.get("/api/tenant")).json()["modo"] == "base"
        r = await c.post("/api/auth/login", json=cred)
        assert r.status_code == 409
        assert r.json()["detail"]["url"] == f"https://{a['slug']}.{BASE}"
        # El superadmin sí entra por el dominio base y por cualquier subdominio.
        su = {"email": "root@odai.mx", "password": PASSWORD}
        assert (await c.post("/api/auth/login", json=su)).status_code == 200
    async with en(f"{a['slug']}.{BASE}") as c:
        assert (await c.post("/api/auth/login", json=su)).status_code == 200

    # Subdominio inexistente.
    async with en(f"nadie.{BASE}") as c:
        assert (await c.get("/api/tenant")).status_code == 404
        assert (await c.post("/api/auth/login", json=cred)).status_code == 404


async def test_ask_de_certificados(client, superadmin, con_dominio):
    a = await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    ask = "/api/tenant/permitido"
    assert (await client.get(ask, params={"domain": ADMIN})).status_code == 200
    assert (await client.get(ask, params={"domain": BASE})).status_code == 404
    assert (await client.get(ask, params={"domain": f"www.{BASE}"})).status_code == 404
    assert (await client.get(ask, params={"domain": f"{a['slug']}.{BASE}"})).status_code == 200
    assert (await client.get(ask, params={"domain": f"x.{BASE}"})).status_code == 404
    assert (await client.get(ask, params={"domain": "evil.com"})).status_code == 404
