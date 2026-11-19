"""Reglas para registrar checadas."""

import hashlib
import hmac
import math
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Checada, ConfigChecadas, Empleado, Obra, Sucursal, TurnoDia
from app.services.lft import Horario
from app.services.lft import bloques as lft_bloques

CAMPOS_CONFIG = (
    "permitir_movil",
    "portal_historial",
    "permitir_kiosco",
    "validar_gps",
    "validar_qr",
    "foto",
    "pin_kiosco",
    "minutos_antes_entrada",
    "ignorar_repetida_min",
    "permitir_offline",
    "offline_max_horas",
)

# Si una entrada no tiene salida en este lapso, la siguiente checada vuelve a ser entrada.
VENTANA_JORNADA = timedelta(hours=16)
QR_PERIODO_S = 30
FOTO_MAX_BYTES = 3 * 1024 * 1024
FOTO_TIPOS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def error(codigo: str, mensaje: str, http: int = status.HTTP_422_UNPROCESSABLE_ENTITY, **extra):
    return HTTPException(http, {"codigo": codigo, "mensaje": mensaje, **extra})


# --- Configuración ---


def config_por_defecto(empresa_id: uuid.UUID) -> ConfigChecadas:
    c = ConfigChecadas(empresa_id=empresa_id, sucursal_id=None)
    for campo in CAMPOS_CONFIG:
        col = ConfigChecadas.__table__.c[campo]
        setattr(c, campo, col.default.arg if col.default is not None else None)
    return c


async def config_efectiva(
    db: AsyncSession, empresa_id: uuid.UUID, sucursal_id: uuid.UUID | None
) -> tuple[ConfigChecadas, str]:
    """(config, origen): la de la sucursal, si no la general, si no la de fábrica."""
    filas = list(
        await db.scalars(
            select(ConfigChecadas).where(
                ConfigChecadas.empresa_id == empresa_id,
                (ConfigChecadas.sucursal_id == sucursal_id) | ConfigChecadas.sucursal_id.is_(None),
            )
        )
    )
    propia = next((c for c in filas if sucursal_id and c.sucursal_id == sucursal_id), None)
    if propia:
        return propia, "sucursal"
    general = next((c for c in filas if c.sucursal_id is None), None)
    if general:
        return general, "general"
    return config_por_defecto(empresa_id), "predeterminada"


MEDIOS = {
    "movil": "celular",
    "kiosco": "kiosco",
    "biometrico": "reloj biométrico",
    "whatsapp": "WhatsApp",
}


def medio_permitido(empleado: Empleado, medio: str, config: ConfigChecadas) -> bool:
    """Lo que diga la ficha del empleado; si no dice nada, la configuración de su sucursal."""
    if empleado.medios_checado is not None:
        return medio in empleado.medios_checado
    if medio == "movil":
        return config.permitir_movil
    if medio == "kiosco":
        return config.permitir_kiosco
    if medio == "whatsapp":
        return False  # lo decide la configuración de WhatsApp de la empresa
    return True  # reloj biométrico: si está dado de alta, se usa


def validar_medio(empleado: Empleado, medio: str, config: ConfigChecadas) -> None:
    if not medio_permitido(empleado, medio, config):
        if empleado.medios_checado:
            otros = " o ".join(MEDIOS[m] for m in empleado.medios_checado if m in MEDIOS)
            detalle = f"Tú checas por {otros}."
        elif empleado.medios_checado is not None:
            detalle = "No tienes ningún medio de checado asignado; pregunta a tu administrador."
        elif medio == "movil":
            detalle = "En tu sucursal no se checa desde el celular. Usa el kiosco."
        else:
            detalle = "El kiosco está desactivado para esta sucursal."
        raise error(f"{medio}_no_permitido", detalle, http=status.HTTP_403_FORBIDDEN)


