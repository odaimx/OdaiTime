from io import BytesIO

from PIL import Image

from app.services import correo
from tests.conftest import PASSWORD, auth, crear_empresa, login
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


async def test_tema_e_imagen_de_inicio(client, superadmin):
    r = await client.put(
        "/api/sistema/tema", headers=superadmin, json={"marca": "#123ABC", "titulos": "#e2c68f"}
    )
    assert r.status_code == 200, r.text
    tema = (await client.get("/api/sistema/tema")).json()  # público
    assert tema["colores"]["marca"] == "#123abc" and tema["colores"]["acento"] is None
    assert tema["demo"] is False
    img = BytesIO()
    Image.new("RGB", (800, 400), (10, 20, 30)).save(img, "JPEG")
    r = await client.put(
        "/api/sistema/imagen-inicio",
        headers=superadmin,
        files={"archivo": ("i.jpg", img.getvalue(), "image/jpeg")},
    )
    assert r.json()["imagen_version"]
    assert (await client.get("/api/sistema/imagen-inicio")).status_code == 200
    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    a = auth(await login(client, "admin@caribe.mx"))
    assert (await client.put("/api/sistema/tema", headers=a, json={})).status_code == 403


async def test_enlaces_de_tienda_y_soporte(client, superadmin):
    tema = (await client.get("/api/sistema/tema")).json()
    assert tema["url_tienda"] and tema["url_soporte"]  # del .env mientras no se configuren
    r = await client.put(
        "/api/sistema/enlaces",
        headers=superadmin,
        json={"url_tienda": "https://tienda.odai.lat/empleados", "url_soporte": None},
    )
    assert r.status_code == 200, r.text
    tema = (await client.get("/api/sistema/tema")).json()
    assert tema["url_tienda"] == "https://tienda.odai.lat/empleados"
    assert tema["enlaces"]["url_soporte"] is None
    r = await client.put("/api/sistema/enlaces", headers=superadmin, json={"url_tienda": "ftp://x"})
    assert r.status_code == 422
    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    a = auth(await login(client, "admin@caribe.mx"))
    assert (await client.get("/api/licencia", headers=a)).json()[
        "url_compra"
    ] == "https://tienda.odai.lat/empleados"
    assert (await client.put("/api/sistema/enlaces", headers=a, json={})).status_code == 403


async def test_cambiar_password(client, superadmin):
    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    tokens = await login(client, "admin@caribe.mx")
    a = auth(tokens)
    url = "/api/auth/cambiar-password"
    r = await client.post(url, headers=a, json={"actual": "mala", "nueva": "OtraClave456!"})
    assert r.status_code == 400
    r = await client.post(url, headers=a, json={"actual": PASSWORD, "nueva": "OtraClave456!"})
    assert r.status_code == 200, r.text
    assert r.json()["refresh_token"]
    # la sesión anterior queda cerrada y solo entra la contraseña nueva
    r = await client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 401
    assert (await login(client, "admin@caribe.mx", "OtraClave456!"))["access_token"]


async def test_frases_apariencia_y_foto(client, superadmin):
    import csv as _csv
    from io import StringIO

    salida = StringIO()
    w = _csv.writer(salida)
    w.writerows(
        [
            ["Tipo", "Texto", "Autor"],
            ["Proverbio", "Al que madruga, Dios lo ayuda.", "Proverbio popular"],
            ["Cita bíblica", "Todo lo puedo en Cristo que me fortalece.", "Filipenses 4:13"],
            ["Frase", "La disciplina es el puente entre metas y logros.", "Jim Rohn"],
            ["", "sin tipo", ""],
        ]
    )
    archivo = {"archivo": ("frases.csv", salida.getvalue().encode(), "text/csv")}
    r = await client.post("/api/sistema/frases/importar", headers=superadmin, files=archivo)
    assert r.json() == {"importadas": 3, "omitidas": 1}
    tema = (await client.get("/api/sistema/tema")).json()
    assert tema["frases"] == {"proverbio": 1, "cita": 1, "frase": 1}
    cita = (await client.get("/api/sistema/frases/aleatoria?tipo=cita")).json()
    assert cita["autor"] == "Filipenses 4:13"
    otra = (await client.get(f"/api/sistema/frases/aleatoria?excluir={cita['id']}")).json()
    assert otra["tipo"] in ("proverbio", "frase")
    assert (await client.delete("/api/sistema/frases", headers=superadmin)).status_code == 204
    assert (await client.get("/api/sistema/tema")).json()["frases"] == {}
    await client.post("/api/sistema/frases/importar", headers=superadmin, files=archivo)

    r = await client.put(
        "/api/sistema/apariencia",
        headers=superadmin,
        json={
            "fondo_color": "#EEF2FF",
            "login_titulo": "Control de asistencia",
            "login_color_subtitulo": "#8A64DE",
            "login_tamano_subtitulo": 28,
        },
    )
    assert r.json()["login_colores"]["subtitulo"] == "#8a64de"
    assert r.json()["login_tamanos"]["subtitulo"] == 28
    assert (
        r.json()["fondo_color"] == "#eef2ff" and r.json()["login_titulo"] == "Control de asistencia"
    )
    img = BytesIO()
    Image.new("RGB", (800, 400), (10, 20, 30)).save(img, "JPEG")
    r = await client.put(
        "/api/sistema/imagen/login",
        headers=superadmin,
        files={"archivo": ("l.jpg", img.getvalue(), "image/jpeg")},
    )
    assert r.json()["login_version"]
    assert (await client.get("/api/sistema/imagen/login")).status_code == 200
    r = await client.put(
        "/api/sistema/imagen/icono",
        headers=superadmin,
        files={"archivo": ("i.jpg", img.getvalue(), "image/jpeg")},
    )
    assert r.json()["icono_version"]
    r = await client.get("/api/sistema/imagen/icono")
    assert r.headers["content-type"] == "image/png"
    assert Image.open(BytesIO(r.content)).size == (128, 128)

    # Foto propia del usuario.
    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    a = auth(await login(client, "admin@caribe.mx"))
    assert (await client.get("/api/auth/me/foto", headers=a)).status_code == 404
    r = await client.put(
        "/api/auth/me/foto", headers=a, files={"archivo": ("f.jpg", img.getvalue(), "image/jpeg")}
    )
    assert r.status_code == 204
    assert (await client.get("/api/auth/me/foto", headers=a)).status_code == 200
    me = (await client.get("/api/auth/me", headers=a)).json()
    assert me["foto_actualizada"] and "licencia_vence" in me["empresa"]


async def test_admin_cambia_datos_de_su_empresa(client, superadmin):
    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    a = auth(await login(client, "admin@caribe.mx"))
    r = await client.patch(
        "/api/tenant/empresa",
        headers=a,
        json={
            "nombre": "Hotel Caribe",
            "razon_social": "Hotel Caribe SA de CV",
            "rfc": None,
            "direccion": "Av. Tulum 123, Cancún",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["nombre"] == "Hotel Caribe" and r.json()["direccion"].startswith("Av. Tulum")
    assert (await client.get("/api/auth/me", headers=a)).json()["empresa"][
        "nombre"
    ] == "Hotel Caribe"
