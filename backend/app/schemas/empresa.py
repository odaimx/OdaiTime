import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.common import RFC, Nombre, Password


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
    max_empleados: int | None = Field(default=None, ge=1, le=100000)
    licencia_vence: date | None = None


class EmpresaUpdate(BaseModel):
    nombre: Nombre | None = None
    razon_social: str | None = None
    rfc: RFC | None = None
    activa: bool | None = None
    max_empleados: int | None = Field(default=None, ge=1, le=100000)
    licencia_vence: date | None = None


class EmpresaOut(EmpresaBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    activa: bool
    max_empleados: int
    licencia_vence: date | None
    created_at: datetime
