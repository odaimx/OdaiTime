"""incidencias y política de asistencia

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ts() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "incidencias",
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
        sa.Column("tipo", sa.String(20), nullable=False),
        sa.Column("fecha_inicio", sa.Date(), nullable=False),
        sa.Column("fecha_fin", sa.Date(), nullable=False),
        sa.Column("notas", sa.Text()),
        sa.Column("folio", sa.String(40)),
        sa.Column("registrada_por", sa.Uuid(), sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
        *_ts(),
        sa.CheckConstraint("fecha_fin >= fecha_inicio", name="ck_incidencias_rango"),
        sa.CheckConstraint(
            "tipo IN ('vacaciones', 'incapacidad', 'permiso_con_goce', 'permiso_sin_goce', "
            "'falta_justificada')",
            name="ck_incidencias_tipo",
        ),
    )
    op.create_index("ix_incidencias_empresa_id", "incidencias", ["empresa_id"])
    op.create_index("ix_incidencias_empleado_id", "incidencias", ["empleado_id"])

    op.create_table(
        "politica_asistencia",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "empresa_id",
            sa.Uuid(),
            sa.ForeignKey("empresas.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("retardos_por_falta", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("retardo_falta_min", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("minimo_extra_min", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("redondeo_extra_min", sa.Integer(), nullable=False, server_default="30"),
        *_ts(),
    )


def downgrade() -> None:
    op.drop_table("politica_asistencia")
    op.drop_table("incidencias")
