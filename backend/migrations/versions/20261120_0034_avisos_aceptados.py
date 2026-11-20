"""Constancia de aceptación del aviso de privacidad.

Revision ID: 0034
Revises: 0033
"""

import sqlalchemy as sa
from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "avisos_aceptados",
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
        sa.Column("version", sa.String(20), nullable=False),
        sa.Column("medio", sa.String(10), nullable=False),
        sa.Column("ip", sa.String(45)),
        sa.Column("equipo", sa.String(120)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("empleado_id", "version", name="uq_aviso_empleado_version"),
    )
    op.create_index("ix_avisos_aceptados_empresa_id", "avisos_aceptados", ["empresa_id"])
    op.create_index("ix_avisos_aceptados_empleado_id", "avisos_aceptados", ["empleado_id"])


def downgrade() -> None:
    op.drop_table("avisos_aceptados")
