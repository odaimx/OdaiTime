"""actividades programadas (tareas) con calendario

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tareas",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "empresa_id",
            sa.Uuid(),
            sa.ForeignKey("empresas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("modelo", sa.String(30)),
        sa.Column("registro_id", sa.Uuid()),
        sa.Column("registro_nombre", sa.String(200)),
        sa.Column("tipo", sa.String(15), nullable=False),
        sa.Column("resumen", sa.String(200), nullable=False),
        sa.Column("nota", sa.Text()),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("hora", sa.Time()),
        sa.Column("asignado_id", sa.Uuid(), sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
        sa.Column("creado_por_id", sa.Uuid(), sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
        sa.Column("hecha_en", sa.DateTime(timezone=True)),
        sa.Column("comentario", sa.Text()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_tareas_registro", "tareas", ["modelo", "registro_id"])
    op.create_index("ix_tareas_empresa_fecha", "tareas", ["empresa_id", "fecha"])


def downgrade() -> None:
    op.drop_table("tareas")
