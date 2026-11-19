"""Reportes de asistencia y exportación a sistemas de nómina (Etapa 6)."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import undefer

from app.api.asistencia import calcular_periodo
from app.api.deps import DB, CurrentUser, empresa_scope, require_roles
from app.models import ClaveNomina, Empresa, Rol
from app.services import reportes
from app.services.asistencia import CONCEPTOS

router = APIRouter(prefix="/reportes", tags=["reportes y nómina"])

_ADMIN = (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA)
_GESTION = (*_ADMIN, Rol.GERENTE_SUCURSAL)


async def _empresa(db: DB, emp: uuid.UUID) -> Empresa:
    # El logo es una columna diferida: se carga aquí porque los reportes la leen sin await.
    empresa = await db.scalar(
        select(Empresa).where(Empresa.id == emp).options(undefer(Empresa.logo))
    )
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
    formato: str = "xlsx",
    tipo_periodo: str | None = None,
    ejercicio: int | None = None,
    numero_periodo: int | None = None,
    checadas: bool = False,
) -> Response:
    """Archivo de incidencias para el sistema de nómina, con las claves de la empresa.

    CONTPAQi usa el layout de intercambio ODAI Time (Excel, CSV o TXT tabulado) con el tipo,
    ejercicio y número de periodo de nómina. Odoo usa la plantilla definitiva de incidencias
    para Odoo 19/20 (Excel o CSV), con entradas y salidas opcionales.
    """
    _validar_sistema(sistema)
    opciones = None
    if sistema == "contpaqi":
        if formato not in ("xlsx", "csv", "txt"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Formato no válido")
        if tipo_periodo and tipo_periodo not in reportes.TIPOS_PERIODO:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Tipo de periodo no válido")
        if numero_periodo is not None and not 1 <= numero_periodo <= 999:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Número de periodo no válido")
        opciones = reportes.OpcionesContpaqi(
            ejercicio=ejercicio or hasta.year,
            tipo_periodo=tipo_periodo,
            numero_periodo=numero_periodo,
            formato=formato,
        )
    elif sistema == "odoo":
        if formato not in ("xlsx", "csv"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Formato no válido")
        opciones = reportes.OpcionesContpaqi(
            ejercicio=hasta.year, formato=formato, checadas=checadas
        )
    emp = empresa_scope(user, empresa_id)
    periodo = await calcular_periodo(db, user, emp, desde, hasta, sucursal_id)
    contenido, mime, ext = reportes.exportar(
        sistema,
        await _empresa(db, emp),
        desde,
        hasta,
        periodo,
        await _claves(db, emp, sistema),
        opciones,
    )
    claves = await _claves(db, emp, sistema)
    resp = _archivo(contenido, mime, f"nomina_{sistema}_{desde:%Y%m%d}_{hasta:%Y%m%d}.{ext}")
    # Cuántos movimientos lleva el archivo: si es 0, la pantalla avisa por qué está vacío.
    resp.headers["X-Odai-Movimientos"] = str(
        len(reportes.movimientos(periodo, claves, hasta, diario=True))
    )
    resp.headers["X-Odai-Empleados"] = str(len(periodo))
    return resp
