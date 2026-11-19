"""Borrado de registros: solo lo que no tiene historial; lo demás se da de baja (LFT)."""

from tests.conftest import auth, crear_empresa, login
from tests.test_asistencia import LUN, _manual, _setup


async def test_borrar_empleado_sucursal_y_turno(client, superadmin):
    a, suc, emp = await _setup(client, superadmin)
    turno_id = emp["turno_actual"]["id"]

    # Con empleados o asignaciones no se puede borrar la sucursal ni el turno.
    r = await client.delete(f"/api/sucursales/{suc['id']}", headers=a)
    detalle = r.json()["detail"]
    assert (
        r.status_code == 409 and "1 empleado (en Empleados)" in detalle and "desactívala" in detalle
    )
    assert (await client.delete(f"/api/turnos/{turno_id}", headers=a)).status_code == 409

    # Con checadas, el empleado tampoco: se da de baja.
    await _manual(client, a, emp, "entrada", LUN, "09:00")
    r = await client.delete(f"/api/empleados/{emp['id']}", headers=a)
    assert r.status_code == 409 and "1 checada (en Asistencias)" in r.json()["detail"]

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
                "rol": "empleado",
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


async def test_un_administrador_y_limite_de_usuarios(client, superadmin):
    empresa = await crear_empresa(client, superadmin, "Caribe", "admin@caribe.mx")
    url = f"/api/empresas/{empresa['id']}/administrador"
    admin = (await client.get(url, headers=superadmin)).json()
    assert admin["email"] == "admin@caribe.mx"

    a = auth(await login(client, "admin@caribe.mx"))
    suc = (
        await client.post(
            "/api/sucursales",
            headers=a,
            json={"clave": "CUN", "nombre": "Cancún", "zona_horaria": "America/Cancun"},
        )
    ).json()
    base = {"password": "Secreta123!", "sucursal_ids": [suc["id"]]}
    # Solo un administrador: no se crea otro desde Usuarios.
    r = await client.post(
        "/api/usuarios",
        headers=a,
        json={**base, "nombre": "Otro Admin", "email": "o@caribe.mx", "rol": "admin_empresa"},
    )
    assert r.status_code == 409
    # Hasta 5 usuarios (el administrador no cuenta).
    for i in range(5):
        r = await client.post(
            "/api/usuarios",
            headers=a,
            json={
                **base,
                "nombre": f"Gerente {i}",
                "email": f"g{i}@caribe.mx",
                "rol": "gerente_sucursal",
            },
        )
        assert r.status_code == 201, r.text
    r = await client.post(
        "/api/usuarios",
        headers=a,
        json={**base, "nombre": "Sexto", "email": "g6@caribe.mx", "rol": "gerente_sucursal"},
    )
    assert r.status_code == 409 and "5 usuarios" in r.json()["detail"]
    # El administrador no se borra desde Usuarios.
    assert (await client.delete(f"/api/usuarios/{admin['id']}", headers=a)).status_code in (
        409,
        422,
    )

    # Odai lo cambia desde la empresa.
    r = await client.put(
        url, headers=superadmin, json={"nombre": "Nueva Admin", "email": "nueva@caribe.mx"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["id"] == admin["id"] and r.json()["email"] == "nueva@caribe.mx"
    r = await client.post(f"{url}/acceso", headers=superadmin)
    assert r.status_code == 202
    assert (await client.get(url, headers=a)).status_code == 403


async def test_subdominio_demo_disponible(client, superadmin):
    r = await client.post(
        "/api/empresas",
        headers=superadmin,
        json={
            "nombre": "Demo Odai",
            "slug": "demo",
            "demo": True,
            "admin": {"nombre": "Demo Admin", "email": "demo@odai.lat", "password": "Secreta123!"},
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["slug"] == "demo" and r.json()["demo"] is True
