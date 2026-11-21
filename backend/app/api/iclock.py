"""Envío directo de relojes ZKTeco a la nube (protocolo ADMS / «push», rutas /iclock).

El reloj se configura con la dirección del servidor (Comunicación › Servidor en la nube / ADMS)
y él mismo sube las marcas; no hace falta una PC en la sucursal.

Seguridad: ADMS no tiene contraseña, el reloj se identifica solo por su número de serie. Por eso:
- el administrador lo habilita a propósito en el dispositivo (tipo reloj, número de serie único);
- se puede limitar a las IPs públicas de la sucursal;
- las marcas pasan por las mismas reglas que el puente (empleado, medios, festivos, 31 días)
  y son idempotentes;
- límite de tamaño del cuerpo y de peticiones por minuto.
"""

import ipaddress
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Request, Response
from sqlalchemy import func, select

from app.api.deps import DB
from app.api.kiosco import RegistroBiometrico, _limite, procesar_marcas
from app.models import Dispositivo, Empresa
from app.services import checadas as svc
from app.services import estado_empresa

log = logging.getLogger(__name__)
router = APIRouter(prefix="/iclock", tags=["zkteco"])

MAX_CUERPO = 512 * 1024
LINEAS_MAX = 1000


def _texto(cuerpo: str, status_code: int = 200) -> Response:
    return Response(cuerpo, status_code=status_code, media_type="text/plain")


def _ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (
        request.client.host if request.client else ""
    )


def _ip_permitida(d: Dispositivo, ip: str) -> bool:
    if not d.ips_permitidas:
        return True
    try:
        dir_ip = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for red in d.ips_permitidas.split(","):
        try:
            if dir_ip in ipaddress.ip_network(red.strip(), strict=False):
                return True
        except ValueError:
            continue
    return False


async def _reloj(db: DB, request: Request, sn: str | None) -> Dispositivo | None:
    sn = (sn or "").strip().upper()[:60]
    ip = _ip(request)
    if not sn or await _limite(f"iclock:{sn}:{ip}", 120, 60):
        return None
    await _limite(f"iclock:{sn}:{ip}", 120, 60, registrar_fallo=True)  # cuenta peticiones
    d = await db.scalar(
        select(Dispositivo).where(
            Dispositivo.adms,
            Dispositivo.activo,
            Dispositivo.tipo == "biometrico",
            func.upper(Dispositivo.serie) == sn,
        )
    )
    if d is None:
        log.warning("ADMS: reloj desconocido o no habilitado SN=%s IP=%s", sn, ip)
        return None
    if not _ip_permitida(d, ip):
        log.warning("ADMS: IP no permitida SN=%s IP=%s", sn, ip)
        return None
    empresa = await db.get(Empresa, d.empresa_id)
    if empresa and estado_empresa.bloqueo(empresa):
        return None
    return d


def _desfase_horas(d: Dispositivo) -> str:
    off = datetime.now(svc.zona(d.sucursal)).utcoffset()
    horas = (off.total_seconds() / 3600) if off else 0
    return str(int(horas)) if horas == int(horas) else f"{horas:g}"


@router.get("/cdata")
async def opciones(request: Request, db: DB, SN: str | None = None) -> Response:  # noqa: N803
    """Primer contacto del reloj: le decimos qué subir (solo marcas) y cada cuánto."""
    d = await _reloj(db, request, SN)
    if d is None:
        return _texto("Unauthorized", 401)
    d.ultima_conexion = datetime.now(UTC)
    await db.commit()
    return _texto(
        "\n".join(
            [
                f"GET OPTION FROM: {d.serie}",
                "ATTLOGStamp=None",
                "OPERLOGStamp=9999",
                "ATTPHOTOStamp=None",
                "ErrorDelay=30",
                "Delay=10",
                "TransTimes=00:00;14:05",
                "TransInterval=1",
                "TransFlag=TransData AttLog",
                f"TimeZone={_desfase_horas(d)}",
                "Realtime=1",
                "Encrypt=None",
            ]
        )
    )


def _marcas(texto: str) -> list[RegistroBiometrico]:
    """Líneas ATTLOG: PIN<TAB>AAAA-MM-DD HH:MM:SS<TAB>estado<TAB>verificación…"""
    salida = []
    for linea in texto.splitlines()[:LINEAS_MAX]:
        partes = linea.strip().split("\t")
        if len(partes) < 2:
            continue
        try:
            momento = datetime.strptime(partes[1].strip(), "%Y-%m-%d %H:%M:%S")
            salida.append(RegistroBiometrico(numero=partes[0].strip()[:20], momento=momento))
        except ValueError:
            continue
    return salida


@router.post("/cdata")
async def recibir(
    request: Request,
    db: DB,
    SN: str | None = None,  # noqa: N803
    table: str | None = None,
) -> Response:
    d = await _reloj(db, request, SN)
    if d is None:
        return _texto("Unauthorized", 401)
    cuerpo = await request.body()
    if len(cuerpo) > MAX_CUERPO:
        return _texto("Payload too large", 413)
    if (table or "").upper() != "ATTLOG":
        d.ultima_conexion = datetime.now(UTC)
        await db.commit()
        return _texto("OK")  # bitácora del reloj, usuarios, fotos: no se guardan
    marcas = _marcas(cuerpo.decode("utf-8", errors="replace"))
    r = await procesar_marcas(db, d, marcas)  # hace commit
    if r["errores"]:
        log.info(
            "ADMS SN=%s: %s marcas con error: %s", d.serie, len(r["errores"]), r["errores"][:5]
        )
    return _texto(f"OK: {len(marcas)}")


@router.get("/getrequest")
async def comandos(request: Request, db: DB, SN: str | None = None) -> Response:  # noqa: N803
    """El reloj pregunta si hay comandos; no le mandamos ninguno."""
    d = await _reloj(db, request, SN)
    if d is None:
        return _texto("Unauthorized", 401)
    return _texto("OK")


@router.post("/devicecmd")
async def resultado_comando(request: Request, db: DB, SN: str | None = None) -> Response:  # noqa: N803
    if await _reloj(db, request, SN) is None:
        return _texto("Unauthorized", 401)
    return _texto("OK")
