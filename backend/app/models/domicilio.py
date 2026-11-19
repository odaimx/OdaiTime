"""Domicilio desglosado (calle y número, colonia, CP, ciudad, estado) para empresas,
sucursales y otras zonas. `direccion` se arma sola con esos datos para reportes e impresiones.
"""

from sqlalchemy import String, event
from sqlalchemy.orm import Mapped, mapped_column

CAMPOS_DOMICILIO = ("calle", "colonia", "codigo_postal", "ciudad", "entidad")


class DomicilioMixin:
    calle: Mapped[str | None] = mapped_column(String(200))  # calle y número
    colonia: Mapped[str | None] = mapped_column(String(120))
    codigo_postal: Mapped[str | None] = mapped_column(String(5))
    ciudad: Mapped[str | None] = mapped_column(String(120))
    entidad: Mapped[str | None] = mapped_column(String(60))  # estado de la república

    def armar_direccion(self) -> str | None:
        partes = [
            self.calle,
            f"Col. {self.colonia}" if self.colonia else None,
            f"C.P. {self.codigo_postal}" if self.codigo_postal else None,
            self.ciudad,
            self.entidad,
        ]
        texto = ", ".join(p.strip() for p in partes if p and p.strip())
        return texto[:300] or None


def _antes_de_guardar(_mapper, _conexion, objetivo) -> None:
    if any(getattr(objetivo, c, None) for c in CAMPOS_DOMICILIO):
        objetivo.direccion = objetivo.armar_direccion()


event.listen(DomicilioMixin, "before_insert", _antes_de_guardar, propagate=True)
event.listen(DomicilioMixin, "before_update", _antes_de_guardar, propagate=True)
