"""API de los dispositivos: kiosco (tablet) y reloj biométrico.

Se autentican con el token que reciben al vincularse (encabezado X-Dispositivo-Token),
no con usuario y contraseña.
"""

import logging
from datetime import UTC, datetime, time, timedelta
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy import func, select

from app.api.deps import DB
from app.core.config import get_settings
from app.core.security import verify_password
from app.models import Checada, Dispositivo, Empleado, Empresa
from app.services import checadas as svc
from app.services import festivos as festivos_svc

router = APIRouter(tags=["kiosco"])
log = logging.getLogger(__name__)


# --- Autenticación del dispositivo ---


async def _dispositivo(
    db: DB, token: Annotated[str | None, Header(alias="X-Dispositivo-Token")] = None
) -> Dispositivo:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Dispositivo no vinculado")
    d = await db.scalar(select(Dispositivo).where(Dispositivo.token_hash == svc.hash_token(token)))
    if d is None or not d.activo:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Dispositivo no vinculado o desactivado")
    d.ultima_conexion = datetime.now(UTC)
    return d


DispositivoActual = Annotated[Dispositivo, Depends(_dispositivo)]


async def _limite(key: str, maximo: int, ventana_s: int, registrar_fallo: bool = False) -> bool:
    """True si se excedió el límite. Si Valkey no responde, no bloquea."""
    try:
        async with Redis.from_url(get_settings().redis_url) as r:
            if registrar_fallo:
                n = await r.incr(key)
                if n == 1:
                    await r.expire(key, ventana_s)
                return False
            n = await r.get(key)
            return n is not None and int(n) >= maximo
    except Exception:  # noqa: BLE001
        return False


# --- Vinculación ---


class VincularIn(BaseModel):
    codigo: str = Field(pattern=r"^\d{6}$")


@router.post("/kiosco/vincular")
async def vincular(data: VincularIn, request: Request, db: DB) -> dict:
    """La tablet (o el puente del reloj) canjea el código de 6 dígitos por su token."""
    ip = request.client.host if request.client else "?"
    key = f"vincular_fail:{ip}"
    if await _limite(key, 10, 900):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Demasiados intentos. Espera unos minutos."
        )
    d = await db.scalar(
        select(Dispositivo).where(
            Dispositivo.codigo_vinculacion == data.codigo,
            Dispositivo.codigo_expira > datetime.now(UTC),
            Dispositivo.activo,
        )
    )
    if d is None:
        await _limite(key, 10, 900, registrar_fallo=True)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Código inválido o vencido")
    token, token_hash = svc.nuevo_token()
    d.token_hash = token_hash
    d.codigo_vinculacion = None
    d.codigo_expira = None
    d.vinculado_en = datetime.now(UTC)
    empresa = await db.get(Empresa, d.empresa_id)
    await db.commit()
    return {
        "token": token,
        "dispositivo": {"id": str(d.id), "nombre": d.nombre, "tipo": d.tipo},
        "sucursal": {"clave": d.sucursal.clave, "nombre": d.sucursal.nombre},
        "empresa": empresa.nombre if empresa else None,
    }


# --- Kiosco ---


def _solo_kiosco(d: Dispositivo) -> None:
    if d.tipo != "kiosco":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Este dispositivo no es un kiosco")


@router.get("/kiosco/estado")
async def estado(d: DispositivoActual, request: Request, db: DB) -> dict:
    _solo_kiosco(d)
    config, _ = await svc.config_efectiva(db, d.empresa_id, d.sucursal_id)
    empresa = await db.get(Empresa, d.empresa_id)
    tz = svc.zona(d.sucursal)
    ahora = datetime.now(UTC)
    inicio_dia = datetime.combine(ahora.astimezone(tz).date(), time.min, tz)
    ultimas = await db.scalars(
        select(Checada)
        .where(Checada.sucursal_id == d.sucursal_id, Checada.momento >= inicio_dia)
        .order_by(Checada.momento.desc())
        .limit(8)
    )
    token, expira = svc.qr_actual(d.id, ahora)
    base = str(request.base_url).rstrip("/")
    await db.commit()  # guarda ultima_conexion
    return {
        "dispositivo": {"id": str(d.id), "nombre": d.nombre},
        "empresa": empresa.nombre if empresa else None,
        "sucursal": {
            "clave": d.sucursal.clave,
            "nombre": d.sucursal.nombre,
            "zona_horaria": d.sucursal.zona_horaria,
        },
        "config": {
            "permitir_kiosco": config.permitir_kiosco,
            "pin": config.pin_kiosco,
            "foto": svc.requiere_foto(config, "kiosco"),
            "qr": config.permitir_movil,
        },
        # El celular abre esta liga con su cámara normal; la app toma el token de la URL.
        "qr": {"url": f"{base}/checar?qr={token}", "expira": expira.isoformat()},
        "ultimas": [
            {
                "nombre": f"{c.empleado.nombre} {c.empleado.apellido_paterno}",
                "tipo": c.tipo,
                "momento": c.momento.isoformat(),
            }
            for c in ultimas
        ],
        "hora_servidor": ahora.isoformat(),
        "festivo_hoy": await festivos_svc.festivo_del_dia(
            db, d.empresa_id, ahora.astimezone(tz).date()
        ),
    }


