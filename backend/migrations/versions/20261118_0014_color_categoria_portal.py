"""color libre (#rrggbb) en categorías; historial del portal configurable

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Paleta anterior (índices 0-9) convertida a colores.
PALETA = [
    "#94a3b8",
    "#f87171",
    "#fb923c",
    "#fbbf24",
    "#a3e635",
    "#34d399",
    "#22d3ee",
    "#38bdf8",
    "#a78bfa",
    "#f472b6",
]


def upgrade() -> None:
    casos = " ".join(f"WHEN {i} THEN '{c}'" for i, c in enumerate(PALETA))
    # Primero sin valor por defecto (el anterior era numérico), luego el tipo y el nuevo valor.
    op.alter_column("categorias", "color", server_default=None)
    op.alter_column(
        "categorias",
        "color",
        type_=sa.String(7),
        postgresql_using=f"CASE color {casos} ELSE '#8a64de' END",
    )
    op.alter_column("categorias", "color", server_default="#8a64de")
    op.add_column(
        "config_checadas",
        sa.Column("portal_historial", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("config_checadas", "portal_historial")
    op.alter_column("categorias", "color", server_default=None)
    op.alter_column("categorias", "color", type_=sa.SmallInteger(), postgresql_using="0")
    op.alter_column("categorias", "color", server_default="0")
