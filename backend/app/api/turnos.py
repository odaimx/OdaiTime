import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, CurrentUser, empresa_scope, require_roles
from app.models import Rol, Turno, TurnoDia
from app.schemas.turno import TurnoCreate, TurnoOut, TurnoUpdate

router = APIRouter(prefix="/turnos", tags=["turnos"])

_ADMIN = (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA)
_LECTURA = (*_ADMIN, Rol.GERENTE_SUCURSAL)
_DUPLICADO = HTTPException(status.HTTP_409_CONFLICT, "Ya existe un turno con ese nombre")


async def obtener_turno(db: DB, turno_id: uuid.UUID, empresa_id: uuid.UUID) -> Turno:
    turno = await db.scalar(
        select(Turno).where(Turno.id == turno_id, Turno.empresa_id == empresa_id)
    )
    if turno is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Turno no encontrado")
    return turno


@router.get("", response_model=list[TurnoOut], dependencies=[Depends(require_roles(*_LECTURA))])
async def listar(user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None) -> list[TurnoOut]:
    emp = empresa_scope(user, empresa_id)
    turnos = await db.scalars(select(Turno).where(Turno.empresa_id == emp).order_by(Turno.nombre))
    return [TurnoOut.de(t) for t in turnos]


@router.post(
    "",
    response_model=TurnoOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(*_ADMIN))],
)
async def crear(
    data: TurnoCreate, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> TurnoOut:
    turno = Turno(
        empresa_id=empresa_scope(user, empresa_id),
        nombre=data.nombre,
        tipo_jornada=data.tipo_jornada,
        tolerancia_minutos=data.tolerancia_minutos,
        dias=[TurnoDia(**d.model_dump()) for d in data.dias],
    )
    db.add(turno)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _DUPLICADO from None
    return TurnoOut.de(turno)


@router.get(
    "/{turno_id}", response_model=TurnoOut, dependencies=[Depends(require_roles(*_LECTURA))]
)
async def obtener(
    turno_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> TurnoOut:
    return TurnoOut.de(await obtener_turno(db, turno_id, empresa_scope(user, empresa_id)))


@router.patch(
    "/{turno_id}", response_model=TurnoOut, dependencies=[Depends(require_roles(*_ADMIN))]
)
async def actualizar(
    turno_id: uuid.UUID,
    data: TurnoUpdate,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> TurnoOut:
    turno = await obtener_turno(db, turno_id, empresa_scope(user, empresa_id))
    cambios = data.model_dump(exclude_unset=True, exclude={"dias"})
    for campo, valor in cambios.items():
        setattr(turno, campo, valor)
    if data.dias is not None:
        # Reemplaza el horario completo. El flush intermedio evita chocar con la PK
        # (turno_id, dia_semana) al reinsertar los mismos días.
        turno.dias.clear()
        await db.flush()
        turno.dias.extend(TurnoDia(**d.model_dump()) for d in data.dias)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _DUPLICADO from None
    await db.refresh(turno, attribute_names=["dias"])
    return TurnoOut.de(turno)
