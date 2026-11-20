"""Checar por WhatsApp.

El empleado escribe al número de WhatsApp de su empresa:
- manda su **ubicación actual** → se valida contra su obra del día o su sucursal y se
  registra la entrada o salida (origen "whatsapp");
- si la empresa pide foto, primero manda una **selfie**;
- "hoy" responde sus checadas del día; cualquier otro texto, las instrucciones.

Seguridad: cada empresa tiene su propio webhook (/api/whatsapp/webhook/{id}); Meta firma cada
envío con el secreto de la app (X-Hub-Signature-256) y se rechaza lo que no venga firmado.
Se identifica al empleado por el celular de su ficha. Una ubicación elegida en el mapa (con
nombre o dirección) no cuenta: tiene que ser la ubicación actual.
"""

import logging
import secrets
import uuid
from datetime import UTC, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser, empresa_scope, require_roles
from app.core.cifrado import cifrar, descifrar
from app.core.config import get_settings
from app.models import Checada, ConfigSistema, ConfigWhatsApp, Empleado, Rol
from app.services import bitacora, obras
from app.services import checadas as svc
from app.services import whatsapp as wa

log = logging.getLogger(__name__)

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

_ADMIN = (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA)
MAX_RETRASO_S = 600  # una ubicación que llega con más de 10 min de retraso no se acepta
FOTO_TTL_S = 600

INSTRUCCIONES = (
    "Para checar, envía tu *ubicación actual*: toca 📎 (o +) → *Ubicación* → "
    "*Enviar mi ubicación actual*.\nEscribe *hoy* para ver tus registros del día."
)


# --- Configuración (admin de la empresa) ---


class ConfigIn(BaseModel):
    activo: bool = False
    todos: bool = True
    phone_number_id: str | None = Field(default=None, max_length=40, pattern=r"^\d*$")
    waba_id: str | None = Field(default=None, max_length=40, pattern=r"^\d*$")
    numero: str | None = Field(default=None, max_length=20)
    token: str | None = Field(default=None, max_length=1000)  # vacío = se conserva
    app_secret: str | None = Field(default=None, max_length=200)  # vacío = se conserva


class ConfigOut(BaseModel):
    activo: bool
    todos: bool
    phone_number_id: str | None
    waba_id: str | None
    numero: str | None
    tiene_token: bool
    tiene_secreto: bool
    webhook_url: str | None
    verify_token: str | None


def _webhook_url(cfg: ConfigWhatsApp, request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.headers.get("host", request.url.netloc))
    return f"{proto}://{host}/api/whatsapp/webhook/{cfg.id}"


def _salida(cfg: ConfigWhatsApp | None, request: Request) -> ConfigOut:
    if cfg is None:
        return ConfigOut(
            activo=False,
            todos=True,
            phone_number_id=None,
            waba_id=None,
            numero=None,
            tiene_token=False,
            tiene_secreto=False,
            webhook_url=None,
            verify_token=None,
        )
    return ConfigOut(
        activo=cfg.activo,
        todos=cfg.todos,
        phone_number_id=cfg.phone_number_id,
        waba_id=cfg.waba_id,
        numero=cfg.numero,
        tiene_token=bool(cfg.token),
        tiene_secreto=bool(cfg.app_secret),
        webhook_url=_webhook_url(cfg, request),
        verify_token=cfg.verify_token,
    )


async def _config(db: DB, emp: uuid.UUID) -> ConfigWhatsApp | None:
    return await db.scalar(select(ConfigWhatsApp).where(ConfigWhatsApp.empresa_id == emp))


@router.get("/config", response_model=ConfigOut, dependencies=[Depends(require_roles(*_ADMIN))])
async def leer_config(
    user: CurrentUser, db: DB, request: Request, empresa_id: uuid.UUID | None = None
) -> ConfigOut:
    return _salida(await _config(db, empresa_scope(user, empresa_id)), request)


