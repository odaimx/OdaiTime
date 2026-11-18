"""Reportes de asistencia (Excel) y exportación a sistemas de nómina.

Los sistemas de nómina reciben los conceptos de ODAITIME (HE2, HE3, PDOM, FALT…) traducidos a
las claves que cada empresa configuró (tabla claves_nomina). ODAITIME entrega cantidades
(horas, días, eventos); el importe lo calcula el sistema de nómina con el salario del trabajador.
"""

import csv
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from io import BytesIO, StringIO
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

from app.models import Empleado, Empresa
from app.services.asistencia import CONCEPTOS, TIPOS_INCIDENCIA, Dia, Resumen, conceptos_nomina

SISTEMAS = {
    "generico": "Genérico (Excel)",
    "contpaqi": "CONTPAQi Nóminas",
    "noi": "Aspel NOI",
    "odoo": "Odoo (entradas de trabajo)",
}

ESTADOS = {
    "asistencia": "Asistencia",
    "falta": "Falta",
    "descanso": "Descanso",
    "festivo": "Festivo",
    "sin_turno": "Sin turno",
    "fuera": "No laboraba",
    **TIPOS_INCIDENCIA,
}
DIAS_SEMANA = ("Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom")
_INCIDENCIA_CONCEPTO = {
    "vacaciones": "VAC",
    "incapacidad": "INC",
    "permiso_con_goce": "PCG",
    "permiso_sin_goce": "PSG",
    "falta_justificada": "FJUS",
}

_MARCA = PatternFill("solid", fgColor="8A64DE")
_NAVY = PatternFill("solid", fgColor="1A2C4F")
_SUAVE = PatternFill("solid", fgColor="F1ECFC")
_BLANCO = Font(bold=True, color="FFFFFF")

Periodo = list[tuple[Empleado, list[Dia], Resumen]]


@dataclass
class Movimiento:
    """Una línea para el sistema de nómina."""

    empleado: Empleado
    concepto: str  # clave ODAITIME
    codigo: str  # clave en el sistema de nómina
    cantidad: float
    fecha: date  # fecha del movimiento (o fin del periodo para totales)


def horas(minutos: int) -> float:
    return round(minutos / 60, 2)


# --- Formato común de las hojas ---


def _encabezado(
    ws: Worksheet, empresa: Empresa, titulo: str, desde: date, hasta: date, columnas: int
) -> int:
    """Escribe el encabezado con logo, empresa y periodo. Devuelve la fila donde va la tabla."""
    if empresa.logo:
        img = XLImage(BytesIO(empresa.logo))
        escala = 48 / max(img.height, 1)
        img.height, img.width = 48, int(img.width * escala)
        ws.add_image(img, "A1")
        ws.row_dimensions[1].height = 20
        ws.row_dimensions[2].height = 20
        col = get_column_letter(min(3, columnas))
    else:
        col = "A"
    ws[f"{col}1"] = empresa.razon_social or empresa.nombre
    ws[f"{col}1"].font = Font(bold=True, size=14, color="1A2C4F")
    ws[f"{col}2"] = f"{titulo} · del {desde:%d/%m/%Y} al {hasta:%d/%m/%Y}"
    ws[f"{col}2"].font = Font(size=11, color="8A64DE")
    ws[f"{col}3"] = f"Generado por ODAITIME el {datetime.now():%d/%m/%Y %H:%M}"
    ws[f"{col}3"].font = Font(size=9, color="64748B")
    return 5


def _tabla(ws: Worksheet, fila: int, encabezados: list[str], filas: Iterable[list]) -> None:
    for i, h in enumerate(encabezados, start=1):
        c = ws.cell(row=fila, column=i, value=h)
        c.fill, c.font = _NAVY, _BLANCO
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[fila].height = 32
    n = fila
    for n, valores in enumerate(filas, start=fila + 1):
        for i, v in enumerate(valores, start=1):
            ws.cell(row=n, column=i, value=v)
        if (n - fila) % 2 == 0:
            for i in range(1, len(encabezados) + 1):
                ws.cell(row=n, column=i).fill = _SUAVE
    ws.freeze_panes = ws.cell(row=fila + 1, column=3)
    for i, h in enumerate(encabezados, start=1):
        ancho = max(
            [len(str(h))]
            + [len(str(ws.cell(row=r, column=i).value or "")) for r in range(fila + 1, n + 1)]
        )
        ws.column_dimensions[get_column_letter(i)].width = min(max(ancho + 2, 9), 45)


