import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, empresa_scope, require_roles
from app.models import Dispositivo, Rol, Sucursal
from app.schemas.checada import DispositivoIn, DispositivoOut, DispositivoUpdate
from app.services import bitacora
from app.services import checadas as svc

router = APIRouter(
    prefix="/dispositivos",
    tags=["dispositivos"],
    dependencies=[Depends(require_roles(Rol.SUPERADMIN, Rol.ADMIN_EMPRESA))],
)

CODIGO_VIGENCIA = timedelta(minutes=15)


def _nuevo_codigo(d: Dispositivo) -> None:
    d.codigo_vinculacion = svc.nuevo_codigo()
    d.codigo_expira = datetime.now(UTC) + CODIGO_VIGENCIA
    d.token_hash = None  # un dispositivo re-vinculado deja de funcionar con el token anterior
    d.vinculado_en = None


async def _get(db: DB, dispositivo_id: uuid.UUID, emp: uuid.UUID) -> Dispositivo:
    d = await db.scalar(
        select(Dispositivo).where(Dispositivo.id == dispositivo_id, Dispositivo.empresa_id == emp)
    )
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dispositivo no encontrado")
    return d


@router.get("", response_model=list[DispositivoOut])
async def listar(
    user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> list[DispositivoOut]:
    emp = empresa_scope(user, empresa_id)
    filas = await db.scalars(
        select(Dispositivo).where(Dispositivo.empresa_id == emp).order_by(Dispositivo.nombre)
    )
    return [DispositivoOut.de(d) for d in filas]


@router.post("", response_model=DispositivoOut, status_code=status.HTTP_201_CREATED)
async def crear(
    data: DispositivoIn, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> DispositivoOut:
    """Da de alta el dispositivo y devuelve un código de 6 dígitos para vincularlo (15 min)."""
    emp = empresa_scope(user, empresa_id)
    if not await db.scalar(
        select(Sucursal.id).where(Sucursal.id == data.sucursal_id, Sucursal.empresa_id == emp)
    ):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Sucursal inválida")
    d = Dispositivo(empresa_id=emp, **data.model_dump())
    _nuevo_codigo(d)
    db.add(d)
    await db.flush()
    await bitacora.registrar(
        db,
        empresa_id=emp,
        modelo="dispositivo",
        registro_id=d.id,
        usuario=user,
        tipo="creacion",
        mensaje=f"Dispositivo “{d.nombre}” dado de alta",
    )
    await db.commit()
    await db.refresh(d, attribute_names=["sucursal"])
    return DispositivoOut.de(d)


@router.post("/{dispositivo_id}/codigo", response_model=DispositivoOut)
async def nuevo_codigo(
    dispositivo_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> DispositivoOut:
    """Genera un código nuevo para (re)vincular. El token anterior deja de servir."""
    emp = empresa_scope(user, empresa_id)
    d = await _get(db, dispositivo_id, emp)
    _nuevo_codigo(d)
    await bitacora.registrar(
        db,
        empresa_id=emp,
        modelo="dispositivo",
        registro_id=d.id,
        usuario=user,
        tipo="cambio",
        mensaje="Nuevo código de vinculación; se desvinculó el equipo anterior",
    )
    await db.commit()
    return DispositivoOut.de(d)


@router.patch("/{dispositivo_id}", response_model=DispositivoOut)
async def actualizar(
    dispositivo_id: uuid.UUID,
    data: DispositivoUpdate,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> DispositivoOut:
    emp = empresa_scope(user, empresa_id)
    d = await _get(db, dispositivo_id, emp)
    antes = bitacora.snapshot(d, ("nombre", "activo"))
    for campo, valor in data.model_dump(exclude_unset=True).items():
        if valor is not None:
            setattr(d, campo, valor)
    await bitacora.cambios(
        db,
        empresa_id=emp,
        modelo="dispositivo",
        registro_id=d.id,
        usuario=user,
        antes=antes,
        despues=bitacora.snapshot(d, ("nombre", "activo")),
    )
    await db.commit()
    return DispositivoOut.de(d)
