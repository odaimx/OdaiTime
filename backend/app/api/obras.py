"""Obras: lugares de trabajo temporales y quién trabaja en cada una por fechas."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, CurrentUser, empresa_scope, require_roles
from app.models import AsignacionObra, Checada, Empleado, Obra, Rol, Sucursal, Usuario
from app.schemas.obra import (
    AsignacionObraOut,
    AsignacionUpdate,
    AsignarIn,
    ObraCreate,
    ObraOut,
    ObraUpdate,
)
from app.services import bitacora, uso

router = APIRouter(prefix="/obras", tags=["obras"])

_ADMIN = (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA, Rol.GERENTE_SUCURSAL)
_DUPLICADA = HTTPException(status.HTTP_409_CONFLICT, "Ya existe una obra con esa clave")


def _sucursales_visibles(user: Usuario) -> list[uuid.UUID] | None:
    return [s.id for s in user.sucursales] if user.rol == Rol.GERENTE_SUCURSAL else None


def _visibles(user: Usuario, empresa_id: uuid.UUID):
    q = select(Obra).where(Obra.empresa_id == empresa_id)
    if (ids := _sucursales_visibles(user)) is not None:
        q = q.where(Obra.sucursal_id.in_(ids))
    return q


async def _get(db: DB, user: Usuario, obra_id: uuid.UUID, empresa_id: uuid.UUID) -> Obra:
    obra = await db.scalar(_visibles(user, empresa_id).where(Obra.id == obra_id))
    if obra is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Obra no encontrada")
    return obra


async def _validar_sucursal(db: DB, user: Usuario, empresa_id: uuid.UUID, sucursal_id: uuid.UUID):
    s = await db.scalar(
        select(Sucursal).where(Sucursal.id == sucursal_id, Sucursal.empresa_id == empresa_id)
    )
    ids = _sucursales_visibles(user)
    if s is None or (ids is not None and s.id not in ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Sucursal no válida")


def _fechas(inicio: date | None, fin: date | None) -> None:
    if inicio and fin and fin < inicio:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "La fecha final es anterior a la inicial"
        )


async def _salida(db: DB, obras: list[Obra]) -> list[ObraOut]:
    hoy = date.today()
    conteo = dict(
        (
            await db.execute(
                select(AsignacionObra.obra_id, func.count())
                .where(
                    AsignacionObra.obra_id.in_([o.id for o in obras]),
                    AsignacionObra.fecha_inicio <= hoy,
                    or_(AsignacionObra.fecha_fin.is_(None), AsignacionObra.fecha_fin >= hoy),
                )
                .group_by(AsignacionObra.obra_id)
            )
        ).all()
    )
    return [
        ObraOut.model_validate(o).model_copy(update={"empleados_asignados": conteo.get(o.id, 0)})
        for o in obras
    ]


@router.get("", response_model=list[ObraOut], dependencies=[Depends(require_roles(*_ADMIN))])
async def listar(user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None) -> list[ObraOut]:
    emp = empresa_scope(user, empresa_id)
    obras = list(await db.scalars(_visibles(user, emp).order_by(Obra.fecha_inicio.desc())))
    return await _salida(db, obras)


@router.post(
    "",
    response_model=ObraOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(*_ADMIN))],
)
async def crear(
    data: ObraCreate, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> ObraOut:
    emp = empresa_scope(user, empresa_id)
    await _validar_sucursal(db, user, emp, data.sucursal_id)
    _fechas(data.fecha_inicio, data.fecha_fin)
    obra = Obra(empresa_id=emp, **data.model_dump())
    db.add(obra)
    try:
        await db.flush()
        await bitacora.registrar(
            db,
            empresa_id=emp,
            modelo="obra",
            registro_id=obra.id,
            usuario=user,
            tipo="creacion",
            mensaje="Obra creada",
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _DUPLICADA from None
    await db.refresh(obra, attribute_names=["sucursal"])
    return (await _salida(db, [obra]))[0]


@router.get("/{obra_id}", response_model=ObraOut, dependencies=[Depends(require_roles(*_ADMIN))])
async def obtener(
    obra_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> ObraOut:
    return (await _salida(db, [await _get(db, user, obra_id, empresa_scope(user, empresa_id))]))[0]


@router.patch("/{obra_id}", response_model=ObraOut, dependencies=[Depends(require_roles(*_ADMIN))])
async def actualizar(
    obra_id: uuid.UUID,
    data: ObraUpdate,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> ObraOut:
    emp = empresa_scope(user, empresa_id)
    obra = await _get(db, user, obra_id, emp)
    cambios = data.model_dump(exclude_unset=True)
    for campo in ("clave", "nombre", "sucursal_id", "radio_metros", "fecha_inicio", "activa"):
        if campo in cambios and cambios[campo] is None:
            cambios.pop(campo)
    if "sucursal_id" in cambios:
        await _validar_sucursal(db, user, emp, cambios["sucursal_id"])
    _fechas(
        cambios.get("fecha_inicio", obra.fecha_inicio), cambios.get("fecha_fin", obra.fecha_fin)
    )
    for campo, valor in cambios.items():
        setattr(obra, campo, valor)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _DUPLICADA from None
    await db.refresh(obra, attribute_names=["sucursal"])
    return (await _salida(db, [obra]))[0]


@router.delete(
    "/{obra_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(*_ADMIN))],
)
async def eliminar(
    obra_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> None:
    """Borra una obra sin asignaciones ni checadas; si ya se usó, se desactiva."""
    obra = await _get(db, user, obra_id, empresa_scope(user, empresa_id))
    uso.bloquear_si_se_usa(
        f"la obra {obra.nombre}",
        [
            (
                await uso.contar(db, AsignacionObra.obra_id, obra.id),
                "empleado asignado",
                "empleados asignados",
                "la ficha de la obra",
            ),
            (await uso.contar(db, Checada.obra_id, obra.id), "checada", "checadas", "Asistencias"),
        ],
        "desactívala",
    )
    await db.delete(obra)
    await db.commit()


# --- Asignaciones ---


@router.get(
    "/{obra_id}/asignaciones",
    response_model=list[AsignacionObraOut],
    dependencies=[Depends(require_roles(*_ADMIN))],
)
async def asignaciones(
    obra_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> list[AsignacionObra]:
    obra = await _get(db, user, obra_id, empresa_scope(user, empresa_id))
    return list(
        await db.scalars(
            select(AsignacionObra)
            .where(AsignacionObra.obra_id == obra.id)
            .order_by(AsignacionObra.fecha_inicio.desc())
        )
    )


@router.post(
    "/{obra_id}/asignaciones",
    response_model=list[AsignacionObraOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(*_ADMIN))],
)
async def asignar(
    obra_id: uuid.UUID,
    data: AsignarIn,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> list[AsignacionObra]:
    """Asigna empleados a la obra. Si ya estaban en otra obra en esas fechas, esa termina el día
    anterior (un empleado está en una sola obra a la vez)."""
    emp = empresa_scope(user, empresa_id)
    obra = await _get(db, user, obra_id, emp)
    _fechas(data.fecha_inicio, data.fecha_fin)
    if data.fecha_inicio < obra.fecha_inicio or (
        obra.fecha_fin and (data.fecha_fin is None or data.fecha_fin > obra.fecha_fin)
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Las fechas de la asignación deben quedar dentro de las fechas de la obra",
        )
    q = select(Empleado).where(
        Empleado.empresa_id == emp, Empleado.id.in_(data.empleado_ids), Empleado.activo
    )
    if (ids := _sucursales_visibles(user)) is not None:
        q = q.where(Empleado.sucursal_id.in_(ids))
    empleados = list(await db.scalars(q))
    if len(empleados) != len(set(data.empleado_ids)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Hay empleados no válidos")
    nuevas = []
    for e in empleados:
        abiertas = await db.scalars(
            select(AsignacionObra).where(
                AsignacionObra.empleado_id == e.id,
                AsignacionObra.fecha_inicio < data.fecha_inicio,
                or_(
                    AsignacionObra.fecha_fin.is_(None),
                    AsignacionObra.fecha_fin >= data.fecha_inicio,
                ),
            )
        )
        for a in abiertas:
            a.fecha_fin = date.fromordinal(data.fecha_inicio.toordinal() - 1)
        a = AsignacionObra(
            empresa_id=emp,
            obra_id=obra.id,
            empleado_id=e.id,
            fecha_inicio=data.fecha_inicio,
            fecha_fin=data.fecha_fin,
        )
        db.add(a)
        nuevas.append(a)
    await db.commit()
    for a in nuevas:
        await db.refresh(a, attribute_names=["obra", "empleado"])
    return nuevas


async def _asignacion(
    db: DB, user: Usuario, asignacion_id: uuid.UUID, empresa_id: uuid.UUID
) -> AsignacionObra:
    a = await db.scalar(
        select(AsignacionObra).where(
            AsignacionObra.id == asignacion_id, AsignacionObra.empresa_id == empresa_id
        )
    )
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asignación no encontrada")
    await _get(db, user, a.obra_id, empresa_id)  # el gerente solo ve las de sus sucursales
    return a


@router.patch(
    "/asignaciones/{asignacion_id}",
    response_model=AsignacionObraOut,
    dependencies=[Depends(require_roles(*_ADMIN))],
)
async def cambiar_asignacion(
    asignacion_id: uuid.UUID,
    data: AsignacionUpdate,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> AsignacionObra:
    a = await _asignacion(db, user, asignacion_id, empresa_scope(user, empresa_id))
    cambios = data.model_dump(exclude_unset=True)
    inicio = cambios.get("fecha_inicio") or a.fecha_inicio
    fin = cambios["fecha_fin"] if "fecha_fin" in cambios else a.fecha_fin
    _fechas(inicio, fin)
    a.fecha_inicio, a.fecha_fin = inicio, fin
    await db.commit()
    await db.refresh(a, attribute_names=["obra", "empleado"])
    return a


@router.delete(
    "/asignaciones/{asignacion_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(*_ADMIN))],
)
async def quitar_asignacion(
    asignacion_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> None:
    """Quita una asignación capturada por error. Si ya checó en la obra, mejor ponle fecha final."""
    emp = empresa_scope(user, empresa_id)
    a = await _asignacion(db, user, asignacion_id, emp)
    checadas = await db.scalar(
        select(func.count()).where(
            Checada.obra_id == a.obra_id,
            Checada.empleado_id == a.empleado_id,
            func.date(Checada.momento) >= a.fecha_inicio,
        )
    )
    if checadas:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{a.empleado.nombre_completo} ya checó en esta obra; ponle fecha final en su lugar.",
        )
    await db.delete(a)
    await db.commit()


@router.get(
    "/empleado/{empleado_id}",
    response_model=list[AsignacionObraOut],
    dependencies=[Depends(require_roles(*_ADMIN))],
)
async def obras_del_empleado(
    empleado_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> list[AsignacionObra]:
    """Historial de obras de un empleado (para su ficha)."""
    emp = empresa_scope(user, empresa_id)
    return list(
        await db.scalars(
            select(AsignacionObra)
            .where(AsignacionObra.empresa_id == emp, AsignacionObra.empleado_id == empleado_id)
            .order_by(AsignacionObra.fecha_inicio.desc())
        )
    )
