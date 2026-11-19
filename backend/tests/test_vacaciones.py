from datetime import date, timedelta

from tests.conftest import PASSWORD, auth, login
from tests.test_asistencia import _setup


def _lunes(despues: date) -> date:
    return despues + timedelta(days=(7 - despues.weekday()) % 7 or 7)


async def _empleado(client, a, emp):
    await client.post(
        f"/api/empleados/{emp['id']}/acceso",
        headers=a,
        json={"email": "ana@caribe.mx", "password": PASSWORD},
    )
    return auth(await login(client, "ana@caribe.mx"))


async def test_solicitar_aprobar_y_calendario(client, superadmin):
    a, suc, emp = await _setup(client, superadmin)
    e = await _empleado(client, a, emp)
    ini = _lunes(date.today() + timedelta(days=14))
    fin = ini + timedelta(days=4)

    mias = (await client.get("/api/vacaciones/mias", headers=e)).json()
    assert mias["saldo"]["dias_correspondientes"] >= 14
    assert mias["solicitudes"] == []

    r = await client.post(
        "/api/vacaciones/mias",
        headers=e,
        json={"fecha_inicio": str(ini), "fecha_fin": str(fin), "motivo": "Viaje"},
    )
    assert r.status_code == 201, r.text
    sol = r.json()
    assert sol["estado"] == "pendiente"
    assert 1 <= sol["dias"] <= 5  # lunes a viernes (menos algún festivo)
    assert any("Art. 78" in x for x in sol["avisos"])

    # Empalme con la pendiente, fechas pasadas y más días de los disponibles.
    r = await client.post(
        "/api/vacaciones/mias", headers=e, json={"fecha_inicio": str(fin), "fecha_fin": str(fin)}
    )
    assert r.status_code == 409
    ayer = date.today() - timedelta(days=1)
    r = await client.post(
        "/api/vacaciones/mias", headers=e, json={"fecha_inicio": str(ayer), "fecha_fin": str(ayer)}
    )
    assert r.status_code == 422
    lejos = fin + timedelta(days=7)
    r = await client.post(
        "/api/vacaciones/mias",
        headers=e,
        json={"fecha_inicio": str(lejos), "fecha_fin": str(lejos + timedelta(days=60))},
    )
    assert r.status_code == 422
    assert "disponible" in r.json()["detail"]

    # Calendario del equipo: aparece por aprobar.
    cal = (
        await client.get(
            "/api/vacaciones/calendario",
            headers=a,
            params={"desde": str(ini), "hasta": str(fin), "sucursal_id": suc["id"]},
        )
    ).json()
    assert [x["numero"] for x in cal["empleados"]] == ["1"]
    assert cal["ausencias"][0]["pendiente"] is True

    # Rechazar exige motivo; aprobar crea la incidencia.
    r = await client.post(f"/api/vacaciones/solicitudes/{sol['id']}/rechazar", headers=a, json={})
    assert r.status_code == 422
    r = await client.post(
        f"/api/vacaciones/solicitudes/{sol['id']}/aprobar",
        headers=a,
        json={"comentario": "¡Disfrútalas!"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["estado"] == "aprobada"
    inc = (
        await client.get(
            "/api/asistencia/incidencias", headers=a, params={"empleado_id": emp["id"]}
        )
    ).json()
    assert inc[0]["tipo"] == "vacaciones" and inc[0]["fecha_inicio"] == str(ini)
    cal = (
        await client.get(
            "/api/vacaciones/calendario", headers=a, params={"desde": str(ini), "hasta": str(fin)}
        )
    ).json()
    assert cal["ausencias"][0]["tipo"] == "vacaciones"

    # El empleado ya no la cancela; el admin sí (aún no empieza) y se quita la incidencia.
    r = await client.post(f"/api/vacaciones/mias/{sol['id']}/cancelar", headers=e)
    assert r.status_code == 409
    r = await client.post(f"/api/vacaciones/solicitudes/{sol['id']}/cancelar", headers=a, json={})
    assert r.json()["estado"] == "cancelada"
    inc = (
        await client.get(
            "/api/asistencia/incidencias", headers=a, params={"empleado_id": emp["id"]}
        )
    ).json()
    assert inc == []

    lista = (await client.get("/api/vacaciones/solicitudes", headers=a)).json()
    assert lista[0]["estado"] == "cancelada"
    assert (await client.get("/api/vacaciones/solicitudes", headers=e)).status_code == 403
