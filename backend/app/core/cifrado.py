"""Cifrado simétrico (Fernet: AES-128-CBC + HMAC-SHA256) para secretos guardados en la base,
como la contraseña del correo saliente. La llave se deriva de SECRET_KEY: si se cambia
SECRET_KEY hay que volver a capturar esos secretos."""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings

PREFIJO = "enc:"


def _fernet() -> Fernet:
    llave = hashlib.sha256(f"{get_settings().secret_key}:odaitime-secretos".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(llave))


def cifrar(texto: str) -> str:
    return PREFIJO + _fernet().encrypt(texto.encode()).decode()


def descifrar(valor: str) -> str:
    """Devuelve el texto original. Acepta valores antiguos sin cifrar."""
    if not valor.startswith(PREFIJO):
        return valor
    try:
        return _fernet().decrypt(valor[len(PREFIJO) :].encode()).decode()
    except InvalidToken:
        return ""  # se cambió SECRET_KEY: hay que capturar de nuevo la contraseña


def esta_cifrado(valor: str) -> bool:
    return valor.startswith(PREFIJO)
