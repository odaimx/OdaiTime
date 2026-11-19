"""Resolución de la empresa (tenant) a partir del subdominio.

Con BASE_DOMAIN=odai.lat y ADMIN_HOST=time.odai.lat:
  time.odai.lat              → "base": panel de Odai, solo el superadmin inicia sesión aquí.
  hotel.odai.lat             → "tenant" con slug "hotel".
  www.odai.lat (reservado)   → "libre": no es de ningún cliente.
  IP, localhost u otro host  → "libre": sin restricción por subdominio (pruebas y desarrollo).
"""

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from fastapi import Request

from app.core.config import get_settings

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$")
# Subdominios que ningún cliente puede tomar (de Odai o de uso técnico común).
# fmt: off
_RESERVADOS_BASE = {
    "www", "app", "api", "admin", "panel", "time", "odai", "static", "cdn", "assets",
    "mail", "webmail", "smtp", "imap", "pop", "pop3", "mx", "autodiscover", "autoconfig",
    "ftp", "sftp", "ssh", "vpn", "ns", "ns1", "ns2", "dns", "cpanel", "whm", "plesk",
    "blog", "shop", "tienda", "store", "soporte", "support", "help", "ayuda", "docs",
    "status", "dev", "staging", "test", "beta", "odoo", "erp", "crm", "portal",
    "login", "auth", "cuenta", "account", "billing", "pagos", "facturacion", "licencias",
}
# fmt: on


def reservados() -> set[str]:
    extra = get_settings().subdominios_reservados
    return _RESERVADOS_BASE | {x.strip().lower() for x in extra.split(",") if x.strip()}


@dataclass(frozen=True)
class Tenant:
    modo: Literal["base", "tenant", "libre"]
    slug: str | None = None


def base_domain() -> str:
    d = get_settings().base_domain.strip().lower().rstrip(".")
    # DOMAIN=":80" (acceso por IP) o vacío desactiva los subdominios.
    return "" if not d or d.startswith(":") else d


def admin_host() -> str:
    h = get_settings().admin_host.strip().lower().rstrip(".")
    return h or base_domain()


def tenant_de_host(host: str | None) -> Tenant:
    base = base_domain()
    if not base or not host:
        return Tenant("libre")
    host = host.split(":")[0].lower().rstrip(".")
    if host == admin_host():
        return Tenant("base")
    if host.endswith("." + base):
        sub = host[: -len(base) - 1]
        if "." not in sub and sub not in reservados():
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
    if s in reservados():
        s = f"{s}-mx"
    return s
