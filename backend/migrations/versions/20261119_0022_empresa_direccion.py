"""Dirección (domicilio) de la empresa.

Revision ID: 0022
Revises: 0021
"""

import sqlalchemy as sa
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("empresas", sa.Column("direccion", sa.String(300)))


def downgrade() -> None:
    op.drop_column("empresas", "direccion")
