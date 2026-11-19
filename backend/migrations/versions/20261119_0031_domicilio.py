"""Domicilio desglosado en empresas, sucursales y otras zonas.

Revision ID: 0031
Revises: 0030
"""

import sqlalchemy as sa
from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None

TABLAS = ("empresas", "sucursales", "obras")
COLUMNAS = (
    ("calle", 200),
    ("colonia", 120),
    ("codigo_postal", 5),
    ("ciudad", 120),
    ("entidad", 60),
)


def upgrade() -> None:
    for t in TABLAS:
        for c, n in COLUMNAS:
            op.add_column(t, sa.Column(c, sa.String(n)))
        # Lo capturado antes queda en "calle y número" para no perderlo.
        op.execute(f"UPDATE {t} SET calle = LEFT(direccion, 200) WHERE direccion IS NOT NULL")


def downgrade() -> None:
    for t in TABLAS:
        for c, _ in COLUMNAS:
            op.drop_column(t, c)
