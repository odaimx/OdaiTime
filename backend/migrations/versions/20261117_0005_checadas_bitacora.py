"""checadas, configuración, dispositivos, bitácora y PIN de empleado

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0005"
down_revision: str | None = "0004"
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


def _fk(tabla: str, ondelete: str | None = "CASCADE") -> sa.ForeignKey:
    return sa.ForeignKey(f"{tabla}.id", ondelete=ondelete)


def upgrade() -> None:
    op.add_column("empleados", sa.Column("pin_hash", sa.String(255)))

    op.create_table(
        "actividades",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("empresa_id", sa.Uuid(), _fk("empresas"), nullable=False),
        sa.Column("modelo", sa.String(30), nullable=False),
        sa.Column("registro_id", sa.Uuid(), nullable=False),
        sa.Column("usuario_id", sa.Uuid(), _fk("usuarios", "SET NULL")),
        sa.Column("tipo", sa.String(15), nullable=False),
        sa.Column("mensaje", sa.Text()),
        sa.Column("cambios", JSONB()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_actividades_registro", "actividades", ["modelo", "registro_id", "created_at"]
    )

    op.create_table(
        "config_checadas",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("empresa_id", sa.Uuid(), _fk("empresas"), nullable=False),
        sa.Column("sucursal_id", sa.Uuid(), _fk("sucursales")),
        sa.Column("permitir_movil", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("permitir_kiosco", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("validar_gps", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("validar_qr", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("foto", sa.String(10), nullable=False, server_default="ninguna"),
        sa.Column("pin_kiosco", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("minutos_antes_entrada", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("ignorar_repetida_min", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("permitir_offline", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("offline_max_horas", sa.Integer(), nullable=False, server_default="24"),
        *_ts(),
        sa.CheckConstraint(
            "foto IN ('ninguna', 'movil', 'kiosco', 'ambos')", name="ck_config_checadas_foto"
        ),
    )
    # Una configuración general por empresa y una por sucursal.
    op.create_index(
        "uq_config_checadas_general",
        "config_checadas",
        ["empresa_id"],
        unique=True,
        postgresql_where=sa.text("sucursal_id IS NULL"),
    )
    op.create_index(
        "uq_config_checadas_sucursal",
        "config_checadas",
        ["sucursal_id"],
        unique=True,
        postgresql_where=sa.text("sucursal_id IS NOT NULL"),
    )

    op.create_table(
        "dispositivos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("empresa_id", sa.Uuid(), _fk("empresas"), nullable=False),
        sa.Column("sucursal_id", sa.Uuid(), _fk("sucursales"), nullable=False),
        sa.Column("nombre", sa.String(100), nullable=False),
        sa.Column("tipo", sa.String(15), nullable=False, server_default="kiosco"),
        sa.Column("serie", sa.String(60)),
        sa.Column("token_hash", sa.String(64), unique=True),
        sa.Column("codigo_vinculacion", sa.String(6)),
        sa.Column("codigo_expira", sa.DateTime(timezone=True)),
        sa.Column("vinculado_en", sa.DateTime(timezone=True)),
        sa.Column("ultima_conexion", sa.DateTime(timezone=True)),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_ts(),
        sa.CheckConstraint("tipo IN ('kiosco', 'biometrico')", name="ck_dispositivos_tipo"),
    )
    op.create_index("ix_dispositivos_empresa_id", "dispositivos", ["empresa_id"])

    op.create_table(
        "checadas",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("empresa_id", sa.Uuid(), _fk("empresas"), nullable=False),
        sa.Column("empleado_id", sa.Uuid(), _fk("empleados"), nullable=False),
        sa.Column("sucursal_id", sa.Uuid(), _fk("sucursales", None), nullable=False),
        sa.Column("tipo", sa.String(10), nullable=False),
        sa.Column("momento", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "recibida_en", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("origen", sa.String(12), nullable=False),
        sa.Column("offline", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("latitud", sa.Numeric(9, 6)),
        sa.Column("longitud", sa.Numeric(9, 6)),
        sa.Column("precision_m", sa.Integer()),
        sa.Column("distancia_m", sa.Integer()),
        sa.Column("foto", sa.String(200)),
        sa.Column("dispositivo_id", sa.Uuid(), _fk("dispositivos", "SET NULL")),
        sa.Column("retardo_minutos", sa.Integer()),
        sa.Column("estado", sa.String(10), nullable=False, server_default="valida"),
        sa.Column("corregida", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("registrada_por", sa.Uuid(), _fk("usuarios", "SET NULL")),
        sa.CheckConstraint("tipo IN ('entrada', 'salida')", name="ck_checadas_tipo"),
        sa.CheckConstraint(
            "origen IN ('movil', 'kiosco', 'biometrico', 'manual')", name="ck_checadas_origen"
        ),
        sa.CheckConstraint("estado IN ('valida', 'anulada')", name="ck_checadas_estado"),
    )
    op.create_index("ix_checadas_empleado_momento", "checadas", ["empleado_id", "momento"])
    op.create_index("ix_checadas_empresa_id", "checadas", ["empresa_id"])
    op.create_index("ix_checadas_sucursal_id", "checadas", ["sucursal_id"])


def downgrade() -> None:
    op.drop_table("checadas")
    op.drop_table("dispositivos")
    op.drop_table("config_checadas")
    op.drop_table("actividades")
    op.drop_column("empleados", "pin_hash")