def validar_dispositivo(empleado: Empleado, dispositivo, nombres: list[str] | None = None) -> None:
    """Si el empleado tiene kioscos/relojes asignados, solo puede checar en esos."""
    if empleado.dispositivos_checado and dispositivo.id not in empleado.dispositivos_checado:
        donde = f" Checa en: {', '.join(nombres)}." if nombres else ""
        que = MEDIOS.get(dispositivo.tipo, "dispositivo")
        raise error(
            "dispositivo_no_asignado",
            f"{empleado.nombre}, este no es tu {que}.{donde}",
            http=status.HTTP_403_FORBIDDEN,
        )


async def nombres_dispositivos(db: AsyncSession, ids: list[uuid.UUID]) -> list[str]:
    from app.models import Dispositivo

    if not ids:
        return []
    return list(await db.scalars(select(Dispositivo.nombre).where(Dispositivo.id.in_(ids))))


def requiere_foto(config: ConfigChecadas, origen: str) -> bool:
    return config.foto == "ambos" or config.foto == origen


# --- Ubicación ---


def distancia_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia en metros (haversine)."""
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def validar_gps(
    sucursal: Sucursal | Obra, lat: float | None, lon: float | None, precision: int | None
) -> int:
    """Distancia al lugar (sucursal u obra); error si está fuera de su radio."""
    lugar = "la zona" if isinstance(sucursal, Obra) else "la sucursal"
    if sucursal.latitud is None or sucursal.longitud is None:
        raise error(
            "sucursal_sin_ubicacion",
            f"{lugar.capitalize()} no tiene ubicación configurada. "
            "Pide a tu administrador que la registre.",
        )
    if lat is None or lon is None:
        raise error("gps_requerido", "Activa la ubicación de tu teléfono para checar.")
    if precision is not None and precision > 200:
        raise error(
            "gps_impreciso",
            "La señal de ubicación es imprecisa. Sal a un lugar abierto e intenta de nuevo.",
        )
    d = round(distancia_m(lat, lon, sucursal.latitud, sucursal.longitud))
    if d > sucursal.radio_metros:
        raise error(
            "fuera_de_rango",
            f"Estás a {d} m de {lugar} {sucursal.nombre}; "
            f"debes estar a menos de {sucursal.radio_metros} m.",
            distancia_m=d,
        )
    return d


# --- Turno y tipo de checada ---


@dataclass
class TurnoHoy:
    nombre: str
    tolerancia: int
    dia: TurnoDia
    bloques: list[tuple[datetime, datetime]]  # (entrada, salida) con zona de la sucursal

    @property
    def inicio(self) -> datetime:
        return self.bloques[0][0]

    @property
    def fin(self) -> datetime:
        return self.bloques[-1][1]


def zona(sucursal: Sucursal) -> ZoneInfo:
    return ZoneInfo(sucursal.zona_horaria)


def turno_del_dia(empleado: Empleado, dia: date, tz: ZoneInfo) -> TurnoHoy | None:
    asignacion = empleado.turno_en(dia)
    if asignacion is None:
        return None
    turno = asignacion.turno
    d = next((x for x in turno.dias if x.dia_semana == dia.weekday()), None)
    if d is None:
        return None
    base = datetime.combine(dia, time(0), tz)
    horario = Horario(d.dia_semana, d.entrada, d.salida, d.comida_minutos, d.entrada2, d.salida2)
    rangos = [
        (base + timedelta(minutes=ini), base + timedelta(minutes=fin))
        for ini, fin in lft_bloques(horario)
    ]
    return TurnoHoy(turno.nombre, turno.tolerancia_minutos, d, rangos)


def jornada_de(empleado: Empleado, momento: datetime, tz: ZoneInfo) -> tuple[date, TurnoHoy | None]:
    """(día de la jornada, turno) de una entrada. Si cae dentro de un turno que empezó el día
    anterior y cruza la medianoche (p. ej. llega 00:10 a un turno de 23:00 a 07:00), la
    jornada es la del día anterior."""
    d = momento.astimezone(tz).date()
    anterior = turno_del_dia(empleado, d - timedelta(days=1), tz)
    if anterior and momento < anterior.fin:
        return d - timedelta(days=1), anterior
    return d, turno_del_dia(empleado, d, tz)


async def ultima_checada(db: AsyncSession, empleado_id: uuid.UUID) -> Checada | None:
    return await db.scalar(
        select(Checada)
        .where(Checada.empleado_id == empleado_id, Checada.estado == "valida")
        .order_by(Checada.momento.desc())
        .limit(1)
    )


def siguiente_tipo(ultima: Checada | None, ahora: datetime) -> str:
    if ultima and ultima.tipo == "entrada" and ahora - ultima.momento < VENTANA_JORNADA:
        return "salida"
    return "entrada"


def bloque_de(turno: TurnoHoy, momento: datetime) -> tuple[datetime, datetime]:
    """Bloque al que corresponde una entrada: en turno quebrado, el regreso de comida
    (después de la mitad del descanso) se compara contra el segundo horario."""
    if len(turno.bloques) == 2:
        (_, fin1), (ini2, _) = turno.bloques
        if momento >= fin1 + (ini2 - fin1) / 2:
            return turno.bloques[1]
    return turno.bloques[0]


def retardo(turno: TurnoHoy | None, momento: datetime) -> int | None:
    if turno is None:
        return None
    inicio, _ = bloque_de(turno, momento)
    minutos = math.floor((momento - inicio).total_seconds() / 60)
    return minutos if minutos > turno.tolerancia else None


# --- QR rotativo del kiosco ---


def _firma(dispositivo_id: uuid.UUID, ventana: int) -> str:
    msg = f"{dispositivo_id}:{ventana}".encode()
    return hmac.new(get_settings().secret_key.encode(), msg, hashlib.sha256).hexdigest()[:20]


def qr_actual(dispositivo_id: uuid.UUID, ahora: datetime | None = None) -> tuple[str, datetime]:
    ts = (ahora or datetime.now(UTC)).timestamp()
    ventana = int(ts // QR_PERIODO_S)
    expira = datetime.fromtimestamp((ventana + 1) * QR_PERIODO_S, UTC)
    return f"{dispositivo_id}.{ventana}.{_firma(dispositivo_id, ventana)}", expira


def validar_qr(token: str | None, ahora: datetime | None = None) -> uuid.UUID:
    """Devuelve el id del kiosco. Acepta la ventana actual y la anterior (margen al escanear)."""
    if not token:
        raise error("qr_requerido", "Escanea el código QR del kiosco de tu sucursal.")
    try:
        disp, ventana_s, firma = token.split(".")
        dispositivo_id, ventana = uuid.UUID(disp), int(ventana_s)
    except ValueError:
        raise error("qr_invalido", "El código QR no es válido.") from None
    actual = int((ahora or datetime.now(UTC)).timestamp() // QR_PERIODO_S)
    if ventana not in (actual, actual - 1) or not hmac.compare_digest(
        firma, _firma(dispositivo_id, ventana)
    ):
        raise error("qr_vencido", "El código QR ya cambió. Escanéalo de nuevo.")
    return dispositivo_id


# --- Tokens de dispositivo ---


def nuevo_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def nuevo_codigo() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


# --- Fotos ---


def dir_fotos() -> Path:
    return Path(get_settings().fotos_dir)


async def guardar_foto(archivo: UploadFile, empresa_id: uuid.UUID) -> str:
    ext = FOTO_TIPOS.get(archivo.content_type or "")
    if ext is None:
        raise error("foto_invalida", "La foto debe ser JPG, PNG o WebP.")
    datos = await archivo.read(FOTO_MAX_BYTES + 1)
    if len(datos) > FOTO_MAX_BYTES:
        raise error("foto_grande", "La foto supera 3 MB.")
    if not datos:
        raise error("foto_invalida", "La foto está vacía.")
    return guardar_bytes(datos, ext, empresa_id)


def guardar_bytes(datos: bytes, ext: str, empresa_id: uuid.UUID) -> str:
    """Guarda la foto de una checada y devuelve su ruta relativa."""
    hoy = datetime.now(UTC)
    rel = Path(str(empresa_id)) / f"{hoy:%Y}" / f"{hoy:%m}" / f"{uuid.uuid4()}.{ext}"
    destino = dir_fotos() / rel
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(datos)
    return str(rel)


# --- Días festivos ---


async def validar_festivo(db: AsyncSession, empleado: Empleado, dia: date) -> None:
    """En día festivo solo registran entrada los empleados designados (art. 75 LFT)."""
    from app.services import festivos as festivos_svc  # evita import circular

    nombre = await festivos_svc.festivo_del_dia(db, empleado.empresa_id, dia)
    if nombre and not await festivos_svc.designado(db, empleado.empresa_id, dia, empleado.id):
        raise error(
            "festivo_no_designado",
            f"Hoy es día de descanso ({nombre}). Solo registran asistencia las personas "
            "designadas por la empresa para trabajar.",
            http=status.HTTP_403_FORBIDDEN,
        )


# --- Registro ---


async def registrar(
    db: AsyncSession,
    *,
    empleado: Empleado,
    sucursal: Sucursal,
    config: ConfigChecadas,
    origen: str,
    momento_dispositivo: datetime | None = None,
    offline: bool = False,
    **campos,
) -> Checada:
    """Valida ventana, repetición y tipo; agrega la checada a la sesión (sin commit)."""
    ahora = datetime.now(UTC)
    momento = ahora
    if offline:
        if not config.permitir_offline:
            raise error("offline_no_permitido", "Tu empresa no permite checar sin internet.")
        if momento_dispositivo is None:
            raise error("offline_sin_hora", "Falta la hora de la checada sin conexión.")
        if momento_dispositivo.tzinfo is None:
            momento_dispositivo = momento_dispositivo.replace(tzinfo=UTC)
        if momento_dispositivo > ahora + timedelta(minutes=2):
            raise error("offline_futuro", "La hora de la checada está en el futuro.")
        if ahora - momento_dispositivo > timedelta(hours=config.offline_max_horas):
            raise error(
                "offline_vencida",
                f"La checada sin conexión tiene más de {config.offline_max_horas} h.",
            )
        momento = momento_dispositivo

    ultima = await ultima_checada(db, empleado.id)
    if ultima and abs((momento - ultima.momento).total_seconds()) < (
        config.ignorar_repetida_min * 60
    ):
        raise error(
            "repetida",
            f"Ya registraste tu {ultima.tipo} hace menos de {config.ignorar_repetida_min} min.",
            http=status.HTTP_409_CONFLICT,
        )

    tipo = siguiente_tipo(ultima, momento)
    tz = zona(sucursal)
    dia, turno = jornada_de(empleado, momento, tz)
    if tipo == "entrada":
        await validar_festivo(db, empleado, dia)
    if tipo == "entrada" and turno and not offline:
        apertura = turno.inicio - timedelta(minutes=config.minutos_antes_entrada)
        if momento < apertura:
            raise error(
                "muy_temprano",
                f"Aún no puedes checar. Tu entrada es a las {turno.inicio:%H:%M}; "
                f"puedes checar desde las {apertura:%H:%M}.",
            )

    checada = Checada(
        empresa_id=empleado.empresa_id,
        empleado_id=empleado.id,
        sucursal_id=sucursal.id,
        tipo=tipo,
        momento=momento,
        origen=origen,
        offline=offline,
        retardo_minutos=retardo(turno, momento) if tipo == "entrada" else None,
        **campos,
    )
    db.add(checada)
    return checada
