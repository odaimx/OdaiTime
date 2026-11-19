"""Estado de la cuenta de la empresa (corriendo, suspendida, eliminada) para las licencias.

Revision ID: 0019
Revises: 0018
"""

import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "empresas",
        sa.Column("estado", sa.String(12), nullable=False, server_default="corriendo"),
    )
    op.add_column("empresas", sa.Column("motivo_suspension", sa.String(300)))
    op.add_column("empresas", sa.Column("periodicidad", sa.String(12)))
    op.add_column("empresas", sa.Column("referencia_odoo", sa.String(100)))
    op.add_column("empresas", sa.Column("estado_cambiado_en", sa.DateTime(timezone=True)))
    op.execute("UPDATE empresas SET estado = 'suspendida' WHERE NOT activa")


def downgrade() -> None:
    for c in ("estado_cambiado_en", "referencia_odoo", "periodicidad", "motivo_suspension"):
        op.drop_column("empresas", c)
    op.drop_column("empresas", "estado")
