import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, empresa_scope, require_roles, sucursales_permitidas
from app.models import Checada, Empleado, Incidencia, PoliticaAsistencia, Rol, Usuario
from app.schemas.asistencia import (
    DetalleAsistencia,
    DiaOut,
    FilaResumen,
    IncidenciaIn,
    IncidenciaOut,
    PoliticaIn,
    PoliticaOut,
    ResumenOut,
    VacacionesOut,
)
from app.schemas.checada import EmpleadoRef
from app.schemas.sucursal import SucursalRef
from app.services import asistencia as motor
from app.services import bitacora, calendario
from app.services import checadas as svc
from app.services import festivos as festivos_svc
from app.services.lft import Horario, efectivos

router = APIRouter(prefix="/asistencia", tags=["asistencia (LFT)"])

_ADMIN = (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA)
_GESTION = (*_ADMIN, Rol.GERENTE_SUCURSAL)
MAX_DIAS = 62
CAMPOS_POLITICA = (
    "retardos_por_falta",
    "retardo_falta_min",
    "minimo_extra_min",
    "redondeo_extra_min",
    "festivo_opcional_pago",
)


# --- Utilidades ---


async def _politica(db: DB, emp: uuid.UUID) -> PoliticaAsistencia | None:
    return await db.scalar(select(PoliticaAsistencia).where(PoliticaAsistencia.empresa_id == emp))


def _a_motor(p: PoliticaAsistencia | None) -> motor.Politica:
    if p is None:
        return motor.Politica()
    return motor.Politica(**{c: getattr(p, c) for c in CAMPOS_POLITICA})


def _validar_rango(desde: date, hasta: date) -> None:
    if hasta < desde or (hasta - desde).days >= MAX_DIAS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"Rango inválido (máximo {MAX_DIAS} días)"
        )


def turno_de_factory(empleado: Empleado):
    tz = svc.zona(empleado.sucursal)

    def turno_de(d: date) -> tuple[str, motor.DiaTurno | None]:
        if empleado.turno_en(d) is None:
            return "sin_turno", None
        t = svc.turno_del_dia(empleado, d, tz)
        if t is None:
            return "descanso", None
        dia = t.dia
        ef = efectivos(
            Horario(
                dia.dia_semana,
                dia.entrada,
                dia.salida,
                dia.comida_minutos,
                dia.entrada2,
                dia.salida2,
            )
        )
        return "laborable", motor.DiaTurno(t.bloques, ef)

    return turno_de


def _calcular(
    empleado: Empleado,
    desde: date,
    hasta: date,
    checadas: list[Checada],
    incidencias: list[Incidencia],
    politica: motor.Politica,
    festivos: tuple[dict, set],
):
    return motor.calcular(
        desde=desde,
        hasta=hasta,
        tz=svc.zona(empleado.sucursal),
        turno_de=turno_de_factory(empleado),
        marcas=[motor.Marca(c.momento, c.tipo, c.retardo_minutos) for c in checadas],
        incidencias=[motor.Incidencia(i.tipo, i.fecha_inicio, i.fecha_fin) for i in incidencias],
        festivos=festivos[0],
        festivos_obligatorios=festivos[1],
        politica=politica,
        ingreso=empleado.fecha_ingreso,
        baja=empleado.fecha_baja,
    )


def _limites_utc(desde: date, hasta: date) -> tuple[datetime, datetime]:
    # Un día de margen por zonas horarias y turnos nocturnos que terminan al día siguiente.
    return (
        datetime.combine(desde - timedelta(days=1), time.min, UTC),
        datetime.combine(hasta + timedelta(days=2), time.min, UTC),
    )


async def _empleado(db: DB, user: Usuario, emp: uuid.UUID, empleado_id: uuid.UUID) -> Empleado:
    q = select(Empleado).where(Empleado.id == empleado_id, Empleado.empresa_id == emp)
    permitidas = sucursales_permitidas(user)
    if permitidas is not None:
        q = q.where(Empleado.sucursal_id.in_(permitidas))
    e = await db.scalar(q)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empleado no encontrado")
    return e


def _ref(e: Empleado) -> EmpleadoRef:
    return EmpleadoRef.model_validate(e)


# --- Política ---


@router.get(
    "/politica", response_model=PoliticaOut, dependencies=[Depends(require_roles(*_GESTION))]
)
async def ver_politica(user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None):
    p = await _politica(db, empresa_scope(user, empresa_id))
    return p or PoliticaOut()


@router.put("/politica", response_model=PoliticaOut, dependencies=[Depends(require_roles(*_ADMIN))])
async def guardar_politica(
    data: PoliticaIn, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
):
    emp = empresa_scope(user, empresa_id)
    p = await _politica(db, emp)
    antes = bitacora.snapshot(p or PoliticaOut(), CAMPOS_POLITICA)
    if p is None:
        p = PoliticaAsistencia(empresa_id=emp)
        db.add(p)
    for c in CAMPOS_POLITICA:
        setattr(p, c, getattr(data, c))
    await bitacora.cambios(
        db,
        empresa_id=emp,
        modelo="politica_asistencia",
        registro_id=emp,
        usuario=user,
        antes=antes,
        despues=bitacora.snapshot(p, CAMPOS_POLITICA),
    )
    await db.commit()
    return p


