from tests.conftest import PASSWORD, auth, crear_empresa, login


async def test_superadmin_crea_empresa_con_admin(client, superadmin):
    empresa = await crear_empresa(client, superadmin, "Hotel Caribe", "admin@caribe.mx")
    assert empresa["activa"] is True

    admin = await login(client, "admin@caribe.mx")
    assert admin["usuario"]["rol"] == "admin_empresa"
    assert admin["usuario"]["empresa"]["id"] == empresa["id"]


async def test_rfc_invalido_y_duplicado(client, superadmin):
    base = {"nombre": "X", "admin": {"nombre": "A B", "email": "a@x.mx", "password": PASSWORD}}
    r = await client.post("/api/empresas", headers=superadmin, json={**base, "rfc": "NOPE"})
    assert r.status_code == 422

    r = await client.post("/api/empresas", headers=superadmin, json={**base, "rfc": "abc010101ab1"})
    assert r.status_code == 201
    assert r.json()["rfc"] == "ABC010101AB1"

    otra = {**base, "rfc": "ABC010101AB1", "admin": {**base["admin"], "email": "b@x.mx"}}
    r = await client.post("/api/empresas", headers=superadmin, json=otra)
    assert r.status_code == 409


async def test_admin_no_puede_administrar_empresas(client, superadmin):
    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    admin = auth(await login(client, "admin@caribe.mx"))
    assert (await client.get("/api/empresas", headers=admin)).status_code == 403


async def test_empresa_desactivada_bloquea_acceso(client, superadmin):
    empresa = await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    admin = await login(client, "admin@caribe.mx")

    r = await client.patch(
        f"/api/empresas/{empresa['id']}", headers=superadmin, json={"activa": False}
    )
    assert r.status_code == 200
    assert (await client.get("/api/auth/me", headers=auth(admin))).status_code == 401
    r = await client.post(
        "/api/auth/login", json={"email": "admin@caribe.mx", "password": PASSWORD}
    )
    assert r.status_code == 403
