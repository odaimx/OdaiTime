"""App de Meta de Odai para el registro integrado de WhatsApp (Tech Provider).

Revision ID: 0035
Revises: 0034
"""

import sqlalchemy as sa
from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("config_sistema", sa.Column("meta_app_id", sa.String(40)))
    op.add_column("config_sistema", sa.Column("meta_config_id", sa.String(40)))
    op.add_column("config_sistema", sa.Column("meta_app_secret", sa.String(500)))


def downgrade() -> None:
    for c in ("meta_app_secret", "meta_config_id", "meta_app_id"):
        op.drop_column("config_sistema", c)