@router.put("/config", response_model=ConfigOut, dependencies=[Depends(require_roles(*_ADMIN))])
async def guardar_config(
    data: ConfigIn,
    user: CurrentUser,
    db: DB,
    request: Request,
    empresa_id: uuid.UUID | None = None,
) -> ConfigOut:
    emp = empresa_scope(user, empresa_id)
    cfg = await _config(db, emp)
    if cfg is None:
        cfg = ConfigWhatsApp(empresa_id=emp, verify_token=secrets.token_urlsafe(24))
        db.add(cfg)
    if data.phone_number_id and data.phone_number_id != cfg.phone_number_id:
        otro = await db.scalar(
            select(ConfigWhatsApp.id).where(
                ConfigWhatsApp.phone_number_id == data.phone_number_id,
                ConfigWhatsApp.empresa_id != emp,
            )
        )
        if otro:
            raise HTTPException(status.HTTP_409_CONFLICT, "Ese número ya lo usa otra empresa")
    cfg.todos = data.todos
    cfg.phone_number_id = data.phone_number_id or None
    cfg.waba_id = data.waba_id or None
    cfg.numero = data.numero or None
    if data.token:
        cfg.token = cifrar(data.token.strip())
    if data.app_secret:
        cfg.app_secret = cifrar(data.app_secret.strip())
    if data.activo and not (cfg.phone_number_id and cfg.token and cfg.app_secret):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Para activar faltan el identificador del número, el token o el secreto de la app",
        )
    cfg.activo = data.activo
    await bitacora.registrar(
        db,
        empresa_id=emp,
        modelo="config_whatsapp",
        registro_id=emp,
        usuario=user,
        tipo="cambio",
        mensaje=f"WhatsApp {'activado' if cfg.activo else 'desactivado'}"
        + (f" ({cfg.numero})" if cfg.numero else ""),
    )
    await db.commit()
    await db.refresh(cfg)
    return _salida(cfg, request)


class PruebaIn(BaseModel):
    telefono: str = Field(min_length=10, max_length=20)


@router.post("/prueba", dependencies=[Depends(require_roles(*_ADMIN))])
async def prueba(
    data: PruebaIn, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> dict:
    """Manda un mensaje de prueba (el destinatario debe haber escrito antes al número)."""
    cfg = await _config(db, empresa_scope(user, empresa_id))
    if cfg is None or not cfg.token:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Primero guarda la configuración")
    ok, error = await wa.enviar_texto(
        cfg, data.telefono, "✅ Prueba de ODAITIME: tu número de WhatsApp está conectado."
    )
    if not ok:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"WhatsApp respondió: {error}")
    return {"enviado": True}


# --- Registro integrado de Meta (Tech Provider) ---
#
# Odai registra UNA app en Meta como Tech Provider. El cliente toca «Conectar con WhatsApp»,
# inicia sesión con su Facebook en el popup de Meta, elige o crea su número y su cuenta de
# WhatsApp Business, y Meta nos devuelve un código. Aquí se cambia por el token del cliente,
# se suscribe el webhook propio de su empresa y se registra el número. El cliente ya no copia
# tokens ni secretos; Meta le sigue cobrando a él.


class ProveedorIn(BaseModel):
    app_id: str | None = Field(default=None, max_length=40, pattern=r"^\d*$")
    config_id: str | None = Field(default=None, max_length=40, pattern=r"^\d*$")
    app_secret: str | None = Field(default=None, max_length=200)  # vacío = se conserva


def _version() -> str:
    return get_settings().whatsapp_graph_url.rstrip("/").rsplit("/", 1)[-1]


async def _sistema(db: DB) -> ConfigSistema:
    c = await db.get(ConfigSistema, 1)
    if c is None:
        c = ConfigSistema(id=1, colores={})
        db.add(c)
    return c


def _proveedor(c: ConfigSistema) -> dict:
    return {
        "app_id": c.meta_app_id,
        "config_id": c.meta_config_id,
        "tiene_secreto": bool(c.meta_app_secret),
        "version": _version(),
    }


