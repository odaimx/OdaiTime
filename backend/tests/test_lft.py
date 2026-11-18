from datetime import time

from app.services.lft import Horario, TipoJornada, analizar, duracion, minutos_nocturnos


def _semana(entrada, salida, comida=0, dias=range(6)):
    return [Horario(d, time(*entrada), time(*salida), comida) for d in dias]


def test_duracion_cruza_medianoche():
    assert duracion(time(22), time(5)) == 420
    assert duracion(time(8), time(16)) == 480
    assert minutos_nocturnos(time(18), time(22)) == 120
    assert minutos_nocturnos(time(5), time(7)) == 60


def test_tope_semanal_gradual():
    from app.services.lft import semana_max_min

    assert semana_max_min(TipoJornada.DIURNA, 2026) == 48 * 60
    assert semana_max_min(TipoJornada.DIURNA, 2027) == 46 * 60
    assert semana_max_min(TipoJornada.DIURNA, 2030) == 40 * 60
    assert semana_max_min(TipoJornada.DIURNA, 2035) == 40 * 60
    assert semana_max_min(TipoJornada.NOCTURNA, 2026) == 42 * 60  # 6 × 7 h
    assert semana_max_min(TipoJornada.MIXTA, 2028) == 44 * 60

    seis_dias_8h = _semana((9, 0), (18, 0), comida=60)
    assert analizar(TipoJornada.DIURNA, seis_dias_8h, anio=2026)[1] == []
    _, avisos = analizar(TipoJornada.DIURNA, seis_dias_8h, anio=2027)
    assert any("en 2027 el máximo" in a and "46 h" in a and "art. 59" in a for a in avisos)


def test_diurna_correcta():
    semana, avisos = analizar(TipoJornada.DIURNA, _semana((9, 0), (18, 0), comida=60), anio=2026)
    assert semana == 48 * 60
    assert avisos == []


def test_diurna_excedida_y_sin_descanso():
    _, avisos = analizar(TipoJornada.DIURNA, _semana((8, 0), (18, 0), comida=60, dias=range(7)))
    assert any("9 h de trabajo" in a for a in avisos)
    assert any("Sin día de descanso" in a for a in avisos)
    assert any("por semana" in a for a in avisos)


def test_diurna_que_entra_de_noche():
    _, avisos = analizar(TipoJornada.DIURNA, _semana((14, 0), (22, 0)))
    assert any("no es diurna" in a for a in avisos)


def test_nocturna_correcta():
    _, avisos = analizar(TipoJornada.NOCTURNA, _semana((22, 0), (5, 0)))
    assert avisos == []


def test_mixta():
    # 15:00-22:30 con 30 min de comida → 7 h efectivas, 2.5 h nocturnas: mixta válida.
    _, avisos = analizar(TipoJornada.MIXTA, _semana((15, 0), (22, 30), comida=30))
    assert avisos == []
    # 18:00-01:30 → 5.5 h nocturnas: debería ser nocturna.
    _, avisos = analizar(TipoJornada.MIXTA, _semana((18, 0), (1, 30)))
    assert any("se considera nocturna" in a for a in avisos)


def test_sin_dias():
    assert analizar(TipoJornada.DIURNA, []) == (0, ["El turno no tiene días laborables"])


def test_turno_quebrado():
    # 9-14 y 16-19: 8 h efectivas, diurna válida; el descanso no cuenta.
    h = Horario(0, time(9), time(14), 0, time(16), time(19))
    from app.services.lft import bloques, efectivos, validar_bloques

    assert bloques(h) == [(540, 840), (960, 1140)]
    assert efectivos(h) == 480
    assert validar_bloques(h) is None
    semana, avisos = analizar(
        TipoJornada.DIURNA,
        [Horario(d, time(9), time(14), 0, time(16), time(19)) for d in range(6)],
        anio=2026,
    )
    assert semana == 48 * 60 and avisos == []

    # 10-15 y 17-21: 9 h y entra en periodo nocturno.
    _, avisos = analizar(
        TipoJornada.DIURNA, [Horario(0, time(10), time(15), 0, time(17), time(21))]
    )
    assert any("9 h de trabajo" in a for a in avisos)
    assert any("no es diurna" in a for a in avisos)


def test_turno_quebrado_nocturno_cruza_medianoche():
    from app.services.lft import bloques, validar_bloques

    h = Horario(0, time(20), time(23), 0, time(0, 30), time(4, 30))
    assert bloques(h) == [(1200, 1380), (1470, 1710)]
    assert validar_bloques(h) is None
