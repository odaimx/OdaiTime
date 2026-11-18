"""turno quebrado: segundo horario por día

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("turno_dias", sa.Column("entrada2", sa.Time()))
    op.add_column("turno_dias", sa.Column("salida2", sa.Time()))
    op.create_check_constraint(
        "ck_turno_dias_bloque2", "turno_dias", "(entrada2 IS NULL) = (salida2 IS NULL)"
    )


def downgrade() -> None:
    op.drop_constraint("ck_turno_dias_bloque2", "turno_dias")
    op.drop_column("turno_dias", "salida2")
    op.drop_column("turno_dias", "entrada2")