@router.get("/proveedor", dependencies=[Depends(require_roles(Rol.SUPERADMIN))])
async def leer_proveedor(db: DB) -> dict:
    """App de Meta de Odai (la configura el superadmin con los datos del trámite)."""
    return _proveedor(await _sistema(db))


@router.put("/proveedor", dependencies=[Depends(require_roles(Rol.SUPERADMIN))])
async def guardar_proveedor(data: ProveedorIn, db: DB) -> dict:
    c = await _sistema(db)
    c.meta_app_id = data.app_id or None
    c.meta_config_id = data.config_id or None
    if data.app_secret:
        c.meta_app_secret = cifrar(data.app_secret.strip())
    await db.commit()
    return _proveedor(c)


@router.get("/registro", dependencies=[Depends(require_roles(*_ADMIN))])
async def datos_registro(db: DB) -> dict:
    """Lo que necesita el botón «Conectar con WhatsApp» (sin secretos)."""
    c = await db.get(ConfigSistema, 1)
    listo = bool(c and c.meta_app_id and c.meta_config_id and c.meta_app_secret)
    return {
        "disponible": listo,
        "app_id": c.meta_app_id if listo else None,
        "config_id": c.meta_config_id if listo else None,
        "version": _version(),
    }


class RegistroIn(BaseModel):
    code: str = Field(min_length=10, max_length=1000)
    waba_id: str = Field(min_length=5, max_length=40, pattern=r"^\d+$")
    phone_number_id: str = Field(min_length=5, max_length=40, pattern=r"^\d+$")


@router.post("/registro", response_model=ConfigOut, dependencies=[Depends(require_roles(*_ADMIN))])
async def completar_registro(
    data: RegistroIn,
    user: CurrentUser,
    db: DB,
    request: Request,
    empresa_id: uuid.UUID | None = None,
) -> ConfigOut:
    emp = empresa_scope(user, empresa_id)
    sistema = await db.get(ConfigSistema, 1)
    if not (sistema and sistema.meta_app_id and sistema.meta_app_secret):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "El registro integrado aún no está disponible"
        )
    otro = await db.scalar(
        select(ConfigWhatsApp.id).where(
            ConfigWhatsApp.phone_number_id == data.phone_number_id,
            ConfigWhatsApp.empresa_id != emp,
        )
    )
    if otro:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ese número ya lo usa otra empresa")
    cfg = await _config(db, emp)
    if cfg is None:
        cfg = ConfigWhatsApp(empresa_id=emp, verify_token=secrets.token_urlsafe(24))
        db.add(cfg)
        await db.flush()  # id para la URL del webhook
    app_secret = descifrar(sistema.meta_app_secret)
    try:
        r = await wa.registro_integrado(
            app_id=sistema.meta_app_id,
            app_secret=app_secret,
            code=data.code,
            waba_id=data.waba_id,
            phone_number_id=data.phone_number_id,
            webhook_url=_webhook_url(cfg, request),
            verify_token=cfg.verify_token,
            pin=f"{secrets.randbelow(1_000_000):06d}",
        )
    except wa.ErrorMeta as e:
        await db.rollback()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Meta respondió: {e}") from None
    cfg.phone_number_id = data.phone_number_id
    cfg.waba_id = data.waba_id
    cfg.numero = (r.get("numero") or "")[:20] or None
    cfg.token = cifrar(r["token"])
    cfg.app_secret = cifrar(app_secret)  # firma del webhook: es el secreto de la app de Odai
    cfg.activo = True
    await bitacora.registrar(
        db,
        empresa_id=emp,
        modelo="config_whatsapp",
        registro_id=emp,
        usuario=user,
        tipo="cambio",
        mensaje="WhatsApp conectado con el registro de Meta"
        + (f" ({cfg.numero})" if cfg.numero else ""),
    )
    await db.commit()
    await db.refresh(cfg)
    return _salida(cfg, request)


# --- Webhook (Meta) ---


