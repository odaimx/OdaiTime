import re
import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    EmailStr,
    Field,
    StringConstraints,
)

from app.models import Empleado
from app.schemas.common import RFC, Nombre, Password
from app.schemas.sucursal import SucursalRef
from app.schemas.turno import AsignacionOut, TurnoRef

CURP_RE = re.compile(r"^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$")


def _vacio_a_none(v):
    """Los formularios y Excel mandan "" para campos vacíos."""
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def _curp(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.upper()
    if not CURP_RE.match(v):
        raise ValueError("CURP inválida")
    return v


def _nss(v: str | None) -> str | None:
    if v is None:
        return v
    v = re.sub(r"\D", "", v)
    if len(v) != 11:
        raise ValueError("El NSS debe tener 11 dígitos")
    return v


Opt = BeforeValidator(_vacio_a_none)
Texto = Annotated[Annotated[str, StringConstraints(max_length=100)] | None, Opt]
CURP = Annotated[str | None, Opt, AfterValidator(_curp)]
NSS = Annotated[str | None, Opt, AfterValidator(_nss)]
RFCOpt = Annotated[RFC | None, Opt]
EmailOpt = Annotated[EmailStr | None, Opt]
Telefono = Annotated[Annotated[str, StringConstraints(max_length=20)] | None, Opt]
NumeroEmpleado = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20, pattern=r"^[\w-]+$")
]
PIN = Annotated[Annotated[str, StringConstraints(pattern=r"^\d{4,6}$")] | None, Opt]
Salario = Annotated[
    Annotated[Decimal, Field(ge=0, le=Decimal("99999999.99"), decimal_places=2)] | None, Opt
]


Medio = Literal["movil", "kiosco", "biometrico", "whatsapp"]


class EmpleadoCreate(BaseModel):
    numero: NumeroEmpleado
    nombre: Nombre
    apellido_paterno: Nombre
    apellido_materno: Texto = None
    curp: CURP = None
    rfc: RFCOpt = None
    nss: NSS = None
    fecha_ingreso: date
    puesto: Texto = None
    departamento: Texto = None
    salario_diario: Salario = None
    email: EmailOpt = None
    telefono: Telefono = None
    sucursal_id: uuid.UUID
    # Turno inicial (vigente desde la fecha de ingreso).
    turno_id: uuid.UUID | None = None
    pin: PIN = None
    # None = según la configuración de checadas de su sucursal.
    medios_checado: list[Medio] | None = None
    dispositivos_checado: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class EmpleadoUpdate(BaseModel):
    numero: NumeroEmpleado | None = None
    nombre: Nombre | None = None
    apellido_paterno: Nombre | None = None
    apellido_materno: Texto = None
    curp: CURP = None
    rfc: RFCOpt = None
    nss: NSS = None
    fecha_ingreso: date | None = None
    puesto: Texto = None
    departamento: Texto = None
    salario_diario: Salario = None
    email: EmailOpt = None
    telefono: Telefono = None
    sucursal_id: uuid.UUID | None = None
    pin: PIN = None  # "" o null quita el PIN
    medios_checado: list[Medio] | None = None  # null = según su sucursal
    dispositivos_checado: list[uuid.UUID] | None = Field(default=None, max_length=50)


class EmpleadoOut(BaseModel):
    id: uuid.UUID
    numero: str
    nombre: str
    apellido_paterno: str
    apellido_materno: str | None
    nombre_completo: str
    curp: str | None
    rfc: str | None
    nss: str | None
    fecha_ingreso: date
    puesto: str | None
    departamento: str | None
    salario_diario: Decimal | None
    email: str | None
    telefono: str | None
    sucursal: SucursalRef
    turno_actual: TurnoRef | None
    tiene_acceso: bool
    # Acceso al portal del trabajador activo (su usuario existe y está activo).
    portal: bool = False
    portal_email: str | None = None
    tiene_pin: bool
    medios_checado: list[str] | None = None
    dispositivos_checado: list[uuid.UUID] = []
    foto_version: str | None  # cambia al actualizar la foto (sirve para refrescar caché)
    activo: bool
    fecha_baja: date | None
    motivo_baja: str | None

    @classmethod
    def de(cls, e: Empleado) -> "EmpleadoOut":
        actual = e.turno_en(date.today())
        return cls(
            **{k: getattr(e, k) for k in cls.model_fields if hasattr(e, k) and k != "sucursal"},
            sucursal=SucursalRef.model_validate(e.sucursal),
            turno_actual=TurnoRef.model_validate(actual.turno) if actual else None,
            tiene_acceso=e.usuario_id is not None,
            portal=e.usuario is not None and e.usuario.activo,
            portal_email=e.usuario.email if e.usuario else None,
            tiene_pin=e.pin_hash is not None,
            foto_version=e.foto_actualizada.isoformat() if e.foto_actualizada else None,
        )


class EmpleadoDetalle(EmpleadoOut):
    asignaciones: list[AsignacionOut]

    @classmethod
    def de(cls, e: Empleado) -> "EmpleadoDetalle":
        base = EmpleadoOut.de(e).model_dump()
        return cls(**base, asignaciones=[AsignacionOut.model_validate(a) for a in e.asignaciones])


class BajaIn(BaseModel):
    fecha_baja: date
    motivo: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=300)]


class AccesoIn(BaseModel):
    email: EmailStr
    password: Password


class ImportResultado(BaseModel):
    creados: int
    errores: list[dict]
