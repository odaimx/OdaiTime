"""Filtros de empleados para reportes y exportaciones a nómina.

Se combinan con Y entre grupos y con O dentro de cada grupo (como los filtros de las vistas):
sucursales, categorías de empleado y de sucursal, departamento, puesto, zona (obra asignada en el
periodo), empleados sueltos y estatus (activos / bajas).
"""

import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Annotated, Literal

from fastapi import Depends, Query
from sqlalchemy import Select, or_, select

from app.models import AsignacionObra, CategoriaRegistro, Empleado

Estatus = Literal["todos", "activos", "bajas"]


@dataclass
class FiltroEmpleados:
    sucursal_ids: list[uuid.UUID] = field(default_factory=list)
    empleado_ids: list[uuid.UUID] = field(default_factory=list)
    categoria_ids: list[uuid.UUID] = field(default_factory=list)
    categoria_sucursal_ids: list[uuid.UUID] = field(default_factory=list)
    departamentos: list[str] = field(default_factory=list)
    puestos: list[str] = field(default_factory=list)
    obra_ids: list[uuid.UUID] = field(default_factory=list)
    estatus: Estatus = "todos"

    def aplicar(self, q: Select, desde: date, hasta: date) -> Select:
        if self.sucursal_ids:
            q = q.where(Empleado.sucursal_id.in_(self.sucursal_ids))
        if self.empleado_ids:
            q = q.where(Empleado.id.in_(self.empleado_ids))
        if self.categoria_ids:
            q = q.where(
                Empleado.id.in_(
                    select(CategoriaRegistro.registro_id).where(
                        CategoriaRegistro.categoria_id.in_(self.categoria_ids)
                    )
                )
            )
        if self.categoria_sucursal_ids:
            q = q.where(
                Empleado.sucursal_id.in_(
                    select(CategoriaRegistro.registro_id).where(
                        CategoriaRegistro.categoria_id.in_(self.categoria_sucursal_ids)
                    )
                )
            )
        if self.departamentos:
            q = q.where(Empleado.departamento.in_(self.departamentos))
        if self.puestos:
            q = q.where(Empleado.puesto.in_(self.puestos))
        if self.obra_ids:
            q = q.where(
                Empleado.id.in_(
                    select(AsignacionObra.empleado_id).where(
                        AsignacionObra.obra_id.in_(self.obra_ids),
                        AsignacionObra.fecha_inicio <= hasta,
                        or_(AsignacionObra.fecha_fin.is_(None), AsignacionObra.fecha_fin >= desde),
                    )
                )
            )
        if self.estatus == "activos":
            q = q.where(Empleado.fecha_baja.is_(None) | (Empleado.fecha_baja > hasta))
        elif self.estatus == "bajas":
            q = q.where(Empleado.fecha_baja.is_not(None), Empleado.fecha_baja <= hasta)
        return q


def _lista(v: list[str]) -> list[str]:
    return [x.strip()[:100] for x in v if x and x.strip()][:50]


async def filtro_empleados(
    sucursal_id: uuid.UUID | None = None,
    sucursal_ids: Annotated[list[uuid.UUID], Query(max_length=200)] = [],  # noqa: B006
    empleado_ids: Annotated[list[uuid.UUID], Query(max_length=500)] = [],  # noqa: B006
    categoria_ids: Annotated[list[uuid.UUID], Query(max_length=100)] = [],  # noqa: B006
    categoria_sucursal_ids: Annotated[list[uuid.UUID], Query(max_length=100)] = [],  # noqa: B006
    departamentos: Annotated[list[str], Query(max_length=50)] = [],  # noqa: B006
    puestos: Annotated[list[str], Query(max_length=50)] = [],  # noqa: B006
    obra_ids: Annotated[list[uuid.UUID], Query(max_length=100)] = [],  # noqa: B006
    estatus: Estatus = "todos",
) -> FiltroEmpleados:
    sucursales = list(sucursal_ids)
    if sucursal_id and sucursal_id not in sucursales:
        sucursales.append(sucursal_id)  # parámetro anterior (una sola sucursal)
    return FiltroEmpleados(
        sucursal_ids=sucursales,
        empleado_ids=list(empleado_ids),
        categoria_ids=list(categoria_ids),
        categoria_sucursal_ids=list(categoria_sucursal_ids),
        departamentos=_lista(departamentos),
        puestos=_lista(puestos),
        obra_ids=list(obra_ids),
        estatus=estatus,
    )


Filtro = Annotated[FiltroEmpleados, Depends(filtro_empleados)]
