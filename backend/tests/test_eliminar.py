"""Borrado de registros: solo lo que no tiene historial; lo demás se da de baja (LFT)."""

from tests.conftest import auth, crear_empresa, login
from tests.test_asistencia import LUN, _manual, _setup


async def test_borrar_empleado_sucursal_y_turno(client, superadmin):
    a, suc, emp = await _setup(client, superadmin)
    turno_id = emp["turno_actual"]["id"]

    # Con empleados o asignaciones no se puede borrar la sucursal ni el turno.
    r = await client.delete(f"/api/sucursales/{suc['id']}", headers=a)
    assert r.status_code == 409 and "Desactívala" in r.json()["detail"]
    assert (await client.delete(f"/api/turnos/{turno_id}", headers=a)).status_code == 409

    # Con checadas, el empleado tampoco: se da de baja.
    await _manual(client, a, emp, "entrada", LUN, "09:00")
    r = await client.delete(f"/api/empleados/{emp['id']}", headers=a)
    assert r.status_code == 409 and "baja" in r.json()["detail"]

    # Uno capturado por error, sin historial, sí se borra.
    nuevo = (
        await client.post(
            "/api/empleados",
            headers=a,
            json={
                "numero": "2",
                "nombre": "Luis",
                "apellido_paterno": "Paz",
                "fecha_ingreso": "2024-03-01",
                "sucursal_id": suc["id"],
            },
        )
    ).json()
    assert (await client.delete(f"/api/empleados/{nuevo['id']}", headers=a)).status_code == 204
    assert (await client.get(f"/api/empleados/{nuevo['id']}", headers=a)).status_code == 404

    otro = (
        await client.post(
            "/api/turnos",
            headers=a,
            json={
                "nombre": "Sin usar",
                "tipo_jornada": "diurna",
                "dias": [{"dia_semana": 0, "entrada": "09:00", "salida": "17:00"}],
            },
        )
    ).json()
    assert (await client.delete(f"/api/turnos/{otro['id']}", headers=a)).status_code == 204
    vacia = (
        await client.post(
            "/api/sucursales",
            headers=a,
            json={"clave": "MID", "nombre": "Mérida", "zona_horaria": "America/Merida"},
        )
    ).json()
    assert (await client.delete(f"/api/sucursales/{vacia['id']}", headers=a)).status_code == 204


async def test_borrar_usuario_y_enviar_cambio_de_password(client, superadmin):
    await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    a = auth(await login(client, "admin@caribe.mx"))
    yo = (await client.get("/api/auth/me", headers=a)).json()
    u = (
        await client.post(
            "/api/usuarios",
            headers=a,
            json={
                "nombre": "Ceci Mora",
                "email": "ceci@caribe.mx",
                "password": "Secreta123!",
                "rol": "admin_empresa",
            },
        )
    ).json()
    r = await client.post(f"/api/usuarios/{u['id']}/enviar-cambio-password", headers=a)
    assert r.status_code == 202, r.text
    assert r.json()["mensaje"]
    assert (await client.delete(f"/api/usuarios/{yo['id']}", headers=a)).status_code == 422
    assert (await client.delete(f"/api/usuarios/{u['id']}", headers=a)).status_code == 204


async def test_borrar_empresa(client, superadmin):
    a, _, emp = await _setup(client, superadmin)
    await _manual(client, a, emp, "entrada", LUN, "09:00")
    empresas = (await client.get("/api/empresas", headers=superadmin)).json()
    caribe = next(e for e in empresas if e["nombre"] == "Empresa Caribe")
    assert caribe["demo"] is False
    url = f"/api/empresas/{caribe['id']}"
    assert (await client.delete(url, headers=superadmin)).status_code == 409
    r = await client.patch(url, headers=superadmin, json={"demo": True})
    assert r.json()["demo"] is True
    me = (await client.get("/api/auth/me", headers=a)).json()
    assert me["empresa"]["demo"] is True
    assert (await client.delete(url, headers=superadmin)).status_code == 204
    assert (await client.get(url, headers=superadmin)).status_code == 404
