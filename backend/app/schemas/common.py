import re
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, field_validator

RFC_RE = re.compile(r"^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$")


def _validar_rfc(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip().upper()
    if not RFC_RE.match(v):
        raise ValueError("RFC inválido (12 caracteres persona moral, 13 persona física)")
    return v


def _validar_zona(v: str) -> str:
    try:
        ZoneInfo(v)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"Zona horaria desconocida: {v}") from exc
    return v


RFC = Annotated[str, AfterValidator(_validar_rfc)]
ZonaHoraria = Annotated[str, AfterValidator(_validar_zona)]
Nombre = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=150)]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]


class Domicilio(BaseModel):
    """Domicilio desglosado; `direccion` se arma sola con estos datos."""

    calle: str | None = Field(default=None, max_length=200)
    colonia: str | None = Field(default=None, max_length=120)
    codigo_postal: str | None = Field(default=None, pattern=r"^(\d{5})?$")
    ciudad: str | None = Field(default=None, max_length=120)
    entidad: str | None = Field(default=None, max_length=60)

    @field_validator("calle", "colonia", "codigo_postal", "ciudad", "entidad", mode="before")
    @classmethod
    def _limpiar(cls, v):
        return (v.strip() or None) if isinstance(v, str) else v
