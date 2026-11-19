"""Solicitudes de vacaciones desde el portal.

Revision ID: 0028
Revises: 0027
"""

import sqlalchemy as sa
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "solicitudes_vacaciones",
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
        sa.Column("fecha_inicio", sa.Date(), nullable=False),
        sa.Column("fecha_fin", sa.Date(), nullable=False),
        sa.Column("dias", sa.Integer(), nullable=False),
        sa.Column("motivo", sa.Text()),
        sa.Column("estado", sa.String(12), nullable=False, server_default="pendiente"),
        sa.Column("comentario", sa.Text()),
        sa.Column("respondida_por", sa.Uuid(), sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
        sa.Column("respondida_en", sa.DateTime(timezone=True)),
        sa.Column("incidencia_id", sa.Uuid(), sa.ForeignKey("incidencias.id", ondelete="SET NULL")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_solicitudes_vacaciones_empresa_id", "solicitudes_vacaciones", ["empresa_id"]
    )
    op.create_index(
        "ix_solicitudes_vacaciones_empleado_id", "solicitudes_vacaciones", ["empleado_id"]
    )
    op.create_index("ix_solicitudes_vacaciones_estado", "solicitudes_vacaciones", ["estado"])


def downgrade() -> None:
    op.drop_table("solicitudes_vacaciones")
