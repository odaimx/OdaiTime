"""Medios de checado y dispositivos por empleado.

Revision ID: 0027
Revises: 0026
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("empleados", sa.Column("medios_checado", postgresql.ARRAY(sa.String(12))))
    op.add_column(
        "empleados",
        sa.Column(
            "dispositivos_checado",
            postgresql.ARRAY(sa.Uuid()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("empleados", "dispositivos_checado")
    op.drop_column("empleados", "medios_checado")
