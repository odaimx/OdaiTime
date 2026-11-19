"""Vacaciones: solicitud desde el portal, aprobación y calendario del equipo (quién falta).

- El empleado pide un rango; se cuentan los días hábiles según su turno (sin descansos ni
  festivos de ley) y se valida contra su saldo del art. 76 (descontando lo pendiente).
- Art. 78: al menos 12 días del periodo se disfrutan de forma continua, salvo que el
  trabajador elija distribuirlos; se avisa, no se bloquea.
- Al aprobar se crea la incidencia "vacaciones", que es la que usa la tarjeta de asistencia.
"""

import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import or_, select

from app.api.asistencia import _empleado, saldo_vacaciones, turno_de_factory
from app.api.deps import DB, CurrentUser, empresa_scope, require_roles, sucursales_permitidas
from app.models import (
    Empleado,
    Empresa,
    Incidencia,
    Rol,
    SolicitudVacaciones,
    Usuario,
    usuario_sucursales,
)
from app.schemas.sucursal import SucursalRef
from app.schemas.vacaciones import (
    Ausencia,
    CalendarioEquipo,
    EmpleadoCalendario,
    MisVacaciones,
    RespuestaIn,
    SolicitudIn,
    SolicitudOut,
)
from app.services import accesos, bitacora, calendario, correo, plantillas_correo
from app.services import asistencia as motor
from app.services import obras as obras_svc

router = APIRouter(prefix="/vacaciones", tags=["vacaciones"])

_GESTION = (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA, Rol.GERENTE_SUCURSAL)
_ESTADOS = {"aprobada": "aprobada", "rechazada": "rechazada", "cancelada": "cancelada"}
CONTINUOS_ART_78 = 12


def _fechas(a: date, b: date) -> str:
    return f"{a:%d/%m/%Y}" if a == b else f"{a:%d/%m/%Y} al {b:%d/%m/%Y}"


def dias_habiles(e: Empleado, inicio: date, fin: date) -> int:
    """Días que el empleado debía trabajar en el rango (sin descansos ni festivos de ley)."""
    turno_de = turno_de_factory(e)
    festivos = calendario.festivos_en(inicio, fin)
    n, d = 0, inicio
    while d <= fin:
        if turno_de(d)[0] != "descanso" and d not in festivos:
            n += 1
        d += timedelta(days=1)
    return n


async def _vacaciones_de(db: DB, empleado_id: uuid.UUID) -> list[Incidencia]:
    return list(
        await db.scalars(
            select(Incidencia).where(
                Incidencia.empleado_id == empleado_id, Incidencia.tipo == "vacaciones"
            )
        )
    )


async def _pendientes(db: DB, empleado_id: uuid.UUID, excepto: uuid.UUID | None = None):
    q = select(SolicitudVacaciones).where(
        SolicitudVacaciones.empleado_id == empleado_id,
        SolicitudVacaciones.estado == "pendiente",
    )
    if excepto:
        q = q.where(SolicitudVacaciones.id != excepto)
    return list(await db.scalars(q))


