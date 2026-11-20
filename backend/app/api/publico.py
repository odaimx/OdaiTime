"""Checar sin usuario ni contraseña (dirección única de la empresa: /marcar).

Dos opciones:
- **QR del kiosco**: el celular escanea el QR de la tablet (firmado, cambia cada 30 s),
  el empleado escribe número + PIN y se valida que esté en la sucursal (GPS). Selfie siempre.
- **Celular vinculado**: el teléfono se vincula una vez con número (o celular) + PIN y queda
  pendiente hasta que el administrador lo aprueba; después checa con su PIN, GPS y selfie.

Seguridad: bloqueo de 15 min tras 5 PIN incorrectos (por número y por IP), sesión firmada de
3 min tras el PIN, token del celular guardado solo como hash y revocable desde la ficha.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.api.checadas import checar_movil, estado_hoy
from app.api.deps import DB
from app.api.kiosco import _autenticar, _config_kiosco, _estado_empleado, _limite
from app.core.security import verify_password
from app.core.tenant import tenant_de
from app.models import CelularVinculado, Dispositivo, Empleado, Empresa
from app.schemas.checada import Accion, EstadoHoy
from app.services import checadas as svc
from app.services import estado_empresa

router = APIRouter(prefix="/publico", tags=["publico"])

PIN_INTENTOS, PIN_VENTANA_S = 5, 900


def _ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (
        request.client.host if request.client else "?"
    )


async def _kiosco_de_qr(db: DB, qr: str) -> Dispositivo:
    d = await db.get(Dispositivo, svc.validar_qr(qr))
    if d is None or not d.activo or d.tipo != "kiosco":
        raise svc.error("qr_invalido", "El código QR no es de un kiosco activo.")
    empresa = await db.get(Empresa, d.empresa_id)
    if empresa and (motivo := estado_empresa.bloqueo(empresa)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, motivo)
    return d


# --- QR del kiosco ---


class QrIdentificarIn(BaseModel):
    qr: str = Field(max_length=120)
    numero: str = Field(min_length=1, max_length=20)
    pin: str | None = Field(default=None, max_length=6)
    latitud: float = Field(ge=-90, le=90)
    longitud: float = Field(ge=-180, le=180)
    precision: int | None = Field(default=None, ge=0)


@router.post("/qr/identificar")
async def qr_identificar(data: QrIdentificarIn, request: Request, db: DB) -> dict:
    """Número + PIN con el QR del kiosco; se valida que el celular esté en la sucursal."""
    if await _limite(f"pub_ip:{_ip(request)}", 30, PIN_VENTANA_S):
        raise svc.error("bloqueado", "Demasiados intentos. Espera unos minutos.", http=429)
    d = await _kiosco_de_qr(db, data.qr)
    config = await _config_kiosco(db, d)
    try:
        empleado = await _autenticar(db, d, config, data.numero, data.pin)
    except HTTPException:
        await _limite(f"pub_ip:{_ip(request)}", 30, PIN_VENTANA_S, registrar_fallo=True)
        raise
    svc.validar_gps(d.sucursal, data.latitud, data.longitud, data.precision)
    estado = await _estado_empleado(db, d, empleado)
    await db.commit()
    return {"sesion": svc.firmar_sesion(d.id, empleado.id), **estado}


@router.post("/qr/checar", status_code=status.HTTP_201_CREATED)
async def qr_checar(
    db: DB,
    sesion: Annotated[str, Form(max_length=200)],
    accion: Annotated[Accion, Form()],
    latitud: Annotated[float, Form(ge=-90, le=90)],
    longitud: Annotated[float, Form(ge=-180, le=180)],
    foto: Annotated[UploadFile, File()],
    precision: Annotated[int | None, Form(ge=0)] = None,
) -> dict:
    try:
        dispositivo_id = uuid.UUID(sesion.split(".")[0])
    except ValueError:
        raise svc.error("sesion_vencida", "Vuelve a escanear el QR.", http=401) from None
    d = await db.get(Dispositivo, dispositivo_id)
    empleado_id = svc.leer_sesion(sesion, dispositivo_id) if d else None
    empleado = await db.get(Empleado, empleado_id) if empleado_id else None
    if d is None or not d.activo or empleado is None or not empleado.activo:
        raise svc.error("sesion_vencida", "Se acabó el tiempo; vuelve a escanear el QR.", http=401)
    config = await _config_kiosco(db, d)
    distancia = svc.validar_gps(d.sucursal, latitud, longitud, precision)
    checada = await svc.registrar(
        db,
        empleado=empleado,
        sucursal=d.sucursal,
        config=config,
        origen="kiosco",
        dispositivo_id=d.id,
        accion=accion,
        latitud=latitud,
        longitud=longitud,
        precision_m=precision,
        distancia_m=distancia,
    )
    checada.foto = await svc.guardar_foto(foto, d.empresa_id)
    await db.commit()
    return {
        "nombre": empleado.nombre_completo,
        "tipo": checada.tipo,
        "comida": checada.comida,
        "momento": checada.momento.isoformat(),
        "retardo_minutos": checada.retardo_minutos,
    }


# --- Celular vinculado ---


async def _empresa_publica(db: DB, request: Request, slug: str | None) -> Empresa:
    """La empresa sale del subdominio (cliente.odai.lat); sin subdominio (desarrollo) del slug."""
    t = tenant_de(request)
    if t.modo == "base":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entra desde la dirección de tu empresa")
    clave = t.slug if t.modo == "tenant" else slug
    empresa = await db.scalar(select(Empresa).where(Empresa.slug == clave)) if clave else None
    if empresa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    if motivo := estado_empresa.bloqueo(empresa):
        raise HTTPException(status.HTTP_403_FORBIDDEN, motivo)
    return empresa


async def _verificar_pin(empleado: Empleado, pin: str | None, clave: str) -> None:
    if await _limite(clave, PIN_INTENTOS, PIN_VENTANA_S):
        raise svc.error("bloqueado", "Demasiados intentos. Espera 15 minutos.", http=429)
    if not empleado.pin_hash:
        raise svc.error("sin_pin", "No tienes PIN asignado. Pídelo a tu administrador.")
    if not pin or not verify_password(pin, empleado.pin_hash):
        await _limite(clave, PIN_INTENTOS, PIN_VENTANA_S, registrar_fallo=True)
        raise svc.error("credenciales", "PIN incorrecto.", http=401)


class VincularIn(BaseModel):
    empresa: str | None = Field(default=None, max_length=60)
    identificador: str = Field(min_length=1, max_length=20)  # número de empleado o celular
    pin: str = Field(min_length=4, max_length=6)
    equipo: str | None = Field(default=None, max_length=120)


@router.post("/celular/vincular", status_code=status.HTTP_201_CREATED)
async def vincular(data: VincularIn, request: Request, db: DB) -> dict:
    empresa = await _empresa_publica(db, request, data.empresa)
    ident = data.identificador.strip()
    clave_ip = f"pub_vinc:{_ip(request)}"
    if await _limite(clave_ip, 10, PIN_VENTANA_S):
        raise svc.error("bloqueado", "Demasiados intentos. Espera 15 minutos.", http=429)
    diez = "".join(ch for ch in ident if ch.isdigit())[-10:]
    empleado = await db.scalar(
        select(Empleado).where(
            Empleado.empresa_id == empresa.id,
            Empleado.activo,
            or_(
                func.upper(Empleado.numero) == ident.upper(),
                (func.right(func.regexp_replace(Empleado.telefono, r"\D", "", "g"), 10) == diez)
                if len(diez) == 10
                else False,
            ),
        )
    )
    invalido = svc.error("credenciales", "Número o PIN incorrecto.", http=401)
    if empleado is None:
        await _limite(clave_ip, 10, PIN_VENTANA_S, registrar_fallo=True)
        raise invalido
    try:
        await _verificar_pin(empleado, data.pin, f"pub_pin:{empleado.id}")
    except HTTPException as e:
        await _limite(clave_ip, 10, PIN_VENTANA_S, registrar_fallo=True)
        if getattr(e, "detail", {}).get("codigo") == "credenciales":
            raise invalido from None
        raise
    token, token_hash = svc.nuevo_token()
    db.add(
        CelularVinculado(
            empresa_id=empresa.id,
            empleado_id=empleado.id,
            token_hash=token_hash,
            equipo=(data.equipo or request.headers.get("user-agent", ""))[:120] or None,
        )
    )
    await db.commit()
    return {"token": token, "estado": "pendiente", "nombre": empleado.nombre}


async def _celular(db: DB, token: str | None) -> CelularVinculado:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Celular no vinculado")
    c = await db.scalar(
        select(CelularVinculado).where(CelularVinculado.token_hash == svc.hash_token(token))
    )
    if c is None or c.estado == "revocado" or not c.empleado.activo:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Este celular ya no está vinculado")
    empresa = await db.get(Empresa, c.empresa_id)
    if empresa and (motivo := estado_empresa.bloqueo(empresa)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, motivo)
    return c


class CelularEstado(BaseModel):
    estado: str
    nombre: str
    hoy: EstadoHoy | None = None


@router.get("/celular/estado", response_model=CelularEstado)
async def celular_estado(
    db: DB, token: Annotated[str | None, Header(alias="X-Celular-Token")] = None
) -> CelularEstado:
    c = await _celular(db, token)
    if c.estado != "aprobado":
        return CelularEstado(estado=c.estado, nombre=c.empleado.nombre)
    return CelularEstado(
        estado="aprobado", nombre=c.empleado.nombre, hoy=await estado_hoy(db, c.empleado)
    )


@router.post("/celular/checar", status_code=status.HTTP_201_CREATED)
async def celular_checar(
    db: DB,
    pin: Annotated[str, Form(min_length=4, max_length=6)],
    accion: Annotated[Accion, Form()],
    foto: Annotated[UploadFile, File()],
    latitud: Annotated[float | None, Form(ge=-90, le=90)] = None,
    longitud: Annotated[float | None, Form(ge=-180, le=180)] = None,
    precision: Annotated[int | None, Form(ge=0)] = None,
    offline: Annotated[bool, Form()] = False,
    momento: Annotated[datetime | None, Form()] = None,
    token: Annotated[str | None, Header(alias="X-Celular-Token")] = None,
) -> dict:
    c = await _celular(db, token)
    if c.estado != "aprobado":
        raise svc.error(
            "pendiente",
            "Tu celular aún no está aprobado. Pide a tu administrador que lo apruebe.",
            http=403,
        )
    await _verificar_pin(c.empleado, pin, f"pub_pin:{c.empleado_id}")
    c.ultimo_uso = datetime.now(UTC)
    checada = await checar_movil(
        db,
        c.empleado,
        latitud=latitud,
        longitud=longitud,
        precision=precision,
        offline=offline,
        momento=momento,
        foto=foto,
        accion=accion,
        foto_obligatoria=True,
        por_ubicacion=True,
    )
    return {
        "nombre": c.empleado.nombre_completo,
        "tipo": checada.tipo,
        "comida": checada.comida,
        "momento": checada.momento.isoformat(),
        "retardo_minutos": checada.retardo_minutos,
    }
