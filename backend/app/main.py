import asyncio
import contextlib
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    actividad,
    asistencia,
    auth,
    categorias,
    celulares,
    checadas,
    correo,
    dispositivos,
    empleados,
    empresas,
    festivos,
    health,
    integracion,
    kiosco,
    licencia,
    obras,
    publico,
    reportes,
    sistema,
    sucursales,
    tareas,
    tenant,
    turnos,
    usuarios,
    vacaciones,
    whatsapp,
)
from app.core.config import get_settings

settings = get_settings()


@contextlib.asynccontextmanager
async def ciclo(_: FastAPI) -> AsyncIterator[None]:
    """Tareas de fondo: borrado diario de fotos vencidas."""
    from app.services.retencion import tarea_diaria

    tarea = asyncio.create_task(tarea_diaria()) if settings.environment != "test" else None
    yield
    if tarea:
        tarea.cancel()


app = FastAPI(
    lifespan=ciclo,
    title=f"{settings.app_name} API",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (
    health.router,
    auth.router,
    empresas.router,
    sucursales.router,
    usuarios.router,
    turnos.router,
    empleados.router,
    licencia.router,
    tenant.router,
    actividad.router,
    checadas.router,
    dispositivos.router,
    kiosco.router,
    asistencia.router,
    festivos.router,
    reportes.router,
    tareas.router,
    categorias.router,
    correo.router,
    sistema.router,
    integracion.router,
    obras.router,
    vacaciones.router,
    whatsapp.router,
    publico.router,
    celulares.router,
):
    app.include_router(r, prefix="/api")
