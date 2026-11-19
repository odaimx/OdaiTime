"""API de integración con el módulo de licencias de Odoo (firma HMAC, sin repetición)."""

import hashlib
import hmac
import json
import secrets
import time

import pytest

from app.core.config import get_settings

SECRETO = "s" * 48


@pytest.fixture(autouse=True)
def _secreto():
    s = get_settings()
    anterior = s.integracion_secreto
    s.integracion_secreto = SECRETO
    yield
    s.integracion_secreto = anterior


def _firmar(metodo: str, ruta: str, cuerpo: bytes = b"", ts: int | None = None, nonce=None):
    ts = str(ts or int(time.time()))
    nonce = nonce or secrets.token_hex(16)
    mensaje = "\n".join([ts, nonce, metodo, ruta, hashlib.sha256(cuerpo).hexdigest()])
    firma = hmac.new(SECRETO.encode(), mensaje.encode(), hashlib.sha256).hexdigest()
    return {"X-Odai-Timestamp": ts, "X-Odai-Nonce": nonce, "X-Odai-Firma": firma}


async def _put(client, slug: str, datos: dict):
    ruta = f"/api/integracion/empresas/{slug}"
    cuerpo = json.dumps(datos).encode()
    h = {**_firmar("PUT", ruta, cuerpo), "Content-Type": "application/json"}
    return await client.put(ruta, content=cuerpo, headers=h)


async def test_firma_y_repeticion(client):
    ruta = "/api/integracion/ping"
    h = _firmar("GET", ruta)
    assert (await client.get(ruta, headers=h)).status_code == 200
    assert (await client.get(ruta, headers=h)).status_code == 401  # mismo nonce: repetida
    malo = {**_firmar("GET", ruta), "X-Odai-Firma": "0" * 64}
    assert (await client.get(ruta, headers=malo)).status_code == 401
    viejo = _firmar("GET", ruta, ts=int(time.time()) - 3600)
    assert (await client.get(ruta, headers=viejo)).status_code == 401
    assert (await client.get(ruta)).status_code == 401


async def test_odoo_crea_suspende_y_reactiva(client, superadmin):
    r = await _put(
        client,
        "hotelmar",
        {
            "nombre": "Hotel Mar",
            "max_empleados": 40,
            "max_usuarios": 3,
            "licencia_vence": "2099-01-31",
            "periodicidad": "mensual",
            "referencia_odoo": "SUB-0042",
            "administrador": {"nombre": "Lucía Mar", "email": "lucia@hotelmar.mx"},
        },
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["creada"] is True and d["estado"] == "corriendo" and d["max_usuarios"] == 3
    assert d["enlace_administrador"]  # sin correo saliente: enlace para mandarlo a mano

    # Suspensión con motivo: el administrador ya no entra y se le explica por qué.
    r = await _put(
        client, "hotelmar", {"estado": "suspendida", "motivo_suspension": "Pago pendiente"}
    )
    assert r.json()["bloqueada"] is True and "Pago pendiente" in r.json()["mensaje_bloqueo"]
    empresas = (await client.get("/api/empresas", headers=superadmin)).json()
    mar = next(e for e in empresas if e["slug"] == "hotelmar")
    assert mar["activa"] is False and mar["estado"] == "suspendida"

    # Renovación: vuelve a correr y se limpia el motivo.
    r = await _put(client, "hotelmar", {"estado": "corriendo", "licencia_vence": "2099-12-31"})
    assert r.json()["bloqueada"] is False and r.json()["motivo_suspension"] is None
    ruta = "/api/integracion/empresas/hotelmar"
    r = await client.get(ruta, headers=_firmar("GET", ruta))
    assert r.json()["licencia_vence"] == "2099-12-31" and r.json()["creada"] is False

    r = await _put(client, "noexiste", {"max_empleados": 5})
    assert r.status_code == 422  # para crear se necesita el nombre
