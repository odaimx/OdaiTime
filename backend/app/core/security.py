import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

_ph = PasswordHasher()
ALGORITHM = "HS256"

# Se usa para verificar contra algo cuando el correo no existe y así no revelar,
# por diferencia de tiempos, qué correos están registrados.
DUMMY_HASH = _ph.hash("odaitime-dummy-password")


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def _encode(payload: dict) -> str:
    return jwt.encode(payload, get_settings().secret_key, algorithm=ALGORITHM)


def create_access_token(user_id: uuid.UUID) -> tuple[str, int]:
    minutes = get_settings().access_token_minutes
    now = datetime.now(UTC)
    token = _encode(
        {"sub": str(user_id), "type": "access", "iat": now, "exp": now + timedelta(minutes=minutes)}
    )
    return token, minutes * 60


def create_refresh_token(user_id: uuid.UUID, session_id: uuid.UUID, expires_at: datetime) -> str:
    return _encode(
        {
            "sub": str(user_id),
            "jti": str(session_id),
            "type": "refresh",
            "iat": datetime.now(UTC),
            "exp": expires_at,
        }
    )


def refresh_expiry() -> datetime:
    return datetime.now(UTC) + timedelta(days=get_settings().refresh_token_days)


def decode_token(token: str, expected_type: str) -> dict:
    """Lanza jwt.PyJWTError si el token es inválido, expiró o no es del tipo esperado."""
    payload = jwt.decode(token, get_settings().secret_key, algorithms=[ALGORITHM])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("Tipo de token incorrecto")
    return payload
