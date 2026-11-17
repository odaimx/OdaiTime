import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, require_roles
from app.core.security import hash_password
from app.models import Empresa, Rol, Usuario
from app.schemas.empresa import EmpresaCreate, EmpresaOut, EmpresaUpdate

# Solo el operador del SaaS administra empresas (clientes).
router = APIRouter(
    prefix="/empresas", tags=["empresas"], dependencies=[Depends(require_roles(Rol.SUPERADMIN))]
)


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

    empresa = Empresa(**data.model_dump(exclude={"admin"}))
    db.add(empresa)
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
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe una empresa con ese RFC") from None
    return empresa


@router.get("/{empresa_id}", response_model=EmpresaOut)
async def obtener(empresa_id: uuid.UUID, db: DB) -> Empresa:
    return await _get(db, empresa_id)


@router.patch("/{empresa_id}", response_model=EmpresaOut)
async def actualizar(empresa_id: uuid.UUID, data: EmpresaUpdate, db: DB) -> Empresa:
    empresa = await _get(db, empresa_id)
    for campo, valor in data.model_dump(exclude_unset=True).items():
        setattr(empresa, campo, valor)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe una empresa con ese RFC") from None
    return empresa
