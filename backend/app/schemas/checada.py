import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.common import Nombre
from app.schemas.sucursal import SucursalRef


class ConfigIn(BaseModel):
    permitir_movil: bool = True
    permitir_kiosco: bool = True
    validar_gps: bool = True
    validar_qr: bool = False
    foto: Literal["ninguna", "movil", "kiosco", "ambos"] = "ninguna"
    pin_kiosco: bool = True
    minutos_antes_entrada: int = Field(default=60, ge=0, le=720)
    ignorar_repetida_min: int = Field(default=5, ge=0, le=120)
    permitir_offline: bool = True
    offline_max_horas: int = Field(default=24, ge=1, le=168)


class ConfigGuardar(ConfigIn):
    sucursal_id: uuid.UUID | None = None  # None = configuración general


class ConfigOut(ConfigIn):
    model_config = ConfigDict(from_attributes=True)

    sucursal_id: uuid.UUID | None
    origen: str  # sucursal | general | predeterminada


class EmpleadoRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    numero: str
    nombre_completo: str
    foto_actualizada: datetime | None = None


class ChecadaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tipo: str
    momento: datetime
    origen: str
    offline: bool
    distancia_m: int | None
    retardo_minutos: int | None
    estado: str
    corregida: bool
    tiene_foto: bool
    empleado: EmpleadoRef
    sucursal: SucursalRef

    @classmethod
    def de(cls, c) -> "ChecadaOut":
        return cls(
            id=c.id,
            tipo=c.tipo,
            momento=c.momento,
            origen=c.origen,
            offline=c.offline,
            distancia_m=c.distancia_m,
            retardo_minutos=c.retardo_minutos,
            estado=c.estado,
            corregida=c.corregida,
            tiene_foto=c.foto is not None,
            empleado=EmpleadoRef.model_validate(c.empleado),
            sucursal=SucursalRef.model_validate(c.sucursal),
        )


class SucursalChecar(BaseModel):
    id: uuid.UUID
    clave: str
    nombre: str
    zona_horaria: str
    latitud: float | None
    longitud: float | None
    radio_metros: int


class BloqueOut(BaseModel):
    entrada: datetime
    salida: datetime


class TurnoHoyOut(BaseModel):
    nombre: str
    entrada: datetime
    salida: datetime
    tolerancia_minutos: int
    bloques: list[BloqueOut]


class Requisitos(BaseModel):
    gps: bool
    foto: bool
    qr: bool


class EstadoHoy(BaseModel):
    empleado: EmpleadoRef
    sucursal: SucursalChecar
    turno: TurnoHoyOut | None
    siguiente_tipo: str
    permitir_movil: bool
    permitir_offline: bool
    requiere: Requisitos
    checadas_hoy: list[ChecadaOut]
    hora_servidor: datetime


Motivo = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=300)]


class ManualIn(BaseModel):
    empleado_id: uuid.UUID
    tipo: Literal["entrada", "salida"]
    momento: datetime
    motivo: Motivo


class CorreccionIn(BaseModel):
    tipo: Literal["entrada", "salida"] | None = None
    momento: datetime | None = None
    estado: Literal["valida", "anulada"] | None = None
    motivo: Motivo


class RangoFechas(BaseModel):
    desde: date
    hasta: date


# --- Dispositivos ---


class DispositivoIn(BaseModel):
    nombre: Nombre
    sucursal_id: uuid.UUID
    tipo: Literal["kiosco", "biometrico"] = "kiosco"
    serie: str | None = Field(default=None, max_length=60)


class DispositivoUpdate(BaseModel):
    nombre: Nombre | None = None
    activo: bool | None = None


class DispositivoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nombre: str
    tipo: str
    serie: str | None
    sucursal: SucursalRef
    activo: bool
    vinculado: bool
    ultima_conexion: datetime | None
    codigo_vinculacion: str | None
    codigo_expira: datetime | None

    @classmethod
    def de(cls, d) -> "DispositivoOut":
        pendiente = d.codigo_vinculacion is not None
        return cls(
            id=d.id,
            nombre=d.nombre,
            tipo=d.tipo,
            serie=d.serie,
            sucursal=SucursalRef.model_validate(d.sucursal),
            activo=d.activo,
            vinculado=d.token_hash is not None,
            ultima_conexion=d.ultima_conexion,
            codigo_vinculacion=d.codigo_vinculacion if pendiente else None,
            codigo_expira=d.codigo_expira if pendiente else None,
        )


# --- Bitácora ---


class UsuarioMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nombre: str


class ActividadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tipo: str
    mensaje: str | None
    cambios: list[dict] | None
    usuario: UsuarioMini | None
    created_at: datetime


class NotaIn(BaseModel):
    modelo: str
    registro_id: uuid.UUID
    mensaje: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