async def _cfg_webhook(db: DB, config_id: uuid.UUID) -> ConfigWhatsApp:
    cfg = await db.get(ConfigWhatsApp, config_id)
    if cfg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return cfg


@router.get("/webhook/{config_id}")
async def verificar(
    config_id: uuid.UUID,
    db: DB,
    modo: str = Query("", alias="hub.mode"),
    token: str = Query("", alias="hub.verify_token"),
    reto: str = Query("", alias="hub.challenge"),
) -> Response:
    """Meta lo llama al registrar el webhook: hay que devolver el reto tal cual."""
    cfg = await _cfg_webhook(db, config_id)
    if modo != "subscribe" or not secrets.compare_digest(token, cfg.verify_token):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Token de verificación incorrecto")
    return Response(reto[:200], media_type="text/plain")


@router.post("/webhook/{config_id}")
async def recibir(config_id: uuid.UUID, request: Request, db: DB) -> dict:
    cfg = await _cfg_webhook(db, config_id)
    cuerpo = await request.body()
    if not wa.firma_valida(
        descifrar(cfg.app_secret or ""), cuerpo, request.headers.get("x-hub-signature-256")
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Firma inválida")
    if not cfg.activo:
        return {"ok": True}
    try:
        datos = await request.json()
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "JSON inválido") from None
    for entrada in datos.get("entry", []):
        for cambio in entrada.get("changes", []):
            valor = cambio.get("value", {})
            if valor.get("metadata", {}).get("phone_number_id") != cfg.phone_number_id:
                continue
            for msg in valor.get("messages", []):
                try:
                    await _procesar(db, cfg, msg)
                except Exception:  # noqa: BLE001 - Meta reintenta si no respondemos 200
                    log.exception("Error al procesar mensaje de WhatsApp %s", msg.get("id"))
                    await db.rollback()
    return {"ok": True}


async def _primera_vez(clave: str, ttl: int) -> bool:
    async with Redis.from_url(get_settings().redis_url) as r:
        return bool(await r.set(clave, "1", nx=True, ex=ttl))


async def _empleado(db: DB, empresa_id: uuid.UUID, wa_id: str) -> Empleado | None:
    diez = wa.ultimos10(wa_id)
    if len(diez) < 10:
        return None
    return await db.scalar(
        select(Empleado)
        .where(
            Empleado.empresa_id == empresa_id,
            Empleado.activo,
            func.right(func.regexp_replace(Empleado.telefono, r"\D", "", "g"), 10) == diez,
        )
        .limit(1)
    )


def _permitido(cfg: ConfigWhatsApp, e: Empleado) -> bool:
    if e.medios_checado is not None:
        return "whatsapp" in e.medios_checado
    return cfg.todos