def _libro(wb: Workbook) -> bytes:
    salida = BytesIO()
    wb.save(salida)
    return salida.getvalue()


# --- Reporte: resumen del periodo ---

COLUMNAS_RESUMEN = [
    "Número",
    "Empleado",
    "Sucursal",
    "Puesto",
    "Departamento",
    "Días laborables",
    "Asistencias",
    "Faltas",
    "Faltas por retardos",
    "Retardos",
    "Min. de retardo",
    "Horas trabajadas",
    "Horas extra dobles",
    "Horas extra triples",
    "Exceso (no permitido)",
    "Domingos trabajados",
    "Descansos trabajados",
    "Festivos trabajados",
    "Vacaciones",
    "Incapacidad",
    "Permiso con goce",
    "Permiso sin goce",
    "Falta justificada",
    "Jornadas sin salida",
]


def reporte_resumen(empresa: Empresa, desde: date, hasta: date, periodo: Periodo) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Resumen"
    fila = _encabezado(ws, empresa, "Resumen de asistencia", desde, hasta, len(COLUMNAS_RESUMEN))
    filas = []
    for e, _, r in periodo:
        inc = r.incidencias
        filas.append(
            [
                e.numero,
                e.nombre_completo,
                e.sucursal.nombre,
                e.puesto or "",
                e.departamento or "",
                r.dias_laborables,
                r.asistencias,
                r.faltas,
                r.faltas_por_retardos,
                r.retardos,
                r.minutos_retardo,
                horas(r.minutos_trabajados),
                horas(r.minutos_dobles),
                horas(r.minutos_triples),
                horas(r.minutos_exceso),
                r.domingos_trabajados,
                r.descansos_trabajados,
                r.festivos_trabajados,
                inc.get("vacaciones", 0),
                inc.get("incapacidad", 0),
                inc.get("permiso_con_goce", 0),
                inc.get("permiso_sin_goce", 0),
                inc.get("falta_justificada", 0),
                r.sin_salida,
            ]
        )
    _tabla(ws, fila, COLUMNAS_RESUMEN, filas)
    _hoja_notas(wb)
    return _libro(wb)


# --- Reporte: detalle diario ---

COLUMNAS_DETALLE = [
    "Número",
    "Empleado",
    "Sucursal",
    "Fecha",
    "Día",
    "Estado",
    "Festivo",
    "Entradas",
    "Salidas",
    "Horas esperadas",
    "Horas trabajadas",
    "Retardo (min)",
    "Horas dobles",
    "Horas triples",
    "Observaciones",
]


def reporte_detalle(empresa: Empresa, desde: date, hasta: date, periodo: Periodo) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Detalle diario"
    fila = _encabezado(
        ws, empresa, "Detalle diario de asistencia", desde, hasta, len(COLUMNAS_DETALLE)
    )
    filas = []
    for e, dias, _ in periodo:
        tz = ZoneInfo(e.sucursal.zona_horaria)
        for d in dias:
            if d.estado == "fuera":
                continue
            filas.append(
                [
                    e.numero,
                    e.nombre_completo,
                    e.sucursal.nombre,
                    d.fecha,
                    DIAS_SEMANA[d.fecha.weekday()],
                    ESTADOS.get(d.estado, d.estado),
                    d.festivo or "",
                    ", ".join(f"{m.astimezone(tz):%H:%M}" for m in d.entradas),
                    ", ".join(f"{m.astimezone(tz):%H:%M}" for m in d.salidas),
                    horas(d.esperado_min),
                    horas(d.trabajado_min),
                    d.retardo_min or "",
                    horas(d.dobles_min) or "",
                    horas(d.triples_min) or "",
                    "; ".join(d.observaciones),
                ]
            )
    _tabla(ws, fila, COLUMNAS_DETALLE, filas)
    for r in range(fila + 1, ws.max_row + 1):
        ws.cell(row=r, column=4).number_format = "DD/MM/YYYY"
    _hoja_notas(wb)
    return _libro(wb)


