from datetime import date, timedelta

from tests.conftest import PASSWORD, auth, crear_empresa, login

LUN = date(2025, 3, 3)  # lunes; ingreso 2024-03-01


async def _setup(client, superadmin):
    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    a = auth(await login(client, "admin@caribe.mx"))
    suc = (
        await client.post(
            "/api/sucursales",
            headers=a,
            json={"clave": "CUN", "nombre": "Cancún", "zona_horaria": "America/Cancun"},
        )
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
                "fecha_ingreso": "2024-03-01",
                "sucursal_id": suc["id"],
                "turno_id": turno["id"],
            },
        )
    ).json()
    return a, suc, emp


async def _manual(client, a, emp, tipo, d: date, hhmm: str):
    r = await client.post(
        "/api/checadas/manual",
        headers=a,
        json={
            "empleado_id": emp["id"],
            "tipo": tipo,
            "momento": f"{d.isoformat()}T{hhmm}:00-05:00",
            "motivo": "Carga de prueba",
        },
    )
    assert r.status_code == 201, r.text


async def test_tarjeta_de_asistencia(client, superadmin):
    a, suc, emp = await _setup(client, superadmin)
    # Lunes normal, martes con retardo y 2 h extra, miércoles falta, jueves vacaciones,
    # viernes asistencia, domingo trabajado (descanso).
    await _manual(client, a, emp, "entrada", LUN, "09:00")
    await _manual(client, a, emp, "salida", LUN, "17:00")
    await _manual(client, a, emp, "entrada", LUN + timedelta(1), "09:30")
    await _manual(client, a, emp, "salida", LUN + timedelta(1), "19:30")
    await _manual(client, a, emp, "entrada", LUN + timedelta(4), "09:00")
    await _manual(client, a, emp, "salida", LUN + timedelta(4), "17:00")
    await _manual(client, a, emp, "entrada", LUN + timedelta(6), "10:00")
    await _manual(client, a, emp, "salida", LUN + timedelta(6), "14:00")
    r = await client.post(
        "/api/asistencia/incidencias",
        headers=a,
        json={
            "empleado_id": emp["id"],
            "tipo": "vacaciones",
            "fecha_inicio": str(LUN + timedelta(3)),
            "fecha_fin": str(LUN + timedelta(3)),
        },
    )
    assert r.status_code == 201, r.text

    params = {"desde": str(LUN), "hasta": str(LUN + timedelta(6))}
    filas = (await client.get("/api/asistencia/resumen", headers=a, params=params)).json()
    assert len(filas) == 1
    res = filas[0]["resumen"]
    assert res["asistencias"] == 3 and res["faltas"] == 1
    assert res["retardos"] == 1 and res["minutos_retardo"] == 30
    assert res["minutos_dobles"] == 120
    assert res["incidencias"] == {"vacaciones": 1}
    assert res["domingos_trabajados"] == 1 and res["descansos_trabajados"] == 1

    det = (
        await client.get(f"/api/asistencia/empleado/{emp['id']}", headers=a, params=params)
    ).json()
    assert [d["estado"] for d in det["dias"]] == [
        "asistencia",
        "asistencia",
        "falta",
        "vacaciones",
        "asistencia",
        "descanso",
        "descanso",
    ]
    assert det["dias"][1]["extra_min"] == 120

    # Política: 1 retardo = 1 falta.
    pol = (await client.get("/api/asistencia/politica", headers=a)).json()
    r = await client.put(
        "/api/asistencia/politica", headers=a, json={**pol, "retardos_por_falta": 1}
    )
    assert r.status_code == 200
    filas = (await client.get("/api/asistencia/resumen", headers=a, params=params)).json()
    assert filas[0]["resumen"]["faltas_por_retardos"] == 1

    # Rango demasiado largo.
    r = await client.get(
        "/api/asistencia/resumen", headers=a, params={"desde": "2025-01-01", "hasta": "2025-06-01"}
    )
    assert r.status_code == 422


async def test_incidencias_empalme_y_festivo(client, superadmin):
    a, _, emp = await _setup(client, superadmin)
    base = {"empleado_id": emp["id"], "tipo": "incapacidad", "folio": "IMSS-123"}
    r = await client.post(
        "/api/asistencia/incidencias",
        headers=a,
        json={**base, "fecha_inicio": "2025-03-03", "fecha_fin": "2025-03-05"},
    )
    assert r.status_code == 201
    r = await client.post(
        "/api/asistencia/incidencias",
        headers=a,
        json={**base, "fecha_inicio": "2025-03-05", "fecha_fin": "2025-03-06"},
    )
    assert r.status_code == 409
    inc_id = (await client.get("/api/asistencia/incidencias", headers=a)).json()[0]["id"]
    assert (
        await client.delete(f"/api/asistencia/incidencias/{inc_id}", headers=a)
    ).status_code == 204

    # 17 de marzo de 2025: tercer lunes de marzo (festivo, art. 74) → no es falta.
    det = (
        await client.get(
            f"/api/asistencia/empleado/{emp['id']}",
            headers=a,
            params={"desde": "2025-03-17", "hasta": "2025-03-17"},
        )
    ).json()
    assert det["dias"][0]["estado"] == "festivo"
    assert "Juárez" in det["dias"][0]["festivo"]


async def test_vacaciones_y_permisos(client, superadmin):
    a, _, emp = await _setup(client, superadmin)
    v = (await client.get(f"/api/asistencia/vacaciones/{emp['id']}", headers=a)).json()
    # Ingresó el 1 de marzo de 2024: en 2026 ya cumplió 2 años → 14 días (art. 76).
    assert v["antiguedad_anios"] >= 2
    assert v["dias_correspondientes"] == {2: 14, 3: 16, 4: 18}.get(v["antiguedad_anios"], 20)
    assert v["dias_tomados"] == 0

    # El rol empleado no ve tarjetas ajenas.
    await client.post(
        f"/api/empleados/{emp['id']}/acceso",
        headers=a,
        json={"email": "ana@caribe.mx", "password": PASSWORD},
    )
    e = auth(await login(client, "ana@caribe.mx"))
    r = await client.get(
        "/api/asistencia/resumen", headers=e, params={"desde": "2025-03-01", "hasta": "2025-03-07"}
    )
    assert r.status_code == 403
