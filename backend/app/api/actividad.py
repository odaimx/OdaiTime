import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, empresa_scope, require_roles, sucursales_permitidas
from app.models import (
    Actividad,
    Checada,
    Dispositivo,
    Empleado,
    Rol,
    Sucursal,
    Turno,
    Usuario,
)
from app.schemas.checada import ActividadOut, NotaIn
from app.services import bitacora

router = APIRouter(
    prefix="/actividad",
    tags=["bitácora"],
    dependencies=[Depends(require_roles(Rol.SUPERADMIN, Rol.ADMIN_EMPRESA, Rol.GERENTE_SUCURSAL))],
)

_NO = HTTPException(status.HTTP_404_NOT_FOUND, "Registro no encontrado")


async def verificar_registro(
    db: DB, user: Usuario, emp: uuid.UUID, modelo: str, registro_id: uuid.UUID
) -> None:
    """El registro debe ser de la empresa y visible para el usuario (gerente: sus sucursales)."""
    if modelo not in bitacora.MODELOS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Modelo desconocido")
    permitidas = sucursales_permitidas(user)
    sucursal_id: uuid.UUID | None = None

    if modelo == "empleado":
        r = await db.scalar(
            select(Empleado.sucursal_id).where(
                Empleado.id == registro_id, Empleado.empresa_id == emp
            )
        )
        if r is None:
            raise _NO
        sucursal_id = r
    elif modelo == "checada":
        r = await db.scalar(
            select(Checada.sucursal_id).where(Checada.id == registro_id, Checada.empresa_id == emp)
        )
        if r is None:
            raise _NO
        sucursal_id = r
    elif modelo == "sucursal":
        if not await db.scalar(
            select(Sucursal.id).where(Sucursal.id == registro_id, Sucursal.empresa_id == emp)
        ):
            raise _NO
        sucursal_id = registro_id
    elif modelo == "turno":
        if not await db.scalar(
            select(Turno.id).where(Turno.id == registro_id, Turno.empresa_id == emp)
        ):
            raise _NO
    elif modelo == "dispositivo":
        r = await db.scalar(
            select(Dispositivo.sucursal_id).where(
                Dispositivo.id == registro_id, Dispositivo.empresa_id == emp
            )
        )
        if r is None:
            raise _NO
        sucursal_id = r
    elif modelo == "config_checadas":
        # registro_id = id de la empresa (config general) o de la sucursal.
        if registro_id != emp:
            if not await db.scalar(
                select(Sucursal.id).where(Sucursal.id == registro_id, Sucursal.empresa_id == emp)
            ):
                raise _NO
            sucursal_id = registro_id

    if permitidas is not None and sucursal_id is not None and sucursal_id not in permitidas:
        raise _NO


@router.get("", response_model=list[ActividadOut])
async def listar(
    user: CurrentUser,
    db: DB,
    modelo: str,
    registro_id: uuid.UUID,
    empresa_id: uuid.UUID | None = None,
    limite: int = Query(default=100, ge=1, le=500),
) -> list[Actividad]:
    emp = empresa_scope(user, empresa_id)
    await verificar_registro(db, user, emp, modelo, registro_id)
    return list(
        await db.scalars(
            select(Actividad)
            .where(
                Actividad.empresa_id == emp,
                Actividad.modelo == modelo,
                Actividad.registro_id == registro_id,
            )
            .order_by(Actividad.created_at.desc())
            .limit(limite)
        )
    )


@router.post("", response_model=ActividadOut, status_code=status.HTTP_201_CREATED)
async def nota(
    data: NotaIn, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> Actividad:
    emp = empresa_scope(user, empresa_id)
    await verificar_registro(db, user, emp, data.modelo, data.registro_id)
    act = await bitacora.registrar(
        db,
        empresa_id=emp,
        modelo=data.modelo,
        registro_id=data.registro_id,
        usuario=user,
        tipo="nota",
        mensaje=data.mensaje,
    )
    await db.commit()
    await db.refresh(act, attribute_names=["usuario"])
    return act
