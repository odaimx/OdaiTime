from tests.conftest import auth, crear_empresa, login


async def test_catalogo_nacional_y_seleccion_de_empresa(client, superadmin):
    # Odai carga el catálogo nacional del año.
    r = await client.post("/api/festivos/generar", headers=superadmin, params={"anio": 2027})
    assert r.status_code == 200 and r.json()["creados"] == 13
    r = await client.post("/api/festivos/generar", headers=superadmin, params={"anio": 2027})
    assert r.json()["creados"] == 0  # idempotente

    nacional = (await client.get("/api/festivos", headers=superadmin, params={"anio": 2027})).json()
    assert len([f for f in nacional if f["tipo"] == "obligatorio"]) == 7
    viernes_santo = next(f for f in nacional if f["nombre"] == "Viernes Santo")
    assert viernes_santo["fecha"] == "2027-03-26"

    # Odai agrega la jornada electoral como obligatoria (art. 74, fr. IX).
    r = await client.post(
        "/api/festivos",
        headers=superadmin,
        json={"fecha": "2027-06-06", "nombre": "Jornada electoral", "tipo": "obligatorio"},
    )
    assert r.status_code == 201

    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    a = auth(await login(client, "admin@caribe.mx"))
    lista = (await client.get("/api/festivos", headers=a, params={"anio": 2027})).json()
    por_nombre = {f["nombre"]: f for f in lista}
    assert por_nombre["Año Nuevo"]["aplica"] and not por_nombre["Año Nuevo"]["editable"]
    assert por_nombre["Jornada electoral"]["aplica"]
    assert not por_nombre["Viernes Santo"]["aplica"]

    # La empresa elige aplicar Viernes Santo; no puede "desaplicar" un obligatorio.
    r = await client.put(
        f"/api/festivos/{viernes_santo['id']}/aplicar", headers=a, json={"aplica": True}
    )
    assert r.status_code == 204
    r = await client.put(
        f"/api/festivos/{por_nombre['Año Nuevo']['id']}/aplicar", headers=a, json={"aplica": False}
    )
    assert r.status_code == 422
    lista = (await client.get("/api/festivos", headers=a, params={"anio": 2027})).json()
    assert next(f for f in lista if f["nombre"] == "Viernes Santo")["aplica"]

    # Día propio de la empresa; el admin no puede tocar el catálogo nacional.
    r = await client.post(
        "/api/festivos", headers=a, json={"fecha": "2027-08-15", "nombre": "Aniversario Caribe"}
    )
    assert (
        r.status_code == 201 and r.json()["origen"] == "empresa" and r.json()["tipo"] == "opcional"
    )
    r = await client.patch(
        f"/api/festivos/{por_nombre['Año Nuevo']['id']}", headers=a, json={"nombre": "Otro"}
    )
    assert r.status_code == 403

    # Otra empresa no ve el día propio de Caribe ni su selección.
    await crear_empresa(client, superadmin, "Sol", "admin@sol.mx")
    b = auth(await login(client, "admin@sol.mx"))
    lista_b = (await client.get("/api/festivos", headers=b, params={"anio": 2027})).json()
    assert "Aniversario Caribe" not in {f["nombre"] for f in lista_b}
    assert not next(f for f in lista_b if f["nombre"] == "Viernes Santo")["aplica"]


