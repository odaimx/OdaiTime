from io import BytesIO

from openpyxl import Workbook, load_workbook

from tests.conftest import PASSWORD, auth, crear_empresa, login

LV = [
    {"dia_semana": d, "entrada": "09:00", "salida": "18:00", "comida_minutos": 60} for d in range(5)
]


async def _setup(client, superadmin):
    """Empresa con dos sucursales, un turno y un admin."""
    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    a = auth(await login(client, "admin@caribe.mx"))
    sucs = {}
    for clave in ("CUN", "PDC"):
        r = await client.post(
            "/api/sucursales",
            headers=a,
            json={"clave": clave, "nombre": f"Hotel {clave}", "zona_horaria": "America/Cancun"},
        )
        sucs[clave] = r.json()
    r = await client.post(
        "/api/turnos",
        headers=a,
        json={"nombre": "Oficina", "tipo_jornada": "diurna", "dias": LV},
    )
    assert r.status_code == 201, r.text
    return a, sucs, r.json()


def _empleado(numero, sucursal_id, **extra):
    return {
        "numero": numero,
        "nombre": "María",
        "apellido_paterno": "López",
        "fecha_ingreso": "2025-01-15",
        "sucursal_id": sucursal_id,
        **extra,
    }


async def test_turno_con_advertencias_lft(client, superadmin):
    a, _, oficina = await _setup(client, superadmin)
    assert oficina["minutos_semana"] == 40 * 60
    assert oficina["advertencias"] == []

    largo = [{"dia_semana": d, "entrada": "07:00", "salida": "19:00"} for d in range(7)]
    r = await client.post(
        "/api/turnos",
        headers=a,
        json={"nombre": "Abusivo", "tipo_jornada": "diurna", "dias": largo},
    )
    assert r.status_code == 201
    avisos = r.json()["advertencias"]
    assert any("art. 61" in x for x in avisos)
    assert any("art. 69" in x for x in avisos)

    # Validaciones duras.
    malo = {"nombre": "X1", "tipo_jornada": "diurna"}
    dup = [LV[0], LV[0]]
    assert (
        await client.post("/api/turnos", headers=a, json={**malo, "dias": dup})
    ).status_code == 422
    igual = [{"dia_semana": 0, "entrada": "09:00", "salida": "09:00"}]
    assert (
        await client.post("/api/turnos", headers=a, json={**malo, "dias": igual})
    ).status_code == 422
    r = await client.post("/api/turnos", headers=a, json={**malo, "nombre": "Oficina", "dias": LV})
    assert r.status_code == 409


async def test_editar_dias_del_turno(client, superadmin):
    a, _, oficina = await _setup(client, superadmin)
    nuevos = [{"dia_semana": d, "entrada": "08:00", "salida": "16:00"} for d in range(6)]
    r = await client.patch(f"/api/turnos/{oficina['id']}", headers=a, json={"dias": nuevos})
    assert r.status_code == 200, r.text
    assert len(r.json()["dias"]) == 6
    assert r.json()["minutos_semana"] == 48 * 60


async def test_crear_empleado_con_turno_y_validaciones(client, superadmin):
    a, sucs, oficina = await _setup(client, superadmin)
    r = await client.post(
        "/api/empleados",
        headers=a,
        json=_empleado(
            "1001",
            sucs["CUN"]["id"],
            curp="lopm900215mqrprr09",
            nss="1234567890-1",
            salario_diario="450.50",
            turno_id=oficina["id"],
            email="",
        ),
    )
    assert r.status_code == 201, r.text
    e = r.json()
    assert e["curp"] == "LOPM900215MQRPRR09"
    assert e["nss"] == "12345678901"
    assert e["email"] is None
    assert e["turno_actual"]["nombre"] == "Oficina"
    assert e["asignaciones"][0]["fecha_inicio"] == "2025-01-15"

    # Número repetido en la misma empresa.
    r = await client.post("/api/empleados", headers=a, json=_empleado("1001", sucs["CUN"]["id"]))
    assert r.status_code == 409
    # CURP inválida.
    r = await client.post(
        "/api/empleados", headers=a, json=_empleado("1002", sucs["CUN"]["id"], curp="XXX")
    )
    assert r.status_code == 422


