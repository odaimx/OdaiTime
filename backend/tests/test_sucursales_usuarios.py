from tests.conftest import PASSWORD, auth, crear_empresa, login


async def _sucursal(client, headers, clave, zona="America/Cancun", **params):
    r = await client.post(
        "/api/sucursales",
        headers=headers,
        params=params,
        json={"clave": clave, "nombre": f"Sucursal {clave}", "zona_horaria": zona},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_aislamiento_entre_empresas(client, superadmin):
    await crear_empresa(client, superadmin, "A", "admin@a.mx")
    await crear_empresa(client, superadmin, "B", "admin@b.mx")
    a = auth(await login(client, "admin@a.mx"))
    b = auth(await login(client, "admin@b.mx"))

    suc_a = await _sucursal(client, a, "CUN")

    # B no la ve en el listado ni puede leerla o editarla.
    assert (await client.get("/api/sucursales", headers=b)).json() == []
    assert (await client.get(f"/api/sucursales/{suc_a['id']}", headers=b)).status_code == 404
    r = await client.patch(f"/api/sucursales/{suc_a['id']}", headers=b, json={"nombre": "Hack"})
    assert r.status_code == 404

    # Ni pasando empresa_id de A (solo el superadmin puede elegir empresa).
    r = await client.get("/api/sucursales", headers=b, params={"empresa_id": suc_a["empresa_id"]})
    assert r.json() == []

    # B no puede asignar sucursales de A a sus usuarios.
    r = await client.post(
        "/api/usuarios",
        headers=b,
        json={
            "email": "g@b.mx",
            "nombre": "Gerente B",
            "password": PASSWORD,
            "rol": "gerente_sucursal",
            "sucursal_ids": [suc_a["id"]],
        },
    )
    assert r.status_code == 422


async def test_clave_unica_por_empresa_y_zona_valida(client, superadmin):
    await crear_empresa(client, superadmin, "A", "admin@a.mx")
    await crear_empresa(client, superadmin, "B", "admin@b.mx")
    a = auth(await login(client, "admin@a.mx"))
    b = auth(await login(client, "admin@b.mx"))

    await _sucursal(client, a, "CUN")
    await _sucursal(client, b, "CUN")  # otra empresa puede repetir la clave
    r = await client.post("/api/sucursales", headers=a, json={"clave": "CUN", "nombre": "Repetida"})
    assert r.status_code == 409

    r = await client.post(
        "/api/sucursales",
        headers=a,
        json={"clave": "MAR", "nombre": "Marte", "zona_horaria": "Marte/Olimpo"},
    )
    assert r.status_code == 422


async def test_gerente_solo_ve_sus_sucursales(client, superadmin):
    await crear_empresa(client, superadmin, "A", "admin@a.mx")
    a = auth(await login(client, "admin@a.mx"))
    cun = await _sucursal(client, a, "CUN")
    await _sucursal(client, a, "MID", zona="America/Merida")

    r = await client.post(
        "/api/usuarios",
        headers=a,
        json={
            "email": "gerente@a.mx",
            "nombre": "Gerente Cancún",
            "password": PASSWORD,
            "rol": "gerente_sucursal",
            "sucursal_ids": [cun["id"]],
        },
    )
    assert r.status_code == 201, r.text
    assert [s["clave"] for s in r.json()["sucursales"]] == ["CUN"]

    g = auth(await login(client, "gerente@a.mx"))
    visibles = (await client.get("/api/sucursales", headers=g)).json()
    assert [s["clave"] for s in visibles] == ["CUN"]

    # El gerente no administra sucursales ni usuarios.
    r = await client.post("/api/sucursales", headers=g, json={"clave": "X", "nombre": "Nueva"})
    assert r.status_code == 403
    assert (await client.get("/api/usuarios", headers=g)).status_code == 403


async def test_reglas_de_usuarios(client, superadmin):
    await crear_empresa(client, superadmin, "A", "admin@a.mx")
    tokens = await login(client, "admin@a.mx")
    a = auth(tokens)
    yo = tokens["usuario"]["id"]

    base = {"email": "x@a.mx", "nombre": "Xavier", "password": PASSWORD}
    # No se crea superadmin desde una empresa.
    r = await client.post("/api/usuarios", headers=a, json={**base, "rol": "superadmin"})
    assert r.status_code == 403
    # Gerente sin sucursal.
    r = await client.post("/api/usuarios", headers=a, json={**base, "rol": "gerente_sucursal"})
    assert r.status_code == 422
    # Correo repetido.
    r = await client.post(
        "/api/usuarios", headers=a, json={**base, "email": "ADMIN@a.mx", "rol": "empleado"}
    )
    assert r.status_code == 409
    # No puede desactivarse a sí mismo.
    r = await client.patch(f"/api/usuarios/{yo}", headers=a, json={"activo": False})
    assert r.status_code == 422


async def test_desactivar_usuario_cierra_sesiones(client, superadmin):
    await crear_empresa(client, superadmin, "A", "admin@a.mx")
    a = auth(await login(client, "admin@a.mx"))
    r = await client.post(
        "/api/usuarios",
        headers=a,
        json={"email": "e@a.mx", "nombre": "Empleado", "password": PASSWORD, "rol": "empleado"},
    )
    emp_id = r.json()["id"]
    emp_tokens = await login(client, "e@a.mx")

    r = await client.patch(f"/api/usuarios/{emp_id}", headers=a, json={"activo": False})
    assert r.status_code == 200
    assert (await client.get("/api/auth/me", headers=auth(emp_tokens))).status_code == 401
    r = await client.post("/api/auth/refresh", json={"refresh_token": emp_tokens["refresh_token"]})
    assert r.status_code == 401


async def test_superadmin_opera_sobre_una_empresa(client, superadmin):
    empresa = await crear_empresa(client, superadmin, "A", "admin@a.mx")
    assert (await client.get("/api/sucursales", headers=superadmin)).status_code == 400
    await _sucursal(client, superadmin, "CUN", empresa_id=empresa["id"])
    r = await client.get(
        "/api/sucursales", headers=superadmin, params={"empresa_id": empresa["id"]}
    )
    assert [s["clave"] for s in r.json()] == ["CUN"]
