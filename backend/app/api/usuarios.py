import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select, update

from app.api.deps import DB, CurrentUser, empresa_scope, require_roles
from app.core.security import hash_password
from app.models import Rol, Sesion, Sucursal, Usuario
from app.schemas.usuario import UsuarioCreate, UsuarioOut, UsuarioUpdate
from app.services import accesos

router = APIRouter(
    prefix="/usuarios",
    tags=["usuarios"],
    dependencies=[Depends(require_roles(Rol.SUPERADMIN, Rol.ADMIN_EMPRESA))],
)


async def _sucursales_de_empresa(
    db: DB, empresa_id: uuid.UUID, ids: list[uuid.UUID]
) -> list[Sucursal]:
    if not ids:
        return []
    encontradas = list(
        await db.scalars(
            select(Sucursal).where(Sucursal.empresa_id == empresa_id, Sucursal.id.in_(ids))
        )
    )
    if len(encontradas) != len(set(ids)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Sucursal inválida")
    return encontradas


def _validar_rol(rol: Rol, sucursales: list[Sucursal]) -> None:
    if rol == Rol.SUPERADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No se puede asignar el rol superadmin")
    if rol == Rol.GERENTE_SUCURSAL and not sucursales:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Un gerente debe tener al menos una sucursal"
        )


async def _get(db: DB, usuario_id: uuid.UUID, empresa_id: uuid.UUID) -> Usuario:
    usuario = await db.scalar(
        select(Usuario).where(Usuario.id == usuario_id, Usuario.empresa_id == empresa_id)
    )
    if usuario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    return usuario


@router.get("", response_model=list[UsuarioOut])
async def listar(user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None) -> list[Usuario]:
    emp = empresa_scope(user, empresa_id)
    return list(
        await db.scalars(select(Usuario).where(Usuario.empresa_id == emp).order_by(Usuario.nombre))
    )


@router.post("", response_model=UsuarioOut, status_code=status.HTTP_201_CREATED)
async def crear(
    data: UsuarioCreate, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> Usuario:
    emp = empresa_scope(user, empresa_id)
    email = data.email.lower()
    if await db.scalar(select(func.count()).where(func.lower(Usuario.email) == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un usuario con ese correo")

    sucursales = await _sucursales_de_empresa(db, emp, data.sucursal_ids)
    _validar_rol(data.rol, sucursales)

    nuevo = Usuario(
        empresa_id=emp,
        email=email,
        nombre=data.nombre,
        password_hash=hash_password(data.password),
        rol=data.rol,
        sucursales=sucursales,
    )
    db.add(nuevo)
    await db.commit()
    await db.refresh(nuevo, attribute_names=["empresa", "sucursales"])
    return nuevo


@router.patch("/{usuario_id}", response_model=UsuarioOut)
async def actualizar(
    usuario_id: uuid.UUID,
    data: UsuarioUpdate,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> Usuario:
    emp = empresa_scope(user, empresa_id)
    usuario = await _get(db, usuario_id, emp)
    cambios = data.model_dump(exclude_unset=True)

    if usuario.id == user.id and (
        cambios.get("activo") is False or ("rol" in cambios and cambios["rol"] != user.rol)
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "No puedes desactivarte ni cambiar tu propio rol",
        )

    if "sucursal_ids" in cambios:
        usuario.sucursales = await _sucursales_de_empresa(db, emp, cambios.pop("sucursal_ids"))
    if "password" in cambios:
        usuario.password_hash = hash_password(cambios.pop("password"))
    for campo, valor in cambios.items():
        setattr(usuario, campo, valor)
    _validar_rol(usuario.rol, usuario.sucursales)

    # Al desactivar o cambiar contraseña se cierran todas sus sesiones abiertas.
    if data.activo is False or data.password is not None:
        await db.execute(
            update(Sesion)
            .where(Sesion.usuario_id == usuario.id, Sesion.revocada_en.is_(None))
            .values(revocada_en=datetime.now(UTC))
        )

    await db.commit()
    await db.refresh(usuario, attribute_names=["empresa", "sucursales"])
    return usuario


@router.delete("/{usuario_id}", status_code=status.HTTP_204_NO_CONTENT)
async def eliminar(
    usuario_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> None:
    """Borra un usuario. Sus registros (checadas manuales, actividades) quedan sin autor."""
    usuario = await _get(db, usuario_id, empresa_scope(user, empresa_id))
    if usuario.id == user.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No puedes eliminarte a ti mismo")
    if usuario.rol == Rol.SUPERADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No se puede eliminar al superadmin")
    await db.delete(usuario)
    await db.commit()


@router.post("/{usuario_id}/enviar-cambio-password", status_code=status.HTTP_202_ACCEPTED)
async def enviar_cambio_password(
    usuario_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> dict[str, str]:
    """Envía al usuario un correo con el enlace para cambiar su contraseña."""
    usuario = await _get(db, usuario_id, empresa_scope(user, empresa_id))
    if not usuario.activo:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{usuario.nombre} está inactivo")
    enviado, enlace = await accesos.enviar_enlace(db, request, usuario, "recuperar")
    await db.commit()
    if enviado:
        return {"mensaje": f"Se envió el enlace a {usuario.email}.", "enlace": ""}
    # Sin correo saliente configurado: se entrega el enlace para compartirlo a mano.
    return {
        "mensaje": "No hay correo saliente configurado; comparte este enlace.",
        "enlace": enlace,
    }
