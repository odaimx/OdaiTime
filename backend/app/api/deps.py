import uuid
from collections.abc import Callable
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import get_db
from app.models import Rol, Usuario

DB = Annotated[AsyncSession, Depends(get_db)]

_bearer = HTTPBearer(auto_error=False)

_NO_AUTH = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="No autenticado",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> Usuario:
    if creds is None:
        raise _NO_AUTH
    try:
        payload = decode_token(creds.credentials, "access")
        user_id = uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise _NO_AUTH from None

    user = await db.get(Usuario, user_id)
    if user is None or not user.activo or (user.empresa and not user.empresa.activa):
        raise _NO_AUTH
    return user


CurrentUser = Annotated[Usuario, Depends(get_current_user)]


def require_roles(*roles: Rol) -> Callable:
    async def checker(user: CurrentUser) -> Usuario:
        if user.rol not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No tienes permiso para esta acción")
        return user

    return checker


def empresa_scope(user: Usuario, empresa_id: uuid.UUID | None) -> uuid.UUID:
    """Empresa sobre la que opera la petición.

    Los usuarios de una empresa siempre operan sobre la suya (se ignora el parámetro);
    el superadmin debe indicar explícitamente con ?empresa_id=.
    """
    if user.rol == Rol.SUPERADMIN:
        if empresa_id is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Indica empresa_id")
        return empresa_id
    assert user.empresa_id is not None
    return user.empresa_id
