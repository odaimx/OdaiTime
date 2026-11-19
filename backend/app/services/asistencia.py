"""Motor de asistencia: convierte checadas, turnos e incidencias en la tarjeta del periodo.

Reglas de la LFT (fuente oficial: https://www.diputados.gob.mx/LeyesBiblio/ref/lft.htm):
- Horas extra (art. 66, reforma DOF 01-05-2026): pagadas con 100 % adicional ("dobles"), hasta
  4 h diarias y 4 días por semana, con tope semanal gradual: 9 h (2026-2027), 10 (2028),
  11 (2029) y 12 (2030 en adelante).
- Art. 68: lo que exceda el tope del art. 66, hasta 4 h más por semana, con 200 % adicional
  ("triples"). Lo que pase de eso se reporta como exceso (no permitido).
- Prima dominical (art. 71): al menos 25 % adicional por trabajar en domingo.
- Descanso semanal trabajado (art. 73) y descanso obligatorio trabajado (arts. 74 y 75):
  salario doble ADEMÁS del salario del día (en total, triple). Si además cae en domingo,
  también corresponde la prima dominical.
- Festivos opcionales (no obligatorios por ley) que la empresa decidió otorgar: se descansan;
  si se trabajan, se pagan según la política de la empresa (doble o normal).
Los retardos y su conversión a faltas no están en la LFT: dependen del reglamento interior
de cada empresa (política configurable).
"""

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

DOBLES_MAX_SEMANA_H = {2026: 9, 2027: 9, 2028: 10, 2029: 11, 2030: 12}
DOBLES_MAX_DIA_H = 4
DOBLES_MAX_DIAS = 4
TRIPLES_MAX_SEMANA_H = 4

TIPOS_INCIDENCIA = {
    "vacaciones": "Vacaciones",
    "incapacidad": "Incapacidad (IMSS)",
    "permiso_con_goce": "Permiso con goce de sueldo",
    "permiso_sin_goce": "Permiso sin goce de sueldo",
    "falta_justificada": "Falta justificada",
}


def dobles_max_semana_min(anio: int) -> int:
    h = DOBLES_MAX_SEMANA_H.get(anio, 9 if anio < 2026 else 12)
    return h * 60


@dataclass
class DiaTurno:
    bloques: list[tuple[datetime, datetime]]
    efectivos_min: int


@dataclass
class Marca:
    momento: datetime
    tipo: str  # entrada | salida
    retardo: int | None = None


@dataclass
class Incidencia:
    tipo: str
    inicio: date
    fin: date


@dataclass
class Politica:
    retardos_por_falta: int = 0  # 0 = los retardos no se convierten en faltas
    retardo_falta_min: int = 0  # retardo de N min o más cuenta como falta (0 = no aplica)
    minimo_extra_min: int = 30  # tiempo extra menor a esto no se cuenta
    redondeo_extra_min: int = 30  # el tiempo extra se cuenta en bloques de N min
    festivo_opcional_pago: str = "doble"  # doble | normal


@dataclass
class Dia:
    fecha: date
    estado: str  # fuera, sin_turno, descanso, festivo, asistencia, falta, <tipo de incidencia>
    esperado_min: int = 0
    trabajado_min: int = 0
    retardo_min: int = 0
    retardos: int = 0
    extra_min: int = 0
    dobles_min: int = 0
    triples_min: int = 0
    exceso_min: int = 0
    festivo: str | None = None
    festivo_obligatorio: bool = False
    domingo_trabajado: bool = False
    descanso_trabajado: bool = False
    festivo_trabajado: bool = False
    entradas: list[datetime] = field(default_factory=list)
    salidas: list[datetime] = field(default_factory=list)
    observaciones: list[str] = field(default_factory=list)


@dataclass
class Resumen:
    dias_laborables: int = 0
    asistencias: int = 0
    faltas: int = 0
    faltas_por_retardos: int = 0
    retardos: int = 0
    minutos_retardo: int = 0
    minutos_trabajados: int = 0
    minutos_dobles: int = 0
    minutos_triples: int = 0
    minutos_exceso: int = 0
    domingos_trabajados: int = 0
    descansos_trabajados: int = 0
    festivos_trabajados: int = 0
    incidencias: dict[str, int] = field(default_factory=dict)
    sin_salida: int = 0


