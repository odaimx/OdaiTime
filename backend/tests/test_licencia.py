from io import BytesIO

from openpyxl import Workbook

from tests.conftest import auth, crear_empresa, login


async def _setup(client, superadmin, limite: int):
    empresa = await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    assert empresa["max_empleados"] == 15  # licencia de prueba por defecto
    r = await client.patch(
        f"/api/empresas/{empresa['id']}", headers=superadmin, json={"max_empleados": limite}
    )
    assert r.json()["max_empleados"] == limite
    a = auth(await login(client, "admin@caribe.mx"))
    r = await client.post("/api/sucursales", headers=a, json={"clave": "CUN", "nombre": "Cancún"})
    return empresa, a, r.json()["id"]


def _emp(numero, suc):
    return {
        "numero": numero,
        "nombre": "Ana",
        "apellido_paterno": "Ruiz",
        "fecha_ingreso": "2025-01-15",
        "sucursal_id": suc,
    }


async def test_limite_al_crear_y_reactivar(client, superadmin):
    empresa, a, suc = await _setup(client, superadmin, limite=2)

    ids = []
    for n in ("1", "2"):
        r = await client.post("/api/empleados", headers=a, json=_emp(n, suc))
        assert r.status_code == 201
        ids.append(r.json()["id"])

    lic = (await client.get("/api/licencia", headers=a)).json()
    assert (lic["max_empleados"], lic["activos"], lic["disponibles"]) == (2, 2, 0)
    assert lic["url_compra"] == "https://odai.lat"

    # El tercero no cabe.
    r = await client.post("/api/empleados", headers=a, json=_emp("3", suc))
    assert r.status_code == 409
    detalle = r.json()["detail"]
    assert detalle["codigo"] == "limite_licencia"
    assert detalle["url_compra"] == "https://odai.lat"
    assert "2 empleados activos" in detalle["mensaje"]

    # Las bajas liberan lugar…
    await client.post(
        f"/api/empleados/{ids[0]}/baja",
        headers=a,
        json={"fecha_baja": "2025-06-30", "motivo": "Renuncia"},
    )
    r = await client.post("/api/empleados", headers=a, json=_emp("3", suc))
    assert r.status_code == 201
    # …y reactivar también cuenta contra el límite.
    r = await client.post(f"/api/empleados/{ids[0]}/reactivar", headers=a)
    assert r.status_code == 409
    assert r.json()["detail"]["codigo"] == "limite_licencia"

    # Si Odai amplía la licencia, ya se puede.
    await client.patch(
        f"/api/empresas/{empresa['id']}", headers=superadmin, json={"max_empleados": 3}
    )
    r = await client.post(f"/api/empleados/{ids[0]}/reactivar", headers=a)
    assert r.status_code == 200


async def test_licencia_vencida(client, superadmin):
    empresa, a, suc = await _setup(client, superadmin, limite=10)
    await client.patch(
        f"/api/empresas/{empresa['id']}", headers=superadmin, json={"licencia_vence": "2020-01-01"}
    )
    # Con la licencia vencida ya no se entra al sistema; se explica el motivo.
    r = await client.post("/api/empleados", headers=a, json=_emp("1", suc))
    assert r.status_code == 403
    assert r.json()["detail"]["codigo"] == "licencia_vencida"
    assert "venció" in r.json()["detail"]["mensaje"]


async def test_importacion_respeta_el_limite(client, superadmin):
    _, a, _ = await _setup(client, superadmin, limite=2)
    wb = Workbook()
    ws = wb.active
    ws.append(["encabezados"])
    for n in (1, 2, 3):
        ws.append([n, "Ana", "Ruiz", None, None, None, None, "2025-01-15"] + [None] * 5 + ["CUN"])
    buf = BytesIO()
    wb.save(buf)

    r = await client.post(
        "/api/empleados/importar",
        headers=a,
        files={"archivo": ("e.xlsx", buf.getvalue(), "application/octet-stream")},
    )
    assert r.status_code == 409
    assert "solo tienes 2 lugar(es)" in r.json()["detail"]["mensaje"]
    assert (await client.get("/api/empleados", headers=a)).json() == []
