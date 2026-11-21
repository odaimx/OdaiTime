"""Huella o rostro del celular vinculado (passkeys WebAuthn).

Revision ID: 0036
Revises: 0035
"""

import sqlalchemy as sa
from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "passkeys_celular",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "empresa_id",
            sa.Uuid(),
            sa.ForeignKey("empresas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "celular_id",
            sa.Uuid(),
            sa.ForeignKey("celulares_vinculados.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("credencial_id", sa.LargeBinary(), nullable=False, unique=True),
        sa.Column("llave_publica", sa.LargeBinary(), nullable=False),
        sa.Column("contador", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rp_id", sa.String(253), nullable=False),
        sa.Column("origen", sa.String(300), nullable=False),
        sa.Column("ultimo_uso", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_passkeys_celular_empresa_id", "passkeys_celular", ["empresa_id"])
    op.create_index("ix_passkeys_celular_celular_id", "passkeys_celular", ["celular_id"])


def downgrade() -> None:
    op.drop_table("passkeys_celular")
