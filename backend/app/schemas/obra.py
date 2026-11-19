import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import Nombre
from app.schemas.sucursal import SucursalRef

Clave = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9_-]+$")


class ObraBase(BaseModel):
    clave: str = Clave
    nombre: Nombre
    sucursal_id: uuid.UUID
    direccion: str | None = Field(default=None, max_length=300)
    latitud: float | None = Field(default=None, ge=-90, le=90)
    longitud: float | None = Field(default=None, ge=-180, le=180)
    radio_metros: int = Field(default=150, ge=10, le=5000)
    fecha_inicio: date
    fecha_fin: date | None = None


class ObraCreate(ObraBase):
    pass


class ObraUpdate(BaseModel):
    clave: str | None = Field(
        default=None, min_length=1, max_length=20, pattern=r"^[A-Za-z0-9_-]+$"
    )
    nombre: Nombre | None = None
    sucursal_id: uuid.UUID | None = None
    direccion: str | None = Field(default=None, max_length=300)
    latitud: float | None = Field(default=None, ge=-90, le=90)
    longitud: float | None = Field(default=None, ge=-180, le=180)
    radio_metros: int | None = Field(default=None, ge=10, le=5000)
    fecha_inicio: date | None = None
    fecha_fin: date | None = None
    activa: bool | None = None


class ObraOut(ObraBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    activa: bool
    sucursal: SucursalRef
    empleados_asignados: int = 0  # asignados hoy


class EmpleadoMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    numero: str
    nombre_completo: str


class ObraMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    clave: str
    nombre: str


class AsignacionObraOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    obra: ObraMini
    empleado: EmpleadoMini
    fecha_inicio: date
    fecha_fin: date | None


class AsignarIn(BaseModel):
    empleado_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    fecha_inicio: date
    fecha_fin: date | None = None


class AsignacionUpdate(BaseModel):
    fecha_inicio: date | None = None
    fecha_fin: date | None = None
