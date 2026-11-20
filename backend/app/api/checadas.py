import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, empresa_scope, require_roles, sucursales_permitidas
from app.core.config import get_settings
from app.models import (
    Checada,
    ConfigChecadas,
    Dispositivo,
    Empleado,
    Empresa,
    Rol,
    Sucursal,
    Usuario,
)
from app.schemas.checada import (
    Accion,
    ChecadaOut,
    ConfigGuardar,
    ConfigOut,
    CorreccionIn,
    EmpleadoRef,
    EstadoHoy,
    ManualIn,
    ObraChecar,
    Requisitos,
    SucursalChecar,
    TurnoHoyOut,
)
from app.services import aviso as aviso_svc
from app.services import bitacora
from app.services import checadas as svc
from app.services import festivos as festivos_svc
from app.services import obras as obras_svc

router = APIRouter(prefix="/checadas", tags=["checadas"])

_ADMIN = (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA)
_GESTION = (*_ADMIN, Rol.GERENTE_SUCURSAL)


# --- Utilidades ---


async def _mi_empleado(db: DB, user: Usuario) -> Empleado:
    empleado = await db.scalar(
        select(Empleado).where(Empleado.usuario_id == user.id, Empleado.activo)
    )
    if empleado is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Tu usuario no está ligado a un expediente de empleado"
        )
    return empleado


def _rango_utc(desde: date, hasta: date) -> tuple[datetime, datetime]:
    tz = ZoneInfo(get_settings().default_timezone)
    return (
        datetime.combine(desde, time.min, tz),
        datetime.combine(hasta + timedelta(days=1), time.min, tz),
    )


async def _get(db: DB, user: Usuario, checada_id: uuid.UUID, emp: uuid.UUID) -> Checada:
    q = select(Checada).where(Checada.id == checada_id, Checada.empresa_id == emp)
    permitidas = sucursales_permitidas(user)
    if permitidas is not None:
        q = q.where(Checada.sucursal_id.in_(permitidas))
    checada = await db.scalar(q)
    if checada is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checada no encontrada")
    return checada


def _snap(c: Checada) -> dict:
    return bitacora.snapshot(c, ("tipo", "momento", "estado"))


# --- Empleado (app del celular) ---


@router.get("/hoy", response_model=EstadoHoy, dependencies=[Depends(require_roles(Rol.EMPLEADO))])
async def hoy(user: CurrentUser, db: DB) -> EstadoHoy:
    return await estado_hoy(db, await _mi_empleado(db, user))


@router.get("/aviso", dependencies=[Depends(require_roles(Rol.EMPLEADO))])
async def ver_aviso(user: CurrentUser, db: DB) -> dict:
    """Responsable, domicilio y versión del aviso de privacidad de su empresa."""
    empleado = await _mi_empleado(db, user)
    return aviso_svc.datos(await db.get(Empresa, empleado.empresa_id))


@router.post(
    "/aviso",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(Rol.EMPLEADO))],
)
async def aceptar_aviso(user: CurrentUser, db: DB, request: Request) -> None:
    """El empleado acepta el aviso de privacidad desde el portal."""
    await aviso_svc.registrar(db, await _mi_empleado(db, user), medio="portal", request=request)
    await db.commit()


