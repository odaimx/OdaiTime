"""Reglas de jornada de la Ley Federal del Trabajo (arts. 58-69).

Fuente oficial: https://www.diputados.gob.mx/LeyesBiblio/ref/lft.htm (Cámara de Diputados).

- Diurna: entre 6:00 y 20:00, máximo 8 h diarias (art. 61).
- Nocturna: entre 20:00 y 6:00, máximo 7 h.
- Mixta: abarca ambos periodos con menos de 3.5 h nocturnas, máximo 7.5 h.
  Con 3.5 h nocturnas o más se considera nocturna (art. 60).
- Jornada semanal máxima (art. 59, reforma DOF 01-05-2026): baja gradualmente de 48 h (2026)
  a 40 h (2030); 46 h en 2027, 44 h en 2028 y 42 h en 2029, a partir del 1 de enero de cada año.
  Para nocturna y mixta el tope semanal es además 6 veces su jornada diaria.
- Por cada seis días de trabajo, al menos uno de descanso con goce de salario (art. 69).

Las advertencias no bloquean el guardado: el patrón puede pactar horas extra, pero el turno
ordinario no debe rebasar la jornada máxima.
"""

from dataclasses import dataclass
from datetime import date, time
from enum import StrEnum


class TipoJornada(StrEnum):
    DIURNA = "diurna"
    NOCTURNA = "nocturna"
    MIXTA = "mixta"


DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

JORNADA_MAX_MIN = {TipoJornada.DIURNA: 480, TipoJornada.NOCTURNA: 420, TipoJornada.MIXTA: 450}
# Art. 59 y segundo transitorio de la reforma publicada en el DOF el 1 de mayo de 2026.
SEMANA_MAX_HORAS_POR_ANIO = {2026: 48, 2027: 46, 2028: 44, 2029: 42, 2030: 40}


def semana_max_min(tipo: "TipoJornada", anio: int | None = None) -> int:
    """Minutos máximos por semana para el tipo de jornada en ese año."""
    anio = anio or date.today().year
    horas = SEMANA_MAX_HORAS_POR_ANIO.get(anio, 48 if anio < 2026 else 40)
    return min(horas * 60, JORNADA_MAX_MIN[tipo] * 6)


MIXTA_MAX_NOCTURNO_MIN = 210  # 3.5 h

_NOCHE_INICIO = 20 * 60
_NOCHE_FIN = 6 * 60


@dataclass(frozen=True)
class Horario:
    dia_semana: int  # 0 = lunes … 6 = domingo
    entrada: time
    salida: time  # si es menor que la entrada, termina al día siguiente
    comida_minutos: int = 0
    # Segundo bloque del turno quebrado (opcional).
    entrada2: time | None = None
    salida2: time | None = None


def _min(t: time) -> int:
    return t.hour * 60 + t.minute


def duracion(entrada: time, salida: time) -> int:
    """Minutos entre entrada y salida (cruza medianoche si salida <= entrada)."""
    d = _min(salida) - _min(entrada)
    return d if d > 0 else d + 1440


def minutos_nocturnos(entrada: time, salida: time) -> int:
    inicio = _min(entrada)
    return sum(
        1
        for m in range(inicio, inicio + duracion(entrada, salida))
        if m % 1440 >= _NOCHE_INICIO or m % 1440 < _NOCHE_FIN
    )


def bloques(h: Horario) -> list[tuple[int, int]]:
    """Bloques como (inicio, fin) en minutos desde las 0:00 del día de entrada.

    El segundo bloque empieza después del primero (puede cruzar medianoche)."""
    ini1 = _min(h.entrada)
    fin1 = ini1 + duracion(h.entrada, h.salida)
    res = [(ini1, fin1)]
    if h.entrada2 is not None and h.salida2 is not None:
        ini2 = ini1 + (_min(h.entrada2) - ini1) % 1440
        if ini2 < fin1:
            ini2 += 1440
        res.append((ini2, ini2 + duracion(h.entrada2, h.salida2)))
    return res


def validar_bloques(h: Horario) -> str | None:
    """Mensaje de error si el turno quebrado es incongruente; None si está bien."""
    b = bloques(h)
    if len(b) == 2 and b[1][1] - b[0][0] > 1440:
        return "Los dos horarios del día suman más de 24 h"
    return None


def efectivos(h: Horario) -> int:
    return sum(fin - ini for ini, fin in bloques(h)) - h.comida_minutos


def _nocturnos(h: Horario) -> int:
    return sum(
        1
        for ini, fin in bloques(h)
        for m in range(ini, fin)
        if m % 1440 >= _NOCHE_INICIO or m % 1440 < _NOCHE_FIN
    )


def fmt(minutos: int) -> str:
    h, m = divmod(minutos, 60)
    return f"{h} h" if m == 0 else f"{h} h {m} min"


def analizar(
    tipo: TipoJornada, horarios: list[Horario], anio: int | None = None
) -> tuple[int, list[str]]:
    """Devuelve (minutos efectivos por semana, advertencias)."""
    avisos: list[str] = []
    if not horarios:
        return 0, ["El turno no tiene días laborables"]

    maximo = JORNADA_MAX_MIN[tipo]
    for h in sorted(horarios, key=lambda x: x.dia_semana):
        dia = DIAS[h.dia_semana]
        total = sum(fin - ini for ini, fin in bloques(h))
        trabajo = efectivos(h)
        noche = _nocturnos(h)
        dia_min = total - noche

        if trabajo > maximo:
            avisos.append(
                f"{dia}: {fmt(trabajo)} de trabajo; la jornada {tipo} es de máximo "
                f"{fmt(maximo)} (art. 61)"
            )

        if tipo == TipoJornada.DIURNA and noche > 0:
            avisos.append(
                f"{dia}: parte del horario cae entre 20:00 y 6:00, no es diurna (art. 60)"
            )
        elif tipo == TipoJornada.NOCTURNA and dia_min > 0:
            avisos.append(
                f"{dia}: parte del horario cae entre 6:00 y 20:00, no es nocturna (art. 60)"
            )
        elif tipo == TipoJornada.MIXTA:
            if noche == 0 or dia_min == 0:
                avisos.append(f"{dia}: el horario no abarca ambos periodos, no es mixta (art. 60)")
            elif noche >= MIXTA_MAX_NOCTURNO_MIN:
                avisos.append(
                    f"{dia}: {fmt(noche)} en periodo nocturno; con 3 h 30 min o más "
                    "se considera nocturna (art. 60)"
                )

    semana = sum(efectivos(h) for h in horarios)
    anio = anio or date.today().year
    tope = semana_max_min(tipo, anio)
    if semana > tope:
        avisos.append(
            f"{fmt(semana)} por semana; en {anio} el máximo para jornada {tipo} es "
            f"{fmt(tope)} (art. 59)"
        )
    if len(horarios) == 7:
        avisos.append(
            "Sin día de descanso: la LFT exige al menos uno por cada seis de trabajo (art. 69)"
        )

    return semana, avisos