async def test_tarjeta_usa_los_festivos_de_la_empresa(client, superadmin):
    await client.post("/api/festivos/generar", headers=superadmin, params={"anio": 2027})
    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    a = auth(await login(client, "admin@caribe.mx"))
    suc = (
        await client.post("/api/sucursales", headers=a, json={"clave": "C", "nombre": "Cancún"})
    ).json()
    dias = [{"dia_semana": d, "entrada": "09:00", "salida": "17:00"} for d in range(5)]
    turno = (
        await client.post(
            "/api/turnos", headers=a, json={"nombre": "LV", "tipo_jornada": "diurna", "dias": dias}
        )
    ).json()
    emp = (
        await client.post(
            "/api/empleados",
            headers=a,
            json={
                "numero": "1",
                "nombre": "Ana",
                "apellido_paterno": "Ruiz",
                "fecha_ingreso": "2026-01-01",
                "sucursal_id": suc["id"],
                "turno_id": turno["id"],
            },
        )
    ).json()
    params = {"desde": "2027-03-26", "hasta": "2027-03-26"}  # Viernes Santo
    det = (
        await client.get(f"/api/asistencia/empleado/{emp['id']}", headers=a, params=params)
    ).json()
    assert det["dias"][0]["estado"] == "falta"  # la empresa no lo otorga

    lista = (await client.get("/api/festivos", headers=a, params={"anio": 2027})).json()
    vs = next(f for f in lista if f["nombre"] == "Viernes Santo")
    await client.put(f"/api/festivos/{vs['id']}/aplicar", headers=a, json={"aplica": True})
    det = (
        await client.get(f"/api/asistencia/empleado/{emp['id']}", headers=a, params=params)
    ).json()
    assert det["dias"][0]["estado"] == "festivo"
    assert det["dias"][0]["festivo_obligatorio"] is False


async def test_en_festivo_solo_checan_los_designados(client, superadmin):
    from datetime import UTC, datetime
    from zoneinfo import ZoneInfo

    from tests.conftest import PASSWORD

    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    a = auth(await login(client, "admin@caribe.mx"))
    suc = (
        await client.post(
            "/api/sucursales",
            headers=a,
            json={"clave": "C", "nombre": "Cancún", "zona_horaria": "America/Cancun"},
        )
    ).json()
    emp = (
        await client.post(
            "/api/empleados",
            headers=a,
            json={
                "numero": "1",
                "nombre": "Ana",
                "apellido_paterno": "Ruiz",
                "fecha_ingreso": "2025-01-01",
                "sucursal_id": suc["id"],
            },
        )
    ).json()
    await client.post(
        f"/api/empleados/{emp['id']}/acceso",
        headers=a,
        json={"email": "ana@caribe.mx", "password": PASSWORD},
    )
    e = auth(await login(client, "ana@caribe.mx"))
    # Sin GPS para simplificar.
    cfg = (await client.get("/api/checadas/config", headers=a)).json()
    cfg = {k: v for k, v in cfg.items() if k not in ("origen", "sucursal_id")}
    await client.put(
        "/api/checadas/config",
        headers=a,
        json={**cfg, "validar_gps": False, "permitir_movil": True},
    )

    # Hoy es festivo de la empresa.
    hoy = datetime.now(UTC).astimezone(ZoneInfo("America/Cancun")).date()
    r = await client.post(
        "/api/festivos", headers=a, json={"fecha": str(hoy), "nombre": "Día de prueba"}
    )
    assert r.status_code == 201

    estado = (await client.get("/api/checadas/hoy", headers=e)).json()
    assert estado["festivo_hoy"] == "Día de prueba" and estado["designado_festivo"] is False
    r = await client.post("/api/checadas", headers=e, data={})
    assert r.status_code == 403 and r.json()["detail"]["codigo"] == "festivo_no_designado"

    # La empresa la designa para trabajar.
    r = await client.put(
        "/api/festivos/designados", headers=a, json={"fecha": str(hoy), "empleado_ids": [emp["id"]]}
    )
    assert r.status_code == 200 and r.json()["empleado_ids"] == [emp["id"]]
    assert (await client.get("/api/checadas/hoy", headers=e)).json()["designado_festivo"] is True
    r = await client.post("/api/checadas", headers=e, data={})
    assert r.status_code == 201, r.text

    # Designar en un día que no es festivo no tiene sentido.
    r = await client.put(
        "/api/festivos/designados", headers=a, json={"fecha": "2030-07-10", "empleado_ids": []}
    )
    assert r.status_code == 422
