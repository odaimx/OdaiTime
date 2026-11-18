"""Días de descanso obligatorio (art. 74) y vacaciones (art. 76) de la LFT.

Fuente oficial: https://www.diputados.gob.mx/LeyesBiblio/ref/lft.htm
"""

from datetime import date, timedelta


def _n_lunes(anio: int, mes: int, n: int) -> date:
    d = date(anio, mes, 1)
    primer_lunes = d + timedelta(days=(7 - d.weekday()) % 7)
    return primer_lunes + timedelta(weeks=n - 1)


def festivos(anio: int) -> dict[date, str]:
    """Días de descanso obligatorio del art. 74 (sin la jornada electoral, que se agrega aparte)."""
    dias = {
        date(anio, 1, 1): "Año Nuevo",
        _n_lunes(anio, 2, 1): "Día de la Constitución (primer lunes de febrero)",
        _n_lunes(anio, 3, 3): "Natalicio de Benito Juárez (tercer lunes de marzo)",
        date(anio, 5, 1): "Día del Trabajo",
        date(anio, 9, 16): "Día de la Independencia",
        _n_lunes(anio, 11, 3): "Revolución Mexicana (tercer lunes de noviembre)",
        date(anio, 12, 25): "Navidad",
    }
    # 1 de octubre, cada seis años, por la transmisión del Poder Ejecutivo Federal (2024, 2030…).
    if anio >= 2024 and (anio - 2024) % 6 == 0:
        dias[date(anio, 10, 1)] = "Transmisión del Poder Ejecutivo Federal"
    return dias


def festivos_en(desde: date, hasta: date) -> dict[date, str]:
    res: dict[date, str] = {}
    for anio in range(desde.year, hasta.year + 1):
        res.update({d: n for d, n in festivos(anio).items() if desde <= d <= hasta})
    return res


def dias_vacaciones(anios_cumplidos: int) -> int:
    """Art. 76 (reforma "vacaciones dignas", DOF 27-12-2022).

    1er año: 12 días; +2 por año hasta 20 (5º año); a partir del 6º, +2 cada cinco años.
    """
    if anios_cumplidos < 1:
        return 0
    if anios_cumplidos <= 5:
        return 12 + 2 * (anios_cumplidos - 1)
    return 22 + 2 * ((anios_cumplidos - 6) // 5)


def anios_cumplidos(ingreso: date, al: date) -> int:
    n = al.year - ingreso.year
    if (al.month, al.day) < (ingreso.month, ingreso.day):
        n -= 1
    return max(n, 0)


def aniversario(ingreso: date, anio: int) -> date:
    try:
        return ingreso.replace(year=anio)
    except ValueError:  # 29 de febrero
        return date(anio, 2, 28)
