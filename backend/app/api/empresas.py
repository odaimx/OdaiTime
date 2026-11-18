import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, require_roles
from app.core.config import get_settings
from app.core.security import hash_password
from app.core.tenant import slugify
from app.models import Checada, Empleado, Empresa, Rol, Usuario
from app.schemas.empresa import EmpresaCreate, EmpresaOut, EmpresaUpdate

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
    if cambios.get("demo", False) is None:
        cambios.pop("demo")
    for campo, valor in cambios.items():
        setattr(empresa, campo, valor)
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
    checadas = await db.scalar(
        select(func.count()).select_from(Checada).where(Checada.empresa_id == empresa.id)
    )
    if checadas and not empresa.demo:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{empresa.nombre} ya tiene checadas registradas. Desactívala en su lugar.",
        )
    # Primero los empleados (con sus checadas y asignaciones) para no chocar con las
    # referencias a sucursales y turnos al borrar en cascada.
    await db.execute(delete(Empleado).where(Empleado.empresa_id == empresa.id))
    await db.delete(empresa)
    await db.commit()
