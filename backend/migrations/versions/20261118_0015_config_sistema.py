"""configuración general del sistema: colores del tema e imagen de inicio

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "config_sistema",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("colores", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("imagen_inicio", sa.LargeBinary()),
        sa.Column("imagen_actualizada", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("config_sistema")
