import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr

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


class EmpresaUpdate(BaseModel):
    nombre: Nombre | None = None
    razon_social: str | None = None
    rfc: RFC | None = None
    activa: bool | None = None


class EmpresaOut(EmpresaBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    activa: bool
    created_at: datetime
