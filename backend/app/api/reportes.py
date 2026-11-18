"""Reportes de asistencia y exportación a sistemas de nómina (Etapa 6)."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from app.api.asistencia import calcular_periodo
from app.api.deps import DB, CurrentUser, empresa_scope, require_roles
from app.models import ClaveNomina, Empresa, Rol
from app.services import reportes
from app.services.asistencia import CONCEPTOS

router = APIRouter(prefix="/reportes", tags=["reportes y nómina"])

_ADMIN = (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA)
_GESTION = (*_ADMIN, Rol.GERENTE_SUCURSAL)


async def _empresa(db: DB, emp: uuid.UUID) -> Empresa:
    empresa = await db.get(Empresa, emp)
    if empresa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    return empresa


def _archivo(contenido: bytes, mime: str, nombre: str) -> Response:
    return Response(
        contenido,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )


def _validar_sistema(sistema: str) -> None:
    if sistema not in reportes.SISTEMAS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Sistema de nómina no válido")


async def _claves(db: DB, emp: uuid.UUID, sistema: str) -> dict[str, str]:
    filas = await db.scalars(
        select(ClaveNomina).where(ClaveNomina.empresa_id == emp, ClaveNomina.sistema == sistema)
    )
    return {c.concepto: c.codigo for c in filas}


# --- Catálogo y claves ---


class ConceptoOut(BaseModel):
    clave: str
    descripcion: str
    unidad: str
    codigo: str | None = None  # clave en el sistema elegido


class ClavesIn(BaseModel):
    claves: dict[str, str | None] = Field(description="concepto ODAITIME → clave en el sistema")


@router.get("/sistemas", dependencies=[Depends(require_roles(*_GESTION))])
async def sistemas() -> dict[str, str]:
    return reportes.SISTEMAS


@router.get(
    "/claves", response_model=list[ConceptoOut], dependencies=[Depends(require_roles(*_GESTION))]
)
async def ver_claves(
    sistema: str, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> list[ConceptoOut]:
    _validar_sistema(sistema)
    claves = await _claves(db, empresa_scope(user, empresa_id), sistema)
    return [
        ConceptoOut(clave=k, descripcion=d, unidad=u, codigo=claves.get(k))
        for k, (d, u) in CONCEPTOS.items()
    ]


@router.put(
    "/claves", response_model=list[ConceptoOut], dependencies=[Depends(require_roles(*_ADMIN))]
)
async def guardar_claves(
    sistema: str, data: ClavesIn, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> list[ConceptoOut]:
    _validar_sistema(sistema)
    emp = empresa_scope(user, empresa_id)
    desconocidos = set(data.claves) - set(CONCEPTOS)
    if desconocidos:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Conceptos desconocidos: {', '.join(sorted(desconocidos))}",
        )
    await db.execute(
        delete(ClaveNomina).where(ClaveNomina.empresa_id == emp, ClaveNomina.sistema == sistema)
    )
    for concepto, codigo in data.claves.items():
        if codigo and codigo.strip():
            db.add(
                ClaveNomina(
                    empresa_id=emp, sistema=sistema, concepto=concepto, codigo=codigo.strip()[:60]
                )
            )
    await db.commit()
    return await ver_claves(sistema, user, db, empresa_id)


# --- Archivos ---


@router.get("/asistencia.xlsx", dependencies=[Depends(require_roles(*_GESTION))])
async def resumen_xlsx(
    user: CurrentUser,
    db: DB,
    desde: date,
    hasta: date,
    sucursal_id: uuid.UUID | None = None,
    empresa_id: uuid.UUID | None = None,
) -> Response:
    emp = empresa_scope(user, empresa_id)
    periodo = await calcular_periodo(db, user, emp, desde, hasta, sucursal_id)
    contenido = reportes.reporte_resumen(await _empresa(db, emp), desde, hasta, periodo)
    return _archivo(
        contenido,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        f"asistencia_{desde:%Y%m%d}_{hasta:%Y%m%d}.xlsx",
    )


@router.get("/detalle.xlsx", dependencies=[Depends(require_roles(*_GESTION))])
async def detalle_xlsx(
    user: CurrentUser,
    db: DB,
    desde: date,
    hasta: date,
    sucursal_id: uuid.UUID | None = None,
    empresa_id: uuid.UUID | None = None,
) -> Response:
    emp = empresa_scope(user, empresa_id)
    periodo = await calcular_periodo(db, user, emp, desde, hasta, sucursal_id)
    contenido = reportes.reporte_detalle(await _empresa(db, emp), desde, hasta, periodo)
    return _archivo(
        contenido,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        f"detalle_diario_{desde:%Y%m%d}_{hasta:%Y%m%d}.xlsx",
    )


@router.get("/nomina", dependencies=[Depends(require_roles(*_GESTION))])
async def exportar_nomina(
    sistema: str,
    user: CurrentUser,
    db: DB,
    desde: date,
    hasta: date,
    sucursal_id: uuid.UUID | None = None,
    empresa_id: uuid.UUID | None = None,
) -> Response:
    """Archivo de incidencias para el sistema de nómina, con las claves de la empresa."""
    _validar_sistema(sistema)
    emp = empresa_scope(user, empresa_id)
    periodo = await calcular_periodo(db, user, emp, desde, hasta, sucursal_id)
    contenido, mime, ext = reportes.exportar(
        sistema, await _empresa(db, emp), desde, hasta, periodo, await _claves(db, emp, sistema)
    )
    return _archivo(contenido, mime, f"nomina_{sistema}_{desde:%Y%m%d}_{hasta:%Y%m%d}.{ext}")
