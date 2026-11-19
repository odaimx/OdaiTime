"""Configuración de WhatsApp por empresa.

Revision ID: 0029
Revises: 0028
"""

import sqlalchemy as sa
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "config_whatsapp",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "empresa_id",
            sa.Uuid(),
            sa.ForeignKey("empresas.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("todos", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("phone_number_id", sa.String(40), unique=True),
        sa.Column("waba_id", sa.String(40)),
        sa.Column("numero", sa.String(20)),
        sa.Column("token", sa.String(2000)),
        sa.Column("app_secret", sa.String(500)),
        sa.Column("verify_token", sa.String(64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("config_whatsapp")
