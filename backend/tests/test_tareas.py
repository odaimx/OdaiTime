from datetime import UTC, date, datetime, timedelta

from tests.test_asistencia import _setup


async def test_actividades_programadas(client, superadmin):
    a, suc, emp = await _setup(client, superadmin)
    hoy = date.today()

    r = await client.post(
        "/api/tareas",
        headers=a,
        json={
            "modelo": "empleado",
            "registro_id": emp["id"],
            "tipo": "llamada",
            "resumen": "Confirmar documentos",
            "fecha": str(hoy - timedelta(days=1)),
        },
    )
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["registro_nombre"] == "Ana Ruiz (#1)" and t["asignado"]["nombre"]

    # Una general (sin registro) para mañana.
    r = await client.post(
        "/api/tareas",
        headers=a,
        json={"tipo": "reunion", "resumen": "Junta", "fecha": str(hoy + timedelta(days=1))},
    )
    assert r.status_code == 201, r.text

    r = await client.get("/api/tareas/resumen", headers=a, params={"modelo": "empleado"})
    assert r.json()[emp["id"]] == {"pendientes": 1, "proxima": str(hoy - timedelta(days=1))}

    params = {"desde": str(hoy - timedelta(days=7)), "hasta": str(hoy + timedelta(days=7))}
    r = await client.get("/api/tareas/calendario", headers=a, params=params)
    assert len(r.json()) == 2
    assert len((await client.get("/api/tareas/mias", headers=a)).json()) == 2

    r = await client.post(f"/api/tareas/{t['id']}/hecha", headers=a, json={"comentario": "Listo"})
    assert r.json()["hecha_en"]
    r = await client.get("/api/tareas/resumen", headers=a, params={"modelo": "empleado"})
    assert r.json() == {}

    # Queda anotado en la bitácora del empleado.
    r = await client.get(
        "/api/actividad", headers=a, params={"modelo": "empleado", "registro_id": emp["id"]}
    )
    assert any("Llamada hecha: Confirmar documentos" in (x["mensaje"] or "") for x in r.json())

    r = await client.post(
        "/api/tareas",
        headers=a,
        json={"modelo": "empleado", "tipo": "tarea", "resumen": "x", "fecha": str(hoy)},
    )
    assert r.status_code == 422

    # Empleado "en el trabajo": su última checada es una entrada.
    momento = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
    r = await client.post(
        "/api/checadas/manual",
        headers=a,
        json={"empleado_id": emp["id"], "tipo": "entrada", "momento": momento, "motivo": "Prueba"},
    )
    assert r.status_code == 201, r.text
    assert (await client.get("/api/empleados/presentes", headers=a)).json() == [emp["id"]]
