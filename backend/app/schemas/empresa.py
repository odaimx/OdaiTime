import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, computed_field

from app.core.tenant import SLUG_RE, reservados, url_empresa
from app.schemas.common import RFC, Domicilio, Nombre, Password


def _slug(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip().lower()
    if not SLUG_RE.match(v):
        raise ValueError(
            "El subdominio debe tener de 3 a 40 caracteres: letras minúsculas, números y guiones"
        )
    if v in reservados():
        raise ValueError("Ese subdominio está reservado")
    return v


Slug = Annotated[str, AfterValidator(_slug)]
Estado = Literal["corriendo", "suspendida", "eliminada"]
Periodicidad = Literal["mensual", "bimestral", "trimestral", "semestral", "anual"]


class EmpresaBase(Domicilio):
    nombre: Nombre
    razon_social: str | None = None
    rfc: RFC | None = None
    direccion: str | None = Field(default=None, max_length=300)


class AdminInicial(BaseModel):
    nombre: Nombre
    email: EmailStr
    password: Password


class EmpresaCreate(EmpresaBase):
    admin: AdminInicial
    slug: Slug | None = None  # si no se indica, se genera del nombre
    max_empleados: int | None = Field(default=None, ge=1, le=100000)
    licencia_vence: date | None = None
    demo: bool = False
    max_usuarios: int = Field(default=5, ge=0, le=1000)


class EmpresaUpdate(Domicilio):
    nombre: Nombre | None = None
    slug: Slug | None = None
    razon_social: str | None = None
    rfc: RFC | None = None
    direccion: str | None = Field(default=None, max_length=300)
    activa: bool | None = None
    max_empleados: int | None = Field(default=None, ge=1, le=100000)
    licencia_vence: date | None = None
    demo: bool | None = None
    max_usuarios: int | None = Field(default=None, ge=0, le=1000)
    estado: Estado | None = None
    motivo_suspension: str | None = Field(default=None, max_length=300)
    periodicidad: Periodicidad | None = None
    referencia_odoo: str | None = Field(default=None, max_length=100)


class EmpresaOut(EmpresaBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    activa: bool
    max_empleados: int
    licencia_vence: date | None
    demo: bool = False
    max_usuarios: int = 5
    estado: str = "corriendo"
    motivo_suspension: str | None = None
    periodicidad: str | None = None
    referencia_odoo: str | None = None
    estado_cambiado_en: datetime | None = None
    created_at: datetime
    logo_version: str | None = None
    fondo_color: str | None = None
    fondo_version: str | None = None

    @computed_field
    @property
    def url(self) -> str | None:
        return url_empresa(self.slug)
