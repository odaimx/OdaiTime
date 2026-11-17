import uuid
from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import DB, CurrentUser, empresa_scope
from app.services import licencia

router = APIRouter(prefix="/licencia", tags=["licencia"])


class LicenciaOut(BaseModel):
    max_empleados: int
    activos: int
    disponibles: int
    vence: date | None
    vencida: bool
    url_compra: str


@router.get("", response_model=LicenciaOut)
async def ver(user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None) -> dict:
    return await licencia.estado(db, empresa_scope(user, empresa_id))