async def estado_hoy(db: DB, empleado: Empleado) -> EstadoHoy:
    """Lo que ve el empleado en su pantalla de checado (portal o celular vinculado)."""
    sucursal = empleado.sucursal
    config, _ = await svc.config_efectiva(db, empleado.empresa_id, sucursal.id)
    tz = svc.zona(sucursal)
    ahora = datetime.now(UTC)
    local = ahora.astimezone(tz)
    # En turno nocturno, de madrugada sigue mostrando el turno (y las checadas) de anoche.
    jornada, turno = svc.jornada_de(empleado, ahora, tz)
    inicio_dia = datetime.combine(jornada, time.min, tz)
    hoy_checadas = list(
        await db.scalars(
            select(Checada)
            .where(Checada.empleado_id == empleado.id, Checada.momento >= inicio_dia)
            .order_by(Checada.momento)
        )
    )
    ultima = await svc.ultima_checada(db, empleado.id)
    festivo = await festivos_svc.festivo_del_dia(db, empleado.empresa_id, local.date())
    obra = await obras_svc.obra_del_dia(db, empleado.id, local.date())
    return EstadoHoy(
        aviso_aceptado=await aviso_svc.aceptado(db, empleado.id),
        obra=ObraChecar.model_validate(obra, from_attributes=True) if obra else None,
        festivo_hoy=festivo,
        designado_festivo=bool(festivo)
        and await festivos_svc.designado(db, empleado.empresa_id, local.date(), empleado.id),
        empleado=EmpleadoRef.model_validate(empleado),
        sucursal=SucursalChecar.model_validate(sucursal, from_attributes=True),
        turno=TurnoHoyOut(
            nombre=turno.nombre,
            entrada=turno.inicio,
            salida=turno.fin,
            tolerancia_minutos=turno.tolerancia,
            bloques=[{"entrada": a, "salida": b} for a, b in turno.bloques],
        )
        if turno
        else None,
        siguiente_tipo=svc.siguiente_tipo(ultima, ahora),
        permitir_movil=svc.medio_permitido(empleado, "movil", config),
        permitir_kiosco=svc.medio_permitido(empleado, "kiosco", config),
        permitir_offline=config.permitir_offline,
        requiere=Requisitos(
            gps=config.validar_gps,
            foto=svc.requiere_foto(config, "movil"),
            qr=config.validar_qr,
        ),
        checadas_hoy=[ChecadaOut.de(c) for c in hoy_checadas],
        acciones=svc.acciones(ultima, hoy_checadas, turno, ahora),
        hora_servidor=ahora,
    )


@router.post(
    "",
    response_model=ChecadaOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(Rol.EMPLEADO))],
)
async def checar(
    user: CurrentUser,
    db: DB,
    latitud: Annotated[float | None, Form(ge=-90, le=90)] = None,
    longitud: Annotated[float | None, Form(ge=-180, le=180)] = None,
    precision: Annotated[int | None, Form(ge=0)] = None,
    qr: Annotated[str | None, Form(max_length=120)] = None,
    offline: Annotated[bool, Form()] = False,
    momento: Annotated[datetime | None, Form()] = None,
    foto: Annotated[UploadFile | None, File()] = None,
    accion: Annotated[Accion | None, Form()] = None,
) -> ChecadaOut:
    empleado = await _mi_empleado(db, user)
    if not await aviso_svc.aceptado(db, empleado.id):
        raise svc.error(
            "aviso_requerido", "Lee y acepta el aviso de privacidad para checar.", http=428
        )
    checada = await checar_movil(
        db,
        empleado,
        latitud=latitud,
        longitud=longitud,
        precision=precision,
        qr=qr,
        offline=offline,
        momento=momento,
        foto=foto,
        accion=accion,
    )
    return ChecadaOut.de(checada)


