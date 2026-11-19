"""Incapacidades: ramo, tipo y certificado.

Revision ID: 0030
Revises: 0029
"""

import sqlalchemy as sa
from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("incidencias", sa.Column("ramo", sa.String(20)))
    op.add_column("incidencias", sa.Column("tipo_incapacidad", sa.String(12)))
    op.add_column("incidencias", sa.Column("certificado", sa.String(200)))
    op.add_column("incidencias", sa.Column("certificado_tipo", sa.String(50)))
    # Las incapacidades ya capturadas se toman como enfermedad general, inicial.
    op.execute(
        "UPDATE incidencias SET ramo = 'enfermedad_general', tipo_incapacidad = 'inicial' "
        "WHERE tipo = 'incapacidad'"
    )


def downgrade() -> None:
    for c in ("certificado_tipo", "certificado", "tipo_incapacidad", "ramo"):
        op.drop_column("incidencias", c)
