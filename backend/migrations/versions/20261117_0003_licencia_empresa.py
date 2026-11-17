"""licencia por empresa (límite de empleados y vencimiento)

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Las empresas existentes quedan con la licencia de prueba de 15 empleados.
    op.add_column(
        "empresas",
        sa.Column("max_empleados", sa.Integer(), nullable=False, server_default="15"),
    )
    op.add_column("empresas", sa.Column("licencia_vence", sa.Date()))
    op.create_check_constraint("ck_empresas_max_empleados", "empresas", "max_empleados > 0")


def downgrade() -> None:
    op.drop_constraint("ck_empresas_max_empleados", "empresas")
    op.drop_column("empresas", "licencia_vence")
    op.drop_column("empresas", "max_empleados")
