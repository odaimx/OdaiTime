from datetime import UTC, datetime, timedelta

from tests.conftest import PASSWORD, auth, crear_empresa, login

# Hotel en Cancún y un punto a ~40 m; otro a ~1.2 km.
LAT, LON = 21.161900, -86.851500
CERCA = {"latitud": "21.162200", "longitud": "-86.851600", "precision": "10"}
LEJOS = {"latitud": "21.172000", "longitud": "-86.851500", "precision": "10"}
JPG = ("foto.jpg", b"\xff\xd8\xff\xe0fake-jpeg", "image/jpeg")


async def _setup(client, superadmin, con_pin=True, aviso=True):
    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    a = auth(await login(client, "admin@caribe.mx"))
    r = await client.post(
        "/api/sucursales",
        headers=a,
        json={
            "clave": "CUN",
            "nombre": "Cancún",
            "zona_horaria": "America/Cancun",
            "latitud": LAT,
            "longitud": LON,
            "radio_metros": 150,
        },
    )
    suc = r.json()
    datos = {
        "numero": "1001",
        "nombre": "María",
        "apellido_paterno": "López",
        "fecha_ingreso": "2025-01-15",
        "sucursal_id": suc["id"],
    }
    if con_pin:
        datos["pin"] = "1234"
    r = await client.post("/api/empleados", headers=a, json=datos)
    assert r.status_code == 201, r.text
    emp = r.json()
    assert emp["tiene_pin"] is con_pin
    r = await client.post(
        f"/api/empleados/{emp['id']}/acceso",
        headers=a,
        json={"email": "maria@caribe.mx", "password": PASSWORD},
    )
    assert r.status_code == 201
    e = auth(await login(client, "maria@caribe.mx"))
    if aviso:  # sin aviso de privacidad aceptado el portal no checa
        assert (await client.post("/api/checadas/aviso", headers=e)).status_code == 204
    await _config(client, a, permitir_movil=True)  # de fábrica el portal no checa
    return a, e, suc, emp


async def _config(client, a, **cambios):
    base = (await client.get("/api/checadas/config", headers=a)).json()
    base = {k: v for k, v in base.items() if k not in ("origen", "sucursal_id")}
    r = await client.put("/api/checadas/config", headers=a, json={**base, **cambios})
    assert r.status_code == 200, r.text
    return r.json()


async def test_checar_con_gps(client, superadmin):
    a, e, suc, _ = await _setup(client, superadmin)

    hoy = (await client.get("/api/checadas/hoy", headers=e)).json()
    assert hoy["siguiente_tipo"] == "entrada"
    assert hoy["requiere"] == {"gps": True, "foto": False, "qr": False}
    assert hoy["sucursal"]["clave"] == "CUN"

    r = await client.post("/api/checadas", headers=e, data=LEJOS)
    assert r.status_code == 422
    assert r.json()["detail"]["codigo"] == "fuera_de_rango"

    r = await client.post("/api/checadas", headers=e, data={})
    assert r.json()["detail"]["codigo"] == "gps_requerido"

    r = await client.post("/api/checadas", headers=e, data=CERCA)
    assert r.status_code == 201, r.text
    entrada = r.json()
    assert entrada["tipo"] == "entrada"
    assert 20 < entrada["distancia_m"] < 60

    # Repetida dentro de 5 min.
    r = await client.post("/api/checadas", headers=e, data=CERCA)
    assert r.status_code == 409
    assert r.json()["detail"]["codigo"] == "repetida"

    # Sin ventana de repetición, la siguiente es salida.
    await _config(client, a, ignorar_repetida_min=0)
    r = await client.post("/api/checadas", headers=e, data=CERCA)
    assert r.json()["tipo"] == "salida"
    assert len((await client.get("/api/checadas/hoy", headers=e)).json()["checadas_hoy"]) == 2


