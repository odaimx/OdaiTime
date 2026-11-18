import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, CurrentUser, empresa_scope, require_roles
from app.models import Checada, Empleado, Rol, Sucursal, Usuario
from app.schemas.sucursal import SucursalCreate, SucursalOut, SucursalUpdate
from app.services import bitacora

CAMPOS = (
    "clave",
    "nombre",
    "zona_horaria",
    "direccion",
    "latitud",
    "longitud",
    "radio_metros",
    "activa",
)

router = APIRouter(prefix="/sucursales", tags=["sucursales"])

_ADMIN = (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA)
_LECTURA = (*_ADMIN, Rol.GERENTE_SUCURSAL)


def _visibles(user: Usuario, empresa_id: uuid.UUID):
    q = select(Sucursal).where(Sucursal.empresa_id == empresa_id)
    if user.rol == Rol.GERENTE_SUCURSAL:
        q = q.where(Sucursal.id.in_([s.id for s in user.sucursales]))
    return q


async def _get(db: DB, user: Usuario, sucursal_id: uuid.UUID, empresa_id: uuid.UUID) -> Sucursal:
    # Filtrar por empresa en la misma consulta: una sucursal ajena responde 404, no 403,
    # para no revelar que existe.
    sucursal = await db.scalar(_visibles(user, empresa_id).where(Sucursal.id == sucursal_id))
    if sucursal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    return sucursal


_DUPLICADA = HTTPException(status.HTTP_409_CONFLICT, "Ya existe una sucursal con esa clave")


@router.get("", response_model=list[SucursalOut], dependencies=[Depends(require_roles(*_LECTURA))])
async def listar(user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None) -> list[Sucursal]:
    emp = empresa_scope(user, empresa_id)
    return list(await db.scalars(_visibles(user, emp).order_by(Sucursal.nombre)))


@router.post(
    "",
    response_model=SucursalOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(*_ADMIN))],
)
async def crear(
    data: SucursalCreate, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> Sucursal:
    sucursal = Sucursal(empresa_id=empresa_scope(user, empresa_id), **data.model_dump())
    db.add(sucursal)
    try:
        await db.flush()
        await bitacora.registrar(
            db,
            empresa_id=sucursal.empresa_id,
            modelo="sucursal",
            registro_id=sucursal.id,
            usuario=user,
            tipo="creacion",
            mensaje="Sucursal creada",
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _DUPLICADA from None
    return sucursal


@router.get(
    "/{sucursal_id}", response_model=SucursalOut, dependencies=[Depends(require_roles(*_LECTURA))]
)
async def obtener(
    sucursal_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> Sucursal:
    return await _get(db, user, sucursal_id, empresa_scope(user, empresa_id))


@router.patch(
    "/{sucursal_id}", response_model=SucursalOut, dependencies=[Depends(require_roles(*_ADMIN))]
)
async def actualizar(
    sucursal_id: uuid.UUID,
    data: SucursalUpdate,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> Sucursal:
    sucursal = await _get(db, user, sucursal_id, empresa_scope(user, empresa_id))
    antes = bitacora.snapshot(sucursal, CAMPOS)
    for campo, valor in data.model_dump(exclude_unset=True).items():
        setattr(sucursal, campo, valor)
    await bitacora.cambios(
        db,
        empresa_id=sucursal.empresa_id,
        modelo="sucursal",
        registro_id=sucursal.id,
        usuario=user,
        antes=antes,
        despues=bitacora.snapshot(sucursal, CAMPOS),
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _DUPLICADA from None
    return sucursal


@router.delete(
    "/{sucursal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(*_ADMIN))],
)
async def eliminar(
    sucursal_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> None:
    """Borra una sucursal sin empleados ni checadas; si ya se usó, se desactiva."""
    sucursal = await _get(db, user, sucursal_id, empresa_scope(user, empresa_id))
    empleados = await db.scalar(
        select(func.count()).select_from(Empleado).where(Empleado.sucursal_id == sucursal.id)
    )
    checadas = await db.scalar(
        select(func.count()).select_from(Checada).where(Checada.sucursal_id == sucursal.id)
    )
    if empleados or checadas:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"La sucursal {sucursal.nombre} tiene empleados o checadas. Desactívala en su lugar.",
        )
    await db.delete(sucursal)
    await db.commit()