# --- Tarjeta de asistencia ---


@router.get(
    "/resumen", response_model=list[FilaResumen], dependencies=[Depends(require_roles(*_GESTION))]
)
async def resumen(
    user: CurrentUser,
    db: DB,
    desde: date,
    hasta: date,
    sucursal_id: uuid.UUID | None = None,
    empresa_id: uuid.UUID | None = None,
) -> list[FilaResumen]:
    """Resumen por empleado del periodo (faltas, retardos, extras, domingos, festivos…)."""
    _validar_rango(desde, hasta)
    emp = empresa_scope(user, empresa_id)
    q = select(Empleado).where(
        Empleado.empresa_id == emp,
        Empleado.fecha_ingreso <= hasta,
        (Empleado.fecha_baja.is_(None)) | (Empleado.fecha_baja >= desde),
    )
    permitidas = sucursales_permitidas(user)
    if permitidas is not None:
        q = q.where(Empleado.sucursal_id.in_(permitidas))
    if sucursal_id:
        q = q.where(Empleado.sucursal_id == sucursal_id)
    empleados = list(await db.scalars(q.order_by(Empleado.apellido_paterno, Empleado.nombre)))
    if not empleados:
        return []
    ids = [e.id for e in empleados]

    ini, fin = _limites_utc(desde, hasta)
    por_emp: dict[uuid.UUID, list[Checada]] = defaultdict(list)
    for c in await db.scalars(
        select(Checada).where(
            Checada.empleado_id.in_(ids),
            Checada.estado == "valida",
            Checada.momento >= ini,
            Checada.momento < fin,
        )
    ):
        por_emp[c.empleado_id].append(c)
    inc_emp: dict[uuid.UUID, list[Incidencia]] = defaultdict(list)
    for i in await db.scalars(
        select(Incidencia).where(
            Incidencia.empleado_id.in_(ids),
            Incidencia.fecha_inicio <= hasta,
            Incidencia.fecha_fin >= desde,
        )
    ):
        inc_emp[i.empleado_id].append(i)

    pol = _a_motor(await _politica(db, emp))
    fest = await festivos_svc.aplicables(db, emp, desde, hasta)
    filas = []
    for e in empleados:
        _, r = _calcular(e, desde, hasta, por_emp[e.id], inc_emp[e.id], pol, fest)
        filas.append(
            FilaResumen(
                empleado=_ref(e),
                sucursal=SucursalRef.model_validate(e.sucursal),
                resumen=ResumenOut.model_validate(r),
                conceptos=motor.conceptos_nomina(r),
            )
        )
    return filas


