"""Ícono de la pestaña del navegador (favicon) configurable por Odai.

Revision ID: 0024
Revises: 0023
"""

import sqlalchemy as sa
from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("config_sistema", sa.Column("icono", sa.LargeBinary()))
    op.add_column("config_sistema", sa.Column("icono_actualizado", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("config_sistema", "icono_actualizado")
    op.drop_column("config_sistema", "icono")
