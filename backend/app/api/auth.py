import logging
import uuid
from datetime import UTC, datetime

import jwt
from fastapi import APIRouter, HTTPException, Request, Response, status
from redis.asyncio import Redis
from sqlalchemy import func, select, update

from app.api.deps import DB, CurrentUser, pertenece
from app.core.config import get_settings
from app.core.security import (
    DUMMY_HASH,
    create_access_token,
    create_refresh_token,
    decode_token,
    refresh_expiry,
    verify_password,
)
from app.core.tenant import tenant_de, url_empresa
from app.models import Empleado, Empresa, Sesion, Usuario
from app.schemas.auth import LoginIn, RefreshIn, TokenOut
from app.schemas.usuario import UsuarioOut

router = APIRouter(prefix="/auth", tags=["autenticación"])
log = logging.getLogger(__name__)

_CREDENCIALES = HTTPException(status.HTTP_401_UNAUTHORIZED, "Correo o contraseña incorrectos")
_SESION_INVALIDA = HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión inválida o expirada")


# --- Límite de intentos (Valkey). Si la caché no responde, no bloquea el login. ---


def _rl_key(email: str, request: Request) -> str:
    ip = request.client.host if request.client else "?"
    return f"login_fail:{email}:{ip}"


async def _intentos_excedidos(key: str) -> bool:
    try:
        async with Redis.from_url(get_settings().redis_url) as r:
            n = await r.get(key)
        return n is not None and int(n) >= get_settings().login_max_attempts
    except Exception:  # noqa: BLE001
        log.warning("Valkey no disponible; sin límite de intentos")
        return False


async def _registrar_fallo(key: str) -> None:
    try:
        async with Redis.from_url(get_settings().redis_url) as r:
            n = await r.incr(key)
            if n == 1:
                await r.expire(key, get_settings().login_window_seconds)
    except Exception:  # noqa: BLE001
        pass


async def _limpiar_fallos(key: str) -> None:
    try:
        async with Redis.from_url(get_settings().redis_url) as r:
            await r.delete(key)
    except Exception:  # noqa: BLE001
        pass


# --- Emisión de tokens ---


async def _emitir(db: DB, user: Usuario) -> TokenOut:
    sesion = Sesion(id=uuid.uuid4(), usuario_id=user.id, expira_en=refresh_expiry())
    db.add(sesion)
    user.ultimo_acceso = datetime.now(UTC)
    await db.commit()
    access, expires_in = create_access_token(user.id)
    return TokenOut(
        access_token=access,
        refresh_token=create_refresh_token(user.id, sesion.id, sesion.expira_en),
        expires_in=expires_in,
        usuario=UsuarioOut.model_validate(user),
    )


@router.post("/login", response_model=TokenOut)
async def login(data: LoginIn, request: Request, db: DB) -> TokenOut:
    email = data.email.lower()
    tenant = tenant_de(request)
    if tenant.modo == "tenant" and not await db.scalar(
        select(func.count()).where(Empresa.slug == tenant.slug)
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    key = _rl_key(email, request)
    if await _intentos_excedidos(key):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Demasiados intentos fallidos. Intenta de nuevo en unos minutos.",
        )

    user = await db.scalar(select(Usuario).where(func.lower(Usuario.email) == email))
    if user is None:
        verify_password(data.password, DUMMY_HASH)  # mismo tiempo de respuesta
        await _registrar_fallo(key)
        raise _CREDENCIALES
    if not verify_password(data.password, user.password_hash):
        await _registrar_fallo(key)
        raise _CREDENCIALES
    if not user.activo or (user.empresa and not user.empresa.activa):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Usuario o empresa desactivados")

    if not pertenece(user, tenant):
        if tenant.modo == "base" and user.empresa:
            # Credenciales correctas pero entró por el dominio de Odai: se le indica su dirección.
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                {
                    "codigo": "usar_subdominio",
                    "mensaje": f"{user.empresa.nombre} tiene su propia dirección de acceso.",
                    "url": url_empresa(user.empresa.slug),
                },
            )
        # En el subdominio de otra empresa se comporta como credenciales incorrectas.
        await _registrar_fallo(key)
        raise _CREDENCIALES

    await _limpiar_fallos(key)
    return await _emitir(db, user)


@router.post("/refresh", response_model=TokenOut)
async def refresh(data: RefreshIn, request: Request, db: DB) -> TokenOut:
    """Rota el refresh token: el anterior queda revocado."""
    try:
        payload = decode_token(data.refresh_token, "refresh")
        sesion_id = uuid.UUID(payload["jti"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise _SESION_INVALIDA from None

    sesion = await db.get(Sesion, sesion_id, with_for_update=True)
    if sesion is None or sesion.revocada_en is not None or sesion.expira_en < datetime.now(UTC):
        raise _SESION_INVALIDA
    user = await db.get(Usuario, sesion.usuario_id)
    if user is None or not user.activo or (user.empresa and not user.empresa.activa):
        raise _SESION_INVALIDA
    if not pertenece(user, tenant_de(request)):
        raise _SESION_INVALIDA

    sesion.revocada_en = datetime.now(UTC)
    return await _emitir(db, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(data: RefreshIn, db: DB) -> None:
    try:
        payload = decode_token(data.refresh_token, "refresh")
        sesion_id = uuid.UUID(payload["jti"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return
    await db.execute(
        update(Sesion)
        .where(Sesion.id == sesion_id, Sesion.revocada_en.is_(None))
        .values(revocada_en=datetime.now(UTC))
    )
    await db.commit()


@router.get("/me", response_model=UsuarioOut)
async def me(user: CurrentUser) -> Usuario:
    return user


@router.get("/me/foto")
async def mi_foto(user: CurrentUser, db: DB) -> Response:
    """Foto (128 px) del empleado ligado al usuario, para el botón del usuario. 404 si no hay."""
    datos = await db.scalar(select(Empleado.foto_128).where(Empleado.usuario_id == user.id))
    if not datos:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sin foto")
    return Response(
        datos, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"}
    )
