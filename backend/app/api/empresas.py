import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, require_roles
from app.core.config import get_settings
from app.core.security import hash_password
from app.core.tenant import slugify
from app.models import Checada, Empleado, Empresa, Rol, Sucursal, Usuario
from app.schemas.common import Nombre, Password
from app.schemas.empresa import EmpresaCreate, EmpresaOut, EmpresaUpdate
from app.schemas.usuario import UsuarioOut
from app.services import accesos, estado_empresa, uso

# Solo el operador del SaaS administra empresas (clientes).
router = APIRouter(
    prefix="/empresas", tags=["empresas"], dependencies=[Depends(require_roles(Rol.SUPERADMIN))]
)


async def _slug_libre(db: DB, base: str) -> str:
    """Primer slug disponible: base, base-2, base-3…"""
    existentes = set(await db.scalars(select(Empresa.slug).where(Empresa.slug.like(f"{base}%"))))
    if base not in existentes:
        return base
    n = 2
    while f"{base[:36]}-{n}" in existentes:
        n += 1
    return f"{base[:36]}-{n}"


async def _get(db: DB, empresa_id: uuid.UUID) -> Empresa:
    empresa = await db.get(Empresa, empresa_id)
    if empresa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empresa no encontrada")
    return empresa


@router.get("", response_model=list[EmpresaOut])
async def listar(db: DB) -> list[Empresa]:
    return list(await db.scalars(select(Empresa).order_by(Empresa.nombre)))


