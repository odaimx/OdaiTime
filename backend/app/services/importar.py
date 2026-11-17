"""Importación de empleados desde Excel (.xlsx)."""

from datetime import date, datetime
from io import BytesIO

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from pydantic import ValidationError

from app.models import Sucursal, Turno
from app.schemas.empleado import EmpleadoCreate

MAX_BYTES = 5 * 1024 * 1024
MAX_FILAS = 2000

# (columna, encabezado en Excel, obligatoria, ejemplo)
COLUMNAS = [
    ("numero", "Número de empleado", True, "1001"),
    ("nombre", "Nombre(s)", True, "María Fernanda"),
    ("apellido_paterno", "Apellido paterno", True, "López"),
    ("apellido_materno", "Apellido materno", False, "Pérez"),
    ("curp", "CURP", False, "LOPM900215MQRPRR09"),
    ("rfc", "RFC", False, "LOPM900215AB1"),
    ("nss", "NSS", False, "12345678901"),
    ("fecha_ingreso", "Fecha de ingreso (AAAA-MM-DD)", True, "2025-01-15"),
    ("puesto", "Puesto", False, "Recepcionista"),
    ("departamento", "Departamento", False, "Recepción"),
    ("salario_diario", "Salario diario", False, "450.00"),
    ("email", "Correo", False, "maria@correo.mx"),
    ("telefono", "Teléfono", False, "9981234567"),
    ("sucursal_clave", "Clave de sucursal", True, "CUN"),
    ("turno", "Turno (nombre)", False, "Matutino"),
]

_MARCA = PatternFill("solid", fgColor="8A64DE")
_NAVY = PatternFill("solid", fgColor="1A2C4F")
_BLANCO = Font(bold=True, color="FFFFFF")


def generar_plantilla(sucursales: list[Sucursal], turnos: list[Turno]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Empleados"
    for i, (_, encabezado, obligatoria, ejemplo) in enumerate(COLUMNAS, start=1):
        celda = ws.cell(row=1, column=i, value=encabezado + (" *" if obligatoria else ""))
        celda.font = _BLANCO
        celda.fill = _MARCA if obligatoria else _NAVY
        ws.cell(row=2, column=i, value=ejemplo).font = Font(italic=True, color="94A3B8")
        ws.column_dimensions[get_column_letter(i)].width = max(16, len(encabezado) + 4)
    ws.freeze_panes = "A2"

    ayuda = wb.create_sheet("Catálogos")
    ayuda["A1"] = "Borra la fila de ejemplo antes de importar. * = obligatorio."
    ayuda["A1"].font = Font(bold=True)
    ayuda["A3"], ayuda["B3"] = "Clave de sucursal", "Sucursal"
    ayuda["D3"] = "Turnos disponibles"
    for c in ("A3", "B3", "D3"):
        ayuda[c].font = _BLANCO
        ayuda[c].fill = _NAVY
    for i, s in enumerate(sorted(sucursales, key=lambda s: s.clave), start=4):
        ayuda.cell(row=i, column=1, value=s.clave)
        ayuda.cell(row=i, column=2, value=s.nombre)
    for i, t in enumerate(sorted(turnos, key=lambda t: t.nombre), start=4):
        ayuda.cell(row=i, column=4, value=t.nombre)
    for col, ancho in (("A", 20), ("B", 32), ("D", 32)):
        ayuda.column_dimensions[col].width = ancho

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _celda(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, int | float):
        return str(v)
    return str(v).strip() or None


def _fecha(v):
    if v is None or isinstance(v, date):
        return v
    for formato in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(v, formato).date()
        except ValueError:
            continue
    return v  # que pydantic reporte el error


def leer(
    contenido: bytes,
    sucursales: dict[str, Sucursal],
    turnos: dict[str, Turno],
    numeros_existentes: set[str],
    curps_existentes: set[str],
) -> tuple[list[tuple[EmpleadoCreate, Turno | None]], list[dict]]:
    try:
        wb = load_workbook(BytesIO(contenido), read_only=True, data_only=True)
    except Exception:  # noqa: BLE001
        return [], [{"fila": 0, "error": "No se pudo leer el archivo. Usa la plantilla .xlsx"}]

    ws = wb.worksheets[0]
    filas: list[tuple[EmpleadoCreate, Turno | None]] = []
    errores: list[dict] = []
    numeros, curps = set(numeros_existentes), set(curps_existentes)

    for n, valores in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        crudo = {col: _celda(v) for (col, *_), v in zip(COLUMNAS, valores, strict=False)}
        if not any(crudo.values()):
            continue
        if len(filas) + len(errores) >= MAX_FILAS:
            errores.append({"fila": n, "error": f"Máximo {MAX_FILAS} empleados por archivo"})
            break

        def error(msg: str, fila: int = n) -> None:
            errores.append({"fila": fila, "error": msg})

        if crudo.get("nss") and len(crudo["nss"]) < 11 and crudo["nss"].isdigit():
            crudo["nss"] = crudo["nss"].zfill(11)  # Excel quita los ceros a la izquierda

        clave = (crudo.pop("sucursal_clave", None) or "").upper()
        sucursal = sucursales.get(clave)
        if sucursal is None:
            error(f"Clave de sucursal desconocida: {clave or '(vacía)'}")
            continue

        nombre_turno = crudo.pop("turno", None)
        turno = turnos.get(nombre_turno.lower()) if nombre_turno else None
        if nombre_turno and turno is None:
            error(f"Turno desconocido: {nombre_turno}")
            continue

        crudo["fecha_ingreso"] = _fecha(crudo.get("fecha_ingreso"))
        try:
            data = EmpleadoCreate(**crudo, sucursal_id=sucursal.id)
        except ValidationError as exc:
            e = exc.errors()[0]
            campo = next((h for c, h, *_ in COLUMNAS if c == e["loc"][0]), e["loc"][0])
            error(f"{campo}: {e['msg'].removeprefix('Value error, ')}")
            continue

        if data.numero.upper() in numeros:
            error(f"Número de empleado repetido: {data.numero}")
            continue
        if data.curp and data.curp in curps:
            error(f"CURP repetida: {data.curp}")
            continue
        numeros.add(data.numero.upper())
        if data.curp:
            curps.add(data.curp)
        filas.append((data, turno))

    if not filas and not errores:
        errores.append({"fila": 0, "error": "El archivo no tiene empleados"})
    return filas, errores
