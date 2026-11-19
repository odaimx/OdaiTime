"""Colores de los textos del panel de acceso; los refranes pasan a ser proverbios.

Revision ID: 0021
Revises: 0020
"""

import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None

_COLUMNAS = ("login_color_titulo", "login_color_subtitulo", "login_color_texto")


def upgrade() -> None:
    for c in _COLUMNAS:
        op.add_column("config_sistema", sa.Column(c, sa.String(7)))
    op.execute("UPDATE frases SET tipo = 'proverbio' WHERE tipo = 'refran'")


def downgrade() -> None:
    op.execute("UPDATE frases SET tipo = 'refran' WHERE tipo = 'proverbio'")
    for c in _COLUMNAS:
        op.drop_column("config_sistema", c)
