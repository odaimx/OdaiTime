import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.checada import EmpleadoRef
from app.schemas.sucursal import SucursalRef

TipoIncidencia = Literal[
    "vacaciones", "incapacidad", "permiso_con_goce", "permiso_sin_goce", "falta_justificada"
]


class PoliticaIn(BaseModel):
    retardos_por_falta: int = Field(default=0, ge=0, le=31)
    retardo_falta_min: int = Field(default=0, ge=0, le=480)
    minimo_extra_min: int = Field(default=30, ge=0, le=240)
    redondeo_extra_min: int = Field(default=30, ge=1, le=120)
    festivo_opcional_pago: Literal["doble", "normal"] = "doble"


class PoliticaOut(PoliticaIn):
    model_config = ConfigDict(from_attributes=True)


class ResumenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    dias_laborables: int
    asistencias: int
    faltas: int
    faltas_por_retardos: int
    retardos: int
    minutos_retardo: int
    minutos_trabajados: int
    minutos_dobles: int
    minutos_triples: int
    minutos_exceso: int
    domingos_trabajados: int
    descansos_trabajados: int
    festivos_trabajados: int
    incidencias: dict[str, int]
    sin_salida: int


class Concepto(BaseModel):
    clave: str
    descripcion: str
    unidad: str
    cantidad: float


class FilaResumen(BaseModel):
    empleado: EmpleadoRef
    sucursal: SucursalRef
    resumen: ResumenOut
    conceptos: list[Concepto] = []


class DiaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    fecha: date
    estado: str
    esperado_min: int
    trabajado_min: int
    retardo_min: int
    retardos: int
    extra_min: int
    dobles_min: int
    triples_min: int
    exceso_min: int
    festivo: str | None
    festivo_obligatorio: bool
    domingo_trabajado: bool
    descanso_trabajado: bool
    festivo_trabajado: bool
    entradas: list[datetime]
    salidas: list[datetime]
    observaciones: list[str]


class DetalleAsistencia(BaseModel):
    empleado: EmpleadoRef
    sucursal: SucursalRef
    zona_horaria: str
    dias: list[DiaOut]
    resumen: ResumenOut
    conceptos: list[Concepto] = []


class IncidenciaIn(BaseModel):
    empleado_id: uuid.UUID
    tipo: TipoIncidencia
    fecha_inicio: date
    fecha_fin: date
    notas: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None = None
    folio: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] | None = None

    @model_validator(mode="after")
    def _rango(self):
        if self.fecha_fin < self.fecha_inicio:
            raise ValueError("La fecha final no puede ser anterior a la inicial")
        if (self.fecha_fin - self.fecha_inicio).days > 365:
            raise ValueError("Una incidencia no puede durar más de un año")
        return self


class IncidenciaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    empleado: EmpleadoRef
    tipo: str
    fecha_inicio: date
    fecha_fin: date
    notas: str | None
    folio: str | None
    created_at: datetime


class VacacionesOut(BaseModel):
    antiguedad_anios: int
    periodo_inicio: date
    periodo_fin: date
    dias_correspondientes: int
    dias_tomados: int
    dias_disponibles: int
    proximo_aniversario: date
    dias_proximo_periodo: int
