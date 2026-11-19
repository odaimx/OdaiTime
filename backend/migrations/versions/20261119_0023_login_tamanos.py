"""Tamaño de letra de los textos del panel de acceso.

Revision ID: 0023
Revises: 0022
"""

import sqlalchemy as sa
from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

_COLUMNAS = ("login_tamano_titulo", "login_tamano_subtitulo", "login_tamano_texto")


def upgrade() -> None:
    for c in _COLUMNAS:
        op.add_column("config_sistema", sa.Column(c, sa.Integer()))


def downgrade() -> None:
    for c in _COLUMNAS:
        op.drop_column("config_sistema", c)
