from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "ODAITIME"
    environment: str = "development"  # development | staging | production
    debug: bool = False

    # Zona horaria por defecto de la cuenta; cada sucursal podrá tener la suya.
    default_timezone: str = "America/Mexico_City"

    database_url: str = "postgresql+asyncpg://odaitime:odaitime@localhost:5432/odaitime"
    redis_url: str = "redis://localhost:6379/0"

    # Dominio de los clientes: cada empresa entra por <slug>.BASE_DOMAIN (p. ej. hotel.odai.lat).
    # Vacío o ":80" = sin subdominios (acceso por IP).
    base_domain: str = ""
    # Dirección del panel de Odai (superadmin), p. ej. time.odai.lat. Vacío = el propio BASE_DOMAIN.
    admin_host: str = ""
    # Subdominios extra que ningún cliente puede usar, separados por coma ("tienda,intranet").
    subdominios_reservados: str = ""

    # Carpeta de fotos de checadas (volumen persistente en Docker).
    fotos_dir: str = "/app/data/fotos"

    secret_key: str = "cambia-esto-en-produccion"
    access_token_minutes: int = 15
    refresh_token_days: int = 7

    # Licencia de prueba mientras no exista el panel central de licencias de Odai.
    licencia_max_empleados_default: int = 15
    licencia_url_compra: str = "https://odai.lat"

    # Intentos de login fallidos permitidos por correo+IP en la ventana.
    login_max_attempts: int = 5
    login_window_seconds: int = 900
    cors_origins: list[str] = ["http://localhost:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
