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

    secret_key: str = "cambia-esto-en-produccion"
    cors_origins: list[str] = ["http://localhost:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
