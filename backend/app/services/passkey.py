"""Huella o rostro del celular (WebAuthn / passkeys) para checar sin PIN.

El reto (challenge) va firmado con HMAC: lleva el celular, el propósito y el vencimiento, así
que no hace falta guardarlo. Además se marca como usado en Valkey para que no se repita.
La verificación de firmas la hace py_webauthn; se exige verificación del usuario (huella,
rostro o bloqueo de pantalla del teléfono), no solo presencia.
"""

import hashlib
import hmac
import json
import os
import struct
import uuid
from datetime import UTC, datetime

from fastapi import Request
from redis.asyncio import Redis
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorAttachment,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.core.config import get_settings
from app.models import CelularVinculado, PasskeyCelular
from app.services import checadas as svc

RETO_S = 180
_PROPOSITO = {"registro": 1, "checar": 2}


def dominio(request: Request) -> tuple[str, str]:
    """rp_id (host sin puerto) y origen esperado, tal como los ve el navegador."""
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.headers.get("host", request.url.netloc))
    host = host.split(",")[0].strip()
    return host.split(":")[0], f"{proto}://{host}"


def _firma(datos: bytes) -> bytes:
    return hmac.new(get_settings().secret_key.encode(), datos, hashlib.sha256).digest()


def nuevo_reto(celular_id: uuid.UUID, proposito: str) -> bytes:
    exp = int(datetime.now(UTC).timestamp()) + RETO_S
    datos = os.urandom(16) + struct.pack(">QB", exp, _PROPOSITO[proposito]) + celular_id.bytes
    return datos + _firma(datos)


def _validar_reto(reto: bytes, celular_id: uuid.UUID, proposito: str) -> bool:
    if len(reto) != 16 + 9 + 16 + 32:
        return False
    datos, firma = reto[:-32], reto[-32:]
    if not hmac.compare_digest(firma, _firma(datos)):
        return False
    exp, prop = struct.unpack(">QB", datos[16:25])
    return (
        prop == _PROPOSITO[proposito]
        and datos[25:41] == celular_id.bytes
        and exp >= datetime.now(UTC).timestamp()
    )


async def _usar_una_vez(reto: bytes) -> bool:
    """Marca el reto como usado; False si ya se había usado. Si Valkey no responde, se acepta
    (el reto vence en 3 min y el contador de firmas sigue detectando repeticiones)."""
    try:
        async with Redis.from_url(get_settings().redis_url) as r:
            clave = f"passkey_reto:{hashlib.sha256(reto).hexdigest()}"
            return bool(await r.set(clave, "1", ex=RETO_S, nx=True))
    except Exception:  # noqa: BLE001
        return True


def _reto_de(credencial: dict) -> bytes:
    """Reto que firmó el teléfono (dentro de clientDataJSON)."""
    cd = json.loads(base64url_to_bytes(credencial["response"]["clientDataJSON"]))
    return base64url_to_bytes(cd["challenge"])


def opciones_registro(
    c: CelularVinculado, request: Request, existentes: list[PasskeyCelular]
) -> dict:
    rp_id, _ = dominio(request)
    opciones = generate_registration_options(
        rp_id=rp_id,
        rp_name="ODAITIME",
        user_id=c.id.bytes,
        user_name=f"{c.empleado.numero}",
        user_display_name=c.empleado.nombre_completo,
        challenge=nuevo_reto(c.id, "registro"),
        timeout=RETO_S * 1000,
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=AuthenticatorAttachment.PLATFORM,
            resident_key=ResidentKeyRequirement.DISCOURAGED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=p.credencial_id) for p in existentes],
    )
    return json.loads(options_to_json(opciones))


async def registrar(c: CelularVinculado, request: Request, credencial: dict) -> PasskeyCelular:
    rp_id, origen = dominio(request)
    reto = _reto_de(credencial)
    if not _validar_reto(reto, c.id, "registro") or not await _usar_una_vez(reto):
        raise svc.error("reto_invalido", "Se acabó el tiempo. Vuelve a intentarlo.", http=401)
    v = verify_registration_response(
        credential=credencial,
        expected_challenge=reto,
        expected_rp_id=rp_id,
        expected_origin=origen,
        require_user_verification=True,
    )
    return PasskeyCelular(
        empresa_id=c.empresa_id,
        celular_id=c.id,
        credencial_id=v.credential_id,
        llave_publica=v.credential_public_key,
        contador=v.sign_count,
        rp_id=rp_id,
        origen=origen,
    )


def opciones_checar(c: CelularVinculado, llaves: list[PasskeyCelular]) -> dict:
    opciones = generate_authentication_options(
        rp_id=llaves[0].rp_id,
        challenge=nuevo_reto(c.id, "checar"),
        timeout=RETO_S * 1000,
        allow_credentials=[PublicKeyCredentialDescriptor(id=p.credencial_id) for p in llaves],
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    return json.loads(options_to_json(opciones))


async def verificar(c: CelularVinculado, credencial: dict, llaves: list[PasskeyCelular]) -> None:
    """Comprueba la huella/rostro del celular; lanza 401 si no corresponde."""
    no = svc.error("passkey_invalida", "No se pudo verificar tu huella o rostro.", http=401)
    try:
        cred_id = base64url_to_bytes(credencial["rawId"])
        reto = _reto_de(credencial)
    except (KeyError, TypeError, ValueError):
        raise no from None
    llave = next((p for p in llaves if hmac.compare_digest(p.credencial_id, cred_id)), None)
    if llave is None or not _validar_reto(reto, c.id, "checar"):
        raise no
    if not await _usar_una_vez(reto):
        raise no
    try:
        v = verify_authentication_response(
            credential=credencial,
            expected_challenge=reto,
            expected_rp_id=llave.rp_id,
            expected_origin=llave.origen,
            credential_public_key=llave.llave_publica,
            credential_current_sign_count=llave.contador,
            require_user_verification=True,
        )
    except Exception:  # noqa: BLE001 — cualquier falla de la firma es un rechazo
        raise no from None
    llave.contador = v.new_sign_count
    llave.ultimo_uso = datetime.now(UTC)


def b64(b: bytes) -> str:
    return bytes_to_base64url(b)
