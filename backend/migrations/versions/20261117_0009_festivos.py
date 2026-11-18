"""catálogo de días festivos y selección por empresa

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-17
"""

from collections.abc import Sequence
from datetime import date

import sqlalchemy as sa
from alembic import op

from app.services.calendario import festivos, opcionales

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    tabla = op.create_table(
        "dias_festivos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("empresa_id", sa.Uuid(), sa.ForeignKey("empresas.id", ondelete="CASCADE")),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("nombre", sa.String(120), nullable=False),
        sa.Column("tipo", sa.String(12), nullable=False),
        sa.Column("fundamento", sa.String(200)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("tipo IN ('obligatorio', 'opcional')", name="ck_festivos_tipo"),
    )
    op.create_index("ix_dias_festivos_empresa_id", "dias_festivos", ["empresa_id"])
    op.create_index("ix_dias_festivos_fecha", "dias_festivos", ["fecha"])
    # Un día por fecha en el catálogo nacional y uno por fecha en cada empresa.
    op.create_index(
        "uq_festivo_nacional_fecha",
        "dias_festivos",
        ["fecha"],
        unique=True,
        postgresql_where=sa.text("empresa_id IS NULL"),
    )
    op.create_unique_constraint(
        "uq_festivo_empresa_fecha", "dias_festivos", ["empresa_id", "fecha"]
    )

    op.create_table(
        "empresa_festivos",
        sa.Column(
            "empresa_id",
            sa.Uuid(),
            sa.ForeignKey("empresas.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "festivo_id",
            sa.Uuid(),
            sa.ForeignKey("dias_festivos.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_table(
        "festivo_designados",
        sa.Column(
            "empresa_id",
            sa.Uuid(),
            sa.ForeignKey("empresas.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("fecha", sa.Date(), primary_key=True),
        sa.Column(
            "empleado_id",
            sa.Uuid(),
            sa.ForeignKey("empleados.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.add_column(
        "politica_asistencia",
        sa.Column("festivo_opcional_pago", sa.String(10), nullable=False, server_default="doble"),
    )

    # Catálogo nacional inicial: año en curso y siguiente.
    import uuid

    filas = []
    hoy = date.today()
    for anio in (hoy.year, hoy.year + 1):
        for f, n in festivos(anio).items():
            filas.append(
                {
                    "id": uuid.uuid4(),
                    "fecha": f,
                    "nombre": n,
                    "tipo": "obligatorio",
                    "fundamento": "Art. 74 LFT",
                }
            )
        for f, n in opcionales(anio).items():
            filas.append(
                {
                    "id": uuid.uuid4(),
                    "fecha": f,
                    "nombre": n,
                    "tipo": "opcional",
                    "fundamento": None,
                }
            )
    op.bulk_insert(tabla, filas)


def downgrade() -> None:
    op.drop_column("politica_asistencia", "festivo_opcional_pago")
    op.drop_table("festivo_designados")
    op.drop_table("empresa_festivos")
    op.drop_table("dias_festivos")