def _hoja_notas(wb: Workbook) -> None:
    ws = wb.create_sheet("Notas LFT")
    notas = [
        (
            "Fuente oficial",
            "Ley Federal del Trabajo: https://www.diputados.gob.mx/LeyesBiblio/ref/lft.htm",
        ),
        (
            "Horas extra dobles",
            "Art. 66: se pagan con 100 % más; tope semanal gradual por la reforma DOF 01-05-2026.",
        ),
        ("Horas extra triples", "Art. 68: lo que excede el tope del art. 66, con 200 % más."),
        (
            "Prima dominical",
            "Art. 71: al menos 25 % adicional sobre el salario de los días ordinarios.",
        ),
        ("Descanso trabajado", "Art. 73: salario doble además del salario del día de descanso."),
        (
            "Festivo trabajado",
            "Arts. 74 y 75: salario doble además del salario del día (triple en total).",
        ),
        ("Retardos", "No están en la LFT; dependen del reglamento interior de la empresa."),
    ]
    for i, (a, b) in enumerate(notas, start=1):
        ws.cell(row=i, column=1, value=a).font = Font(bold=True)
        ws.cell(row=i, column=2, value=b)
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 100


# --- Exportación a nómina ---


def conceptos_dia(d: Dia) -> list[tuple[str, float]]:
    """Conceptos de un solo día (para sistemas que reciben movimientos diarios, como Odoo)."""
    salida: list[tuple[str, float]] = []
    if d.dobles_min:
        salida.append(("HE2", horas(d.dobles_min)))
    if d.triples_min:
        salida.append(("HE3", horas(d.triples_min)))
    if d.domingo_trabajado:
        salida.append(("PDOM", 1))
    if d.descanso_trabajado:
        salida.append(("DLAB", 1))
    if d.festivo_trabajado:
        salida.append(("FLAB", 1))
    if d.estado == "falta":
        salida.append(("FALT", 1))
    if d.retardos:
        salida.append(("RET", d.retardos))
    if d.estado in _INCIDENCIA_CONCEPTO:
        salida.append((_INCIDENCIA_CONCEPTO[d.estado], 1))
    return salida


def movimientos(
    periodo: Periodo, claves: dict[str, str], hasta: date, diario: bool = False
) -> list[Movimiento]:
    """Movimientos con la clave del sistema (si no se configuró, va la clave de ODAITIME)."""
    salida = []
    for e, dias, r in periodo:
        if diario:
            for d in dias:
                for concepto, cantidad in conceptos_dia(d):
                    salida.append(
                        Movimiento(e, concepto, claves.get(concepto) or concepto, cantidad, d.fecha)
                    )
            if r.faltas_por_retardos:  # solo existe como total del periodo
                salida.append(
                    Movimiento(
                        e, "FRET", claves.get("FRET") or "FRET", r.faltas_por_retardos, hasta
                    )
                )
        else:
            for c in conceptos_nomina(r):
                salida.append(
                    Movimiento(
                        e, c["clave"], claves.get(c["clave"]) or c["clave"], c["cantidad"], hasta
                    )
                )
    return salida


def exportar(
    sistema: str,
    empresa: Empresa,
    desde: date,
    hasta: date,
    periodo: Periodo,
    claves: dict[str, str],
) -> tuple[bytes, str, str]:
    """Devuelve (contenido, tipo MIME, extensión)."""
    if sistema == "odoo":
        return _odoo(periodo, claves, hasta), "text/csv; charset=utf-8", "csv"
    wb = Workbook()
    ws = wb.active
    sin_clave = sorted(
        {m.concepto for m in movimientos(periodo, claves, hasta)}
        - {k for k, v in claves.items() if v}
    )
    if sistema == "contpaqi":
        ws.title = "Movimientos"
        _tabla(
            ws,
            1,
            ["Código de empleado", "Concepto", "Descripción", "Valor", "Fecha"],
            [
                [m.empleado.numero, m.codigo, CONCEPTOS[m.concepto][0], m.cantidad, m.fecha]
                for m in movimientos(periodo, claves, hasta)
            ],
        )
        _formato_fecha(ws, 5)
    elif sistema == "noi":
        ws.title = "Movimientos"
        _tabla(
            ws,
            1,
            ["Clave del trabajador", "Clave", "Descripción", "Unidades", "Importe", "Fecha"],
            [
                [m.empleado.numero, m.codigo, CONCEPTOS[m.concepto][0], m.cantidad, None, m.fecha]
                for m in movimientos(periodo, claves, hasta)
            ],
        )
        _formato_fecha(ws, 6)
    else:
        _generico(wb, ws, empresa, desde, hasta, periodo, claves)
        sin_clave = []
    if sin_clave and sistema != "generico":
        avisos = wb.create_sheet("Avisos")
        avisos["A1"] = "Conceptos sin clave configurada (se exportaron con la clave de ODAITIME):"
        avisos["A1"].font = Font(bold=True, color="B45309")
        for i, k in enumerate(sin_clave, start=2):
            avisos.cell(row=i, column=1, value=k)
            avisos.cell(row=i, column=2, value=CONCEPTOS[k][0])
        avisos.column_dimensions["A"].width = 12
        avisos.column_dimensions["B"].width = 45
    return _libro(wb), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"