async def test_foto_requerida_y_visible_para_admin(client, superadmin):
    a, e, _, _ = await _setup(client, superadmin)
    cfg = await _config(client, a, foto="movil")
    assert cfg["origen"] == "general"

    r = await client.post("/api/checadas", headers=e, data=CERCA)
    assert r.json()["detail"]["codigo"] == "foto_requerida"

    r = await client.post("/api/checadas", headers=e, data=CERCA, files={"foto": JPG})
    assert r.status_code == 201, r.text
    checada = r.json()
    assert checada["tiene_foto"] is True

    r = await client.get(f"/api/checadas/{checada['id']}/foto", headers=a)
    assert r.status_code == 200
    assert r.content == JPG[1]

    malo = ("x.txt", b"hola", "text/plain")
    await _config(client, a, foto="movil", ignorar_repetida_min=0)
    r = await client.post("/api/checadas", headers=e, data=CERCA, files={"foto": malo})
    assert r.json()["detail"]["codigo"] == "foto_invalida"


async def test_config_por_sucursal_y_movil_bloqueado(client, superadmin):
    a, e, suc, _ = await _setup(client, superadmin)
    base = (await client.get("/api/checadas/config", headers=a)).json()
    assert base["origen"] == "general"

    propia = {k: v for k, v in base.items() if k not in ("origen", "sucursal_id")}
    r = await client.put(
        "/api/checadas/config",
        headers=a,
        json={**propia, "permitir_movil": False, "sucursal_id": suc["id"]},
    )
    assert r.json()["origen"] == "sucursal"
    r = await client.get("/api/checadas/config", headers=a, params={"sucursal_id": suc["id"]})
    assert r.json()["permitir_movil"] is False

    r = await client.post("/api/checadas", headers=e, data=CERCA)
    assert r.status_code == 403
    assert r.json()["detail"]["codigo"] == "movil_no_permitido"

    # Volver a la general.
    r = await client.delete("/api/checadas/config", headers=a, params={"sucursal_id": suc["id"]})
    assert r.status_code == 204
    assert (await client.post("/api/checadas", headers=e, data=CERCA)).status_code == 201


async def test_offline(client, superadmin):
    _, e, _, _ = await _setup(client, superadmin)
    hace_una_hora = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    r = await client.post(
        "/api/checadas",
        headers=e,
        data={**CERCA, "offline": "true", "momento": hace_una_hora},
    )
    assert r.status_code == 201, r.text
    assert r.json()["offline"] is True
    assert r.json()["momento"].startswith(hace_una_hora[:16])

    viejo = (datetime.now(UTC) - timedelta(hours=30)).isoformat()
    r = await client.post(
        "/api/checadas", headers=e, data={**CERCA, "offline": "true", "momento": viejo}
    )
    assert r.json()["detail"]["codigo"] == "offline_vencida"


async def test_kiosco_pin_y_qr(client, superadmin):
    a, e, suc, _ = await _setup(client, superadmin)
    r = await client.post(
        "/api/dispositivos",
        headers=a,
        json={"nombre": "Tablet recepción", "sucursal_id": suc["id"]},
    )
    assert r.status_code == 201
    codigo = r.json()["codigo_vinculacion"]
    assert len(codigo) == 6 and r.json()["vinculado"] is False

    assert (await client.post("/api/kiosco/vincular", json={"codigo": "000000"})).status_code in (
        404,
        429,
    ) or codigo == "000000"
    r = await client.post("/api/kiosco/vincular", json={"codigo": codigo})
    assert r.status_code == 200, r.text
    k = {"X-Dispositivo-Token": r.json()["token"]}
    # El código ya no sirve dos veces.
    assert (await client.post("/api/kiosco/vincular", json={"codigo": codigo})).status_code == 404

    estado = (await client.get("/api/kiosco/estado", headers=k)).json()
    assert estado["sucursal"]["clave"] == "CUN"
    assert estado["config"]["pin"] is True
    assert "/marcar?qr=" in estado["qr"]["url"]
    assert (await client.get("/api/kiosco/estado")).status_code == 401

    # Número + PIN.
    r = await client.post("/api/kiosco/checar", headers=k, data={"numero": "1001", "pin": "9999"})
    assert r.status_code == 401
    r = await client.post("/api/kiosco/checar", headers=k, data={"numero": "1001", "pin": "1234"})
    assert r.status_code == 201, r.text
    assert r.json()["tipo"] == "entrada"
    assert r.json()["nombre"] == "María López"

    # QR desde el celular (sin GPS): la checada queda en la sucursal del kiosco.
    await _config(client, a, validar_gps=False, validar_qr=True, ignorar_repetida_min=0)
    r = await client.post("/api/checadas", headers=e, data={})
    assert r.json()["detail"]["codigo"] == "qr_requerido"
    token = estado["qr"]["url"].split("qr=")[1]
    estado = (await client.get("/api/kiosco/estado", headers=k)).json()
    token = estado["qr"]["url"].split("qr=")[1]
    r = await client.post("/api/checadas", headers=e, data={"qr": token})
    assert r.status_code == 201, r.text
    assert r.json()["tipo"] == "salida"
    r = await client.post("/api/checadas", headers=e, data={"qr": token[:-3] + "abc"})
    assert r.json()["detail"]["codigo"] in ("qr_vencido", "qr_invalido")

    # Desactivar el kiosco lo desconecta.
    lista = (await client.get("/api/dispositivos", headers=a)).json()
    assert lista[0]["vinculado"] is True
    await client.patch(f"/api/dispositivos/{lista[0]['id']}", headers=a, json={"activo": False})
    assert (await client.get("/api/kiosco/estado", headers=k)).status_code == 401


