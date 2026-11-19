from datetime import date, timedelta

from tests.test_checadas import CERCA, LEJOS, _setup

HOY = date.today()


async def _obra(client, a, suc, **extra):
    datos = {
        "clave": "OB1",
        "nombre": "Torre Norte",
        "sucursal_id": suc["id"],
        # La obra está donde la sucursal queda "LEJOS".
        "latitud": 21.172000,
        "longitud": -86.851500,
        "radio_metros": 150,
        "fecha_inicio": str(HOY - timedelta(days=30)),
        **extra,
    }
    r = await client.post("/api/obras", headers=a, json=datos)
    assert r.status_code == 201, r.text
    return r.json()


async def test_crear_obra_y_validaciones(client, superadmin):
    a, _, suc, _ = await _setup(client, superadmin)
    obra = await _obra(client, a, suc)
    assert obra["sucursal"]["clave"] == "CUN"
    assert obra["empleados_asignados"] == 0

    r = await client.post(
        "/api/obras",
        headers=a,
        json={"clave": "OB1", "nombre": "Otra", "sucursal_id": suc["id"], "fecha_inicio": str(HOY)},
    )
    assert r.status_code == 409

    r = await client.post(
        "/api/obras",
        headers=a,
        json={
            "clave": "OB2",
            "nombre": "Mal",
            "sucursal_id": suc["id"],
            "fecha_inicio": str(HOY),
            "fecha_fin": str(HOY - timedelta(days=1)),
        },
    )
    assert r.status_code == 422

    r = await client.get("/api/obras", headers=a)
    assert [o["clave"] for o in r.json()] == ["OB1"]


async def test_checar_en_obra_usa_su_ubicacion(client, superadmin):
    a, e, suc, emp = await _setup(client, superadmin)
    obra = await _obra(client, a, suc)
    r = await client.post(
        f"/api/obras/{obra['id']}/asignaciones",
        headers=a,
        json={"empleado_ids": [emp["id"]], "fecha_inicio": str(HOY - timedelta(days=1))},
    )
    assert r.status_code == 201, r.text

    hoy = (await client.get("/api/checadas/hoy", headers=e)).json()
    assert hoy["obra"]["clave"] == "OB1"

    # Cerca de la sucursal ya no vale: hoy le toca la obra.
    r = await client.post("/api/checadas", headers=e, data=CERCA)
    assert r.status_code == 422
    assert r.json()["detail"]["codigo"] == "fuera_de_rango"
    assert "zona" in r.json()["detail"]["mensaje"]

    r = await client.post("/api/checadas", headers=e, data=LEJOS)
    assert r.status_code == 201, r.text
    assert r.json()["obra"]["clave"] == "OB1"

    # Con checadas, ni la obra ni la asignación se pueden borrar.
    r = await client.delete(f"/api/obras/{obra['id']}", headers=a)
    assert r.status_code == 409
    asig = (await client.get(f"/api/obras/{obra['id']}/asignaciones", headers=a)).json()
    assert len(asig) == 1
    r = await client.delete(f"/api/obras/asignaciones/{asig[0]['id']}", headers=a)
    assert r.status_code == 409

    hist = (await client.get(f"/api/obras/empleado/{emp['id']}", headers=a)).json()
    assert hist[0]["obra"]["clave"] == "OB1"


async def test_reasignar_cierra_la_anterior(client, superadmin):
    a, _, suc, emp = await _setup(client, superadmin)
    o1 = await _obra(client, a, suc)
    o2 = await _obra(client, a, suc, clave="OB2", nombre="Plaza Sur")
    inicio = HOY - timedelta(days=10)
    await client.post(
        f"/api/obras/{o1['id']}/asignaciones",
        headers=a,
        json={"empleado_ids": [emp["id"]], "fecha_inicio": str(inicio)},
    )
    r = await client.post(
        f"/api/obras/{o2['id']}/asignaciones",
        headers=a,
        json={"empleado_ids": [emp["id"]], "fecha_inicio": str(HOY)},
    )
    assert r.status_code == 201, r.text
    asig = (await client.get(f"/api/obras/{o1['id']}/asignaciones", headers=a)).json()
    assert asig[0]["fecha_fin"] == str(HOY - timedelta(days=1))

    # Sin checadas, la obra 1 sí se puede borrar... pero tiene asignación: se avisa.
    r = await client.delete(f"/api/obras/{o1['id']}", headers=a)
    assert r.status_code == 409


async def test_reporte_obras(client, superadmin):
    a, _, suc, _ = await _setup(client, superadmin)
    await _obra(client, a, suc)
    r = await client.get(
        "/api/reportes/obras.xlsx",
        headers=a,
        params={"desde": str(HOY - timedelta(days=7)), "hasta": str(HOY)},
    )
    assert r.status_code == 200, r.text
    assert r.content[:2] == b"PK"
