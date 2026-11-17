from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    auth,
    empleados,
    empresas,
    health,
    licencia,
    sucursales,
    tenant,
    turnos,
    usuarios,
)
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
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
):
    app.include_router(r, prefix="/api")
