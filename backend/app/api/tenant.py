"""Endpoints públicos sobre el subdominio actual."""

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import DB
from app.core.tenant import base_domain, tenant_de, tenant_de_host
from app.models import Empresa

router = APIRouter(prefix="/tenant", tags=["subdominio"])


class TenantOut(BaseModel):
    modo: str  # base | tenant | libre
    nombre: str | None = None
    slug: str | None = None
    dominio: str | None = None  # dominio de los clientes, p. ej. odai.lat


@router.get("", response_model=TenantOut)
async def actual(request: Request, db: DB) -> TenantOut:
    """La pantalla de login lo usa para mostrar el nombre de la empresa."""
    t = tenant_de(request)
    dominio = base_domain() or None
    if t.modo != "tenant":
        return TenantOut(modo=t.modo, dominio=dominio)
    empresa = await db.scalar(select(Empresa).where(Empresa.slug == t.slug, Empresa.activa))
    if empresa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    return TenantOut(modo="tenant", nombre=empresa.nombre, slug=empresa.slug, dominio=dominio)


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
