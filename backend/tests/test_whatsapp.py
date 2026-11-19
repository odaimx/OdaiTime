import hashlib
import hmac
import json
import time
from datetime import date, timedelta

import pytest

from app.services import whatsapp as wa
from tests.test_checadas import LAT, LON, _config, _setup

SECRETO = "secreto-de-la-app"


@pytest.fixture
def enviados(monkeypatch):
    lista: list[tuple[str, str]] = []

    async def falso(cfg, para, texto):
        lista.append((para, texto))
        return True, None

    monkeypatch.setattr(wa, "enviar_texto", falso)
    return lista


async def _activar(client, a, emp):
    await client.patch(f"/api/empleados/{emp['id']}", headers=a, json={"telefono": "998 123 4567"})
    r = await client.put(
        "/api/whatsapp/config",
        headers=a,
        json={
            "activo": True,
            "phone_number_id": "1111",
            "numero": "+52 998 000 0000",
            "token": "EAAG-token",
            "app_secret": SECRETO,
        },
    )
    assert r.status_code == 200, r.text
    cfg = r.json()
    assert cfg["tiene_token"] and cfg["tiene_secreto"] and "token" not in cfg
    return cfg


def _mensaje(tipo: str, contenido: dict, mid: str, desde="5219981234567") -> dict:
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "metadata": {"phone_number_id": "1111"},
                            "messages": [
                                {
                                    "id": mid,
                                    "from": desde,
                                    "timestamp": str(int(time.time())),
                                    "type": tipo,
                                    tipo: contenido,
                                }
                            ],
                        }
                    }
                ]
            }
        ],
    }


async def _enviar(client, cfg, cuerpo: dict, firmar=True):
    datos = json.dumps(cuerpo).encode()
    firma = "sha256=" + hmac.new(SECRETO.encode(), datos, hashlib.sha256).hexdigest()
    return await client.post(
        cfg["webhook_url"].split("http://test")[1],
        content=datos,
        headers={
            "content-type": "application/json",
            "x-hub-signature-256": firma if firmar else "",
        },
    )


async def test_webhook_verificacion_y_firma(client, superadmin, enviados):
    a, _, _, emp = await _setup(client, superadmin)
    cfg = await _activar(client, a, emp)
    ruta = cfg["webhook_url"].split("http://test")[1]
    r = await client.get(
        ruta,
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": cfg["verify_token"],
            "hub.challenge": "42",
        },
    )
    assert r.status_code == 200 and r.text == "42"
    r = await client.get(
        ruta, params={"hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "42"}
    )
    assert r.status_code == 403
    r = await _enviar(client, cfg, _mensaje("text", {"body": "hola"}, "m0"), firmar=False)
    assert r.status_code == 403
    assert enviados == []


async def test_checar_por_whatsapp(client, superadmin, enviados):
    a, e, suc, emp = await _setup(client, superadmin)
    cfg = await _activar(client, a, emp)
    await _config(client, a, ignorar_repetida_min=0)

    await _enviar(client, cfg, _mensaje("text", {"body": "hola"}, "m1"))
    assert "ubicación actual" in enviados[-1][1]

    # Lugar elegido en el mapa: no cuenta.
    lugar = {"latitude": LAT, "longitude": LON, "name": "Hotel", "address": "Av. Kukulcán"}
    await _enviar(client, cfg, _mensaje("location", lugar, "m2"))
    assert "elegida en el mapa" in enviados[-1][1]

    # Lejos de la sucursal.
    await _enviar(client, cfg, _mensaje("location", {"latitude": 21.2, "longitude": LON}, "m3"))
    assert enviados[-1][1].startswith("❌")

    # Ubicación actual dentro del radio: entrada.
    actual = {"latitude": LAT + 0.0003, "longitude": LON}
    await _enviar(client, cfg, _mensaje("location", actual, "m4"))
    assert enviados[-1][1].startswith("✅ Entrada"), enviados[-1]
    # Reintento de Meta con el mismo id: no se duplica.
    n = len(enviados)
    await _enviar(client, cfg, _mensaje("location", actual, "m4"))
    assert len(enviados) == n

    hoy = date.today()
    r = await client.get(
        "/api/checadas",
        headers=a,
        params={"desde": str(hoy - timedelta(days=1)), "hasta": str(hoy + timedelta(days=1))},
    )
    assert [c["origen"] for c in r.json()] == ["whatsapp"]

    await _enviar(client, cfg, _mensaje("text", {"body": "Hoy"}, "m5"))
    assert "Entrada" in enviados[-1][1]

    # Número desconocido.
    await _enviar(client, cfg, _mensaje("text", {"body": "hola"}, "m6", desde="5215550000000"))
    assert "no está registrado" in enviados[-1][1]

    # Si su ficha dice que no checa por WhatsApp.
    await client.patch(
        f"/api/empleados/{emp['id']}", headers=a, json={"medios_checado": ["kiosco"]}
    )
    await _enviar(client, cfg, _mensaje("location", actual, "m7"))
    assert "no checas por WhatsApp" in enviados[-1][1]


async def test_config_requiere_datos(client, superadmin):
    a, _, _, _ = await _setup(client, superadmin)
    r = await client.put("/api/whatsapp/config", headers=a, json={"activo": True})
    assert r.status_code == 422
    r = await client.get("/api/whatsapp/config", headers=a)
    assert r.json()["activo"] is False
