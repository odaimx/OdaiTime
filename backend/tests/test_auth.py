from tests.conftest import PASSWORD, auth, crear_superadmin, login


async def test_login_y_me(client):
    await crear_superadmin()
    tokens = await login(client, "ROOT@odai.mx")  # el correo no distingue mayúsculas
    assert tokens["usuario"]["rol"] == "superadmin"

    r = await client.get("/api/auth/me", headers=auth(tokens))
    assert r.status_code == 200
    assert r.json()["email"] == "root@odai.mx"


async def test_login_incorrecto(client):
    await crear_superadmin()
    for email in ("root@odai.mx", "nadie@odai.mx"):
        r = await client.post("/api/auth/login", json={"email": email, "password": "mala-clave"})
        assert r.status_code == 401
        assert r.json()["detail"] == "Correo o contraseña incorrectos"


async def test_limite_de_intentos(client):
    await crear_superadmin()
    for _ in range(5):
        r = await client.post("/api/auth/login", json={"email": "root@odai.mx", "password": "x"})
        assert r.status_code == 401
    r = await client.post("/api/auth/login", json={"email": "root@odai.mx", "password": PASSWORD})
    assert r.status_code == 429


async def test_sin_token(client):
    assert (await client.get("/api/auth/me")).status_code == 401
    r = await client.get("/api/auth/me", headers={"Authorization": "Bearer basura"})
    assert r.status_code == 401


async def test_refresh_rota_el_token(client):
    await crear_superadmin()
    tokens = await login(client, "root@odai.mx")

    r = await client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200
    nuevos = r.json()
    assert nuevos["refresh_token"] != tokens["refresh_token"]

    # El refresh anterior ya no sirve.
    r = await client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 401


async def test_logout_revoca(client):
    await crear_superadmin()
    tokens = await login(client, "root@odai.mx")
    r = await client.post("/api/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 204
    r = await client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 401


async def test_access_token_no_sirve_como_refresh(client):
    await crear_superadmin()
    tokens = await login(client, "root@odai.mx")
    r = await client.post("/api/auth/refresh", json={"refresh_token": tokens["access_token"]})
    assert r.status_code == 401
