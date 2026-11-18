from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.services.asistencia import DiaTurno, Incidencia, Marca, Politica, calcular
from app.services.calendario import anios_cumplidos, dias_vacaciones, festivos

TZ = ZoneInfo("America/Cancun")


def dt(d: date, h: int, m: int = 0) -> datetime:
    return datetime.combine(d, time(h, m), TZ)


def turno_lv(d: date):
    """Lunes a viernes 9:00-17:00 (8 h)."""
    if d.weekday() < 5:
        return "laborable", DiaTurno([(dt(d, 9), dt(d, 17))], 480)
    return "descanso", None


def correr(marcas, desde, hasta, incidencias=(), politica=None, festivos_=None):
    return calcular(
        desde=desde,
        hasta=hasta,
        tz=TZ,
        turno_de=turno_lv,
        marcas=marcas,
        incidencias=list(incidencias),
        festivos=festivos_ or {},
        politica=politica or Politica(),
        ingreso=date(2025, 1, 1),
    )


LUN = date(2027, 3, 1)  # lunes


def test_festivos_art_74():
    f = festivos(2027)
    assert date(2027, 2, 1) in f  # primer lunes de febrero
    assert date(2027, 3, 15) in f  # tercer lunes de marzo
    assert date(2027, 11, 15) in f  # tercer lunes de noviembre
    assert date(2027, 10, 1) not in f
    assert date(2030, 10, 1) in festivos(2030)  # transmisión del Ejecutivo


def test_vacaciones_art_76():
    assert [dias_vacaciones(n) for n in (0, 1, 2, 5, 6, 10, 11, 16)] == [
        0,
        12,
        14,
        20,
        22,
        22,
        24,
        26,
    ]
    assert anios_cumplidos(date(2020, 6, 15), date(2026, 6, 14)) == 5
    assert anios_cumplidos(date(2020, 6, 15), date(2026, 6, 15)) == 6


def test_asistencia_falta_retardo_y_descanso():
    marcas = [
        Marca(dt(LUN, 9), "entrada"),
        Marca(dt(LUN, 17), "salida"),
        # martes: falta
        Marca(dt(LUN + timedelta(2), 9, 25), "entrada", retardo=25),
        Marca(dt(LUN + timedelta(2), 17), "salida"),
    ]
    dias, r = correr(marcas, LUN, LUN + timedelta(6))
    estados = [d.estado for d in dias]
    assert estados == [
        "asistencia",
        "falta",
        "asistencia",
        "falta",
        "falta",
        "descanso",
        "descanso",
    ]
    assert r.asistencias == 2 and r.faltas == 3 and r.retardos == 1 and r.minutos_retardo == 25
    assert r.minutos_trabajados == 480 + 455
    assert r.dias_laborables == 5


def test_horas_extra_dobles_triples_y_exceso():
    # Lunes a jueves salen a las 21:00 (4 h extra c/u) y el viernes a las 23:00 (6 h extra).
    marcas = []
    for i, salida in enumerate([21, 21, 21, 21, 23]):
        d = LUN + timedelta(i)
        marcas += [Marca(dt(d, 9), "entrada"), Marca(dt(d, salida), "salida")]
    dias, r = correr(marcas, LUN, LUN + timedelta(6))
    # 2027: tope de dobles 9 h/semana, máx. 4 h por día → 4 + 4 + 1.
    assert [d.dobles_min for d in dias[:5]] == [240, 240, 60, 0, 0]
    # Triples (art. 68) hasta 4 h/semana; el resto es exceso.
    assert sum(d.triples_min for d in dias) == 240
    assert r.minutos_dobles == 540 and r.minutos_triples == 240
    assert r.minutos_exceso == 22 * 60 - 540 - 240
    assert any("arts. 66 y 68" in o for d in dias for o in d.observaciones)


def test_tope_de_dobles_sube_en_2030():
    lunes = date(2030, 3, 4)
    marcas = []
    for i in range(3):
        d = lunes + timedelta(i)
        marcas += [Marca(dt(d, 9), "entrada"), Marca(dt(d, 21), "salida")]
    _, r = correr(marcas, lunes, lunes + timedelta(6))
    assert r.minutos_dobles == 12 * 60 and r.minutos_triples == 0


def test_extra_minimo_y_redondeo():
    marcas = [Marca(dt(LUN, 9), "entrada"), Marca(dt(LUN, 17, 25), "salida")]
    dias, _ = correr(marcas, LUN, LUN)
    assert dias[0].extra_min == 0  # 25 min < 30
    marcas = [Marca(dt(LUN, 9), "entrada"), Marca(dt(LUN, 18, 50), "salida")]
    dias, _ = correr(marcas, LUN, LUN)
    assert dias[0].extra_min == 90  # 110 min → bloques de 30


def test_domingo_descanso_y_festivo_trabajados():
    dom = LUN + timedelta(6)
    marcas = [Marca(dt(dom, 9), "entrada"), Marca(dt(dom, 15), "salida")]
    marcas += [Marca(dt(LUN, 9), "entrada"), Marca(dt(LUN, 17), "salida")]
    dias, r = correr(marcas, LUN, dom, festivos_={LUN: "Prueba"})
    assert dias[0].estado == "festivo" and dias[0].festivo_trabajado
    assert (
        dias[-1].estado == "descanso" and dias[-1].descanso_trabajado and dias[-1].domingo_trabajado
    )
    assert (r.domingos_trabajados, r.descansos_trabajados, r.festivos_trabajados) == (1, 1, 1)


def test_incidencias_y_politica_de_retardos():
    marcas = []
    for i in range(3):
        d = LUN + timedelta(i)
        marcas += [Marca(dt(d, 9, 20), "entrada", retardo=20), Marca(dt(d, 17), "salida")]
    inc = [Incidencia("vacaciones", LUN + timedelta(3), LUN + timedelta(4))]
    dias, r = correr(marcas, LUN, LUN + timedelta(4), inc, Politica(retardos_por_falta=3))
    assert [d.estado for d in dias[3:]] == ["vacaciones", "vacaciones"]
    assert r.incidencias == {"vacaciones": 2} and r.faltas == 0
    assert r.faltas_por_retardos == 1

    _, r = correr(marcas, LUN, LUN + timedelta(2), politica=Politica(retardo_falta_min=15))
    assert r.faltas == 3


def test_turno_nocturno_y_entrada_sin_salida():
    marcas = [
        Marca(dt(LUN, 22), "entrada"),
        Marca(dt(LUN + timedelta(1), 5), "salida"),
        Marca(dt(LUN + timedelta(1), 22), "entrada"),
    ]
    dias, r = correr(marcas, LUN, LUN + timedelta(1))
    assert dias[0].trabajado_min == 7 * 60  # el par cuenta al día de la entrada
    assert "Entrada sin salida" in dias[1].observaciones and r.sin_salida == 1
