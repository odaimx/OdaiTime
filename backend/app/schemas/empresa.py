import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, computed_field

from app.core.tenant import SLUG_RE, reservados, url_empresa
from app.schemas.common import RFC, Nombre, Password


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


class EmpresaBase(BaseModel):
    nombre: Nombre
    razon_social: str | None = None
    rfc: RFC | None = None


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


class EmpresaUpdate(BaseModel):
    nombre: Nombre | None = None
    slug: Slug | None = None
    razon_social: str | None = None
    rfc: RFC | None = None
    activa: bool | None = None
    max_empleados: int | None = Field(default=None, ge=1, le=100000)
    licencia_vence: date | None = None
    demo: bool | None = None


class EmpresaOut(EmpresaBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    activa: bool
    max_empleados: int
    licencia_vence: date | None
    demo: bool = False
    created_at: datetime
    logo_version: str | None = None
    fondo_color: str | None = None
    fondo_version: str | None = None

    @computed_field
    @property
    def url(self) -> str | None:
        return url_empresa(self.slug)
