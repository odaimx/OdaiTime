from io import BytesIO

from PIL import Image

from tests.conftest import auth, crear_empresa, login


def _png(lado: int = 900) -> bytes:
    salida = BytesIO()
    Image.new("RGBA", (lado, lado // 2), (138, 100, 222, 128)).save(salida, "PNG")
    return salida.getvalue()


def _archivo(datos: bytes) -> dict:
    return {"archivo": ("logo.png", datos, "image/png")}


async def test_logo_de_la_empresa(client, superadmin):
    empresa = await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    a = auth(await login(client, "admin@caribe.mx"))

    r = await client.put("/api/tenant/logo", headers=a, files=_archivo(_png()))
    assert r.status_code == 200, r.text
    version = r.json()["logo_version"]
    assert version

    # Se reduce a 512 px y conserva la transparencia; se puede ver sin sesión.
    r = await client.get(f"/api/tenant/logo/{empresa['id']}")
    assert r.status_code == 200
    img = Image.open(BytesIO(r.content))
    assert img.format == "PNG" and img.mode == "RGBA" and max(img.size) == 512

    me = (await client.get("/api/auth/me", headers=a)).json()
    assert me["empresa"]["logo_version"] == version

    r = await client.put("/api/tenant/logo", headers=a, files=_archivo(b"no-es-imagen"))
    assert r.status_code in (400, 422)

    r = await client.delete("/api/tenant/logo", headers=a)
    assert r.json()["logo_version"] is None
    assert (await client.get(f"/api/tenant/logo/{empresa['id']}")).status_code == 404
