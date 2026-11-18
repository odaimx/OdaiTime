import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, CurrentUser, require_roles
from app.models import DiaFestivo, EmpresaFestivo, Rol, Usuario
from app.services import calendario

router = APIRouter(prefix="/festivos", tags=["días festivos"])

_LECTURA = (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA, Rol.GERENTE_SUCURSAL)


class FestivoIn(BaseModel):
    fecha: date
    nombre: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=120)]
    tipo: Literal["obligatorio", "opcional"] = "opcional"
    fundamento: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = (
        None
    )


class FestivoUpdate(BaseModel):
    fecha: date | None = None
    nombre: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=120)]
        | None
    ) = None
    tipo: Literal["obligatorio", "opcional"] | None = None
    fundamento: str | None = None


class FestivoOut(BaseModel):
    id: uuid.UUID
    fecha: date
    nombre: str
    tipo: str
    fundamento: str | None
    origen: str  # nacional | empresa
    aplica: bool
    editable: bool


class AplicarIn(BaseModel):
    aplica: bool


def _empresa(user: Usuario, empresa_id: uuid.UUID | None) -> uuid.UUID | None:
    """Empresa de la petición. None = el superadmin trabaja sobre el catálogo nacional."""
    if user.rol == Rol.SUPERADMIN:
        return empresa_id
    return user.empresa_id


def _puede_editar(user: Usuario, f: DiaFestivo) -> bool:
    if f.empresa_id is None:
        return user.rol == Rol.SUPERADMIN
    return user.rol in (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA) and (
        user.rol == Rol.SUPERADMIN or f.empresa_id == user.empresa_id
    )


async def _get(db: DB, user: Usuario, festivo_id: uuid.UUID) -> DiaFestivo:
    f = await db.get(DiaFestivo, festivo_id)
    if f is None or (
        f.empresa_id is not None and user.rol != Rol.SUPERADMIN and f.empresa_id != user.empresa_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Día festivo no encontrado")
    return f


@router.get("", response_model=list[FestivoOut], dependencies=[Depends(require_roles(*_LECTURA))])
async def listar(
    user: CurrentUser, db: DB, anio: int | None = None, empresa_id: uuid.UUID | None = None
) -> list[FestivoOut]:
    anio = anio or date.today().year
    desde, hasta = date(anio, 1, 1), date(anio, 12, 31)
    emp = _empresa(user, empresa_id)
    q = select(DiaFestivo).where(DiaFestivo.fecha.between(desde, hasta))
    q = (
        q.where(DiaFestivo.empresa_id.is_(None) | (DiaFestivo.empresa_id == emp))
        if emp
        else q.where(DiaFestivo.empresa_id.is_(None))
    )
    filas = list(await db.scalars(q.order_by(DiaFestivo.fecha)))
    elegidos = (
        set(
            await db.scalars(
                select(EmpresaFestivo.festivo_id).where(EmpresaFestivo.empresa_id == emp)
            )
        )
        if emp
        else set()
    )
    return [
        FestivoOut(
            id=f.id,
            fecha=f.fecha,
            nombre=f.nombre,
            tipo=f.tipo,
            fundamento=f.fundamento,
            origen="nacional" if f.empresa_id is None else "empresa",
            aplica=f.tipo == "obligatorio" or f.empresa_id is not None or f.id in elegidos,
            editable=_puede_editar(user, f),
        )
        for f in filas
    ]


@router.post(
    "",
    response_model=FestivoOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(Rol.SUPERADMIN, Rol.ADMIN_EMPRESA))],
)
async def crear(
    data: FestivoIn, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> FestivoOut:
    """Superadmin sin empresa: agrega al catálogo nacional (p. ej. la jornada electoral).
    Administrador: agrega un día propio de su empresa (siempre opcional ante la ley)."""
    emp = _empresa(user, empresa_id)
    f = DiaFestivo(
        empresa_id=emp,
        fecha=data.fecha,
        nombre=data.nombre,
        tipo=data.tipo if emp is None else "opcional",
        fundamento=data.fundamento,
    )
    db.add(f)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Ya hay un día festivo en esa fecha"
        ) from None
    return FestivoOut(
        id=f.id,
        fecha=f.fecha,
        nombre=f.nombre,
        tipo=f.tipo,
        fundamento=f.fundamento,
        origen="nacional" if emp is None else "empresa",
        aplica=True,
        editable=True,
    )


