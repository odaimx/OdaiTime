"""Límite de usuarios por empresa (sin contar al administrador ni a los empleados).

Revision ID: 0018
Revises: 0017
"""

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "empresas", sa.Column("max_usuarios", sa.Integer(), nullable=False, server_default="5")
    )


def downgrade() -> None:
    op.drop_column("empresas", "max_usuarios")