@router.get(
    "/empleado/{empleado_id}",
    response_model=DetalleAsistencia,
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def detalle(
    empleado_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    desde: date,
    hasta: date,
    empresa_id: uuid.UUID | None = None,
) -> DetalleAsistencia:
    _validar_rango(desde, hasta)
    emp = empresa_scope(user, empresa_id)
    e = await _empleado(db, user, emp, empleado_id)
    ini, fin = _limites_utc(desde, hasta)
    checadas = list(
        await db.scalars(
            select(Checada).where(
                Checada.empleado_id == e.id,
                Checada.estado == "valida",
                Checada.momento >= ini,
                Checada.momento < fin,
            )
        )
    )
    incidencias = list(
        await db.scalars(
            select(Incidencia).where(
                Incidencia.empleado_id == e.id,
                Incidencia.fecha_inicio <= hasta,
                Incidencia.fecha_fin >= desde,
            )
        )
    )
    fest = await festivos_svc.aplicables(db, emp, desde, hasta)
    dias, r = _calcular(
        e, desde, hasta, checadas, incidencias, _a_motor(await _politica(db, emp)), fest
    )
    return DetalleAsistencia(
        empleado=_ref(e),
        sucursal=SucursalRef.model_validate(e.sucursal),
        zona_horaria=e.sucursal.zona_horaria,
        dias=[DiaOut.model_validate(d) for d in dias],
        resumen=ResumenOut.model_validate(r),
        conceptos=motor.conceptos_nomina(r),
    )


# --- Incidencias ---


@router.get(
    "/incidencias",
    response_model=list[IncidenciaOut],
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def listar_incidencias(
    user: CurrentUser,
    db: DB,
    empleado_id: uuid.UUID | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    empresa_id: uuid.UUID | None = None,
) -> list[Incidencia]:
    emp = empresa_scope(user, empresa_id)
    q = select(Incidencia).join(Empleado).where(Incidencia.empresa_id == emp)
    permitidas = sucursales_permitidas(user)
    if permitidas is not None:
        q = q.where(Empleado.sucursal_id.in_(permitidas))
    if empleado_id:
        q = q.where(Incidencia.empleado_id == empleado_id)
    if desde:
        q = q.where(Incidencia.fecha_fin >= desde)
    if hasta:
        q = q.where(Incidencia.fecha_inicio <= hasta)
    return list(await db.scalars(q.order_by(Incidencia.fecha_inicio.desc()).limit(500)))


@router.post(
    "/incidencias",
    response_model=IncidenciaOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def crear_incidencia(
    data: IncidenciaIn, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> Incidencia:
    emp = empresa_scope(user, empresa_id)
    e = await _empleado(db, user, emp, data.empleado_id)
    if data.fecha_inicio < e.fecha_ingreso:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "La incidencia es anterior a la fecha de ingreso"
        )
    choque = await db.scalar(
        select(Incidencia).where(
            Incidencia.empleado_id == e.id,
            Incidencia.fecha_inicio <= data.fecha_fin,
            Incidencia.fecha_fin >= data.fecha_inicio,
        )
    )
    if choque:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Se empalma con otra incidencia ({motor.TIPOS_INCIDENCIA[choque.tipo]}, "
            f"{choque.fecha_inicio:%d/%m/%Y} – {choque.fecha_fin:%d/%m/%Y})",
        )
    inc = Incidencia(empresa_id=emp, registrada_por=user.id, **data.model_dump())
    db.add(inc)
    await bitacora.registrar(
        db,
        empresa_id=emp,
        modelo="empleado",
        registro_id=e.id,
        usuario=user,
        tipo="cambio",
        mensaje=(
            f"{motor.TIPOS_INCIDENCIA[data.tipo]}: {data.fecha_inicio:%d/%m/%Y} – "
            f"{data.fecha_fin:%d/%m/%Y}" + (f" ({data.notas})" if data.notas else "")
        ),
    )
    await db.commit()
    await db.refresh(inc, attribute_names=["empleado", "created_at"])
    return inc


@router.delete(
    "/incidencias/{incidencia_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def borrar_incidencia(
    incidencia_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> None:
    emp = empresa_scope(user, empresa_id)
    inc = await db.scalar(
        select(Incidencia).where(Incidencia.id == incidencia_id, Incidencia.empresa_id == emp)
    )
    if inc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Incidencia no encontrada")
    await _empleado(db, user, emp, inc.empleado_id)  # valida alcance del gerente
    await bitacora.registrar(
        db,
        empresa_id=emp,
        modelo="empleado",
        registro_id=inc.empleado_id,
        usuario=user,
        tipo="cambio",
        mensaje=(
            f"Se eliminó {motor.TIPOS_INCIDENCIA[inc.tipo].lower()}: "
            f"{inc.fecha_inicio:%d/%m/%Y} – {inc.fecha_fin:%d/%m/%Y}"
        ),
    )
    await db.delete(inc)
    await db.commit()


# --- Vacaciones (art. 76) ---


def saldo_vacaciones(e: Empleado, vacaciones: list[Incidencia], hoy: date) -> VacacionesOut:
    n = calendario.anios_cumplidos(e.fecha_ingreso, hoy)
    inicio = calendario.aniversario(e.fecha_ingreso, e.fecha_ingreso.year + n)
    siguiente = calendario.aniversario(e.fecha_ingreso, e.fecha_ingreso.year + n + 1)
    fin = siguiente - timedelta(days=1)
    turno_de = turno_de_factory(e)
    festivos = calendario.festivos_en(inicio, fin)
    tomados = 0
    for v in vacaciones:
        d = max(v.fecha_inicio, inicio)
        while d <= min(v.fecha_fin, fin):
            # Solo cuentan los días que debía trabajar (no descansos ni festivos).
            if turno_de(d)[0] != "descanso" and d not in festivos:
                tomados += 1
            d += timedelta(days=1)
    corresponden = calendario.dias_vacaciones(n)
    return VacacionesOut(
        antiguedad_anios=n,
        periodo_inicio=inicio,
        periodo_fin=fin,
        dias_correspondientes=corresponden,
        dias_tomados=tomados,
        dias_disponibles=corresponden - tomados,
        proximo_aniversario=siguiente,
        dias_proximo_periodo=calendario.dias_vacaciones(n + 1),
    )


@router.get(
    "/vacaciones/{empleado_id}",
    response_model=VacacionesOut,
    dependencies=[Depends(require_roles(*_GESTION))],
)
async def vacaciones(
    empleado_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> VacacionesOut:
    emp = empresa_scope(user, empresa_id)
    e = await _empleado(db, user, emp, empleado_id)
    vac = list(
        await db.scalars(
            select(Incidencia).where(
                Incidencia.empleado_id == e.id, Incidencia.tipo == "vacaciones"
            )
        )
    )
    return saldo_vacaciones(e, vac, date.today())