async def _procesar(db: DB, cfg: ConfigWhatsApp, msg: dict) -> None:
    mid, wa_id, tipo = msg.get("id", ""), msg.get("from", ""), msg.get("type")
    if not mid or not wa_id or not await _primera_vez(f"wa_msg:{mid}", 86400):
        return  # reintento de Meta: ya se procesó

    async def responder(texto: str) -> None:
        await wa.enviar_texto(cfg, wa_id, texto)

    e = await _empleado(db, cfg.empresa_id, wa_id)
    if e is None:
        await responder(
            "Este número no está registrado como empleado. Pide a tu administrador que capture "
            "tu celular en tu ficha de ODAITIME."
        )
        return
    if not _permitido(cfg, e):
        await responder(f"{e.nombre}, tú no checas por WhatsApp. Pregunta a tu administrador.")
        return

    config, _ = await svc.config_efectiva(db, e.empresa_id, e.sucursal_id)
    tz = svc.zona(e.sucursal)

    if tipo == "text":
        texto = (msg.get("text", {}).get("body") or "").strip().lower()
        if texto in ("hoy", "estado", "registros"):
            inicio = datetime.combine(datetime.now(UTC).astimezone(tz).date(), time.min, tz)
            hoy = list(
                await db.scalars(
                    select(Checada)
                    .where(Checada.empleado_id == e.id, Checada.momento >= inicio)
                    .order_by(Checada.momento)
                )
            )
            if not hoy:
                await responder(f"{e.nombre}, hoy aún no tienes registros.\n\n{INSTRUCCIONES}")
            else:
                lineas = [f"• {c.tipo.capitalize()} {c.momento.astimezone(tz):%H:%M}" for c in hoy]
                await responder(f"{e.nombre}, tus registros de hoy:\n" + "\n".join(lineas))
        else:
            await responder(f"Hola, {e.nombre}. {INSTRUCCIONES}")
        return

    if tipo == "image":
        media = msg.get("image", {}).get("id")
        if media:
            async with Redis.from_url(get_settings().redis_url) as r:
                await r.set(f"wa_foto:{e.id}", media, ex=FOTO_TTL_S)
            await responder("📷 Foto recibida. Ahora envía tu *ubicación actual* para checar.")
        return

    if tipo != "location":
        await responder(INSTRUCCIONES)
        return

    loc = msg.get("location", {})
    if loc.get("name") or loc.get("address"):
        await responder(
            "Esa es una ubicación elegida en el mapa. Envía tu *ubicación actual* "
            "(📎 → Ubicación → Enviar mi ubicación actual)."
        )
        return
    try:
        enviado = datetime.fromtimestamp(int(msg.get("timestamp", 0)), UTC)
    except (TypeError, ValueError):
        enviado = datetime.now(UTC)
    if (datetime.now(UTC) - enviado).total_seconds() > MAX_RETRASO_S:
        await responder("Tu ubicación llegó con retraso y no se registró. Envíala de nuevo.")
        return

    try:
        lat, lon = float(loc["latitude"]), float(loc["longitude"])
    except (KeyError, TypeError, ValueError):
        await responder(INSTRUCCIONES)
        return
    sucursal = e.sucursal
    obra = await obras.obra_del_dia(db, e.id, datetime.now(UTC).astimezone(tz).date())
    lugar = obra or sucursal
    try:
        distancia = svc.validar_gps(lugar, lat, lon, None) if config.validar_gps else None
        foto_rel = None
        if svc.requiere_foto(config, "movil"):
            async with Redis.from_url(get_settings().redis_url) as r:
                media = await r.get(f"wa_foto:{e.id}")
            if not media:
                await responder(
                    "Tu empresa pide una foto: envía primero una *selfie* y luego tu ubicación."
                )
                return
            archivo = await wa.descargar_media(cfg, media.decode())
            ext = svc.FOTO_TIPOS.get(archivo[1]) if archivo else None
            if not archivo or not ext:
                await responder("No se pudo leer tu foto. Envía otra selfie (JPG o PNG).")
                return
            foto_rel = svc.guardar_bytes(archivo[0], ext, e.empresa_id)
        checada = await svc.registrar(
            db,
            empleado=e,
            sucursal=sucursal,
            config=config,
            origen="whatsapp",
            latitud=lat,
            longitud=lon,
            distancia_m=distancia,
            obra_id=obra.id if obra else None,
        )
        checada.foto = foto_rel
        await db.commit()
    except HTTPException as exc:
        await db.rollback()
        detalle = exc.detail if isinstance(exc.detail, dict) else {"mensaje": str(exc.detail)}
        await responder(f"❌ No se registró: {detalle.get('mensaje')}")
        return
    if foto_rel:
        async with Redis.from_url(get_settings().redis_url) as r:
            await r.delete(f"wa_foto:{e.id}")
    donde = f"{obra.clave} · {obra.nombre}" if obra else f"{sucursal.clave} · {sucursal.nombre}"
    extra = f" (a {distancia} m)" if distancia is not None else ""
    retardo = f"\n⚠️ Retardo de {checada.retardo_minutos} min" if checada.retardo_minutos else ""
    await responder(
        f"✅ {checada.tipo.capitalize()} registrada a las "
        f"{checada.momento.astimezone(tz):%H:%M}\n{donde}{extra}{retardo}"
    )
