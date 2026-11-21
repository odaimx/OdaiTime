"""Precisión del GPS por sucursal y meses de retención de las fotos.

Revision ID: 0037
Revises: 0036
"""

import sqlalchemy as sa
from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sucursales",
        sa.Column("precision_gps_m", sa.Integer(), nullable=False, server_default="100"),
    )
    op.add_column(
        "config_sistema",
        sa.Column("retencion_fotos_meses", sa.Integer(), server_default="24"),
    )


def downgrade() -> None:
    op.drop_column("config_sistema", "retencion_fotos_meses")
    op.drop_column("sucursales", "precision_gps_m")
