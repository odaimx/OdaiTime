from tests.test_checadas import CERCA, _config, _setup


async def _kiosco(client, a, suc, nombre):
    r = await client.post(
        "/api/dispositivos", headers=a, json={"nombre": nombre, "sucursal_id": suc["id"]}
    )
    assert r.status_code == 201, r.text
    d = r.json()
    r = await client.post("/api/kiosco/vincular", json={"codigo": d["codigo_vinculacion"]})
    return d, {"X-Dispositivo-Token": r.json()["token"]}


async def test_medios_por_empleado(client, superadmin):
    a, e, suc, emp = await _setup(client, superadmin)
    await _config(client, a, ignorar_repetida_min=0)
    k1, h1 = await _kiosco(client, a, suc, "Tablet entrada")
    k2, h2 = await _kiosco(client, a, suc, "Tablet almacén")

    # De fábrica sigue la configuración de la sucursal.
    assert (await client.get(f"/api/empleados/{emp['id']}", headers=a)).json()[
        "medios_checado"
    ] is None

    # Solo kiosco, y solo en la tablet del almacén.
    r = await client.patch(
        f"/api/empleados/{emp['id']}",
        headers=a,
        json={"medios_checado": ["kiosco"], "dispositivos_checado": [k2["id"]]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["medios_checado"] == ["kiosco"]

    assert (await client.get("/api/checadas/portal", headers=e)).json()["checar"] is False
    r = await client.post("/api/checadas", headers=e, data=CERCA)
    assert r.status_code == 403
    assert r.json()["detail"]["codigo"] == "movil_no_permitido"

    datos = {"numero": "1001", "pin": "1234"}
    r = await client.post("/api/kiosco/checar", headers=h1, data=datos)
    assert r.status_code == 403
    assert r.json()["detail"]["codigo"] == "dispositivo_no_asignado"
    assert "Tablet almacén" in r.json()["detail"]["mensaje"]
    r = await client.post("/api/kiosco/checar", headers=h2, data=datos)
    assert r.status_code == 201, r.text

    # Solo celular: el kiosco lo rechaza aunque la sucursal lo permita.
    await client.patch(
        f"/api/empleados/{emp['id']}",
        headers=a,
        json={"medios_checado": ["movil"], "dispositivos_checado": []},
    )
    r = await client.post("/api/kiosco/checar", headers=h1, data=datos)
    assert r.json()["detail"]["codigo"] == "kiosco_no_permitido"
    assert (await client.get("/api/checadas/portal", headers=e)).json()["checar"] is True

    # Volver a "según su sucursal".
    r = await client.patch(f"/api/empleados/{emp['id']}", headers=a, json={"medios_checado": None})
    assert r.json()["medios_checado"] is None
    r = await client.post("/api/kiosco/checar", headers=h1, data=datos)
    assert r.status_code == 201, r.text


async def test_kiosco_de_otra_empresa_no_valido(client, superadmin):
    a, _, suc, emp = await _setup(client, superadmin)
    r = await client.patch(
        f"/api/empleados/{emp['id']}",
        headers=a,
        json={"dispositivos_checado": ["00000000-0000-0000-0000-000000000001"]},
    )
    assert r.status_code == 422