def _redondear(minutos: int, politica: Politica) -> int:
    if minutos < politica.minimo_extra_min:
        return 0
    r = max(politica.redondeo_extra_min, 1)
    return (minutos // r) * r


def calcular(
    *,
    desde: date,
    hasta: date,
    tz: ZoneInfo,
    turno_de: Callable[[date], tuple[str, DiaTurno | None]],
    marcas: list[Marca],
    incidencias: list[Incidencia],
    festivos: dict[date, str],
    politica: Politica,
    festivos_obligatorios: set[date] | None = None,
    ingreso: date,
    baja: date | None = None,
) -> tuple[list[Dia], Resumen]:
    """turno_de(fecha) → ("laborable", DiaTurno) | ("descanso", None) | ("sin_turno", None).

    festivos: todos los días festivos que aplican a la empresa (se descansan).
    festivos_obligatorios: cuáles son del art. 74 (None = todos lo son).
    """
    obligatorios = set(festivos) if festivos_obligatorios is None else festivos_obligatorios

    def paga_doble(d: date) -> bool:
        return d in obligatorios or politica.festivo_opcional_pago == "doble"

    # 1) Emparejar entradas y salidas. Cada par pertenece a la jornada de su entrada: el día
    # local de la entrada o, si llega durante un turno nocturno que empezó el día anterior
    # (p. ej. 00:10 en un turno de 23:00 a 07:00), a ese día anterior.
    def jornada(momento: datetime) -> date:
        d = momento.astimezone(tz).date()
        clase, anterior = turno_de(d - timedelta(days=1))
        if clase == "laborable" and anterior and anterior.bloques:
            if momento < anterior.bloques[-1][1]:
                return d - timedelta(days=1)
        return d

    pares: dict[date, list[tuple[datetime, datetime | None]]] = defaultdict(list)
    sueltas: dict[date, int] = defaultdict(int)
    retardos_dia: dict[date, list[int]] = defaultdict(list)
    abierta: Marca | None = None
    for m in sorted(marcas, key=lambda x: x.momento):
        if m.tipo == "entrada":
            if abierta is not None:
                pares[jornada(abierta.momento)].append((abierta.momento, None))
            abierta = m
            if m.retardo:
                retardos_dia[jornada(m.momento)].append(m.retardo)
        elif abierta is not None:
            pares[jornada(abierta.momento)].append((abierta.momento, m.momento))
            abierta = None
        else:
            sueltas[m.momento.astimezone(tz).date()] += 1
    if abierta is not None:
        pares[jornada(abierta.momento)].append((abierta.momento, None))

    def incidencia_en(d: date) -> str | None:
        return next((i.tipo for i in incidencias if i.inicio <= d <= i.fin), None)

    # 2) Clasificar cada día.
    dias: list[Dia] = []
    d = desde
    while d <= hasta:
        dia = Dia(
            fecha=d,
            estado="asistencia",
            festivo=festivos.get(d),
            festivo_obligatorio=d in obligatorios and d in festivos,
        )
        for ent, sal in pares.get(d, []):
            dia.entradas.append(ent)
            if sal is None:
                dia.observaciones.append("Entrada sin salida")
            else:
                dia.salidas.append(sal)
                dia.trabajado_min += round((sal - ent).total_seconds() / 60)
        if sueltas.get(d):
            dia.observaciones.append("Salida sin entrada")
        dia.retardos = len(retardos_dia.get(d, []))
        dia.retardo_min = sum(retardos_dia.get(d, []))

        if d < ingreso or (baja and d > baja):
            dia.estado = "fuera"
        else:
            clase, turno = turno_de(d)
            inc = incidencia_en(d)
            trabajo = dia.trabajado_min > 0
            if trabajo and d.weekday() == 6:
                dia.domingo_trabajado = True
            if clase == "sin_turno":
                dia.estado = "sin_turno"
            elif dia.festivo and clase == "laborable":
                dia.estado = "festivo"
                dia.festivo_trabajado = trabajo and paga_doble(d)
            elif clase == "descanso":
                dia.estado = "descanso"
                dia.descanso_trabajado = trabajo
                if dia.festivo:
                    dia.festivo_trabajado = trabajo and paga_doble(d)
            elif inc:
                dia.estado = inc
                dia.esperado_min = turno.efectivos_min if turno else 0
            else:
                dia.esperado_min = turno.efectivos_min if turno else 0
                if not dia.entradas:
                    dia.estado = "falta"
                elif politica.retardo_falta_min and dia.retardo_min >= politica.retardo_falta_min:
                    dia.estado = "falta"
                    dia.observaciones.append(
                        f"Retardo de {dia.retardo_min} min (cuenta como falta por política)"
                    )
                else:
                    dia.extra_min = _redondear(
                        max(dia.trabajado_min - dia.esperado_min, 0), politica
                    )
        dias.append(dia)
        d += timedelta(days=1)

    # 3) Repartir el tiempo extra por semana (lunes a domingo): dobles (art. 66), triples (art. 68).
    por_semana: dict[date, list[Dia]] = defaultdict(list)
    for dia in dias:
        por_semana[dia.fecha - timedelta(days=dia.fecha.weekday())].append(dia)
    for lunes, lista in por_semana.items():
        tope_dobles = dobles_max_semana_min(lunes.year)
        tope_triples = TRIPLES_MAX_SEMANA_H * 60
        dobles = triples = dias_con_dobles = 0
        for dia in lista:
            if not dia.extra_min:
                continue
            resto = dia.extra_min
            if dias_con_dobles < DOBLES_MAX_DIAS and dobles < tope_dobles:
                dia.dobles_min = min(resto, DOBLES_MAX_DIA_H * 60, tope_dobles - dobles)
                dobles += dia.dobles_min
                dias_con_dobles += 1
                resto -= dia.dobles_min
            if resto and triples < tope_triples:
                dia.triples_min = min(resto, tope_triples - triples)
                triples += dia.triples_min
                resto -= dia.triples_min
            if resto:
                dia.exceso_min = resto
                dia.observaciones.append(
                    "Tiempo extra por encima de los límites de los arts. 66 y 68"
                )

    # 4) Resumen.
    r = Resumen()
    for dia in dias:
        if dia.estado in ("asistencia", "falta") or dia.estado in TIPOS_INCIDENCIA:
            r.dias_laborables += 1
        if dia.estado == "asistencia":
            r.asistencias += 1
        elif dia.estado == "falta":
            r.faltas += 1
        elif dia.estado in TIPOS_INCIDENCIA:
            r.incidencias[dia.estado] = r.incidencias.get(dia.estado, 0) + 1
        r.retardos += dia.retardos
        r.minutos_retardo += dia.retardo_min
        r.minutos_trabajados += dia.trabajado_min
        r.minutos_dobles += dia.dobles_min
        r.minutos_triples += dia.triples_min
        r.minutos_exceso += dia.exceso_min
        r.domingos_trabajados += dia.domingo_trabajado
        r.descansos_trabajados += dia.descanso_trabajado
        r.festivos_trabajados += dia.festivo_trabajado
        r.sin_salida += "Entrada sin salida" in dia.observaciones
    if politica.retardos_por_falta > 0:
        r.faltas_por_retardos = r.retardos // politica.retardos_por_falta
    return dias, r


# --- Conceptos para nómina (Odoo, CONTPAQi Nóminas, Aspel NOI u otros) ---
# Claves genéricas de ODAITIME; en la etapa de exportación cada empresa las relaciona con las
# claves de percepción/deducción o tipos de incidencia de su sistema de nómina.
CONCEPTOS = {
    "HE2": ("Horas extra dobles (art. 66)", "horas"),
    "HE3": ("Horas extra triples (art. 68)", "horas"),
    "PDOM": ("Prima dominical (art. 71)", "dias"),
    "DLAB": ("Descanso semanal laborado (art. 73)", "dias"),
    "FLAB": ("Día festivo laborado (art. 75)", "dias"),
    "FALT": ("Faltas injustificadas", "dias"),
    "FRET": ("Faltas por acumulación de retardos", "dias"),
    "RET": ("Retardos", "eventos"),
    "VAC": ("Vacaciones", "dias"),
    "INC": ("Incapacidad", "dias"),
    "PCG": ("Permiso con goce de sueldo", "dias"),
    "PSG": ("Permiso sin goce de sueldo", "dias"),
    "FJUS": ("Falta justificada", "dias"),
}
_INCIDENCIA_CONCEPTO = {
    "vacaciones": "VAC",
    "incapacidad": "INC",
    "permiso_con_goce": "PCG",
    "permiso_sin_goce": "PSG",
    "falta_justificada": "FJUS",
}


def conceptos_nomina(r: Resumen) -> list[dict]:
    valores = {
        "HE2": round(r.minutos_dobles / 60, 2),
        "HE3": round(r.minutos_triples / 60, 2),
        "PDOM": r.domingos_trabajados,
        "DLAB": r.descansos_trabajados,
        "FLAB": r.festivos_trabajados,
        "FALT": r.faltas,
        "FRET": r.faltas_por_retardos,
        "RET": r.retardos,
    }
    for tipo, n in r.incidencias.items():
        valores[_INCIDENCIA_CONCEPTO[tipo]] = n
    return [
        {"clave": k, "descripcion": CONCEPTOS[k][0], "unidad": CONCEPTOS[k][1], "cantidad": v}
        for k, v in valores.items()
        if v
    ]
