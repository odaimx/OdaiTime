import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.usuario import Rol
from app.schemas.common import Nombre, Password
from app.schemas.sucursal import SucursalRef


class EmpresaRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nombre: str
    logo_version: str | None = None
    fondo_color: str | None = None
    fondo_version: str | None = None


class UsuarioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    nombre: str
    rol: Rol
    activo: bool
    empresa: EmpresaRef | None
    sucursales: list[SucursalRef]
    ultimo_acceso: datetime | None


class UsuarioCreate(BaseModel):
    email: EmailStr
    nombre: Nombre
    password: Password
    rol: Rol
    sucursal_ids: list[uuid.UUID] = []


class UsuarioUpdate(BaseModel):
    nombre: Nombre | None = None
    password: Password | None = None
    rol: Rol | None = None
    activo: bool | None = None
    sucursal_ids: list[uuid.UUID] | None = None