@router.patch(
    "/{festivo_id}",
    response_model=FestivoOut,
    dependencies=[Depends(require_roles(Rol.SUPERADMIN, Rol.ADMIN_EMPRESA))],
)
async def actualizar(
    festivo_id: uuid.UUID, data: FestivoUpdate, user: CurrentUser, db: DB
) -> FestivoOut:
    f = await _get(db, user, festivo_id)
    if not _puede_editar(user, f):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "El catálogo nacional lo actualiza Odai")
    for campo, valor in data.model_dump(exclude_unset=True).items():
        if campo == "tipo" and f.empresa_id is not None:
            continue
        if valor is not None or campo == "fundamento":
            setattr(f, campo, valor)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Ya hay un día festivo en esa fecha"
        ) from None
    return FestivoOut(
        id=f.id,
        fecha=f.fecha,
        nombre=f.nombre,
        tipo=f.tipo,
        fundamento=f.fundamento,
        origen="nacional" if f.empresa_id is None else "empresa",
        aplica=True,
        editable=True,
    )


@router.delete(
    "/{festivo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(Rol.SUPERADMIN, Rol.ADMIN_EMPRESA))],
)
async def borrar(festivo_id: uuid.UUID, user: CurrentUser, db: DB) -> None:
    f = await _get(db, user, festivo_id)
    if not _puede_editar(user, f):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "El catálogo nacional lo actualiza Odai")
    await db.delete(f)
    await db.commit()


@router.put(
    "/{festivo_id}/aplicar",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(Rol.SUPERADMIN, Rol.ADMIN_EMPRESA))],
)
async def aplicar(
    festivo_id: uuid.UUID,
    data: AplicarIn,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> None:
    """La empresa decide si otorga un festivo opcional del catálogo nacional."""
    emp = _empresa(user, empresa_id)
    if emp is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Indica empresa_id")
    f = await _get(db, user, festivo_id)
    if f.empresa_id is not None or f.tipo != "opcional":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Solo se eligen los opcionales; los obligatorios del art. 74 aplican siempre",
        )
    await db.execute(
        delete(EmpresaFestivo).where(
            EmpresaFestivo.empresa_id == emp, EmpresaFestivo.festivo_id == f.id
        )
    )
    if data.aplica:
        db.add(EmpresaFestivo(empresa_id=emp, festivo_id=f.id))
    await db.commit()


@router.post(
    "/generar",
    response_model=dict,
    dependencies=[Depends(require_roles(Rol.SUPERADMIN))],
)
async def generar(user: CurrentUser, db: DB, anio: int) -> dict:
    """Carga al catálogo nacional los obligatorios (art. 74) y opcionales comunes de un año.
    No toca las fechas que ya existen (p. ej. ajustes manuales)."""
    if not 2000 <= anio <= 2100:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Año inválido")
    existentes = set(
        await db.scalars(
            select(DiaFestivo.fecha).where(
                DiaFestivo.empresa_id.is_(None),
                DiaFestivo.fecha.between(date(anio, 1, 1), date(anio, 12, 31)),
            )
        )
    )
    creados = 0
    for tipo, dias in (
        ("obligatorio", calendario.festivos(anio)),
        ("opcional", calendario.opcionales(anio)),
    ):
        for f, n in dias.items():
            if f not in existentes:
                db.add(
                    DiaFestivo(
                        empresa_id=None,
                        fecha=f,
                        nombre=n,
                        tipo=tipo,
                        fundamento="Art. 74 LFT" if tipo == "obligatorio" else None,
                    )
                )
                existentes.add(f)
                creados += 1
    await db.commit()
    return {"anio": anio, "creados": creados}