async def _validar(
    db: DB, e: Empleado, inicio: date, fin: date, excepto: uuid.UUID | None = None
) -> tuple[int, list[str]]:
    """(días hábiles, avisos). Lanza 409/422 si no procede."""
    if inicio < e.fecha_ingreso:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Las fechas son anteriores a tu ingreso"
        )
    choque = await db.scalar(
        select(Incidencia).where(
            Incidencia.empleado_id == e.id,
            Incidencia.fecha_inicio <= fin,
            Incidencia.fecha_fin >= inicio,
        )
    )
    if choque:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Se empalma con {motor.TIPOS_INCIDENCIA[choque.tipo].lower()} del "
            f"{_fechas(choque.fecha_inicio, choque.fecha_fin)}",
        )
    pendientes = await _pendientes(db, e.id, excepto)
    for p in pendientes:
        if p.fecha_inicio <= fin and p.fecha_fin >= inicio:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Ya hay una solicitud pendiente del {_fechas(p.fecha_inicio, p.fecha_fin)}",
            )
    dias = dias_habiles(e, inicio, fin)
    if dias == 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "En esas fechas no tienes días laborables (son descansos o festivos)",
        )
    vac = await _vacaciones_de(db, e.id)
    saldo = saldo_vacaciones(e, vac, inicio)
    if saldo.dias_correspondientes == 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Las vacaciones se generan al cumplir el primer año (el "
            f"{saldo.proximo_aniversario:%d/%m/%Y})",
        )
    en_periodo = sum(
        p.dias for p in pendientes if saldo.periodo_inicio <= p.fecha_inicio <= saldo.periodo_fin
    )
    disponibles = saldo.dias_disponibles - en_periodo
    if dias > disponibles:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Pides {dias} día(s) y tienes {max(disponibles, 0)} disponible(s) en el periodo "
            f"{_fechas(saldo.periodo_inicio, saldo.periodo_fin)}"
            + (f" ({en_periodo} ya en solicitudes pendientes)" if en_periodo else ""),
        )
    avisos = []
    continuo = max(
        [dias]
        + [
            dias_habiles(e, v.fecha_inicio, v.fecha_fin)
            for v in vac
            if v.fecha_fin >= saldo.periodo_inicio
        ]
    )
    if saldo.dias_correspondientes >= CONTINUOS_ART_78 and continuo < CONTINUOS_ART_78:
        avisos.append(
            "Art. 78 LFT: del periodo se deben disfrutar al menos 12 días continuos, salvo que "
            "el trabajador elija distribuirlos."
        )
    return dias, avisos


async def _mi_empleado(db: DB, user: Usuario) -> Empleado:
    e = await db.scalar(select(Empleado).where(Empleado.usuario_id == user.id))
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No tienes ficha de empleado")
    return e


async def _nombre_empresa(db: DB, empresa_id: uuid.UUID) -> tuple[str, Empresa | None]:
    empresa = await db.get(Empresa, empresa_id)
    return (empresa.nombre if empresa else "ODAITIME"), empresa


async def _avisar_gestores(db: DB, request: Request, s: SolicitudVacaciones) -> None:
    """Correo al administrador de la empresa y a los gerentes de la sucursal del empleado."""
    e = s.empleado
    nombre, empresa = await _nombre_empresa(db, s.empresa_id)
    destinatarios = list(
        await db.scalars(
            select(Usuario.email)
            .outerjoin(usuario_sucursales, usuario_sucursales.c.usuario_id == Usuario.id)
            .where(
                Usuario.empresa_id == s.empresa_id,
                Usuario.activo,
                or_(
                    Usuario.rol == Rol.ADMIN_EMPRESA,
                    (Usuario.rol == Rol.GERENTE_SUCURSAL)
                    & (usuario_sucursales.c.sucursal_id == e.sucursal_id),
                ),
            )
            .distinct()
        )
    )
    c = plantillas_correo.armar(
        await plantillas_correo.obtener(db, "vacaciones_solicitud"),
        {
            "empresa": nombre,
            "empleado": e.nombre_completo,
            "fechas": _fechas(s.fecha_inicio, s.fecha_fin),
            "dias": str(s.dias),
            "motivo": f"Motivo: {s.motivo}" if s.motivo else "",
        },
    )
    enlace = f"{accesos.origen(request, empresa)}/vacaciones?abrir={s.id}"
    for para in destinatarios:
        await correo.enviar(
            db,
            para=para,
            asunto=c.asunto,
            nombre_empresa=nombre,
            titulo=c.titulo,
            parrafos=c.parrafos,
            boton=(c.boton or "Abrir", enlace),
        )


async def _avisar_empleado(db: DB, request: Request, s: SolicitudVacaciones) -> None:
    e = s.empleado
    para = e.usuario.email if e.usuario else e.email
    if not para:
        return
    nombre, empresa = await _nombre_empresa(db, s.empresa_id)
    c = plantillas_correo.armar(
        await plantillas_correo.obtener(db, "vacaciones_respuesta"),
        {
            "empresa": nombre,
            "nombre": e.nombre,
            "nombre_completo": e.nombre_completo,
            "fechas": _fechas(s.fecha_inicio, s.fecha_fin),
            "estado": _ESTADOS.get(s.estado, s.estado),
            "comentario": f"Comentario: {s.comentario}" if s.comentario else "",
        },
    )
    await correo.enviar(
        db,
        para=para,
        asunto=c.asunto,
        nombre_empresa=nombre,
        titulo=c.titulo,
        parrafos=c.parrafos,
        boton=(c.boton or "Abrir", f"{accesos.origen(request, empresa)}/mis-vacaciones"),
    )


