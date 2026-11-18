from io import BytesIO

from PIL import Image

from app.services import correo
from tests.conftest import auth, crear_empresa, login
from tests.test_asistencia import _setup


async def test_portal_invitacion_y_recuperar_clave(client, superadmin, monkeypatch):
    a, _, emp = await _setup(client, superadmin)
    enviados: list[dict] = []

    async def falso(db, **kw):
        enviados.append(kw)
        return True

    # Sin correo configurado: no se envía y se devuelve el enlace para compartirlo a mano.
    r = await client.post(
        f"/api/empleados/{emp['id']}/portal", headers=a, json={"email": "ana@caribe.mx"}
    )
    assert r.status_code == 200, r.text
    datos = r.json()
    assert datos["enviado"] is False and "/restablecer?token=" in datos["enlace"]
    assert datos["empleado"]["portal"] is True
    token = datos["enlace"].split("token=")[1]

    r = await client.get("/api/auth/enlace", params={"token": token})
    assert r.json()["tipo"] == "invitacion" and r.json()["email"] == "ana@caribe.mx"

    r = await client.post(
        "/api/auth/restablecer", json={"token": token, "password": "ClaveNueva123"}
    )
    assert r.status_code == 200, r.text
    assert (
        await client.post(
            "/api/auth/restablecer", json={"token": token, "password": "OtraClave123"}
        )
    ).status_code == 410
    assert await login(client, "ana@caribe.mx", "ClaveNueva123")

    # Recuperar: responde igual exista o no el correo; con correo configurado lo envía.
    monkeypatch.setattr(correo, "enviar", falso)
    r = await client.post("/api/auth/recuperar", json={"email": "nadie@caribe.mx"})
    assert r.status_code == 202 and not enviados
    r = await client.post("/api/auth/recuperar", json={"email": "ana@caribe.mx"})
    assert r.status_code == 202 and enviados[-1]["para"] == "ana@caribe.mx"
    assert enviados[-1]["nombre_empresa"] == "Empresa Caribe"

    # Quitar el acceso desactiva al usuario.
    r = await client.delete(f"/api/empleados/{emp['id']}/portal", headers=a)
    assert r.json()["portal"] is False


async def test_categorias(client, superadmin):
    a, suc, emp = await _setup(client, superadmin)
    r = await client.post(
        "/api/categorias",
        headers=a,
        params={"modelo": "empleado"},
        json={"nombre": "Operativo", "color": "#22D3EE"},
    )
    assert r.status_code == 201, r.text
    cat = r.json()
    r = await client.put(
        "/api/categorias/registro",
        headers=a,
        params={"modelo": "empleado"},
        json={"registro_id": emp["id"], "categoria_ids": [cat["id"]]},
    )
    assert r.json() == [cat["id"]]
    r = await client.get("/api/categorias/asignadas", headers=a, params={"modelo": "empleado"})
    assert r.json() == {emp["id"]: [cat["id"]]}
    r = await client.get("/api/categorias", headers=a, params={"modelo": "empleado"})
    assert r.json()[0]["registros"] == 1
    # Las de empresas solo las maneja Odai.
    r = await client.get("/api/categorias", headers=a, params={"modelo": "empresa"})
    assert r.status_code == 403


async def test_fondo_y_correo(client, superadmin):
    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    a = auth(await login(client, "admin@caribe.mx"))
    r = await client.put("/api/tenant/fondo/color", headers=a, json={"color": "#F1ECFC"})
    assert r.json() == {"fondo_color": "#f1ecfc", "fondo_version": None}
    img = BytesIO()
    Image.new("RGB", (2400, 1200), (20, 30, 70)).save(img, "JPEG")
    r = await client.put(
        "/api/tenant/fondo/imagen",
        headers=a,
        files={"archivo": ("f.jpg", img.getvalue(), "image/jpeg")},
    )
    assert r.json()["fondo_version"] and r.json()["fondo_color"] is None
    me = (await client.get("/api/auth/me", headers=a)).json()
    assert me["empresa"]["fondo_version"]

    s = superadmin
    r = await client.put(
        "/api/correo",
        headers=s,
        json={
            "host": "smtp.odai.lat",
            "puerto": 587,
            "seguridad": "starttls",
            "usuario": "x",
            "password": "secreta",
            "remitente": "no-responder@odai.lat",
            "activo": True,
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["tiene_password"] is True and "password" not in r.json()
    from app.core.cifrado import descifrar, esta_cifrado
    from app.db.session import SessionLocal
    from app.models import ConfigCorreo

    async with SessionLocal() as db:
        guardada = (await db.get(ConfigCorreo, 1)).password
    assert esta_cifrado(guardada) and descifrar(guardada) == "secreta"
    assert (await client.get("/api/correo", headers=a)).status_code == 403