@router.post("/kiosco/checar", status_code=status.HTTP_201_CREATED)
async def checar_kiosco(
    d: DispositivoActual,
    db: DB,
    numero: Annotated[str, Form(min_length=1, max_length=20)],
    pin: Annotated[str | None, Form(max_length=6)] = None,
    foto: Annotated[UploadFile | None, File()] = None,
) -> dict:
    _solo_kiosco(d)
    config, _ = await svc.config_efectiva(db, d.empresa_id, d.sucursal_id)
    if not config.permitir_kiosco:
        raise svc.error(
            "kiosco_no_permitido", "El kiosco está desactivado para esta sucursal.", http=403
        )

    key = f"pin_fail:{d.id}:{numero.upper()}"
    if await _limite(key, 5, 900):
        raise svc.error(
            "bloqueado", "Demasiados intentos con ese número. Espera 15 minutos.", http=429
        )
    empleado = await db.scalar(
        select(Empleado).where(
            Empleado.empresa_id == d.empresa_id,
            func.upper(Empleado.numero) == numero.strip().upper(),
            Empleado.activo,
        )
    )
    # Mismo mensaje si el número no existe o el PIN es incorrecto.
    invalido = svc.error("credenciales", "Número de empleado o PIN incorrecto.", http=401)
    if empleado is None:
        await _limite(key, 5, 900, registrar_fallo=True)
        raise invalido
    if config.pin_kiosco:
        if not empleado.pin_hash:
            raise svc.error("sin_pin", "No tienes PIN asignado. Pídelo a tu administrador.")
        if not pin or not verify_password(pin, empleado.pin_hash):
            await _limite(key, 5, 900, registrar_fallo=True)
            raise invalido
    if svc.requiere_foto(config, "kiosco") and foto is None:
        raise svc.error("foto_requerida", "Se necesita la foto para checar.")

    checada = await svc.registrar(
        db,
        empleado=empleado,
        sucursal=d.sucursal,
        config=config,
        origen="kiosco",
        dispositivo_id=d.id,
    )
    if foto is not None:
        checada.foto = await svc.guardar_foto(foto, d.empresa_id)
    await db.commit()
    return {
        "nombre": empleado.nombre_completo,
        "tipo": checada.tipo,
        "momento": checada.momento.isoformat(),
        "retardo_minutos": checada.retardo_minutos,
    }


# --- Reloj biométrico (preparado; la conexión con ZKTeco se configura al final) ---


class RegistroBiometrico(BaseModel):
    numero: str = Field(min_length=1, max_length=20)
    momento: datetime


class LoteBiometrico(BaseModel):
    registros: list[RegistroBiometrico] = Field(max_length=1000)


@router.post("/biometrico/registros")
async def registros_biometricos(lote: LoteBiometrico, d: DispositivoActual, db: DB) -> dict:
    """Recibe marcas de un reloj (o de un puente que lee el reloj).

    Idempotente: una marca con el mismo empleado y la misma hora no se duplica.
    El tipo (entrada/salida) se deduce de la checada anterior del empleado.
    """
    if d.tipo != "biometrico":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Este dispositivo no es un reloj biométrico")
    ahora = datetime.now(UTC)
    creadas = omitidas = 0
    errores: list[dict] = []
    for r in sorted(lote.registros, key=lambda x: x.momento):
        momento = r.momento if r.momento.tzinfo else r.momento.replace(tzinfo=svc.zona(d.sucursal))
        if momento > ahora + timedelta(minutes=5) or ahora - momento > timedelta(days=31):
            errores.append({"numero": r.numero, "error": "Hora fuera de rango"})
            continue
        empleado = await db.scalar(
            select(Empleado).where(
                Empleado.empresa_id == d.empresa_id,
                func.upper(Empleado.numero) == r.numero.upper(),
            )
        )
        if empleado is None:
            errores.append({"numero": r.numero, "error": "Empleado no encontrado"})
            continue
        if await db.scalar(
            select(Checada.id).where(Checada.empleado_id == empleado.id, Checada.momento == momento)
        ):
            omitidas += 1
            continue
        anterior = await db.scalar(
            select(Checada)
            .where(
                Checada.empleado_id == empleado.id,
                Checada.estado == "valida",
                Checada.momento < momento,
            )
            .order_by(Checada.momento.desc())
            .limit(1)
        )
        tipo = svc.siguiente_tipo(anterior, momento)
        tz = svc.zona(d.sucursal)
        if tipo == "entrada":
            try:
                await svc.validar_festivo(db, empleado, momento.astimezone(tz).date())
            except HTTPException as exc:
                errores.append({"numero": r.numero, "error": exc.detail["mensaje"]})
                continue
        turno = svc.turno_del_dia(empleado, momento.astimezone(tz).date(), tz)
        db.add(
            Checada(
                empresa_id=d.empresa_id,
                empleado_id=empleado.id,
                sucursal_id=d.sucursal_id,
                tipo=tipo,
                momento=momento,
                origen="biometrico",
                dispositivo_id=d.id,
                retardo_minutos=svc.retardo(turno, momento) if tipo == "entrada" else None,
            )
        )
        await db.flush()
        creadas += 1
    await db.commit()
    return {"creadas": creadas, "omitidas": omitidas, "errores": errores}
