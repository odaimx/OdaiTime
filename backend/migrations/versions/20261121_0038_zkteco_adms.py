"""Envío directo de relojes ZKTeco (ADMS): habilitar e IPs permitidas.

Revision ID: 0038
Revises: 0037
"""

import sqlalchemy as sa
from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "dispositivos",
        sa.Column("adms", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("dispositivos", sa.Column("ips_permitidas", sa.String(300)))


def downgrade() -> None:
    op.drop_column("dispositivos", "ips_permitidas")
    op.drop_column("dispositivos", "adms")
