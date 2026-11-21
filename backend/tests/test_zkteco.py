"""Relojes ZKTeco: envío directo ADMS (/iclock)."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from tests.test_checadas import _setup

SN = "CKJX201760123"


async def _reloj(client, a, suc, **extra):
    r = await client.post(
        "/api/dispositivos",
        headers=a,
        json={
            "nombre": "ZKTeco entrada",
            "sucursal_id": suc["id"],
            "tipo": "biometrico",
            "serie": SN.lower(),
            **extra,
        },
    )
    return r


async def test_adms_zkteco(client, superadmin):
    a, _, suc, _ = await _setup(client, superadmin)
    # Validaciones: ADMS solo para relojes con número de serie.
    r = await client.post(
        "/api/dispositivos",
        headers=a,
        json={"nombre": "Tablet", "sucursal_id": suc["id"], "adms": True},
    )
    assert r.status_code == 422
    r = await _reloj(client, a, suc, ips_permitidas="no-es-ip")
    assert r.status_code == 422
    r = await _reloj(client, a, suc)  # aún sin ADMS habilitado
    assert r.status_code == 201, r.text
    reloj = r.json()
    assert reloj["serie"] == SN and reloj["adms"] is False

    # Sin habilitar, el reloj no entra.
    assert (await client.get(f"/iclock/cdata?SN={SN}&options=all")).status_code == 401

    r = await client.patch(
        f"/api/dispositivos/{reloj['id']}",
        headers=a,
        json={"adms": True, "ips_permitidas": "10.0.0.0/8"},
    )
    assert r.status_code == 200 and r.json()["ips_permitidas"] == "10.0.0.0/8"
    # IP no permitida (el cliente de pruebas es 127.0.0.1).
    assert (await client.get(f"/iclock/cdata?SN={SN}&options=all")).status_code == 401
    await client.patch(
        f"/api/dispositivos/{reloj['id']}", headers=a, json={"ips_permitidas": "127.0.0.1"}
    )
    r = await client.get(f"/iclock/cdata?SN={SN}&options=all&pushver=2.4.1")
    assert r.status_code == 200 and f"GET OPTION FROM: {SN}" in r.text
    assert "TimeZone=" in r.text

    # Número de serie duplicado en otro reloj con ADMS: rechazado.
    r = await _reloj(client, a, suc, adms=True)
    assert r.status_code == 409

    # Marcas: hora local de la sucursal, como las manda el reloj.
    tz = ZoneInfo(suc["zona_horaria"])
    ahora = datetime.now(tz).replace(microsecond=0, tzinfo=None)
    fmt = "%Y-%m-%d %H:%M:%S"
    cuerpo = (
        f"1001\t{(ahora - timedelta(hours=9)):{fmt}}\t0\t1\t0\t0\n"
        f"1001\t{(ahora - timedelta(hours=1)):{fmt}}\t1\t1\t0\t0\n"
        f"9999\t{ahora:{fmt}}\t0\t1\t0\t0\n"
        "basura sin tabuladores\n"
    )
    r = await client.post(f"/iclock/cdata?SN={SN}&table=ATTLOG&Stamp=1", content=cuerpo)
    assert r.status_code == 200 and r.text == "OK: 3"
    # Reenvío: idempotente.
    r = await client.post(f"/iclock/cdata?SN={SN}&table=ATTLOG&Stamp=1", content=cuerpo)
    assert r.text == "OK: 3"
    r = await client.post(f"/iclock/cdata?SN={SN}&table=OPERLOG", content="OPLOG 4\t0\n")
    assert r.text == "OK"
    assert (await client.get(f"/iclock/getrequest?SN={SN}")).text == "OK"
    assert (await client.get("/iclock/getrequest?SN=OTRO")).status_code == 401

    hoy = datetime.now(tz).date()
    lista = (
        await client.get(
            "/api/checadas",
            headers=a,
            params={"desde": str(hoy - timedelta(days=1)), "hasta": str(hoy + timedelta(days=1))},
        )
    ).json()
    bio = [c for c in lista if c["origen"] == "biometrico"]
    assert [c["tipo"] for c in sorted(bio, key=lambda c: c["momento"])] == ["entrada", "salida"]
    disp = (await client.get("/api/dispositivos", headers=a)).json()
    assert next(d for d in disp if d["id"] == reloj["id"])["ultima_conexion"]