def _formato_fecha(ws: Worksheet, columna: int) -> None:
    for r in range(2, ws.max_row + 1):
        ws.cell(row=r, column=columna).number_format = "DD/MM/YYYY"


def _generico(
    wb: Workbook,
    ws: Worksheet,
    empresa: Empresa,
    desde: date,
    hasta: date,
    periodo: Periodo,
    claves: dict[str, str],
) -> None:
    """Prenómina: una fila por empleado y una columna por concepto, más la lista de movimientos."""
    ws.title = "Prenómina"
    conceptos = list(CONCEPTOS)
    fila = _encabezado(ws, empresa, "Prenómina", desde, hasta, len(conceptos) + 3)
    encabezados = ["Número", "Empleado", "Sucursal"] + [
        f"{claves.get(k) or k} · {CONCEPTOS[k][0]} ({CONCEPTOS[k][1]})" for k in conceptos
    ]
    filas = []
    for e, _, r in periodo:
        valores = {c["clave"]: c["cantidad"] for c in conceptos_nomina(r)}
        filas.append(
            [e.numero, e.nombre_completo, e.sucursal.nombre]
            + [valores.get(k) or None for k in conceptos]
        )
    _tabla(ws, fila, encabezados, filas)
    for i in range(4, len(encabezados) + 1):
        ws.column_dimensions[get_column_letter(i)].width = 16

    mov = wb.create_sheet("Movimientos")
    _tabla(
        mov,
        1,
        [
            "Número",
            "Empleado",
            "Clave",
            "Concepto ODAITIME",
            "Descripción",
            "Cantidad",
            "Unidad",
            "Fecha",
        ],
        [
            [
                m.empleado.numero,
                m.empleado.nombre_completo,
                m.codigo,
                m.concepto,
                CONCEPTOS[m.concepto][0],
                m.cantidad,
                CONCEPTOS[m.concepto][1],
                m.fecha,
            ]
            for m in movimientos(periodo, claves, hasta)
        ],
    )
    _formato_fecha(mov, 8)
    _hoja_notas(wb)


def _odoo(periodo: Periodo, claves: dict[str, str], hasta: date) -> bytes:
    """CSV para importar entradas de trabajo (hr.work.entry) desde la vista de lista de Odoo.

    Odoo relaciona employee_id y work_entry_type_id por su nombre, así que la clave configurada
    debe ser el nombre del tipo de entrada de trabajo tal como aparece en Odoo.
    Los conceptos en días ocupan la jornada esperada del día (8 h si no hay turno).
    """
    salida = StringIO()
    w = csv.writer(salida)
    w.writerow(["name", "employee_id", "work_entry_type_id", "date_start", "date_stop"])
    for e, dias, r in periodo:
        por_fecha = {d.fecha: d for d in dias}
        for m in movimientos([(e, dias, r)], claves, hasta, diario=True):
            unidad = CONCEPTOS[m.concepto][1]
            if unidad == "horas":
                duracion = timedelta(hours=m.cantidad)
            elif unidad == "dias":
                d = por_fecha.get(m.fecha)
                duracion = timedelta(
                    minutes=(d.esperado_min if d and d.esperado_min else 480) * m.cantidad
                )
            else:  # eventos (retardos): Odoo no los maneja como tiempo; van de 1 minuto
                duracion = timedelta(minutes=int(m.cantidad))
            inicio = datetime.combine(m.fecha, datetime.min.time())
            w.writerow(
                [
                    f"{CONCEPTOS[m.concepto][0]} · {e.nombre_completo}",
                    e.nombre_completo,
                    m.codigo,
                    f"{inicio:%Y-%m-%d %H:%M:%S}",
                    f"{inicio + duracion:%Y-%m-%d %H:%M:%S}",
                ]
            )
    return ("﻿" + salida.getvalue()).encode("utf-8")  # BOM: Excel abre bien los acentos
