"""API de integración para el módulo de licencias de Odoo (odai.lat).

Odoo asigna y renueva licencias al facturar: crea la empresa (con su administrador), cambia el
número de empleados y usuarios, la vigencia, la periodicidad y el estado (corriendo, suspendida,
eliminada) con su motivo. La empresa se identifica por su subdominio (`slug`), el mismo de
<slug>.odai.lat.

Seguridad (todas se exigen):
- Solo por HTTPS (lo pone Caddy).
- Firma HMAC-SHA256 con un secreto compartido que nunca viaja en la petición:
    X-Odai-Timestamp: segundos Unix (se aceptan ±5 minutos)
    X-Odai-Nonce:     valor aleatorio único por petición (16 a 64 caracteres)
    X-Odai-Firma:     hex(HMAC_SHA256(secreto, mensaje)), donde mensaje es
                      timestamp, nonce, MÉTODO, ruta y sha256(cuerpo) en hex, unidos con "\\n"
- Cada nonce se usa una sola vez (se guarda 10 minutos en Valkey): no se pueden repetir peticiones.
- Lista opcional de IPs permitidas (INTEGRACION_IPS).
"""

import hashlib
import hmac
import logging
import time
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB
from app.core.config import get_settings
from app.core.security import hash_password
from app.core.tenant import url_empresa
from app.models import Empleado, Empresa, Rol, Usuario
from app.schemas.common import RFC, Nombre
from app.schemas.empresa import Estado, Periodicidad, Slug
from app.services import accesos, estado_empresa

log = logging.getLogger(__name__)
VENTANA_S = 300


