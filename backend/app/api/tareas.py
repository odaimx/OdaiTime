"""Actividades programadas (tareas) y calendario, al estilo de Odoo."""

import uuid
from datetime import UTC, date, datetime, time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import Select, func, or_, select

from app.api.actividad import verificar_registro
from app.api.deps import DB, CurrentUser, empresa_scope, require_roles
from app.models import Empleado, Rol, Sucursal, Tarea, Turno, Usuario
from app.services import bitacora

router = APIRouter(
    prefix="/tareas",
    tags=["actividades programadas"],
    dependencies=[Depends(require_roles(Rol.SUPERADMIN, Rol.ADMIN_EMPRESA, Rol.GERENTE_SUCURSAL))],
)

TipoTarea = Literal["llamada", "reunion", "correo", "tarea", "recordatorio"]
TIPOS = {
    "llamada": "Llamada",
    "reunion": "Reunión",
    "correo": "Correo",
    "tarea": "Tarea",
    "recordatorio": "Recordatorio",
}
_NO = HTTPException(status.HTTP_404_NOT_FOUND, "Actividad no encontrada")


class UsuarioRef(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    nombre: str


class TareaIn(BaseModel):
    modelo: str | None = None
    registro_id: uuid.UUID | None = None
    tipo: TipoTarea = "tarea"
    resumen: str = Field(min_length=1, max_length=200)
    nota: str | None = Field(default=None, max_length=5000)
    fecha: date
    hora: time | None = None
    asignado_id: uuid.UUID | None = None


class TareaPatch(BaseModel):
    tipo: TipoTarea | None = None
    resumen: str | None = Field(default=None, min_length=1, max_length=200)
    nota: str | None = Field(default=None, max_length=5000)
    fecha: date | None = None
    hora: time | None = None
    asignado_id: uuid.UUID | None = None


class HechaIn(BaseModel):
    comentario: str | None = Field(default=None, max_length=5000)


class TareaOut(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    modelo: str | None
    registro_id: uuid.UUID | None
    registro_nombre: str | None
    tipo: str
    resumen: str
    nota: str | None
    fecha: date
    hora: time | None
    asignado: UsuarioRef | None
    hecha_en: datetime | None
    comentario: str | None
    created_at: datetime


class ResumenRegistro(BaseModel):
    pendientes: int
    proxima: date  # fecha de la actividad pendiente más próxima (o más vencida)


def _es_gerente(user: Usuario) -> bool:
    return user.rol == Rol.GERENTE_SUCURSAL


def _visibles(q: Select, user: Usuario) -> Select:
    """El gerente solo ve las actividades que le asignaron o que él creó."""
    if _es_gerente(user):
        q = q.where(or_(Tarea.asignado_id == user.id, Tarea.creado_por_id == user.id))
    return q


async def _nombre_registro(
    db: DB, emp: uuid.UUID, modelo: str, registro_id: uuid.UUID
) -> str | None:
    if modelo == "empleado":
        e = await db.scalar(
            select(Empleado).where(Empleado.id == registro_id, Empleado.empresa_id == emp)
        )
        return f"{e.nombre_completo} (#{e.numero})" if e else None
    if modelo == "sucursal":
        return await db.scalar(select(Sucursal.nombre).where(Sucursal.id == registro_id))
    if modelo == "turno":
        return await db.scalar(select(Turno.nombre).where(Turno.id == registro_id))
    return None


async def _validar_asignado(db: DB, emp: uuid.UUID, asignado_id: uuid.UUID | None) -> None:
    if asignado_id is None:
        return
    ok = await db.scalar(
        select(Usuario.id).where(
            Usuario.id == asignado_id,
            Usuario.activo.is_(True),
            or_(Usuario.empresa_id == emp, Usuario.rol == Rol.SUPERADMIN),
        )
    )
    if not ok:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "El responsable no es de la empresa"
        )


async def _obtener(db: DB, user: Usuario, emp: uuid.UUID, tarea_id: uuid.UUID) -> Tarea:
    t = await db.scalar(
        _visibles(select(Tarea).where(Tarea.id == tarea_id, Tarea.empresa_id == emp), user)
    )
    if t is None:
        # Un gerente también puede manejar las actividades de los registros de sus sucursales.
        t = await db.scalar(select(Tarea).where(Tarea.id == tarea_id, Tarea.empresa_id == emp))
        if t is None or t.modelo is None or t.registro_id is None:
            raise _NO
        await verificar_registro(db, user, emp, t.modelo, t.registro_id)
    return t


@router.get("/tipos")
async def tipos() -> dict[str, str]:
    return TIPOS


@router.get("/usuarios", response_model=list[UsuarioRef])
async def responsables(
    user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> list[Usuario]:
    """Usuarios a los que se les puede asignar una actividad."""
    emp = empresa_scope(user, empresa_id)
    return list(
        await db.scalars(
            select(Usuario)
            .where(
                Usuario.empresa_id == emp,
                Usuario.activo.is_(True),
                Usuario.rol != Rol.EMPLEADO,
            )
            .order_by(Usuario.nombre)
        )
    )


@router.get("", response_model=list[TareaOut])
async def listar(
    user: CurrentUser,
    db: DB,
    modelo: str,
    registro_id: uuid.UUID,
    empresa_id: uuid.UUID | None = None,
    incluir_hechas: bool = False,
) -> list[Tarea]:
    """Actividades de un registro (las pendientes primero, por fecha)."""
    emp = empresa_scope(user, empresa_id)
    await verificar_registro(db, user, emp, modelo, registro_id)
    q = select(Tarea).where(
        Tarea.empresa_id == emp, Tarea.modelo == modelo, Tarea.registro_id == registro_id
    )
    if not incluir_hechas:
        q = q.where(Tarea.hecha_en.is_(None))
    return list(await db.scalars(q.order_by(Tarea.hecha_en.is_not(None), Tarea.fecha, Tarea.hora)))


@router.get("/resumen", response_model=dict[uuid.UUID, ResumenRegistro])
async def resumen(
    user: CurrentUser, db: DB, modelo: str, empresa_id: uuid.UUID | None = None
) -> dict[uuid.UUID, ResumenRegistro]:
    """Pendientes por registro de un modelo, para pintar el reloj de cada fila (como Odoo)."""
    emp = empresa_scope(user, empresa_id)
    q = (
        select(Tarea.registro_id, func.count(), func.min(Tarea.fecha))
        .where(
            Tarea.empresa_id == emp,
            Tarea.modelo == modelo,
            Tarea.registro_id.is_not(None),
            Tarea.hecha_en.is_(None),
        )
        .group_by(Tarea.registro_id)
    )
    return {rid: ResumenRegistro(pendientes=n, proxima=f) for rid, n, f in await db.execute(q)}


@router.get("/calendario", response_model=list[TareaOut])
async def calendario(
    user: CurrentUser,
    db: DB,
    desde: date,
    hasta: date,
    empresa_id: uuid.UUID | None = None,
    modelo: str | None = None,
    mias: bool = False,
    incluir_hechas: bool = True,
) -> list[Tarea]:
    if (hasta - desde).days > 400:  # la vista de año pide el año completo
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El rango máximo es de un año")
    emp = empresa_scope(user, empresa_id)
    q = _visibles(
        select(Tarea).where(Tarea.empresa_id == emp, Tarea.fecha.between(desde, hasta)), user
    )
    if modelo:
        q = q.where(Tarea.modelo == modelo)
    if mias:
        q = q.where(Tarea.asignado_id == user.id)
    if not incluir_hechas:
        q = q.where(Tarea.hecha_en.is_(None))
    return list(
        await db.scalars(q.order_by(Tarea.fecha, Tarea.hora.nulls_first(), Tarea.created_at))
    )


@router.get("/mias", response_model=list[TareaOut])
async def mias(
    user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None, hasta: date | None = None
) -> list[Tarea]:
    """Mis actividades pendientes (para el aviso del encabezado). `hasta`: solo hasta esa fecha."""
    emp = empresa_scope(user, empresa_id)
    q = select(Tarea).where(
        Tarea.empresa_id == emp, Tarea.asignado_id == user.id, Tarea.hecha_en.is_(None)
    )
    if hasta:
        q = q.where(Tarea.fecha <= hasta)
    return list(await db.scalars(q.order_by(Tarea.fecha, Tarea.hora.nulls_first()).limit(100)))


@router.post("", response_model=TareaOut, status_code=status.HTTP_201_CREATED)
async def crear(
    data: TareaIn, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> Tarea:
    emp = empresa_scope(user, empresa_id)
    nombre = None
    if data.modelo or data.registro_id:
        if not (data.modelo and data.registro_id):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Falta el registro de la actividad"
            )
        await verificar_registro(db, user, emp, data.modelo, data.registro_id)
        nombre = await _nombre_registro(db, emp, data.modelo, data.registro_id)
    await _validar_asignado(db, emp, data.asignado_id)
    t = Tarea(
        empresa_id=emp,
        registro_nombre=nombre,
        creado_por_id=user.id,
        **data.model_dump(),
    )
    t.asignado_id = data.asignado_id or user.id  # sin responsable: quien la programa
    db.add(t)
    if data.modelo and data.registro_id:
        await bitacora.registrar(
            db,
            empresa_id=emp,
            modelo=data.modelo,
            registro_id=data.registro_id,
            usuario=user,
            tipo="sistema",
            mensaje=f"Programó {TIPOS[data.tipo].lower()}: {data.resumen} ({data.fecha:%d/%m/%Y})",
        )
    await db.commit()
    await db.refresh(t, attribute_names=["asignado"])
    return t


@router.patch("/{tarea_id}", response_model=TareaOut)
async def editar(
    tarea_id: uuid.UUID,
    data: TareaPatch,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> Tarea:
    emp = empresa_scope(user, empresa_id)
    t = await _obtener(db, user, emp, tarea_id)
    cambios = data.model_dump(exclude_unset=True)
    if "asignado_id" in cambios:
        await _validar_asignado(db, emp, cambios["asignado_id"])
    for k, v in cambios.items():
        setattr(t, k, v)
    await db.commit()
    await db.refresh(t, attribute_names=["asignado"])
    return t


@router.post("/{tarea_id}/hecha", response_model=TareaOut)
async def marcar_hecha(
    tarea_id: uuid.UUID,
    data: HechaIn,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> Tarea:
    emp = empresa_scope(user, empresa_id)
    t = await _obtener(db, user, emp, tarea_id)
    if t.hecha_en is None:
        t.hecha_en = datetime.now(UTC)
        t.comentario = data.comentario
        if t.modelo and t.registro_id:
            msg = f"{TIPOS.get(t.tipo, t.tipo)} hecha: {t.resumen}"
            if data.comentario:
                msg += f"\n{data.comentario}"
            await bitacora.registrar(
                db,
                empresa_id=emp,
                modelo=t.modelo,
                registro_id=t.registro_id,
                usuario=user,
                tipo="nota",
                mensaje=msg,
            )
    await db.commit()
    await db.refresh(t, attribute_names=["asignado"])
    return t


@router.delete("/{tarea_id}", status_code=status.HTTP_204_NO_CONTENT)
async def borrar(
    tarea_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> None:
    emp = empresa_scope(user, empresa_id)
    t = await _obtener(db, user, emp, tarea_id)
    await db.delete(t)
    await db.commit()
