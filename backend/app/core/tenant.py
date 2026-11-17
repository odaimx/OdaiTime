"""Resolución de la empresa (tenant) a partir del subdominio.

Con BASE_DOMAIN=time.odai.lat:
  time.odai.lat              → "base": solo el superadmin (Odai) inicia sesión aquí.
  hotelcaribe.time.odai.lat  → "tenant" con slug "hotelcaribe".
  IP, localhost u otro host  → "libre": sin restricción por subdominio (pruebas y desarrollo).
"""

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from fastapi import Request

from app.core.config import get_settings

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$")
RESERVADOS = {
    "www",
    "app",
    "api",
    "admin",
    "panel",
    "mail",
    "smtp",
    "ftp",
    "time",
    "odai",
    "static",
}


@dataclass(frozen=True)
class Tenant:
    modo: Literal["base", "tenant", "libre"]
    slug: str | None = None


def base_domain() -> str:
    d = get_settings().base_domain.strip().lower().rstrip(".")
    # DOMAIN=":80" (acceso por IP) o vacío desactiva los subdominios.
    return "" if not d or d.startswith(":") else d


def tenant_de_host(host: str | None) -> Tenant:
    base = base_domain()
    if not base or not host:
        return Tenant("libre")
    host = host.split(":")[0].lower().rstrip(".")
    if host == base:
        return Tenant("base")
    if host.endswith("." + base):
        sub = host[: -len(base) - 1]
        if "." not in sub:
            return Tenant("tenant", sub)
    return Tenant("libre")


def tenant_de(request: Request) -> Tenant:
    return tenant_de_host(request.headers.get("host"))


def url_empresa(slug: str) -> str | None:
    base = base_domain()
    return f"https://{slug}.{base}" if base else None


def slugify(texto: str) -> str:
    s = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40].strip("-")
    if len(s) < 3:
        s = (s + "-empresa").strip("-")
    if s in RESERVADOS:
        s = f"{s}-mx"
    return s
