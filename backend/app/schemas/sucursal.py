import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import Domicilio, Nombre, ZonaHoraria


class SucursalBase(Domicilio):
    clave: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9_-]+$")
    nombre: Nombre
    zona_horaria: ZonaHoraria = "America/Mexico_City"
    direccion: str | None = Field(default=None, max_length=300)
    latitud: float | None = Field(default=None, ge=-90, le=90)
    longitud: float | None = Field(default=None, ge=-180, le=180)
    radio_metros: int = Field(default=150, ge=10, le=5000)
    precision_gps_m: int = Field(default=100, ge=10, le=1000)


class SucursalCreate(SucursalBase):
    pass


class SucursalUpdate(Domicilio):
    clave: str | None = Field(
        default=None, min_length=1, max_length=20, pattern=r"^[A-Za-z0-9_-]+$"
    )
    nombre: Nombre | None = None
    zona_horaria: ZonaHoraria | None = None
    direccion: str | None = Field(default=None, max_length=300)
    latitud: float | None = Field(default=None, ge=-90, le=90)
    longitud: float | None = Field(default=None, ge=-180, le=180)
    radio_metros: int | None = Field(default=None, ge=10, le=5000)
    precision_gps_m: int | None = Field(default=None, ge=10, le=1000)
    activa: bool | None = None


class SucursalOut(SucursalBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    empresa_id: uuid.UUID
    activa: bool


class SucursalRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    clave: str
    nombre: str
