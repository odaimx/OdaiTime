"""Obras (lugares de trabajo temporales), sus asignaciones y la obra de cada checada.

Revision ID: 0026
Revises: 0025
"""

import sqlalchemy as sa
from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def _tiempos() -> list[sa.Column]:
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
        "obras",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "empresa_id",
            sa.Uuid(),
            sa.ForeignKey("empresas.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "sucursal_id", sa.Uuid(), sa.ForeignKey("sucursales.id"), nullable=False, index=True
        ),
        sa.Column("clave", sa.String(20), nullable=False),
        sa.Column("nombre", sa.String(150), nullable=False),
        sa.Column("direccion", sa.String(300)),
        sa.Column("latitud", sa.Numeric(9, 6)),
        sa.Column("longitud", sa.Numeric(9, 6)),
        sa.Column("radio_metros", sa.Integer(), nullable=False, server_default="150"),
        sa.Column("fecha_inicio", sa.Date(), nullable=False),
        sa.Column("fecha_fin", sa.Date()),
        sa.Column("activa", sa.Boolean(), nullable=False, server_default="true"),
        *_tiempos(),
        sa.UniqueConstraint("empresa_id", "clave"),
    )
    op.create_table(
        "asignaciones_obra",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "empresa_id",
            sa.Uuid(),
            sa.ForeignKey("empresas.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "obra_id",
            sa.Uuid(),
            sa.ForeignKey("obras.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "empleado_id",
            sa.Uuid(),
            sa.ForeignKey("empleados.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("fecha_inicio", sa.Date(), nullable=False),
        sa.Column("fecha_fin", sa.Date()),
        *_tiempos(),
    )
    op.add_column(
        "checadas", sa.Column("obra_id", sa.Uuid(), sa.ForeignKey("obras.id"), index=True)
    )


def downgrade() -> None:
    op.drop_column("checadas", "obra_id")
    op.drop_table("asignaciones_obra")
    op.drop_table("obras")
