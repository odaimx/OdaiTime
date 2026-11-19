"""Endpoints públicos sobre el subdominio actual."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, CurrentUser, empresa_scope, require_roles
from app.core.tenant import base_domain, tenant_de, tenant_de_host
from app.models import Empresa
from app.models.usuario import Rol
from app.schemas.common import RFC, Nombre
from app.services import estado_empresa, fotos

router = APIRouter(prefix="/tenant", tags=["subdominio"])


class TenantOut(BaseModel):
    modo: str  # base | tenant | libre
    nombre: str | None = None
    slug: str | None = None
    dominio: str | None = None  # dominio de los clientes, p. ej. odai.lat
    empresa_id: uuid.UUID | None = None
    logo_version: str | None = None
    fondo_color: str | None = None
    fondo_version: str | None = None
    aviso: str | None = None  # suspendida o licencia vencida: motivo para el login


@router.get("", response_model=TenantOut)
async def actual(request: Request, db: DB) -> TenantOut:
    """La pantalla de login lo usa para mostrar el nombre de la empresa."""
    t = tenant_de(request)
    dominio = base_domain() or None
    if t.modo != "tenant":
        return TenantOut(modo=t.modo, dominio=dominio)
    empresa = await db.scalar(select(Empresa).where(Empresa.slug == t.slug))
    if empresa is None or empresa.estado == "eliminada":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    return TenantOut(
        modo="tenant",
        nombre=empresa.nombre,
        slug=empresa.slug,
        dominio=dominio,
        empresa_id=empresa.id,
        logo_version=empresa.logo_version,
        fondo_color=empresa.fondo_color,
        fondo_version=empresa.fondo_version,
        aviso=(b := estado_empresa.bloqueo(empresa)) and b["mensaje"],
    )


# --- Logo de la empresa ---


@router.get("/logo/{empresa_id}")
async def ver_logo(empresa_id: uuid.UUID, db: DB) -> Response:
    """Público: el logo se muestra en el login del subdominio, en el menú y en los reportes."""
    datos = await db.scalar(select(Empresa.logo).where(Empresa.id == empresa_id))
    if not datos:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sin logo")
    # La URL lleva ?v=<versión>, así que se puede guardar en caché mucho tiempo.
    return Response(
        datos, media_type="image/png", headers={"Cache-Control": "public, max-age=31536000"}
    )


CACHE_LARGA = {"Cache-Control": "public, max-age=31536000"}


class LogoOut(BaseModel):
    logo_version: str | None


_admin = Depends(require_roles(Rol.SUPERADMIN, Rol.ADMIN_EMPRESA))


@router.put("/logo", response_model=LogoOut, dependencies=[_admin])
async def subir_logo(
    user: CurrentUser,
    db: DB,
    archivo: Annotated[UploadFile, File()],
    empresa_id: uuid.UUID | None = None,
) -> LogoOut:
    empresa = await db.get(Empresa, empresa_scope(user, empresa_id))
    if empresa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    empresa.logo = await fotos.procesar_logo(archivo)
    empresa.logo_actualizado = datetime.now(UTC)
    await db.commit()
    return LogoOut(logo_version=empresa.logo_version)


@router.delete("/logo", response_model=LogoOut, dependencies=[_admin])
async def quitar_logo(user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None) -> LogoOut:
    empresa = await db.get(Empresa, empresa_scope(user, empresa_id))
    if empresa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    empresa.logo = None
    empresa.logo_actualizado = None
    await db.commit()
    return LogoOut(logo_version=None)


@router.get("/permitido", include_in_schema=False)
async def permitido(domain: str, db: DB) -> Response:
    """Caddy pregunta aquí antes de emitir un certificado bajo demanda (on_demand_tls).

    Solo se emite para el dominio base y subdominios de empresas registradas, para que nadie
    agote el límite de Let's Encrypt apuntando hosts arbitrarios al servidor.
    Caddy lo llama por la red interna; desde fuera, el Caddyfile bloquea esta ruta.
    """
    t = tenant_de_host(domain)
    if t.modo == "base" and base_domain():
        return Response(status_code=200)
    if t.modo == "tenant" and await db.scalar(select(Empresa.id).where(Empresa.slug == t.slug)):
        return Response(status_code=200)
    return Response(status_code=404)


# --- Fondo principal de la empresa (color o imagen) ---


class FondoOut(BaseModel):
    fondo_color: str | None
    fondo_version: str | None


class ColorIn(BaseModel):
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


async def _empresa_admin(db: DB, user: CurrentUser, empresa_id: uuid.UUID | None) -> Empresa:
    empresa = await db.get(Empresa, empresa_scope(user, empresa_id))
    if empresa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    return empresa


def _fondo(e: Empresa) -> FondoOut:
    return FondoOut(fondo_color=e.fondo_color, fondo_version=e.fondo_version)


@router.get("/fondo/{empresa_id}")
async def ver_fondo(empresa_id: uuid.UUID, db: DB) -> Response:
    """Público: se usa en el login del subdominio y detrás de las pantallas."""
    datos = await db.scalar(select(Empresa.fondo_imagen).where(Empresa.id == empresa_id))
    if not datos:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sin imagen de fondo")
    return Response(datos, media_type="image/jpeg", headers=CACHE_LARGA)


@router.put("/fondo/color", response_model=FondoOut, dependencies=[_admin])
async def fondo_color(
    data: ColorIn, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> FondoOut:
    """Fondo de un color (quita la imagen)."""
    e = await _empresa_admin(db, user, empresa_id)
    e.fondo_color = data.color.lower()
    e.fondo_imagen = None
    e.fondo_actualizado = None
    await db.commit()
    return _fondo(e)


@router.put("/fondo/imagen", response_model=FondoOut, dependencies=[_admin])
async def fondo_imagen(
    user: CurrentUser,
    db: DB,
    archivo: Annotated[UploadFile, File()],
    empresa_id: uuid.UUID | None = None,
) -> FondoOut:
    e = await _empresa_admin(db, user, empresa_id)
    e.fondo_imagen = await fotos.procesar_fondo(archivo)
    e.fondo_actualizado = datetime.now(UTC)
    e.fondo_color = None
    await db.commit()
    return _fondo(e)


@router.delete("/fondo", response_model=FondoOut, dependencies=[_admin])
async def quitar_fondo(user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None) -> FondoOut:
    e = await _empresa_admin(db, user, empresa_id)
    e.fondo_color = None
    e.fondo_imagen = None
    e.fondo_actualizado = None
    await db.commit()
    return _fondo(e)


# --- Datos básicos de la empresa (los cambia su administrador) ---


class MiEmpresaIn(BaseModel):
    nombre: Nombre
    razon_social: str | None = Field(default=None, max_length=250)
    rfc: RFC | None = None
    direccion: str | None = Field(default=None, max_length=300)


class MiEmpresaOut(BaseModel):
    id: uuid.UUID
    nombre: str
    razon_social: str | None
    rfc: str | None
    direccion: str | None
    slug: str
    logo_version: str | None


def _mi_empresa(e: Empresa) -> MiEmpresaOut:
    return MiEmpresaOut(
        id=e.id,
        nombre=e.nombre,
        razon_social=e.razon_social,
        rfc=e.rfc,
        direccion=e.direccion,
        slug=e.slug,
        logo_version=e.logo_version,
    )


@router.get("/empresa", response_model=MiEmpresaOut, dependencies=[_admin])
async def ver_mi_empresa(
    user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> MiEmpresaOut:
    e = await db.get(Empresa, empresa_scope(user, empresa_id))
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    return _mi_empresa(e)


@router.patch("/empresa", response_model=MiEmpresaOut, dependencies=[_admin])
async def guardar_mi_empresa(
    data: MiEmpresaIn, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> MiEmpresaOut:
    """Nombre, razón social, RFC y dirección. La licencia y el subdominio solo los cambia Odai."""
    e = await db.get(Empresa, empresa_scope(user, empresa_id))
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    e.nombre = data.nombre
    e.razon_social = (data.razon_social or "").strip() or None
    e.rfc = data.rfc or None
    e.direccion = (data.direccion or "").strip() or None
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe una empresa con ese RFC") from None
    return _mi_empresa(e)
