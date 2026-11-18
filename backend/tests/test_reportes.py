import csv
from datetime import timedelta
from io import BytesIO, StringIO

from openpyxl import load_workbook

from app.services import reportes
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

    extra = {"sistema": "contpaqi", "tipo_periodo": "Semanal", "numero_periodo": 7}
    r = await client.get("/api/reportes/nomina", headers=a, params={**PARAMS, **extra})
    assert r.status_code == 200, r.text
    wb = load_workbook(BytesIO(r.content))
    assert wb.sheetnames[:3] == ["ODAI_Incidencias", "LEEME", "MAPEO_INCIDENCIAS"]
    ws = wb["ODAI_Incidencias"]
    assert [c.value for c in ws[1]] == reportes.COLUMNAS_CONTPAQI
    filas = [[c.value for c in f] for f in ws.iter_rows(min_row=2) if f[0].value]
    assert all(f[5] == "Semanal" and f[6] == LUN.year and f[7] == 7 for f in filas)
    assert all(isinstance(f[0], str) for f in filas)
    por_concepto: dict[str, float] = {}
    for f in filas:
        por_concepto[f[2]] = por_concepto.get(f[2], 0) + f[3]
    assert por_concepto["102"] == 2 and por_concepto["301"] == 3
    assert "RET" in por_concepto  # sin clave: va con la de ODAITIME
    mapeo = {f[0].value: f[1].value for f in wb["MAPEO_INCIDENCIAS"].iter_rows(min_row=2)}
    assert mapeo["Faltas injustificadas"] == "301"

    r = await client.get(
        "/api/reportes/nomina", headers=a, params={**PARAMS, **extra, "formato": "txt"}
    )
    assert r.content.startswith("\ufeff".encode())
    lineas = r.content.decode("utf-8-sig").split("\n")
    assert lineas[0].split("\t") == reportes.COLUMNAS_CONTPAQI
    falta = next(x.split("\t") for x in lineas[1:] if "\t301\t" in x)
    assert len(falta[1]) == 10 and falta[1][2] == "/" and falta[3] == "1"

    r = await client.get(
        "/api/reportes/nomina", headers=a, params={**PARAMS, **extra, "formato": "csv"}
    )
    assert next(csv.reader(StringIO(r.content.decode("utf-8-sig")))) == reportes.COLUMNAS_CONTPAQI
    r = await client.get(
        "/api/reportes/nomina", headers=a, params={**PARAMS, **extra, "formato": "pdf"}
    )
    assert r.status_code == 422

    r = await client.get("/api/reportes/nomina", headers=a, params={**PARAMS, "sistema": "odoo"})
    assert r.status_code == 200, r.text
    wb = load_workbook(BytesIO(r.content))
    assert wb.sheetnames == ["INCIDENCIAS", "CATALOGOS", "MAPEO_ODOO", "INSTRUCCIONES"]
    ws = wb["INCIDENCIAS"]
    assert [c.value for c in ws[1]] == reportes.COLUMNAS_ODOO
    filas = [[c.value for c in f] for f in ws.iter_rows(min_row=2) if f[0].value]
    assert len({f[0] for f in filas}) == len(filas)  # external_id único
    assert all(f[1] == "ODAITIME" and f[17] == "APPROVED" for f in filas)
    extra = next(f for f in filas if f[6] == "HORAS_EXTRA")
    assert extra[7] == str(LUN + timedelta(1)) and extra[11] == 2 and extra[12] == "HOURS"
    ret = next(f for f in filas if f[6] == "RETARDO")
    assert ret[12] == "MINUTES" and ret[11] > 0 and ret[9] == "09:30"
    faltas = [f for f in filas if f[6] == "FALTA"]
    assert sum(f[11] for f in faltas) == 3 and all(f[12] == "DAYS" for f in faltas)
    assert any(f[7] != f[8] for f in faltas)  # días seguidos van en un solo rango
    assert not any(f[16] for f in filas)

    r = await client.get(
        "/api/reportes/nomina",
        headers=a,
        params={**PARAMS, "sistema": "odoo", "formato": "csv", "checadas": "true"},
    )
    lineas = list(csv.reader(StringIO(r.content.decode("utf-8-sig"))))
    assert lineas[0] == reportes.COLUMNAS_ODOO
    acciones = [x[16] for x in lineas[1:] if x[16]]
    assert acciones.count("CHECK_IN") == 2 and acciones.count("CHECK_OUT") == 2
    assert len({x[0] for x in lineas[1:]}) == len(lineas) - 1

    r = await client.get(
        "/api/reportes/nomina", headers=a, params={**PARAMS, "sistema": "generico"}
    )
    assert "Prenómina" in load_workbook(BytesIO(r.content)).sheetnames

    r = await client.get("/api/reportes/nomina", headers=a, params={**PARAMS, "sistema": "sap"})
    assert r.status_code == 422
