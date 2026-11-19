"""Plantillas de correo editables.

Revision ID: 0025
Revises: 0024
"""

import sqlalchemy as sa
from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plantillas_correo",
        sa.Column("clave", sa.String(30), primary_key=True),
        sa.Column("asunto", sa.String(200), nullable=False),
        sa.Column("titulo", sa.String(200), nullable=False),
        sa.Column("cuerpo", sa.String(4000), nullable=False),
        sa.Column("boton", sa.String(80)),
        sa.Column("actualizada", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("plantillas_correo")