async def checar_movil(
    db: DB,
    empleado: Empleado,
    *,
    latitud: float | None,
    longitud: float | None,
    precision: int | None,
    qr: str | None = None,
    offline: bool = False,
    momento: datetime | None = None,
    foto: UploadFile | None = None,
    accion: str | None = None,
    foto_obligatoria: bool = False,
    por_ubicacion: bool = False,
) -> Checada:
    """Checada desde el celular (portal o celular vinculado): valida medio, QR, GPS y foto."""
    sucursal = empleado.sucursal
    dispositivo_id = None

    # Con el QR de un kiosco, la checada es en la sucursal de ese kiosco.
    config, _ = await svc.config_efectiva(db, empleado.empresa_id, sucursal.id)
    # El celular vinculado checa por ubicación: no usa el QR y el GPS es obligatorio.
    if qr or (config.validar_qr and not por_ubicacion):
        dispositivo_id = svc.validar_qr(qr, ahora=momento if offline else None)
        kiosco = await db.scalar(
            select(Dispositivo).where(
                Dispositivo.id == dispositivo_id,
                Dispositivo.empresa_id == empleado.empresa_id,
                Dispositivo.activo,
            )
        )
        if kiosco is None:
            raise svc.error("qr_invalido", "El código QR no es de un kiosco de tu empresa.")
        svc.validar_dispositivo(
            empleado, kiosco, await svc.nombres_dispositivos(db, empleado.dispositivos_checado)
        )
        sucursal = kiosco.sucursal
        config, _ = await svc.config_efectiva(db, empleado.empresa_id, sucursal.id)

    svc.validar_medio(empleado, "movil", config)

    # Si ese día está asignado a una obra, checa en la obra (y se valida su ubicación).
    obra = None
    if dispositivo_id is None:
        hoy = datetime.now(UTC).astimezone(svc.zona(sucursal)).date()
        obra = await obras_svc.obra_del_dia(db, empleado.id, hoy)
    lugar = obra or sucursal
    distancia = None
    if config.validar_gps or por_ubicacion:
        distancia = svc.validar_gps(lugar, latitud, longitud, precision)
    elif latitud is not None and longitud is not None and lugar.latitud is not None:
        distancia = round(svc.distancia_m(latitud, longitud, lugar.latitud, lugar.longitud))

    if (foto_obligatoria or svc.requiere_foto(config, "movil")) and foto is None:
        raise svc.error("foto_requerida", "Se necesita tu selfie para checar.")

    checada = await svc.registrar(
        db,
        empleado=empleado,
        sucursal=sucursal,
        config=config,
        origen="movil",
        momento_dispositivo=momento,
        offline=offline,
        latitud=latitud,
        longitud=longitud,
        precision_m=precision,
        distancia_m=distancia,
        dispositivo_id=dispositivo_id,
        obra_id=obra.id if obra else None,
        accion=accion,
    )
    if foto is not None:
        checada.foto = await svc.guardar_foto(foto, empleado.empresa_id)
    await db.commit()
    await db.refresh(checada, attribute_names=["empleado", "sucursal", "obra"])
    return checada


class PortalOut(BaseModel):
    checar: bool  # puede registrar su asistencia desde el portal
    historial: bool  # puede ver su historial


@router.get(
    "/portal", response_model=PortalOut, dependencies=[Depends(require_roles(Rol.EMPLEADO))]
)
async def portal(user: CurrentUser, db: DB) -> PortalOut:
    """Qué puede hacer el empleado en el portal, según la configuración de su sucursal."""
    empleado = await _mi_empleado(db, user)
    config, _ = await svc.config_efectiva(db, empleado.empresa_id, empleado.sucursal_id)
    return PortalOut(
        checar=svc.medio_permitido(empleado, "movil", config), historial=config.portal_historial
    )


@router.get(
    "/mias", response_model=list[ChecadaOut], dependencies=[Depends(require_roles(Rol.EMPLEADO))]
)
async def mias(
    user: CurrentUser,
    db: DB,
    desde: date | None = None,
    hasta: date | None = None,
) -> list[ChecadaOut]:
    empleado = await _mi_empleado(db, user)
    config, _ = await svc.config_efectiva(db, empleado.empresa_id, empleado.sucursal_id)
    if not config.portal_historial:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Tu empresa no tiene habilitada la consulta del historial"
        )
    hasta = hasta or date.today()
    desde = desde or hasta - timedelta(days=14)
    ini, fin = _rango_utc(desde, hasta)
    filas = await db.scalars(
        select(Checada)
        .where(Checada.empleado_id == empleado.id, Checada.momento >= ini, Checada.momento < fin)
        .order_by(Checada.momento.desc())
    )
    return [ChecadaOut.de(c) for c in filas]


# --- Configuración ---


@router.get("/config", response_model=ConfigOut, dependencies=[Depends(require_roles(*_GESTION))])
async def ver_config(
    user: CurrentUser,
    db: DB,
    sucursal_id: uuid.UUID | None = None,
    empresa_id: uuid.UUID | None = None,
) -> ConfigOut:
    emp = empresa_scope(user, empresa_id)
    config, origen = await svc.config_efectiva(db, emp, sucursal_id)
    datos = {c: getattr(config, c) for c in svc.CAMPOS_CONFIG}
    return ConfigOut(**datos, sucursal_id=sucursal_id, origen=origen)


