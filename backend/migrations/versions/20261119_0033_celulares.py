"""Celulares vinculados para checar sin usuario.

Revision ID: 0033
Revises: 0032
"""

import sqlalchemy as sa
from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "celulares_vinculados",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "empresa_id",
            sa.Uuid(),
            sa.ForeignKey("empresas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "empleado_id",
            sa.Uuid(),
            sa.ForeignKey("empleados.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("equipo", sa.String(120)),
        sa.Column("estado", sa.String(10), nullable=False, server_default="pendiente"),
        sa.Column("aprobado_por", sa.Uuid(), sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
        sa.Column("aprobado_en", sa.DateTime(timezone=True)),
        sa.Column("ultimo_uso", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_celulares_vinculados_empresa_id", "celulares_vinculados", ["empresa_id"])
    op.create_index("ix_celulares_vinculados_empleado_id", "celulares_vinculados", ["empleado_id"])
    op.create_index("ix_celulares_vinculados_estado", "celulares_vinculados", ["estado"])


def downgrade() -> None:
    op.drop_table("celulares_vinculados")
