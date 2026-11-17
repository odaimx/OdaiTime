"""empleados, turnos y asignaciones

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
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
        "turnos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "empresa_id",
            sa.Uuid(),
            sa.ForeignKey("empresas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("nombre", sa.String(100), nullable=False),
        sa.Column("tipo_jornada", sa.String(10), nullable=False),
        sa.Column("tolerancia_minutos", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_timestamps(),
        sa.UniqueConstraint("empresa_id", "nombre", name="uq_turno_empresa_nombre"),
        sa.CheckConstraint(
            "tipo_jornada IN ('diurna', 'nocturna', 'mixta')", name="ck_turnos_tipo_jornada"
        ),
        sa.CheckConstraint("tolerancia_minutos BETWEEN 0 AND 120", name="ck_turnos_tolerancia"),
    )
    op.create_index("ix_turnos_empresa_id", "turnos", ["empresa_id"])

    op.create_table(
        "turno_dias",
        sa.Column(
            "turno_id",
            sa.Uuid(),
            sa.ForeignKey("turnos.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("dia_semana", sa.SmallInteger(), primary_key=True),
        sa.Column("entrada", sa.Time(), nullable=False),
        sa.Column("salida", sa.Time(), nullable=False),
        sa.Column("comida_minutos", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("dia_semana BETWEEN 0 AND 6", name="ck_turno_dia_semana"),
    )

    op.create_table(
        "empleados",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "empresa_id",
            sa.Uuid(),
            sa.ForeignKey("empresas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sucursal_id",
            sa.Uuid(),
            sa.ForeignKey("sucursales.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("numero", sa.String(20), nullable=False),
        sa.Column("nombre", sa.String(100), nullable=False),
        sa.Column("apellido_paterno", sa.String(100), nullable=False),
        sa.Column("apellido_materno", sa.String(100)),
        sa.Column("curp", sa.String(18)),
        sa.Column("rfc", sa.String(13)),
        sa.Column("nss", sa.String(11)),
        sa.Column("fecha_ingreso", sa.Date(), nullable=False),
        sa.Column("puesto", sa.String(100)),
        sa.Column("departamento", sa.String(100)),
        sa.Column("salario_diario", sa.Numeric(10, 2)),
        sa.Column("email", sa.String(254)),
        sa.Column("telefono", sa.String(20)),
        sa.Column(
            "usuario_id",
            sa.Uuid(),
            sa.ForeignKey("usuarios.id", ondelete="SET NULL"),
            unique=True,
        ),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("fecha_baja", sa.Date()),
        sa.Column("motivo_baja", sa.String(300)),
        *_timestamps(),
        sa.UniqueConstraint("empresa_id", "numero", name="uq_empleado_empresa_numero"),
        sa.UniqueConstraint("empresa_id", "curp", name="uq_empleado_empresa_curp"),
    )
    op.create_index("ix_empleados_empresa_id", "empleados", ["empresa_id"])
    op.create_index("ix_empleados_sucursal_id", "empleados", ["sucursal_id"])

    op.create_table(
        "asignaciones_turno",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "empleado_id",
            sa.Uuid(),
            sa.ForeignKey("empleados.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "turno_id",
            sa.Uuid(),
            sa.ForeignKey("turnos.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("fecha_inicio", sa.Date(), nullable=False),
        sa.Column("fecha_fin", sa.Date()),
        sa.UniqueConstraint("empleado_id", "fecha_inicio", name="uq_asignacion_empleado_inicio"),
    )
    op.create_index("ix_asignaciones_turno_empleado_id", "asignaciones_turno", ["empleado_id"])


def downgrade() -> None:
    op.drop_table("asignaciones_turno")
    op.drop_table("empleados")
    op.drop_table("turno_dias")
    op.drop_table("turnos")
