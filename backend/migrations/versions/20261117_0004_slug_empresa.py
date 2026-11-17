"""subdominio (slug) por empresa

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.core.tenant import slugify

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("empresas", sa.Column("slug", sa.String(40)))

    # Genera el subdominio de las empresas existentes a partir de su nombre.
    conn = op.get_bind()
    usados: set[str] = set()
    for id_, nombre in conn.execute(sa.text("SELECT id, nombre FROM empresas ORDER BY created_at")):
        base = slugify(nombre)
        slug, n = base, 2
        while slug in usados:
            slug = f"{base[:36]}-{n}"
            n += 1
        usados.add(slug)
        conn.execute(sa.text("UPDATE empresas SET slug = :s WHERE id = :i"), {"s": slug, "i": id_})

    op.alter_column("empresas", "slug", nullable=False)
    op.create_unique_constraint("uq_empresas_slug", "empresas", ["slug"])


def downgrade() -> None:
    op.drop_constraint("uq_empresas_slug", "empresas")
    op.drop_column("empresas", "slug")