async def test_bloqueo_de_pin(client, superadmin):
    a, _, suc, _ = await _setup(client, superadmin)
    r = await client.post(
        "/api/dispositivos", headers=a, json={"nombre": "Tablet", "sucursal_id": suc["id"]}
    )
    r = await client.post("/api/kiosco/vincular", json={"codigo": r.json()["codigo_vinculacion"]})
    k = {"X-Dispositivo-Token": r.json()["token"]}
    for _ in range(5):
        r = await client.post(
            "/api/kiosco/checar", headers=k, data={"numero": "1001", "pin": "0000"}
        )
        assert r.status_code == 401
    r = await client.post("/api/kiosco/checar", headers=k, data={"numero": "1001", "pin": "1234"})
    assert r.status_code == 429


async def test_biometrico_preparado(client, superadmin):
    a, _, suc, _ = await _setup(client, superadmin)
    r = await client.post(
        "/api/dispositivos",
        headers=a,
        json={"nombre": "ZKTeco entrada", "sucursal_id": suc["id"], "tipo": "biometrico"},
    )
    r = await client.post("/api/kiosco/vincular", json={"codigo": r.json()["codigo_vinculacion"]})
    k = {"X-Dispositivo-Token": r.json()["token"]}
    ahora = datetime.now(UTC).replace(microsecond=0)
    lote = {
        "registros": [
            {"numero": "1001", "momento": (ahora - timedelta(hours=9)).isoformat()},
            {"numero": "1001", "momento": (ahora - timedelta(hours=1)).isoformat()},
            {"numero": "9999", "momento": ahora.isoformat()},
        ]
    }
    r = await client.post("/api/biometrico/registros", headers=k, json=lote)
    assert r.status_code == 200, r.text
    assert r.json()["creadas"] == 2 and len(r.json()["errores"]) == 1
    r = await client.post("/api/biometrico/registros", headers=k, json=lote)
    assert r.json()["omitidas"] == 2  # idempotente

    hoy = datetime.now(UTC).date()
    lista = (
        await client.get(
            "/api/checadas",
            headers=a,
            params={"desde": str(hoy - timedelta(days=1)), "hasta": str(hoy + timedelta(days=1))},
        )
    ).json()
    assert sorted(c["tipo"] for c in lista) == ["entrada", "salida"]
    assert {c["origen"] for c in lista} == {"biometrico"}
    # Un kiosco no puede mandar marcas de biométrico ni al revés.
    assert (await client.get("/api/kiosco/estado", headers=k)).status_code == 403


async def test_manual_correccion_y_bitacora(client, superadmin):
    a, _, suc, emp = await _setup(client, superadmin)
    momento = (datetime.now(UTC) - timedelta(hours=3)).replace(microsecond=0)
    r = await client.post(
        "/api/checadas/manual",
        headers=a,
        json={
            "empleado_id": emp["id"],
            "tipo": "entrada",
            "momento": momento.isoformat(),
            "motivo": "Olvidó checar, confirmado por el gerente",
        },
    )
    assert r.status_code == 201, r.text
    checada = r.json()
    assert checada["origen"] == "manual"

    r = await client.patch(
        f"/api/checadas/{checada['id']}",
        headers=a,
        json={"estado": "anulada", "motivo": "Registro duplicado"},
    )
    assert r.json()["estado"] == "anulada" and r.json()["corregida"] is True

    acts = (
        await client.get(
            "/api/actividad", headers=a, params={"modelo": "checada", "registro_id": checada["id"]}
        )
    ).json()
    assert acts[0]["tipo"] == "cambio"
    assert acts[0]["mensaje"] == "Corrección: Registro duplicado"
    assert acts[0]["cambios"][0]["campo"] == "estado"
    assert acts[0]["usuario"]["nombre"] == "Admin Caribe"
    assert acts[1]["tipo"] == "creacion"