async def verificar_firma(
    request: Request,
    timestamp: Annotated[str | None, Header(alias="X-Odai-Timestamp")] = None,
    nonce: Annotated[str | None, Header(alias="X-Odai-Nonce")] = None,
    firma: Annotated[str | None, Header(alias="X-Odai-Firma")] = None,
) -> None:
    s = get_settings()
    secreto = s.integracion_secreto
    if len(secreto) < 32:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Integración no configurada")
    permitidas = {ip.strip() for ip in s.integracion_ips.split(",") if ip.strip()}
    ip = request.client.host if request.client else ""
    if permitidas and ip not in permitidas:
        log.warning("Integración: IP no permitida %s", ip)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Origen no permitido")
    no_valida = HTTPException(status.HTTP_401_UNAUTHORIZED, "Firma inválida")
    if not timestamp or not nonce or not firma or not 16 <= len(nonce) <= 64:
        raise no_valida
    try:
        ts = int(timestamp)
    except ValueError:
        raise no_valida from None
    if abs(time.time() - ts) > VENTANA_S:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Petición vencida (revisa el reloj)")
    cuerpo = await request.body()
    mensaje = "\n".join(
        [
            timestamp,
            nonce,
            request.method.upper(),
            request.url.path,
            hashlib.sha256(cuerpo).hexdigest(),
        ]
    )
    esperada = hmac.new(secreto.encode(), mensaje.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(esperada, firma.lower()):
        log.warning("Integración: firma inválida desde %s", ip)
        raise no_valida
    # Un nonce solo sirve una vez. Si Valkey no responde, se rechaza (falla cerrada).
    try:
        async with Redis.from_url(s.redis_url) as r:
            nuevo = await r.set(f"integracion:nonce:{nonce}", "1", nx=True, ex=VENTANA_S * 2)
    except Exception:  # noqa: BLE001
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Intenta de nuevo") from None
    if not nuevo:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Petición repetida")


router = APIRouter(
    prefix="/integracion", tags=["integración Odoo"], dependencies=[Depends(verificar_firma)]
)


class AdministradorIn(BaseModel):
    nombre: Nombre
    email: EmailStr


class LicenciaIn(BaseModel):
    """Campos que manda Odoo. Todos son opcionales al actualizar; al crear se pide nombre."""

    nombre: Nombre | None = None
    razon_social: str | None = Field(default=None, max_length=250)
    rfc: RFC | None = None
    max_empleados: int | None = Field(default=None, ge=1, le=100000)
    max_usuarios: int | None = Field(default=None, ge=0, le=1000)
    licencia_vence: date | None = None
    periodicidad: Periodicidad | None = None
    estado: Estado | None = None
    motivo_suspension: str | None = Field(default=None, max_length=300)
    demo: bool | None = None
    referencia_odoo: str | None = Field(default=None, max_length=100)
    administrador: AdministradorIn | None = None  # solo al crear: recibe su invitación


class LicenciaOut(BaseModel):
    slug: str
    url: str | None
    nombre: str
    estado: str
    motivo_suspension: str | None
    max_empleados: int
    max_usuarios: int
    empleados_activos: int
    licencia_vence: date | None
    periodicidad: str | None
    demo: bool
    referencia_odoo: str | None
    bloqueada: bool
    mensaje_bloqueo: str | None
    creada: bool = False
    enlace_administrador: str | None = None  # si no hay correo saliente, para mandarlo a mano


async def _salida(db: DB, e: Empresa, **extra) -> LicenciaOut:
    activos = await db.scalar(
        select(func.count()).where(Empleado.empresa_id == e.id, Empleado.activo)
    )
    bloqueo = estado_empresa.bloqueo(e)
    return LicenciaOut(
        slug=e.slug,
        url=url_empresa(e.slug),
        nombre=e.nombre,
        estado=e.estado,
        motivo_suspension=e.motivo_suspension,
        max_empleados=e.max_empleados,
        max_usuarios=e.max_usuarios,
        empleados_activos=activos or 0,
        licencia_vence=e.licencia_vence,
        periodicidad=e.periodicidad,
        demo=e.demo,
        referencia_odoo=e.referencia_odoo,
        bloqueada=bloqueo is not None,
        mensaje_bloqueo=bloqueo["mensaje"] if bloqueo else None,
        **extra,
    )


@router.get("/ping")
async def ping() -> dict[str, str]:
    """Para probar la firma desde Odoo."""
    return {"estado": "ok"}


@router.get("/empresas/{slug}", response_model=LicenciaOut)
async def consultar(slug: str, db: DB) -> LicenciaOut:
    e = await db.scalar(select(Empresa).where(Empresa.slug == slug.lower()))
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    return await _salida(db, e)


@router.put("/empresas/{slug}", response_model=LicenciaOut)
async def asignar_licencia(slug: Slug, data: LicenciaIn, request: Request, db: DB) -> LicenciaOut:
    """Crea la empresa (si no existe) o actualiza su licencia y su estado."""
    e = await db.scalar(select(Empresa).where(Empresa.slug == slug))
    creada = e is None
    enlace = None
    if creada:
        if not data.nombre:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Para crear la empresa se necesita su nombre"
            )
        e = Empresa(
            nombre=data.nombre,
            slug=slug,
            max_empleados=data.max_empleados or get_settings().licencia_max_empleados_default,
        )
        db.add(e)
    campos = data.model_dump(
        exclude_unset=True, exclude={"administrador", "estado", "motivo_suspension"}
    )
    for campo, valor in campos.items():
        if valor is not None or campo in ("licencia_vence", "razon_social", "rfc"):
            setattr(e, campo, valor)
    if data.estado is not None or "motivo_suspension" in data.model_fields_set:
        estado_empresa.aplicar(e, data.estado or e.estado, data.motivo_suspension)
    try:
        await db.flush()
        if creada and data.administrador:
            email = data.administrador.email.lower()
            if await db.scalar(select(func.count()).where(func.lower(Usuario.email) == email)):
                raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un usuario con ese correo")
            admin = Usuario(
                empresa_id=e.id,
                email=email,
                nombre=data.administrador.nombre,
                # Contraseña inutilizable: la crea él con el enlace de su invitación.
                password_hash=hash_password(
                    hashlib.sha256(str(time.time_ns()).encode()).hexdigest()
                ),
                rol=Rol.ADMIN_EMPRESA,
            )
            db.add(admin)
            await db.flush()
            enviado, url = await accesos.enviar_enlace(db, request, admin, "invitacion")
            enlace = None if enviado else url
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe una empresa con ese RFC") from None
    log.info("Integración: licencia de %s actualizada (estado=%s)", e.slug, e.estado)
    return await _salida(db, e, creada=creada, enlace_administrador=enlace)
