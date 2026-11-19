from datetime import date, timedelta

from tests.test_asistencia import _setup

PDF = ("cert.pdf", b"%PDF-1.4 certificado", "application/pdf")


async def _incapacidad(client, a, emp, ini, fin, **extra):
    return await client.post(
        "/api/asistencia/incidencias",
        headers=a,
        json={
            "empleado_id": emp["id"],
            "tipo": "incapacidad",
            "fecha_inicio": str(ini),
            "fecha_fin": str(fin),
            **extra,
        },
    )


async def test_ramo_tipo_subsecuente_y_alertas(client, superadmin):
    a, _, emp = await _setup(client, superadmin)
    hoy = date.today()
    ini = hoy - timedelta(days=5)

    # El ramo es obligatorio.
    r = await _incapacidad(client, a, emp, ini, hoy + timedelta(days=1))
    assert r.status_code == 422

    r = await _incapacidad(
        client, a, emp, ini, hoy + timedelta(days=1), ramo="riesgo_trabajo", folio="AB123"
    )
    assert r.status_code == 201, r.text
    inicial = r.json()
    assert inicial["tipo_incapacidad"] == "inicial" and inicial["tiene_certificado"] is False

    alertas = (await client.get("/api/asistencia/incapacidades/alertas", headers=a)).json()
    assert {x["tipo"] for x in alertas} == {"por_vencer", "sin_certificado"}

    # Subsecuente: debe seguir el día siguiente y ser del mismo ramo.
    sig = hoy + timedelta(days=2)
    r = await _incapacidad(
        client,
        a,
        emp,
        sig + timedelta(days=1),
        sig + timedelta(days=5),
        ramo="riesgo_trabajo",
        tipo_incapacidad="subsecuente",
    )
    assert r.status_code == 422
    r = await _incapacidad(
        client,
        a,
        emp,
        sig,
        sig + timedelta(days=5),
        ramo="enfermedad_general",
        tipo_incapacidad="subsecuente",
    )
    assert r.status_code == 422
    r = await _incapacidad(
        client,
        a,
        emp,
        sig,
        sig + timedelta(days=5),
        ramo="riesgo_trabajo",
        tipo_incapacidad="subsecuente",
    )
    assert r.status_code == 201, r.text

    # Certificado: PDF válido, se puede ver y quitar.
    r = await client.put(
        f"/api/asistencia/incidencias/{inicial['id']}/certificado",
        headers=a,
        files={"archivo": PDF},
    )
    assert r.status_code == 200, r.text
    assert r.json()["tiene_certificado"] is True
    r = await client.get(f"/api/asistencia/incidencias/{inicial['id']}/certificado", headers=a)
    assert r.status_code == 200 and r.content == PDF[1]
    malo = ("x.pdf", b"no es pdf", "application/pdf")
    r = await client.put(
        f"/api/asistencia/incidencias/{inicial['id']}/certificado",
        headers=a,
        files={"archivo": malo},
    )
    assert r.status_code == 422

    alertas = (await client.get("/api/asistencia/incapacidades/alertas", headers=a)).json()
    # La inicial ya tiene subsecuente y certificado; la subsecuente aún no tiene certificado.
    assert [x["tipo"] for x in alertas] == ["sin_certificado"]
    assert alertas[0]["incidencia"]["tipo_incapacidad"] == "subsecuente"
