from tests.test_checadas import CERCA, LAT, LON, _config, _setup
from tests.test_medios_checado import _kiosco

FOTO = ("selfie.webp", b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image/webp")


async def _slug(client, a):
    return (await client.get("/api/tenant/empresa", headers=a)).json()["slug"]


async def test_celular_vinculado_sin_usuario(client, superadmin):
    a, _, _, emp = await _setup(client, superadmin)
    await _config(client, a, ignorar_repetida_min=0, permitir_movil=True)
    slug = await _slug(client, a)

    r = await client.post(
        "/api/publico/celular/vincular",
        json={"empresa": slug, "identificador": "1001", "pin": "9999"},
    )
    assert r.status_code == 401
    vinc = {"empresa": slug, "identificador": "1001", "pin": "1234", "equipo": "Android"}
    # Sin aceptar el aviso de privacidad no se vincula.
    r = await client.post("/api/publico/celular/vincular", json=vinc)
    assert r.status_code == 428 and r.json()["detail"]["codigo"] == "aviso_requerido"
    aviso = (await client.get(f"/api/publico/aviso?empresa={slug}")).json()
    assert aviso["version"] and aviso["responsable"]
    r = await client.post("/api/publico/celular/vincular", json={**vinc, "aviso": aviso["version"]})
    assert r.status_code == 201, r.text
    constancia = (await client.get(f"/api/empleados/{emp['id']}/aviso", headers=a)).json()
    assert constancia["medio"] == "celular"
    h = {"X-Celular-Token": r.json()["token"]}

    est = (await client.get("/api/publico/celular/estado", headers=h)).json()
    assert est["estado"] == "pendiente" and est["hoy"] is None
    datos = {**CERCA, "pin": "1234", "accion": "entrada"}
    r = await client.post(
        "/api/publico/celular/checar", headers=h, data=datos, files={"foto": FOTO}
    )
    assert r.status_code == 403

    # El administrador lo aprueba desde la ficha.
    cels = (await client.get(f"/api/empleados/{emp['id']}/celulares", headers=a)).json()
    assert len(cels) == 1 and cels[0]["estado"] == "pendiente"
    pend = (await client.get("/api/celulares/pendientes", headers=a)).json()
    assert pend["pendientes"] == 1 and len(pend["empleados"]) == 1
    r = await client.post(f"/api/celulares/{cels[0]['id']}/aprobar", headers=a)
    assert r.status_code == 200, r.text

    est = (await client.get("/api/publico/celular/estado", headers=h)).json()
    assert est["estado"] == "aprobado" and est["hoy"]["acciones"][0]["accion"] == "entrada"
    assert "foto" in est

    # Sin selfie no; con PIN incorrecto no; con todo, sí.
    r = await client.post("/api/publico/celular/checar", headers=h, data=datos)
    assert r.status_code == 422
    r = await client.post(
        "/api/publico/celular/checar",
        headers=h,
        data={**datos, "pin": "0000"},
        files={"foto": FOTO},
    )
    assert r.status_code == 401
    r = await client.post(
        "/api/publico/celular/checar", headers=h, data=datos, files={"foto": FOTO}
    )
    assert r.status_code == 201, r.text
    assert r.json()["tipo"] == "entrada"

    # Desvinculado: ya no entra.
    await client.delete(f"/api/celulares/{cels[0]['id']}", headers=a)
    assert (await client.get("/api/publico/celular/estado", headers=h)).status_code == 401


async def test_qr_del_kiosco_sin_usuario(client, superadmin):
    a, _, suc, _ = await _setup(client, superadmin)
    await _config(client, a, ignorar_repetida_min=0)
    k, h = await _kiosco(client, a, suc, "Tablet")
    qr = (await client.get("/api/kiosco/estado", headers=h)).json()["qr"]["url"].split("qr=")[1]

    base = {"qr": qr, "numero": "1001", "pin": "1234"}
    # Lejos de la sucursal: no.
    r = await client.post(
        "/api/publico/qr/identificar", json={**base, "latitud": 21.2, "longitud": LON}
    )
    assert r.status_code == 422
    cerca = {**base, "latitud": LAT, "longitud": LON, "precision": 10}
    r = await client.post("/api/publico/qr/identificar", json=cerca)
    assert r.status_code == 428
    version = (await client.get(f"/api/publico/aviso?qr={qr}")).json()["version"]
    r = await client.post("/api/publico/qr/identificar", json={**cerca, "aviso": version})
    assert r.status_code == 200, r.text
    ses = r.json()
    assert ses["acciones"][0] == {"accion": "entrada", "habilitada": True}
    assert ses["gps"]["metros"] < ses["gps"]["radio"] and ses["sucursal"] == "Cancún"

    r = await client.post(
        "/api/publico/qr/checar",
        data={"sesion": ses["sesion"], "accion": "entrada", "latitud": LAT, "longitud": LON},
        files={"foto": FOTO},
    )
    assert r.status_code == 201, r.text
    assert r.json()["tipo"] == "entrada"

    r = await client.post(
        "/api/publico/qr/identificar", json={**base, "qr": "x.1.y", "latitud": LAT, "longitud": LON}
    )
    assert r.status_code == 422


async def test_aviso_en_el_portal(client, superadmin):
    a, e, _, emp = await _setup(client, superadmin)
    assert (await client.get(f"/api/empleados/{emp['id']}/aviso", headers=a)).json() is None
    assert (await client.get("/api/checadas/hoy", headers=e)).json()["aviso_aceptado"] is False
    assert (await client.post("/api/checadas/aviso", headers=e)).status_code == 204
    assert (await client.post("/api/checadas/aviso", headers=e)).status_code == 204  # idempotente
    assert (await client.get("/api/checadas/hoy", headers=e)).json()["aviso_aceptado"] is True
    constancia = (await client.get(f"/api/empleados/{emp['id']}/aviso", headers=a)).json()
    assert constancia["medio"] == "portal"
