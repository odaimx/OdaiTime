"""claves de nómina por empresa y sistema

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "claves_nomina",
        sa.Column(
            "empresa_id",
            sa.Uuid(),
            sa.ForeignKey("empresas.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("sistema", sa.String(20), primary_key=True),
        sa.Column("concepto", sa.String(10), primary_key=True),
        sa.Column("codigo", sa.String(60), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("claves_nomina")