def _salida(s: SolicitudVacaciones, avisos: list[str] | None = None) -> SolicitudOut:
    out = SolicitudOut.model_validate(s)
    out.avisos = avisos or []
    return out


async def _log(db: DB, user: Usuario, s: SolicitudVacaciones, texto: str) -> None:
    await bitacora.registrar(
        db,
        empresa_id=s.empresa_id,
        modelo="empleado",
        registro_id=s.empleado_id,
        usuario=user,
        tipo="cambio",
        mensaje=f"Vacaciones {_fechas(s.fecha_inicio, s.fecha_fin)}: {texto}",
    )


# --- Portal del empleado ---


@router.get(
    "/mias", response_model=MisVacaciones, dependencies=[Depends(require_roles(Rol.EMPLEADO))]
)
async def mias(user: CurrentUser, db: DB) -> MisVacaciones:
    e = await _mi_empleado(db, user)
    saldo = saldo_vacaciones(e, await _vacaciones_de(db, e.id), date.today())
    solicitudes = list(
        await db.scalars(
            select(SolicitudVacaciones)
            .where(SolicitudVacaciones.empleado_id == e.id)
            .order_by(SolicitudVacaciones.fecha_inicio.desc())
            .limit(100)
        )
    )
    return MisVacaciones(
        saldo=saldo,
        pendientes_dias=sum(s.dias for s in solicitudes if s.estado == "pendiente"),
        solicitudes=[_salida(s) for s in solicitudes],
    )


@router.post(
    "/mias",
    response_model=SolicitudOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(Rol.EMPLEADO))],
)
async def solicitar(data: SolicitudIn, user: CurrentUser, db: DB, request: Request) -> SolicitudOut:
    e = await _mi_empleado(db, user)
    if data.fecha_inicio < date.today():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "No puedes pedir vacaciones en fechas pasadas"
        )
    dias, avisos = await _validar(db, e, data.fecha_inicio, data.fecha_fin)
    s = SolicitudVacaciones(
        empresa_id=e.empresa_id,
        empleado_id=e.id,
        fecha_inicio=data.fecha_inicio,
        fecha_fin=data.fecha_fin,
        dias=dias,
        motivo=data.motivo,
    )
    db.add(s)
    await db.flush()
    await db.refresh(s, attribute_names=["empleado"])
    await _log(db, user, s, f"solicitadas desde el portal ({dias} día(s))")
    await db.commit()
    await _avisar_gestores(db, request, s)
    return _salida(s, avisos)


@router.post(
    "/mias/{solicitud_id}/cancelar",
    response_model=SolicitudOut,
    dependencies=[Depends(require_roles(Rol.EMPLEADO))],
)
async def cancelar_mia(solicitud_id: uuid.UUID, user: CurrentUser, db: DB) -> SolicitudOut:
    e = await _mi_empleado(db, user)
    s = await db.scalar(
        select(SolicitudVacaciones).where(
            SolicitudVacaciones.id == solicitud_id, SolicitudVacaciones.empleado_id == e.id
        )
    )
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Solicitud no encontrada")
    if s.estado != "pendiente":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Solo puedes cancelar solicitudes pendientes; para una aprobada habla con tu jefe",
        )
    s.estado = "cancelada"
    s.respondida_en = datetime.now(UTC)
    await _log(db, user, s, "cancelada por el empleado")
    await db.commit()
    return _salida(s)


# --- Gestión ---


async def _solicitud(db: DB, user: Usuario, solicitud_id: uuid.UUID, emp: uuid.UUID):
    s = await db.scalar(
        select(SolicitudVacaciones).where(
            SolicitudVacaciones.id == solicitud_id, SolicitudVacaciones.empresa_id == emp
        )
    )
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Solicitud no encontrada")
    await _empleado(db, user, emp, s.empleado_id)  # alcance del gerente
    return s


