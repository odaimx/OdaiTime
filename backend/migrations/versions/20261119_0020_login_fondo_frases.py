"""Fondo de la aplicación y pantalla de acceso globales, frases del login y foto del usuario.

Revision ID: 0020
Revises: 0019
"""

import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None

_CONFIG = [
    ("fondo_color", sa.String(7)),
    ("fondo_imagen", sa.LargeBinary()),
    ("fondo_actualizado", sa.DateTime(timezone=True)),
    ("login_imagen", sa.LargeBinary()),
    ("login_actualizada", sa.DateTime(timezone=True)),
    ("login_titulo", sa.String(120)),
    ("login_subtitulo", sa.String(120)),
    ("login_texto", sa.String(600)),
]


def upgrade() -> None:
    for nombre, tipo in _CONFIG:
        op.add_column("config_sistema", sa.Column(nombre, tipo))
    op.add_column("usuarios", sa.Column("foto", sa.LargeBinary()))
    op.add_column("usuarios", sa.Column("foto_actualizada", sa.DateTime(timezone=True)))
    op.create_table(
        "frases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tipo", sa.String(10), nullable=False, index=True),
        sa.Column("texto", sa.String(600), nullable=False),
        sa.Column("autor", sa.String(150)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("frases")
    op.drop_column("usuarios", "foto_actualizada")
    op.drop_column("usuarios", "foto")
    for nombre, _ in reversed(_CONFIG):
        op.drop_column("config_sistema", nombre)