async def test_bitacora_de_empleado(client, superadmin):
    a, _, suc, emp = await _setup(client, superadmin)
    r = await client.patch(
        f"/api/empleados/{emp['id']}",
        headers=a,
        json={"salario_diario": "500", "puesto": "Recepción"},
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        "/api/actividad",
        headers=a,
        json={"modelo": "empleado", "registro_id": emp["id"], "mensaje": "Entregó su INE"},
    )
    assert r.status_code == 201

    acts = (
        await client.get(
            "/api/actividad", headers=a, params={"modelo": "empleado", "registro_id": emp["id"]}
        )
    ).json()
    tipos = [x["tipo"] for x in acts]
    assert tipos[0] == "nota" and "creacion" in tipos
    cambio = next(x for x in acts if x["tipo"] == "cambio" and x["cambios"])
    campos = {c["campo"]: c for c in cambio["cambios"]}
    assert campos["salario_diario"]["despues"] in ("500", "500.00")
    assert campos["puesto"]["antes"] is None and campos["puesto"]["despues"] == "Recepción"

    # Un empleado (rol) no ve la bitácora; otra empresa tampoco.
    e = auth(await login(client, "maria@caribe.mx"))
    r = await client.get(
        "/api/actividad", headers=e, params={"modelo": "empleado", "registro_id": emp["id"]}
    )
    assert r.status_code == 403
    await crear_empresa(client, superadmin, "Sol", "admin@sol.mx")
    otro = auth(await login(client, "admin@sol.mx"))
    r = await client.get(
        "/api/actividad", headers=otro, params={"modelo": "empleado", "registro_id": emp["id"]}
    )
    assert r.status_code == 404


async def test_turno_quebrado_y_retardo_al_regresar(client, superadmin):
    a, _, _, emp = await _setup(client, superadmin)
    dias = [
        {
            "dia_semana": d,
            "entrada": "09:00",
            "salida": "14:00",
            "entrada2": "16:00",
            "salida2": "19:00",
        }
        for d in range(5)
    ]
    r = await client.post(
        "/api/turnos",
        headers=a,
        json={"nombre": "Quebrado", "tipo_jornada": "diurna", "dias": dias},
    )
    assert r.status_code == 201, r.text
    turno = r.json()
    assert turno["minutos_semana"] == 40 * 60 and turno["advertencias"] == []
    assert turno["dias"][0]["entrada2"] == "16:00:00"

    # Validaciones del segundo horario.
    malo = [{"dia_semana": 0, "entrada": "09:00", "salida": "14:00", "entrada2": "16:00"}]
    r = await client.post(
        "/api/turnos", headers=a, json={"nombre": "Malo", "tipo_jornada": "diurna", "dias": malo}
    )
    assert r.status_code == 422

    r = await client.post(
        f"/api/empleados/{emp['id']}/turno",
        headers=a,
        json={"turno_id": turno["id"], "fecha_inicio": "2025-01-15"},
    )
    assert r.status_code == 200

    async def manual(tipo, hora_local):
        # Lunes 3 de marzo de 2025 en Cancún (UTC-5).
        momento = f"2025-03-03T{hora_local}:00-05:00"
        r = await client.post(
            "/api/checadas/manual",
            headers=a,
            json={"empleado_id": emp["id"], "tipo": tipo, "momento": momento, "motivo": "Prueba"},
        )
        assert r.status_code == 201, r.text
        return r.json()

    assert (await manual("entrada", "09:05"))["retardo_minutos"] is None  # dentro de tolerancia
    await manual("salida", "14:00")
    assert (await manual("entrada", "16:20"))["retardo_minutos"] == 20  # regreso de comer
    await manual("salida", "19:00")