async def _sucursal_de_empresa(db: DB, emp: uuid.UUID, sucursal_id: uuid.UUID) -> Sucursal:
    sucursal = await db.scalar(
        select(Sucursal).where(Sucursal.id == sucursal_id, Sucursal.empresa_id == emp)
    )
    if sucursal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sucursal no encontrada")
    return sucursal


@router.put("/config", response_model=ConfigOut, dependencies=[Depends(require_roles(*_ADMIN))])
async def guardar_config(
    data: ConfigGuardar, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> ConfigOut:
    emp = empresa_scope(user, empresa_id)
    if data.sucursal_id:
        await _sucursal_de_empresa(db, emp, data.sucursal_id)

    anterior, origen = await svc.config_efectiva(db, emp, data.sucursal_id)
    antes = bitacora.snapshot(anterior, svc.CAMPOS_CONFIG)
    config = (
        anterior
        if (origen == "sucursal" or (origen == "general" and not data.sucursal_id))
        else None
    )
    if config is None:
        config = ConfigChecadas(empresa_id=emp, sucursal_id=data.sucursal_id)
        db.add(config)
    for campo in svc.CAMPOS_CONFIG:
        setattr(config, campo, getattr(data, campo))

    await bitacora.cambios(
        db,
        empresa_id=emp,
        modelo="config_checadas",
        registro_id=data.sucursal_id or emp,
        usuario=user,
        antes=antes,
        despues=bitacora.snapshot(config, svc.CAMPOS_CONFIG),
        mensaje="Configuración propia de la sucursal creada"
        if data.sucursal_id and origen != "sucursal"
        else None,
    )
    await db.commit()
    return ConfigOut(
        **{c: getattr(config, c) for c in svc.CAMPOS_CONFIG},
        sucursal_id=data.sucursal_id,
        origen="sucursal" if data.sucursal_id else "general",
    )


@router.delete(
    "/config",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(*_ADMIN))],
)
async def usar_general(
    user: CurrentUser, db: DB, sucursal_id: uuid.UUID, empresa_id: uuid.UUID | None = None
) -> None:
    """La sucursal deja su configuración propia y vuelve a usar la general."""
    emp = empresa_scope(user, empresa_id)
    await _sucursal_de_empresa(db, emp, sucursal_id)
    config = await db.scalar(
        select(ConfigChecadas).where(
            ConfigChecadas.empresa_id == emp, ConfigChecadas.sucursal_id == sucursal_id
        )
    )
    if config:
        await db.delete(config)
        await bitacora.registrar(
            db,
            empresa_id=emp,
            modelo="config_checadas",
            registro_id=sucursal_id,
            usuario=user,
            tipo="cambio",
            mensaje="La sucursal volvió a usar la configuración general",
        )
        await db.commit()


# --- Administración de checadas ---


@router.get("", response_model=list[ChecadaOut], dependencies=[Depends(require_roles(*_GESTION))])
async def listar(
    user: CurrentUser,
    db: DB,
    desde: date,
    hasta: date,
    sucursal_id: uuid.UUID | None = None,
    empleado_id: uuid.UUID | None = None,
    incluir_anuladas: bool = False,
    empresa_id: uuid.UUID | None = None,
    limite: int = Query(default=1000, ge=1, le=5000),
) -> list[ChecadaOut]:
    emp = empresa_scope(user, empresa_id)
    if hasta < desde or (hasta - desde).days > 92:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Rango de fechas inválido (máx. 92 días)"
        )
    ini, fin = _rango_utc(desde, hasta)
    q = select(Checada).where(
        Checada.empresa_id == emp, Checada.momento >= ini, Checada.momento < fin
    )
    permitidas = sucursales_permitidas(user)
    if permitidas is not None:
        q = q.where(Checada.sucursal_id.in_(permitidas))
    if sucursal_id:
        q = q.where(Checada.sucursal_id == sucursal_id)
    if empleado_id:
        q = q.where(Checada.empleado_id == empleado_id)
    if not incluir_anuladas:
        q = q.where(Checada.estado == "valida")
    filas = await db.scalars(q.order_by(Checada.momento.desc()).limit(limite))
    return [ChecadaOut.de(c) for c in filas]


