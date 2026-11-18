"""Configuración general de ODAITIME (todas las empresas): tema de colores e imagen de inicio."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DB, require_roles
from app.models import ConfigSistema, Rol
from app.services import fotos

router = APIRouter(prefix="/sistema", tags=["sistema"])
_SUPER = [Depends(require_roles(Rol.SUPERADMIN))]
HEX = r"^#[0-9a-fA-F]{6}$"


class Colores(BaseModel):
    marca: str | None = Field(default=None, pattern=HEX)  # morado: botones activos, acentos
    acento: str | None = Field(default=None, pattern=HEX)  # azul secundario
    marino: str | None = Field(default=None, pattern=HEX)  # menú, encabezados y botón principal
    titulos: str | None = Field(default=None, pattern=HEX)  # beige: títulos y menú lateral


class TemaOut(BaseModel):
    colores: Colores
    imagen_version: str | None


async def _config(db: DB) -> ConfigSistema:
    c = await db.get(ConfigSistema, 1)
    if c is None:
        c = ConfigSistema(id=1, colores={})
        db.add(c)
        await db.flush()
    return c


def _out(c: ConfigSistema) -> TemaOut:
    return TemaOut(
        colores=Colores(**(c.colores or {})),
        imagen_version=c.imagen_actualizada.isoformat() if c.imagen_actualizada else None,
    )


@router.get("/tema", response_model=TemaOut)
async def tema(db: DB) -> TemaOut:
    """Público: los colores se aplican desde la pantalla de acceso."""
    c = await db.get(ConfigSistema, 1)
    return _out(c) if c else TemaOut(colores=Colores(), imagen_version=None)


@router.put("/tema", response_model=TemaOut, dependencies=_SUPER)
async def guardar_tema(data: Colores, db: DB) -> TemaOut:
    c = await _config(db)
    c.colores = {k: v.lower() for k, v in data.model_dump().items() if v}
    await db.commit()
    return _out(c)


@router.get("/imagen-inicio")
async def imagen_inicio(db: DB) -> Response:
    datos = await db.scalar(select(ConfigSistema.imagen_inicio).where(ConfigSistema.id == 1))
    if not datos:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sin imagen de inicio")
    return Response(
        datos, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=31536000"}
    )


@router.put("/imagen-inicio", response_model=TemaOut, dependencies=_SUPER)
async def subir_imagen(db: DB, archivo: Annotated[UploadFile, File()]) -> TemaOut:
    c = await _config(db)
    c.imagen_inicio = await fotos.procesar_fondo(archivo)
    c.imagen_actualizada = datetime.now(UTC)
    await db.commit()
    return _out(c)


@router.delete("/imagen-inicio", response_model=TemaOut, dependencies=_SUPER)
async def quitar_imagen(db: DB) -> TemaOut:
    c = await _config(db)
    c.imagen_inicio = None
    c.imagen_actualizada = None
    await db.commit()
    return _out(c)