async def test_historial_de_turnos(client, superadmin):
    a, sucs, oficina = await _setup(client, superadmin)
    noche = [{"dia_semana": d, "entrada": "22:00", "salida": "05:00"} for d in range(6)]
    r = await client.post(
        "/api/turnos",
        headers=a,
        json={"nombre": "Noche", "tipo_jornada": "nocturna", "dias": noche},
    )
    noche_id = r.json()["id"]
    r = await client.post(
        "/api/empleados",
        headers=a,
        json=_empleado("1001", sucs["CUN"]["id"], turno_id=oficina["id"]),
    )
    emp_id = r.json()["id"]

    r = await client.post(
        f"/api/empleados/{emp_id}/turno",
        headers=a,
        json={"turno_id": noche_id, "fecha_inicio": "2025-06-01"},
    )
    assert r.status_code == 200, r.text
    hist = r.json()["asignaciones"]
    assert [h["turno"]["nombre"] for h in hist] == ["Noche", "Oficina"]
    assert hist[1]["fecha_fin"] == "2025-05-31"
    assert hist[0]["fecha_fin"] is None
    assert r.json()["turno_actual"]["nombre"] == "Noche"

    # No antes del ingreso.
    r = await client.post(
        f"/api/empleados/{emp_id}/turno",
        headers=a,
        json={"turno_id": noche_id, "fecha_inicio": "2024-01-01"},
    )
    assert r.status_code == 422


async def test_gerente_solo_gestiona_sus_sucursales(client, superadmin):
    a, sucs, _ = await _setup(client, superadmin)
    r = await client.post(
        "/api/usuarios",
        headers=a,
        json={
            "email": "g@caribe.mx",
            "nombre": "Gerente CUN",
            "password": PASSWORD,
            "rol": "gerente_sucursal",
            "sucursal_ids": [sucs["CUN"]["id"]],
        },
    )
    assert r.status_code == 201
    r = await client.post("/api/empleados", headers=a, json=_empleado("2001", sucs["PDC"]["id"]))
    ajeno = r.json()["id"]

    g = auth(await login(client, "g@caribe.mx"))
    r = await client.post("/api/empleados", headers=g, json=_empleado("1001", sucs["CUN"]["id"]))
    assert r.status_code == 201
    propio = r.json()["id"]
    r = await client.post("/api/empleados", headers=g, json=_empleado("1002", sucs["PDC"]["id"]))
    assert r.status_code == 422

    lista = (await client.get("/api/empleados", headers=g)).json()
    assert [e["numero"] for e in lista] == ["1001"]
    assert (await client.get(f"/api/empleados/{ajeno}", headers=g)).status_code == 404
    # No puede mover a su empleado a una sucursal ajena.
    r = await client.patch(
        f"/api/empleados/{propio}", headers=g, json={"sucursal_id": sucs["PDC"]["id"]}
    )
    assert r.status_code == 422
    # Importar es solo para administradores.
    assert (await client.get("/api/empleados/plantilla", headers=g)).status_code == 403


