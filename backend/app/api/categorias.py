"""Categorías (etiquetas) de empleados, sucursales, usuarios y empresas."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from app.api.deps import DB, CurrentUser, empresa_scope, require_roles
from app.models import Categoria, CategoriaRegistro, Rol, Usuario

router = APIRouter(
    prefix="/categorias",
    tags=["categorías"],
    dependencies=[Depends(require_roles(Rol.SUPERADMIN, Rol.ADMIN_EMPRESA, Rol.GERENTE_SUCURSAL))],
)

Modelo = Literal["empleado", "sucursal", "usuario", "empresa"]
_NO = HTTPException(status.HTTP_404_NOT_FOUND, "Categoría no encontrada")


class CategoriaIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=60)
    color: int = Field(default=0, ge=0, le=9)


class CategoriaOut(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    modelo: str
    nombre: str
    color: int
    registros: int = 0


class AsignarIn(BaseModel):
    registro_id: uuid.UUID
    categoria_ids: list[uuid.UUID]


def _dueno(user: Usuario, modelo: str, empresa_id: uuid.UUID | None) -> uuid.UUID | None:
    """Empresa dueña de las categorías: las de empresas son de Odai (None)."""
    if modelo == "empresa":
        if user.rol != Rol.SUPERADMIN:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Solo Odai maneja categorías de empresas"
            )
        return None
    return empresa_scope(user, empresa_id)


def _de(q, dueno: uuid.UUID | None):
    return q.where(
        Categoria.empresa_id.is_(None) if dueno is None else Categoria.empresa_id == dueno
    )


def _puede_editar(user: Usuario) -> None:
    if user.rol not in (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Solo el administrador maneja las categorías"
        )


@router.get("", response_model=list[CategoriaOut])
async def listar(
    modelo: Modelo, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> list[CategoriaOut]:
    dueno = _dueno(user, modelo, empresa_id)
    q = _de(
        select(Categoria, func.count(CategoriaRegistro.registro_id))
        .outerjoin(CategoriaRegistro, CategoriaRegistro.categoria_id == Categoria.id)
        .where(Categoria.modelo == modelo)
        .group_by(Categoria.id),
        dueno,
    ).order_by(Categoria.nombre)
    return [
        CategoriaOut.model_validate(c).model_copy(update={"registros": n})
        for c, n in await db.execute(q)
    ]


@router.get("/asignadas", response_model=dict[uuid.UUID, list[uuid.UUID]])
async def asignadas(
    modelo: Modelo, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Categorías de cada registro del modelo (para las listas)."""
    dueno = _dueno(user, modelo, empresa_id)
    q = _de(
        select(CategoriaRegistro.registro_id, CategoriaRegistro.categoria_id)
        .join(Categoria, Categoria.id == CategoriaRegistro.categoria_id)
        .where(Categoria.modelo == modelo),
        dueno,
    )
    salida: dict[uuid.UUID, list[uuid.UUID]] = {}
    for rid, cid in await db.execute(q):
        salida.setdefault(rid, []).append(cid)
    return salida


@router.post("", response_model=CategoriaOut, status_code=status.HTTP_201_CREATED)
async def crear(
    modelo: Modelo,
    data: CategoriaIn,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> Categoria:
    _puede_editar(user)
    c = Categoria(empresa_id=_dueno(user, modelo, empresa_id), modelo=modelo, **data.model_dump())
    db.add(c)
    await db.commit()
    return c


async def _obtener(
    db: DB, user: Usuario, categoria_id: uuid.UUID, empresa_id: uuid.UUID | None
) -> Categoria:
    c = await db.get(Categoria, categoria_id)
    if c is None or c.empresa_id != _dueno(user, c.modelo, empresa_id):
        raise _NO
    return c


@router.patch("/{categoria_id}", response_model=CategoriaOut)
async def editar(
    categoria_id: uuid.UUID,
    data: CategoriaIn,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> Categoria:
    _puede_editar(user)
    c = await _obtener(db, user, categoria_id, empresa_id)
    c.nombre, c.color = data.nombre, data.color
    await db.commit()
    return c


@router.delete("/{categoria_id}", status_code=status.HTTP_204_NO_CONTENT)
async def borrar(
    categoria_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> None:
    _puede_editar(user)
    await db.delete(await _obtener(db, user, categoria_id, empresa_id))
    await db.commit()


@router.put("/registro", response_model=list[uuid.UUID])
async def asignar(
    modelo: Modelo, data: AsignarIn, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> list[uuid.UUID]:
    """Reemplaza las categorías de un registro."""
    dueno = _dueno(user, modelo, empresa_id)
    validas = set(
        await db.scalars(
            _de(
                select(Categoria.id).where(
                    Categoria.modelo == modelo, Categoria.id.in_(data.categoria_ids)
                ),
                dueno,
            )
        )
    )
    if len(validas) != len(set(data.categoria_ids)):
        raise _NO
    todas = select(Categoria.id).where(Categoria.modelo == modelo)
    await db.execute(
        delete(CategoriaRegistro).where(
            CategoriaRegistro.registro_id == data.registro_id,
            CategoriaRegistro.categoria_id.in_(_de(todas, dueno)),
        )
    )
    for cid in validas:
        db.add(CategoriaRegistro(categoria_id=cid, registro_id=data.registro_id))
    await db.commit()
    return sorted(validas)
