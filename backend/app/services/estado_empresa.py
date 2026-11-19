"""Estado de la cuenta de una empresa y bloqueo de acceso.

Una empresa suspendida, eliminada o con la licencia vencida no puede entrar al sistema (ni sus
usuarios ni sus checadores); se le explica el motivo. Odai no borra los datos al momento: una
empresa eliminada se conserva `retencion_dias` antes de purgarse.
"""

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Empleado, Empresa

ESTADOS = ("corriendo", "suspendida", "eliminada")
PERIODICIDADES = ("mensual", "bimestral", "trimestral", "semestral", "anual")


def aplicar(empresa: Empresa, estado: str, motivo: str | None = None) -> None:
    """Cambia el estado y mantiene `activa` sincronizada."""
    if estado != empresa.estado:
        empresa.estado_cambiado_en = datetime.now(UTC)
    empresa.estado = estado
    empresa.activa = estado == "corriendo"
    empresa.motivo_suspension = None if estado == "corriendo" else (motivo or None)


def bloqueo(empresa: Empresa, hoy: date | None = None) -> dict | None:
    """Motivo por el que la empresa no puede entrar, o None si puede."""
    hoy = hoy or date.today()
    motivo = empresa.motivo_suspension
    if empresa.estado == "eliminada":
        return {
            "codigo": "empresa_eliminada",
            "mensaje": f"La cuenta de {empresa.nombre} fue dada de baja.",
            "motivo": motivo,
        }
    if empresa.estado == "suspendida" or not empresa.activa:
        return {
            "codigo": "empresa_suspendida",
            "mensaje": f"El acceso de {empresa.nombre} a ODAITIME está suspendido."
            + (f" Motivo: {motivo}." if motivo else ""),
            "motivo": motivo,
        }
    if empresa.licencia_vence and empresa.licencia_vence < hoy:
        return {
            "codigo": "licencia_vencida",
            "mensaje": f"La licencia de {empresa.nombre} venció el "
            f"{empresa.licencia_vence:%d/%m/%Y}. Renueva tu suscripción para seguir usando "
            "ODAITIME.",
            "motivo": motivo,
        }
    return None


async def purgar(db: AsyncSession, dias: int) -> list[str]:
    """Borra definitivamente las empresas eliminadas hace más de `dias`. Devuelve sus slugs."""
    limite = datetime.now(UTC) - timedelta(days=dias)
    viejas = list(
        await db.scalars(
            select(Empresa).where(
                Empresa.estado == "eliminada", Empresa.estado_cambiado_en < limite
            )
        )
    )
    for e in viejas:
        # Primero los empleados (con sus checadas): evita choques con sucursales y turnos.
        await db.execute(delete(Empleado).where(Empleado.empresa_id == e.id))
        await db.delete(e)
    await db.commit()
    return [e.slug for e in viejas]
