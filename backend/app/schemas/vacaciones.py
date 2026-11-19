import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

from app.schemas.asistencia import VacacionesOut
from app.schemas.checada import EmpleadoRef
from app.schemas.sucursal import SucursalRef

Texto = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None


class SolicitudIn(BaseModel):
    fecha_inicio: date
    fecha_fin: date
    motivo: Texto = None

    @model_validator(mode="after")
    def _rango(self):
        if self.fecha_fin < self.fecha_inicio:
            raise ValueError("La fecha final no puede ser anterior a la inicial")
        if (self.fecha_fin - self.fecha_inicio).days > 90:
            raise ValueError("Una solicitud no puede abarcar más de 90 días")
        return self


class RespuestaIn(BaseModel):
    comentario: Texto = None


class SolicitudOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    empleado: EmpleadoRef
    fecha_inicio: date
    fecha_fin: date
    dias: int
    motivo: str | None
    estado: str
    comentario: str | None
    respondida_en: datetime | None
    created_at: datetime
    avisos: list[str] = []


class MisVacaciones(BaseModel):
    saldo: VacacionesOut
    pendientes_dias: int  # días en solicitudes pendientes (aún no descontados)
    solicitudes: list[SolicitudOut]


class EmpleadoCalendario(BaseModel):
    id: uuid.UUID
    numero: str
    nombre_completo: str
    sucursal: SucursalRef
    obra: str | None = None


class Ausencia(BaseModel):
    empleado_id: uuid.UUID
    tipo: str  # vacaciones | incapacidad | permiso | ... | solicitud (pendiente)
    etiqueta: str
    fecha_inicio: date
    fecha_fin: date
    pendiente: bool = False


class CalendarioEquipo(BaseModel):
    empleados: list[EmpleadoCalendario]
    ausencias: list[Ausencia]
