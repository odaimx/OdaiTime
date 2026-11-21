"""Huella o rostro del celular (WebAuthn) con un autenticador simulado (llave ES256 real)."""

import base64
import hashlib
import json
import os
import struct

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

from tests.test_checadas import CERCA, _config, _setup
from tests.test_publico import FOTO, _slug

ORIGEN, RP_ID = "http://test", "test"


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class Autenticador:
    """Simula el sensor del teléfono: guarda la llave privada y firma con verificación (UV)."""

    def __init__(self):
        self.llave = ec.generate_private_key(ec.SECP256R1())
        self.id = os.urandom(32)
        self.contador = 0

    def _auth_data(self, flags: int, extra: bytes = b"") -> bytes:
        return (
            hashlib.sha256(RP_ID.encode()).digest()
            + bytes([flags])
            + struct.pack(">I", self.contador)
            + extra
        )

    def crear(self, opciones: dict) -> dict:
        nums = self.llave.public_key().public_numbers()
        cose = cbor2.dumps(
            {1: 2, 3: -7, -1: 1, -2: nums.x.to_bytes(32, "big"), -3: nums.y.to_bytes(32, "big")}
        )
        cred = bytes(16) + struct.pack(">H", len(self.id)) + self.id + cose
        auth = self._auth_data(0x01 | 0x04 | 0x40, cred)
        cd = json.dumps(
            {"type": "webauthn.create", "challenge": opciones["challenge"], "origin": ORIGEN}
        ).encode()
        return {
            "id": b64(self.id),
            "rawId": b64(self.id),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64(cd),
                "attestationObject": b64(
                    cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth})
                ),
                "transports": ["internal"],
            },
            "clientExtensionResults": {},
            "authenticatorAttachment": "platform",
        }

    def firmar(self, opciones: dict, uv: bool = True) -> dict:
        self.contador += 1
        auth = self._auth_data(0x01 | (0x04 if uv else 0))
        cd = json.dumps(
            {"type": "webauthn.get", "challenge": opciones["challenge"], "origin": ORIGEN}
        ).encode()
        firma = self.llave.sign(auth + hashlib.sha256(cd).digest(), ec.ECDSA(hashes.SHA256()))
        return {
            "id": b64(self.id),
            "rawId": b64(self.id),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64(cd),
                "authenticatorData": b64(auth),
                "signature": b64(firma),
            },
            "clientExtensionResults": {},
        }


async def _celular_aprobado(client, superadmin):
    a, _, _, emp = await _setup(client, superadmin)
    await _config(client, a, ignorar_repetida_min=0, permitir_movil=True)
    slug = await _slug(client, a)
    r = await client.post(
        "/api/publico/celular/vincular",
        json={"empresa": slug, "identificador": "1001", "pin": "1234", "aviso": "2026-11"},
    )
    assert r.status_code == 201, r.text
    h = {"X-Celular-Token": r.json()["token"]}
    cel = (await client.get(f"/api/empleados/{emp['id']}/celulares", headers=a)).json()[0]
    assert (await client.post(f"/api/celulares/{cel['id']}/aprobar", headers=a)).status_code == 200
    return a, emp, h


async def _checar(client, h, **campos):
    return await client.post(
        "/api/publico/celular/checar",
        headers=h,
        data={"accion": "entrada", **CERCA, **campos},
        files={"foto": FOTO},
    )


async def test_checar_con_huella(client, superadmin):
    a, emp, h = await _celular_aprobado(client, superadmin)
    assert (await client.get("/api/publico/celular/estado", headers=h)).json()["passkey"] is False

    # Activar: se confirma con el PIN.
    r = await client.post(
        "/api/publico/celular/passkey/opciones-registro", headers=h, json={"pin": "0000"}
    )
    assert r.status_code == 401
    r = await client.post(
        "/api/publico/celular/passkey/opciones-registro", headers=h, json={"pin": "1234"}
    )
    assert r.status_code == 200, r.text
    op = r.json()
    assert op["rp"]["id"] == RP_ID
    assert op["authenticatorSelection"]["userVerification"] == "required"
    tel = Autenticador()
    cred = tel.crear(op)
    r = await client.post("/api/publico/celular/passkey", headers=h, json={"credencial": cred})
    assert r.status_code == 201, r.text
    # El mismo reto no sirve dos veces.
    r = await client.post("/api/publico/celular/passkey", headers=h, json={"credencial": cred})
    assert r.status_code == 401
    assert (await client.get("/api/publico/celular/estado", headers=h)).json()["passkey"] is True
    lista = (await client.get(f"/api/empleados/{emp['id']}/celulares", headers=a)).json()
    assert lista[0]["passkey"] is True

    # Checar con la huella, sin PIN.
    op = (await client.post("/api/publico/celular/passkey/opciones", headers=h)).json()
    firma = tel.firmar(op)
    r = await _checar(client, h, passkey=json.dumps(firma))
    assert r.status_code == 201, r.text
    # Repetir la misma firma (reto usado) se rechaza.
    r = await _checar(client, h, accion="salida", passkey=json.dumps(firma))
    assert r.status_code == 401

    # Sin verificación del usuario (solo tocar la pantalla) no basta.
    op = (await client.post("/api/publico/celular/passkey/opciones", headers=h)).json()
    r = await _checar(client, h, accion="salida", passkey=json.dumps(tel.firmar(op, uv=False)))
    assert r.status_code == 401

    # Firma de otra llave (otro teléfono) con el mismo id: rechazada.
    op = (await client.post("/api/publico/celular/passkey/opciones", headers=h)).json()
    falso = Autenticador()
    falso.id = tel.id
    r = await _checar(client, h, accion="salida", passkey=json.dumps(falso.firmar(op)))
    assert r.status_code == 401

    # Reto alterado: rechazado.
    op = (await client.post("/api/publico/celular/passkey/opciones", headers=h)).json()
    reto = bytearray(unb64(op["challenge"]))
    reto[0] ^= 0xFF
    r = await _checar(
        client, h, accion="salida", passkey=json.dumps(tel.firmar({"challenge": b64(reto)}))
    )
    assert r.status_code == 401

    # Quitar la huella (con PIN) y volver al PIN.
    r = await client.request(
        "DELETE", "/api/publico/celular/passkey", headers=h, json={"pin": "1234"}
    )
    assert r.status_code == 204
    assert (
        await client.post("/api/publico/celular/passkey/opciones", headers=h)
    ).status_code == 422
