import uuid
from datetime import date, time

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import Turno
from app.schemas.common import Nombre
from app.services.lft import (
    Horario,
    TipoJornada,
    analizar,
    efectivos,
    semana_max_min,
    validar_bloques,
)


class TurnoDiaIn(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    dia_semana: int = Field(ge=0, le=6)
    entrada: time
    salida: time
    comida_minutos: int = Field(default=0, ge=0, le=180)
    # Turno quebrado: segundo horario del día (ambos o ninguno).
    entrada2: time | None = None
    salida2: time | None = None

    @model_validator(mode="after")
    def _validar(self):
        if self.entrada == self.salida:
            raise ValueError("La entrada y la salida no pueden ser iguales")
        if (self.entrada2 is None) != (self.salida2 is None):
            raise ValueError("El segundo horario necesita entrada y salida")
        if self.entrada2 is not None:
            if self.entrada2 == self.salida2:
                raise ValueError("La entrada y la salida del segundo horario no pueden ser iguales")
            if self.entrada2 == self.salida:
                raise ValueError("Entre los dos horarios debe haber un descanso")
        h = Horario(
            self.dia_semana,
            self.entrada,
            self.salida,
            self.comida_minutos,
            self.entrada2,
            self.salida2,
        )
        if msg := validar_bloques(h):
            raise ValueError(msg)
        if efectivos(h) <= 0:
            raise ValueError("El tiempo de comida no puede ser mayor que la jornada")
        return self


def _dias_unicos(v: list[TurnoDiaIn] | None) -> list[TurnoDiaIn] | None:
    if v is not None and len({d.dia_semana for d in v}) != len(v):
        raise ValueError("Hay días repetidos en el turno")
    return v


class TurnoCreate(BaseModel):
    nombre: Nombre
    tipo_jornada: TipoJornada
    tolerancia_minutos: int = Field(default=10, ge=0, le=120)
    dias: list[TurnoDiaIn] = Field(min_length=1)

    _unicos = field_validator("dias")(_dias_unicos)


class TurnoUpdate(BaseModel):
    nombre: Nombre | None = None
    tipo_jornada: TipoJornada | None = None
    tolerancia_minutos: int | None = Field(default=None, ge=0, le=120)
    dias: list[TurnoDiaIn] | None = Field(default=None, min_length=1)
    activo: bool | None = None

    _unicos = field_validator("dias")(_dias_unicos)


class TurnoOut(BaseModel):
    id: uuid.UUID
    nombre: str
    tipo_jornada: TipoJornada
    tolerancia_minutos: int
    activo: bool
    dias: list[TurnoDiaIn]
    minutos_semana: int
    semana_max_minutos: int  # tope del año en curso (art. 59)
    advertencias: list[str]

    @classmethod
    def de(cls, t: Turno) -> "TurnoOut":
        semana, avisos = analizar(
            t.tipo_jornada,
            [
                Horario(d.dia_semana, d.entrada, d.salida, d.comida_minutos, d.entrada2, d.salida2)
                for d in t.dias
            ],
        )
        return cls(
            id=t.id,
            nombre=t.nombre,
            tipo_jornada=t.tipo_jornada,
            tolerancia_minutos=t.tolerancia_minutos,
            activo=t.activo,
            dias=[TurnoDiaIn.model_validate(d) for d in t.dias],
            minutos_semana=semana,
            semana_max_minutos=semana_max_min(t.tipo_jornada),
            advertencias=avisos,
        )


class TurnoRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nombre: str


class AsignarTurnoIn(BaseModel):
    turno_id: uuid.UUID
    fecha_inicio: date


class AsignacionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    turno: TurnoRef
    fecha_inicio: date
    fecha_fin: date | None