async def test_busqueda_baja_y_reactivacion(client, superadmin):
    a, sucs, _ = await _setup(client, superadmin)
    await client.post(
        "/api/empleados",
        headers=a,
        json=_empleado("1001", sucs["CUN"]["id"], nombre="Ana", apellido_materno="Ruiz"),
    )
    r = await client.post(
        "/api/empleados",
        headers=a,
        json=_empleado("1002", sucs["CUN"]["id"], nombre="Luis", apellido_paterno="Gómez"),
    )
    luis = r.json()["id"]

    r = await client.get("/api/empleados", headers=a, params={"q": "lópez ruiz"})
    assert [e["numero"] for e in r.json()] == ["1001"]

    r = await client.post(
        f"/api/empleados/{luis}/baja",
        headers=a,
        json={"fecha_baja": "2025-08-31", "motivo": "Renuncia voluntaria"},
    )
    assert r.status_code == 200
    assert r.json()["activo"] is False
    activos = (await client.get("/api/empleados", headers=a)).json()
    assert [e["numero"] for e in activos] == ["1001"]
    bajas = (await client.get("/api/empleados", headers=a, params={"estado": "bajas"})).json()
    assert [e["numero"] for e in bajas] == ["1002"]

    r = await client.post(f"/api/empleados/{luis}/reactivar", headers=a)
    assert r.json()["activo"] is True and r.json()["fecha_baja"] is None


async def test_acceso_del_empleado(client, superadmin):
    a, sucs, _ = await _setup(client, superadmin)
    r = await client.post("/api/empleados", headers=a, json=_empleado("1001", sucs["CUN"]["id"]))
    emp_id = r.json()["id"]

    r = await client.post(
        f"/api/empleados/{emp_id}/acceso",
        headers=a,
        json={"email": "maria@caribe.mx", "password": PASSWORD},
    )
    assert r.status_code == 201, r.text
    assert r.json()["tiene_acceso"] is True

    tokens = await login(client, "maria@caribe.mx")
    assert tokens["usuario"]["rol"] == "empleado"
    assert [s["clave"] for s in tokens["usuario"]["sucursales"]] == ["CUN"]
    # El empleado no ve el catálogo de empleados.
    assert (await client.get("/api/empleados", headers=auth(tokens))).status_code == 403

    # La baja le quita el acceso.
    await client.post(
        f"/api/empleados/{emp_id}/baja",
        headers=a,
        json={"fecha_baja": "2025-09-01", "motivo": "Fin de contrato"},
    )
    r = await client.post(
        "/api/auth/login", json={"email": "maria@caribe.mx", "password": PASSWORD}
    )
    assert r.status_code == 403


def _xlsx(filas: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(["encabezados"])
    for f in filas:
        ws.append(f)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def test_plantilla_e_importacion(client, superadmin):
    a, _, _ = await _setup(client, superadmin)

    r = await client.get("/api/empleados/plantilla", headers=a)
    assert r.status_code == 200
    wb = load_workbook(BytesIO(r.content))
    assert wb.sheetnames == ["Empleados", "Catálogos"]
    assert wb["Empleados"]["A1"].value == "Número de empleado *"

    def fila(num, curp=None, suc="CUN", turno="oficina", fecha="15/01/2025"):
        return [
            num,
            "Ana",
            "Ruiz",
            None,
            curp,
            None,
            1234567890,
            fecha,
            None,
            None,
            400,
            None,
            None,
            suc,
            turno,
        ]

    # Con errores no se importa nada.
    malo = _xlsx([fila(1), fila(2, suc="XXX"), fila(1)])
    r = await client.post(
        "/api/empleados/importar",
        headers=a,
        files={"archivo": ("e.xlsx", malo, "application/octet-stream")},
    )
    body = r.json()
    assert body["creados"] == 0
    assert {e["fila"] for e in body["errores"]} == {3, 4}
    assert (await client.get("/api/empleados", headers=a)).json() == []

    bueno = _xlsx([fila(1), fila("A-2", fecha="2025-02-01", turno=None)])
    r = await client.post(
        "/api/empleados/importar",
        headers=a,
        files={"archivo": ("e.xlsx", bueno, "application/octet-stream")},
    )
    assert r.json() == {"creados": 2, "errores": []}
    lista = (await client.get("/api/empleados", headers=a)).json()
    por_numero = {e["numero"]: e for e in lista}
    assert por_numero["1"]["nss"] == "01234567890"  # recupera el cero perdido por Excel
    assert por_numero["1"]["turno_actual"]["nombre"] == "Oficina"
    assert por_numero["A-2"]["turno_actual"] is None
