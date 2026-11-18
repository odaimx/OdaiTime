import csv
from datetime import timedelta
from io import BytesIO, StringIO

from openpyxl import load_workbook

from tests.test_asistencia import LUN, _manual, _setup
from tests.test_logo import _archivo, _png

PARAMS = {"desde": str(LUN), "hasta": str(LUN + timedelta(6))}


async def _semana(client, a, emp):
    # Lunes normal, martes 2 h extra con retardo, miércoles falta, resto sin checadas.
    await _manual(client, a, emp, "entrada", LUN, "09:00")
    await _manual(client, a, emp, "salida", LUN, "17:00")
    await _manual(client, a, emp, "entrada", LUN + timedelta(1), "09:30")
    await _manual(client, a, emp, "salida", LUN + timedelta(1), "19:30")


def _hoja(contenido: bytes, nombre: str):
    return load_workbook(BytesIO(contenido))[nombre]


async def test_reportes_excel(client, superadmin):
    a, _, emp = await _setup(client, superadmin)
    await _semana(client, a, emp)
    await client.put("/api/tenant/logo", headers=a, files=_archivo(_png()))

    r = await client.get("/api/reportes/asistencia.xlsx", headers=a, params=PARAMS)
    assert r.status_code == 200, r.text
    assert "attachment" in r.headers["content-disposition"]
    ws = _hoja(r.content, "Resumen")
    assert len(ws._images) == 1 and ws["C1"].value == "Empresa Caribe"  # logo y razón social
    encabezados = [c.value for c in ws[5]]
    fila = {h: c.value for h, c in zip(encabezados, ws[6], strict=False)}
    assert fila["Número"] == "1" and fila["Horas extra dobles"] == 2
    assert fila["Faltas"] == 3 and fila["Retardos"] == 1

    r = await client.get("/api/reportes/detalle.xlsx", headers=a, params=PARAMS)
    ws = _hoja(r.content, "Detalle diario")
    estados = [ws.cell(row=i, column=6).value for i in range(6, ws.max_row + 1)]
    assert estados[:3] == ["Asistencia", "Asistencia", "Falta"]


async def test_claves_y_exportacion_a_nomina(client, superadmin):
    a, _, emp = await _setup(client, superadmin)
    await _semana(client, a, emp)

    r = await client.put(
        "/api/reportes/claves",
        headers=a,
        params={"sistema": "contpaqi"},
        json={"claves": {"HE2": "102", "FALT": "  301 ", "RET": ""}},
    )
    assert r.status_code == 200, r.text
    codigos = {c["clave"]: c["codigo"] for c in r.json()}
    assert codigos["HE2"] == "102" and codigos["FALT"] == "301" and codigos["RET"] is None

    r = await client.get(
        "/api/reportes/nomina", headers=a, params={**PARAMS, "sistema": "contpaqi"}
    )
    assert r.status_code == 200, r.text
    wb = load_workbook(BytesIO(r.content))
    filas = [[c.value for c in f] for f in wb["Movimientos"].iter_rows(min_row=2)]
    por_concepto = {f[1]: f[3] for f in filas}
    assert por_concepto["102"] == 2 and por_concepto["301"] == 3
    assert "RET" in por_concepto  # sin clave: va con la de ODAITIME y se avisa
    assert wb["Avisos"]["A2"].value == "RET"

    r = await client.get("/api/reportes/nomina", headers=a, params={**PARAMS, "sistema": "odoo"})
    lineas = list(csv.reader(StringIO(r.content.decode("utf-8-sig"))))
    assert lineas[0] == ["name", "employee_id", "work_entry_type_id", "date_start", "date_stop"]
    extra = next(x for x in lineas[1:] if x[2] == "HE2")
    assert extra[3].startswith(str(LUN + timedelta(1))) and extra[4].endswith("02:00:00")

    r = await client.get(
        "/api/reportes/nomina", headers=a, params={**PARAMS, "sistema": "generico"}
    )
    assert "Prenómina" in load_workbook(BytesIO(r.content)).sheetnames

    r = await client.get("/api/reportes/nomina", headers=a, params={**PARAMS, "sistema": "sap"})
    assert r.status_code == 422
