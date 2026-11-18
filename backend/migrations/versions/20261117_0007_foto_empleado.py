"""foto de la ficha del empleado (binario)

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("empleados", sa.Column("foto", sa.LargeBinary()))  # 512 px
    op.add_column("empleados", sa.Column("foto_128", sa.LargeBinary()))  # 128 px
    op.add_column("empleados", sa.Column("foto_actualizada", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("empleados", "foto_actualizada")
    op.drop_column("empleados", "foto_128")
    op.drop_column("empleados", "foto")