@router.post("", response_model=EmpresaOut, status_code=status.HTTP_201_CREATED)
async def crear(data: EmpresaCreate, db: DB) -> Empresa:
    """Da de alta una empresa cliente junto con su primer administrador."""
    email = data.admin.email.lower()
    if await db.scalar(select(func.count()).where(func.lower(Usuario.email) == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un usuario con ese correo")

    if data.slug:
        if await db.scalar(select(func.count()).where(Empresa.slug == data.slug)):
            raise HTTPException(status.HTTP_409_CONFLICT, "Ese subdominio ya está en uso")
        slug = data.slug
    else:
        slug = await _slug_libre(db, slugify(data.nombre))

    empresa = Empresa(**data.model_dump(exclude={"admin", "max_empleados", "slug"}), slug=slug)
    empresa.max_empleados = data.max_empleados or get_settings().licencia_max_empleados_default
    db.add(empresa)
    try:
        await db.flush()
        db.add(
            Usuario(
                empresa_id=empresa.id,
                email=email,
                nombre=data.admin.nombre,
                password_hash=hash_password(data.admin.password),
                rol=Rol.ADMIN_EMPRESA,
            )
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Ya existe una empresa con ese RFC o subdominio"
        ) from None
    return empresa


@router.get("/{empresa_id}", response_model=EmpresaOut)
async def obtener(empresa_id: uuid.UUID, db: DB) -> Empresa:
    return await _get(db, empresa_id)


@router.patch("/{empresa_id}", response_model=EmpresaOut)
async def actualizar(empresa_id: uuid.UUID, data: EmpresaUpdate, db: DB) -> Empresa:
    empresa = await _get(db, empresa_id)
    cambios = data.model_dump(exclude_unset=True)
    if cambios.get("max_empleados", 0) is None:
        cambios.pop("max_empleados")
    for campo in ("demo", "max_usuarios"):
        if campo in cambios and cambios[campo] is None:
            cambios.pop(campo)
    # El estado manda sobre "activa" (que se conserva por compatibilidad).
    activa = cambios.pop("activa", None)
    estado = cambios.pop("estado", None) or (
        None if activa is None else ("corriendo" if activa else "suspendida")
    )
    motivo = cambios.pop("motivo_suspension", empresa.motivo_suspension)
    for campo, valor in cambios.items():
        setattr(empresa, campo, valor)
    if estado is not None or motivo != empresa.motivo_suspension:
        estado_empresa.aplicar(empresa, estado or empresa.estado, motivo)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Ya existe una empresa con ese RFC o subdominio"
        ) from None
    return empresa


@router.delete("/{empresa_id}", status_code=status.HTTP_204_NO_CONTENT)
async def eliminar(empresa_id: uuid.UUID, db: DB) -> None:
    """Borra una empresa con todos sus datos. Si tiene checadas, solo se permite si es demo."""
    empresa = await _get(db, empresa_id)
    if not empresa.demo:  # una demo se borra completa al terminar la presentación
        uso.bloquear_si_se_usa(
            f"la empresa {empresa.nombre}",
            [
                (
                    await uso.contar(db, Empleado.empresa_id, empresa.id),
                    "empleado",
                    "empleados",
                    "Empleados",
                ),
                (
                    await uso.contar(db, Sucursal.empresa_id, empresa.id),
                    "sucursal",
                    "sucursales",
                    "Sucursales",
                ),
                (
                    await uso.contar(db, Checada.empresa_id, empresa.id),
                    "checada",
                    "checadas",
                    "Asistencias",
                ),
            ],
            "desactívala",
        )
    # Primero los empleados (con sus checadas y asignaciones) para no chocar con las
    # referencias a sucursales y turnos al borrar en cascada.
    await db.execute(delete(Empleado).where(Empleado.empresa_id == empresa.id))
    await db.delete(empresa)
    await db.commit()


# --- Administrador de la empresa (uno por empresa; lo asigna Odai) ---


class AdministradorIn(BaseModel):
    nombre: Nombre
    email: EmailStr
    password: Password | None = None  # obligatoria solo si la empresa aún no tiene administrador


async def _administrador(db: DB, empresa_id: uuid.UUID) -> Usuario | None:
    return await db.scalar(
        select(Usuario)
        .where(Usuario.empresa_id == empresa_id, Usuario.rol == Rol.ADMIN_EMPRESA)
        .order_by(Usuario.created_at)
        .limit(1)
    )


@router.get("/{empresa_id}/administrador", response_model=UsuarioOut | None)
async def ver_administrador(empresa_id: uuid.UUID, db: DB) -> Usuario | None:
    await _get(db, empresa_id)
    return await _administrador(db, empresa_id)


@router.put("/{empresa_id}/administrador", response_model=UsuarioOut)
async def guardar_administrador(empresa_id: uuid.UUID, data: AdministradorIn, db: DB) -> Usuario:
    """Crea o actualiza al único administrador de la empresa."""
    await _get(db, empresa_id)
    admin = await _administrador(db, empresa_id)
    email = data.email.lower()
    otro = await db.scalar(select(Usuario).where(func.lower(Usuario.email) == email))
    if otro is not None and (admin is None or otro.id != admin.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un usuario con ese correo")
    if admin is None:
        if not data.password:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Escribe una contraseña para el administrador"
            )
        admin = Usuario(
            empresa_id=empresa_id,
            email=email,
            nombre=data.nombre,
            password_hash=hash_password(data.password),
            rol=Rol.ADMIN_EMPRESA,
        )
        db.add(admin)
    else:
        admin.nombre = data.nombre
        admin.email = email
        admin.activo = True
        if data.password:
            admin.password_hash = hash_password(data.password)
    await db.commit()
    await db.refresh(admin, attribute_names=["empresa", "sucursales"])
    return admin


@router.post("/{empresa_id}/administrador/acceso", status_code=status.HTTP_202_ACCEPTED)
async def enviar_acceso_administrador(
    empresa_id: uuid.UUID, request: Request, db: DB
) -> dict[str, str]:
    """Manda al administrador el enlace para crear o cambiar su contraseña."""
    admin = await _administrador(db, empresa_id)
    if admin is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "La empresa aún no tiene administrador")
    enviado, enlace = await accesos.enviar_enlace(db, request, admin, "recuperar")
    await db.commit()
    if enviado:
        return {"mensaje": f"Se envió el enlace a {admin.email}.", "enlace": ""}
    return {
        "mensaje": "No hay correo saliente configurado; comparte este enlace.",
        "enlace": enlace,
    }