@router.post(
    "/manual",
    response_model=ChecadaOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def manual(
    data: ManualIn, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> ChecadaOut:
    """Registra una checada olvidada. Queda en la bitácora con el motivo."""
    emp = empresa_scope(user, empresa_id)
    q = select(Empleado).where(Empleado.id == data.empleado_id, Empleado.empresa_id == emp)
    permitidas = sucursales_permitidas(user)
    if permitidas is not None:
        q = q.where(Empleado.sucursal_id.in_(permitidas))
    empleado = await db.scalar(q)
    if empleado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empleado no encontrado")
    momento = data.momento if data.momento.tzinfo else data.momento.replace(tzinfo=UTC)
    if momento > datetime.now(UTC) + timedelta(minutes=5):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "La hora no puede ser futura")

    tz = svc.zona(empleado.sucursal)
    turno = svc.turno_del_dia(empleado, momento.astimezone(tz).date(), tz)
    checada = Checada(
        empresa_id=emp,
        empleado_id=empleado.id,
        sucursal_id=empleado.sucursal_id,
        tipo=data.tipo,
        momento=momento,
        origen="manual",
        retardo_minutos=svc.retardo(turno, momento) if data.tipo == "entrada" else None,
        registrada_por=user.id,
    )
    db.add(checada)
    await db.flush()
    await bitacora.registrar(
        db,
        empresa_id=emp,
        modelo="checada",
        registro_id=checada.id,
        usuario=user,
        tipo="creacion",
        mensaje=f"Checada manual: {data.motivo}",
    )
    await db.commit()
    await db.refresh(checada, attribute_names=["empleado", "sucursal"])
    return ChecadaOut.de(checada)


@router.patch(
    "/{checada_id}", response_model=ChecadaOut, dependencies=[Depends(require_roles(*_GESTION))]
)
async def corregir(
    checada_id: uuid.UUID,
    data: CorreccionIn,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> ChecadaOut:
    emp = empresa_scope(user, empresa_id)
    checada = await _get(db, user, checada_id, emp)
    antes = _snap(checada)
    if data.tipo:
        checada.tipo = data.tipo
    if data.momento:
        checada.momento = data.momento if data.momento.tzinfo else data.momento.replace(tzinfo=UTC)
    if data.estado:
        checada.estado = data.estado
    checada.corregida = True
    tz = svc.zona(checada.sucursal)
    turno = svc.turno_del_dia(checada.empleado, checada.momento.astimezone(tz).date(), tz)
    checada.retardo_minutos = (
        svc.retardo(turno, checada.momento) if checada.tipo == "entrada" else None
    )
    await bitacora.cambios(
        db,
        empresa_id=emp,
        modelo="checada",
        registro_id=checada.id,
        usuario=user,
        antes=antes,
        despues=_snap(checada),
        mensaje=f"Corrección: {data.motivo}",
    )
    await db.commit()
    return ChecadaOut.de(checada)


@router.get("/{checada_id}/foto", dependencies=[Depends(require_roles(*_GESTION, Rol.EMPLEADO))])
async def ver_foto(
    checada_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> FileResponse:
    emp = empresa_scope(user, empresa_id)
    if user.rol == Rol.EMPLEADO:
        empleado = await _mi_empleado(db, user)
        checada = await db.scalar(
            select(Checada).where(Checada.id == checada_id, Checada.empleado_id == empleado.id)
        )
    else:
        checada = await _get(db, user, checada_id, emp)
    if checada is None or not checada.foto:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sin foto")
    ruta = (svc.dir_fotos() / checada.foto).resolve()
    if svc.dir_fotos().resolve() not in ruta.parents or not ruta.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sin foto")
    return FileResponse(ruta, headers={"Cache-Control": "private, max-age=3600"})