@router.get(
    "/solicitudes",
    response_model=list[SolicitudOut],
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def solicitudes(
    user: CurrentUser,
    db: DB,
    estado: str | None = None,
    empresa_id: uuid.UUID | None = None,
) -> list[SolicitudOut]:
    emp = empresa_scope(user, empresa_id)
    q = (
        select(SolicitudVacaciones)
        .join(Empleado, Empleado.id == SolicitudVacaciones.empleado_id)
        .where(SolicitudVacaciones.empresa_id == emp)
    )
    permitidas = sucursales_permitidas(user)
    if permitidas is not None:
        q = q.where(Empleado.sucursal_id.in_(permitidas))
    if estado:
        q = q.where(SolicitudVacaciones.estado == estado)
    filas = await db.scalars(q.order_by(SolicitudVacaciones.created_at.desc()).limit(1000))
    return [_salida(s) for s in filas]


@router.post(
    "/solicitudes/{solicitud_id}/aprobar",
    response_model=SolicitudOut,
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def aprobar(
    solicitud_id: uuid.UUID,
    data: RespuestaIn,
    user: CurrentUser,
    db: DB,
    request: Request,
    empresa_id: uuid.UUID | None = None,
) -> SolicitudOut:
    emp = empresa_scope(user, empresa_id)
    s = await _solicitud(db, user, solicitud_id, emp)
    if s.estado != "pendiente":
        raise HTTPException(status.HTTP_409_CONFLICT, f"La solicitud ya está {s.estado}")
    # Se revalida: pudo cambiar el saldo, el turno o haber otra incidencia.
    dias, avisos = await _validar(db, s.empleado, s.fecha_inicio, s.fecha_fin, excepto=s.id)
    inc = Incidencia(
        empresa_id=emp,
        empleado_id=s.empleado_id,
        tipo="vacaciones",
        fecha_inicio=s.fecha_inicio,
        fecha_fin=s.fecha_fin,
        notas=s.motivo,
        registrada_por=user.id,
    )
    db.add(inc)
    await db.flush()
    s.estado, s.dias, s.incidencia_id = "aprobada", dias, inc.id
    s.comentario, s.respondida_por, s.respondida_en = data.comentario, user.id, datetime.now(UTC)
    await _log(db, user, s, f"aprobadas por {user.nombre}")
    await db.commit()
    await _avisar_empleado(db, request, s)
    return _salida(s, avisos)


@router.post(
    "/solicitudes/{solicitud_id}/rechazar",
    response_model=SolicitudOut,
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def rechazar(
    solicitud_id: uuid.UUID,
    data: RespuestaIn,
    user: CurrentUser,
    db: DB,
    request: Request,
    empresa_id: uuid.UUID | None = None,
) -> SolicitudOut:
    emp = empresa_scope(user, empresa_id)
    s = await _solicitud(db, user, solicitud_id, emp)
    if s.estado != "pendiente":
        raise HTTPException(status.HTTP_409_CONFLICT, f"La solicitud ya está {s.estado}")
    if not data.comentario:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Escribe el motivo del rechazo para el empleado"
        )
    s.estado, s.comentario = "rechazada", data.comentario
    s.respondida_por, s.respondida_en = user.id, datetime.now(UTC)
    await _log(db, user, s, f"rechazadas por {user.nombre}: {data.comentario}")
    await db.commit()
    await _avisar_empleado(db, request, s)
    return _salida(s)


@router.post(
    "/solicitudes/{solicitud_id}/cancelar",
    response_model=SolicitudOut,
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def cancelar(
    solicitud_id: uuid.UUID,
    data: RespuestaIn,
    user: CurrentUser,
    db: DB,
    request: Request,
    empresa_id: uuid.UUID | None = None,
) -> SolicitudOut:
    """Cancela una aprobada que aún no empieza (quita la incidencia) o una pendiente."""
    emp = empresa_scope(user, empresa_id)
    s = await _solicitud(db, user, solicitud_id, emp)
    if s.estado not in ("pendiente", "aprobada"):
        raise HTTPException(status.HTTP_409_CONFLICT, f"La solicitud ya está {s.estado}")
    if s.estado == "aprobada":
        if s.fecha_inicio <= date.today():
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Las vacaciones ya empezaron; corrígelas en las incidencias del empleado",
            )
        if s.incidencia_id and (inc := await db.get(Incidencia, s.incidencia_id)):
            await db.delete(inc)
        s.incidencia_id = None
    s.estado, s.comentario = "cancelada", data.comentario
    s.respondida_por, s.respondida_en = user.id, datetime.now(UTC)
    await _log(db, user, s, f"canceladas por {user.nombre}")
    await db.commit()
    await _avisar_empleado(db, request, s)
    return _salida(s)


# --- Calendario del equipo ---


@router.get(
    "/calendario",
    response_model=CalendarioEquipo,
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def calendario_equipo(
    user: CurrentUser,
    db: DB,
    desde: date,
    hasta: date,
    sucursal_id: uuid.UUID | None = None,
    obra_id: uuid.UUID | None = None,
    pendientes: bool = True,
    empresa_id: uuid.UUID | None = None,
) -> CalendarioEquipo:
    """Quién falta: vacaciones, incapacidades y permisos (y solicitudes pendientes)."""
    if hasta < desde or (hasta - desde).days > 120:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Rango inválido (máx. 120 días)")
    emp = empresa_scope(user, empresa_id)
    q = select(Empleado).where(
        Empleado.empresa_id == emp,
        Empleado.activo,
        Empleado.fecha_ingreso <= hasta,
    )
    permitidas = sucursales_permitidas(user)
    if permitidas is not None:
        q = q.where(Empleado.sucursal_id.in_(permitidas))
    if sucursal_id:
        q = q.where(Empleado.sucursal_id == sucursal_id)
    asignaciones = await obras_svc.obras_por_empleado(db, emp, desde, hasta)
    if obra_id:
        ids = {
            a.empleado_id for lista in asignaciones.values() for a in lista if a.obra_id == obra_id
        }
        q = q.where(Empleado.id.in_(ids or [uuid.uuid4()]))
    empleados = list(await db.scalars(q.order_by(Empleado.nombre, Empleado.apellido_paterno)))
    ids = [e.id for e in empleados]

    ausencias: list[Ausencia] = []
    if ids:
        for i in await db.scalars(
            select(Incidencia).where(
                Incidencia.empleado_id.in_(ids),
                Incidencia.fecha_inicio <= hasta,
                Incidencia.fecha_fin >= desde,
            )
        ):
            ausencias.append(
                Ausencia(
                    empleado_id=i.empleado_id,
                    tipo=i.tipo,
                    etiqueta=motor.TIPOS_INCIDENCIA.get(i.tipo, i.tipo)
                    + (f" · {i.ramo.replace('_', ' ')}" if i.ramo else ""),
                    fecha_inicio=i.fecha_inicio,
                    fecha_fin=i.fecha_fin,
                )
            )
        if pendientes:
            for s in await db.scalars(
                select(SolicitudVacaciones).where(
                    SolicitudVacaciones.empleado_id.in_(ids),
                    SolicitudVacaciones.estado == "pendiente",
                    SolicitudVacaciones.fecha_inicio <= hasta,
                    SolicitudVacaciones.fecha_fin >= desde,
                )
            ):
                ausencias.append(
                    Ausencia(
                        empleado_id=s.empleado_id,
                        tipo="solicitud",
                        etiqueta="Vacaciones por aprobar",
                        fecha_inicio=s.fecha_inicio,
                        fecha_fin=s.fecha_fin,
                        pendiente=True,
                    )
                )

    def obra_de(e: Empleado) -> str | None:
        o = obras_svc.obra_en(asignaciones.get(e.id, []), max(desde, min(date.today(), hasta)))
        return f"{o.clave} · {o.nombre}" if o else None

    return CalendarioEquipo(
        empleados=[
            EmpleadoCalendario(
                id=e.id,
                numero=e.numero,
                nombre_completo=e.nombre_completo,
                sucursal=SucursalRef.model_validate(e.sucursal),
                obra=obra_de(e),
            )
            for e in empleados
        ],
        ausencias=ausencias,
    )
