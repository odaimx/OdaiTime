"""Configuración del correo saliente general de Odai (solo superadmin)."""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import DB, CurrentUser, require_roles
from app.core.cifrado import cifrar
from app.models import PlantillaCorreo, Rol
from app.services import correo, plantillas_correo

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
    c = plantillas_correo.armar(
        await plantillas_correo.obtener(db, "prueba"),
        {**plantillas_correo.EJEMPLO, "empresa": "ODAITIME", "usuario_envia": user.nombre},
    )
    ok = await correo.enviar(
        db,
        para=data.para,
        asunto=c.asunto,
        nombre_empresa="ODAITIME",
        titulo=c.titulo,
        parrafos=c.parrafos,
    )
    if not ok:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "No se pudo enviar. Revisa el servidor, el puerto, la seguridad y la contraseña.",
        )
    return {"mensaje": f"Correo enviado a {data.para}"}


# --- Plantillas de correo editables ---


class PlantillaOut(BaseModel):
    clave: str
    nombre: str
    descripcion: str
    asunto: str
    titulo: str
    cuerpo: str
    boton: str | None
    personalizada: bool


class PlantillaIn(BaseModel):
    asunto: str = Field(min_length=1, max_length=200)
    titulo: str = Field(min_length=1, max_length=200)
    cuerpo: str = Field(min_length=1, max_length=4000)
    boton: str | None = Field(default=None, max_length=80)


async def _salida(db: DB, clave: str) -> PlantillaOut:
    p = await plantillas_correo.obtener(db, clave)
    return PlantillaOut(
        clave=clave,
        nombre=p.nombre,
        descripcion=p.descripcion,
        asunto=p.asunto,
        titulo=p.titulo,
        cuerpo=p.cuerpo,
        boton=p.boton,
        personalizada=await db.get(PlantillaCorreo, clave) is not None,
    )


def _clave(clave: str) -> str:
    if clave not in plantillas_correo.FABRICA:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plantilla no encontrada")
    return clave


@router.get("/plantillas")
async def listar_plantillas(db: DB) -> dict:
    return {
        "variables": plantillas_correo.VARIABLES,
        "plantillas": [await _salida(db, k) for k in plantillas_correo.FABRICA],
    }


@router.put("/plantillas/{clave}", response_model=PlantillaOut)
async def guardar_plantilla(clave: str, data: PlantillaIn, db: DB) -> PlantillaOut:
    _clave(clave)
    fila = await db.get(PlantillaCorreo, clave) or PlantillaCorreo(clave=clave)
    fila.asunto, fila.titulo, fila.cuerpo = data.asunto, data.titulo, data.cuerpo
    fila.boton = (data.boton or "").strip() or None
    fila.actualizada = datetime.now(UTC)
    db.add(fila)
    await db.commit()
    return await _salida(db, clave)


@router.delete("/plantillas/{clave}", response_model=PlantillaOut)
async def restablecer_plantilla(clave: str, db: DB) -> PlantillaOut:
    """Vuelve al texto de fábrica."""
    _clave(clave)
    if fila := await db.get(PlantillaCorreo, clave):
        await db.delete(fila)
        await db.commit()
    return await _salida(db, clave)


@router.post("/plantillas/{clave}/vista-previa")
async def vista_previa(clave: str, data: PlantillaIn) -> dict[str, str]:
    """HTML del correo con datos de ejemplo, sin guardar."""
    _clave(clave)
    base = plantillas_correo.FABRICA[clave]
    p = plantillas_correo.Plantilla(
        base.nombre, base.descripcion, data.asunto, data.titulo, data.cuerpo, data.boton
    )
    c = plantillas_correo.armar(p, plantillas_correo.EJEMPLO)
    boton = (c.boton, "https://ejemplo.odai.lat/restablecer?token=…") if c.boton else None
    return {
        "asunto": c.asunto,
        "html": correo.html_correo(
            plantillas_correo.EJEMPLO["empresa"], c.titulo, c.parrafos, boton
        ),
    }
