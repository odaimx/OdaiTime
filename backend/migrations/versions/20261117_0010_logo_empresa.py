"""logo de la empresa (binario)

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("empresas", sa.Column("logo", sa.LargeBinary()))
    op.add_column("empresas", sa.Column("logo_actualizado", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("empresas", "logo_actualizado")
    op.drop_column("empresas", "logo")
