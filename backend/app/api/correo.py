"""Configuración del correo saliente general de Odai (solo superadmin)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import DB, CurrentUser, require_roles
from app.core.cifrado import cifrar
from app.models import Rol
from app.services import correo

router = APIRouter(
    prefix="/correo",
    tags=["correo saliente"],
    dependencies=[Depends(require_roles(Rol.SUPERADMIN))],
)


class CorreoOut(BaseModel):
    host: str
    puerto: int
    seguridad: str
    usuario: str
    remitente: str
    activo: bool
    tiene_password: bool


class CorreoIn(BaseModel):
    host: str = Field(max_length=200)
    puerto: int = Field(ge=1, le=65535)
    seguridad: Literal["starttls", "ssl", "ninguna"]
    usuario: str = Field(default="", max_length=200)
    # Vacío = conservar la contraseña guardada.
    password: str | None = Field(default=None, max_length=300)
    remitente: EmailStr
    activo: bool


class PruebaIn(BaseModel):
    para: EmailStr


def _out(c) -> CorreoOut:
    return CorreoOut(
        host=c.host,
        puerto=c.puerto,
        seguridad=c.seguridad,
        usuario=c.usuario,
        remitente=c.remitente,
        activo=c.activo,
        tiene_password=bool(c.password),
    )


@router.get("", response_model=CorreoOut)
async def ver(db: DB) -> CorreoOut:
    c = await correo.config(db)
    await db.commit()
    return _out(c)


@router.put("", response_model=CorreoOut)
async def guardar(data: CorreoIn, db: DB) -> CorreoOut:
    c = await correo.config(db)
    for k, v in data.model_dump(exclude={"password"}).items():
        setattr(c, k, v)
    if data.password:
        c.password = cifrar(data.password)  # nunca se guarda en claro
    await db.commit()
    return _out(c)


@router.post("/prueba")
async def prueba(data: PruebaIn, user: CurrentUser, db: DB) -> dict[str, str]:
    ok = await correo.enviar(
        db,
        para=data.para,
        asunto="Prueba de correo de ODAITIME",
        nombre_empresa="ODAITIME",
        titulo="¡Funciona!",
        parrafos=[f"Este es un correo de prueba enviado por {user.nombre}."],
    )
    if not ok:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "No se pudo enviar. Revisa el servidor, el puerto, la seguridad y la contraseña.",
        )
    return {"mensaje": f"Correo enviado a {data.para}"}
