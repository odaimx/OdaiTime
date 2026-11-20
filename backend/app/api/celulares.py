"""Aprobación de celulares vinculados (ficha del empleado)."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser, empresa_scope, require_roles, sucursales_permitidas
from app.models import CelularVinculado, Empleado, Rol, Usuario
from app.services import bitacora

router = APIRouter(tags=["celulares"])
_GESTION = (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA, Rol.GERENTE_SUCURSAL)


class CelularOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    empleado_id: uuid.UUID
    equipo: str | None
    estado: str
    created_at: datetime
    aprobado_en: datetime | None
    ultimo_uso: datetime | None


def _alcance(q, user: Usuario):
    permitidas = sucursales_permitidas(user)
    if permitidas is not None:
        q = q.join(Empleado, Empleado.id == CelularVinculado.empleado_id).where(
            Empleado.sucursal_id.in_(permitidas)
        )
    return q


@router.get(
    "/empleados/{empleado_id}/celulares",
    response_model=list[CelularOut],
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def listar(
    empleado_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> list[CelularVinculado]:
    emp = empresa_scope(user, empresa_id)
    q = select(CelularVinculado).where(
        CelularVinculado.empresa_id == emp,
        CelularVinculado.empleado_id == empleado_id,
        CelularVinculado.estado != "revocado",
    )
    return list(await db.scalars(_alcance(q, user).order_by(CelularVinculado.created_at.desc())))


@router.get("/celulares/pendientes", dependencies=[Depends(require_roles(*_GESTION))])
async def pendientes(user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None) -> dict:
    """Celulares por aprobar (aviso en Inicio): total y los primeros empleados."""
    emp = empresa_scope(user, empresa_id)
    filtro = (CelularVinculado.empresa_id == emp, CelularVinculado.estado == "pendiente")
    total = await db.scalar(_alcance(select(func.count(CelularVinculado.id)).where(*filtro), user))
    primeros = await db.scalars(
        _alcance(select(CelularVinculado).where(*filtro), user)
        .order_by(CelularVinculado.created_at)
        .limit(5)
    )
    return {
        "pendientes": total or 0,
        "empleados": [
            {"id": str(c.empleado_id), "nombre": c.empleado.nombre_completo} for c in primeros
        ],
    }


async def _get(db: DB, user: Usuario, celular_id: uuid.UUID, emp: uuid.UUID) -> CelularVinculado:
    q = select(CelularVinculado).where(
        CelularVinculado.id == celular_id, CelularVinculado.empresa_id == emp
    )
    c = await db.scalar(_alcance(q, user))
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Celular no encontrado")
    return c


@router.post(
    "/celulares/{celular_id}/aprobar",
    response_model=CelularOut,
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def aprobar(
    celular_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> CelularVinculado:
    emp = empresa_scope(user, empresa_id)
    c = await _get(db, user, celular_id, emp)
    if c.estado != "pendiente":
        raise HTTPException(status.HTTP_409_CONFLICT, "Ese celular no está pendiente")
    c.estado, c.aprobado_por, c.aprobado_en = "aprobado", user.id, datetime.now(UTC)
    await bitacora.registrar(
        db,
        empresa_id=emp,
        modelo="empleado",
        registro_id=c.empleado_id,
        usuario=user,
        tipo="cambio",
        mensaje=f"Celular aprobado para checar ({c.equipo or 'sin nombre'})",
    )
    await db.commit()
    return c


@router.delete(
    "/celulares/{celular_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def quitar(
    celular_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> None:
    """Rechaza un pendiente o desvincula un celular (perdido, cambio de equipo)."""
    emp = empresa_scope(user, empresa_id)
    c = await _get(db, user, celular_id, emp)
    c.estado = "revocado"
    await bitacora.registrar(
        db,
        empresa_id=emp,
        modelo="empleado",
        registro_id=c.empleado_id,
        usuario=user,
        tipo="cambio",
        mensaje=f"Celular desvinculado ({c.equipo or 'sin nombre'})",
    )
    await db.commit()
