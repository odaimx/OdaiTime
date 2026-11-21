import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPkMixin
from app.models.empleado import Empleado


class CelularVinculado(UUIDPkMixin, TimestampMixin, Base):
    """Celular de un empleado para checar sin usuario ni contraseña.

    Se vincula una vez con número + PIN y queda pendiente hasta que el administrador o el
    gerente lo aprueba. El teléfono guarda un token (aquí solo su hash).
    """

    __tablename__ = "celulares_vinculados"

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    empleado_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empleados.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    equipo: Mapped[str | None] = mapped_column(String(120))  # p. ej. "Android · Chrome"
    estado: Mapped[str] = mapped_column(String(10), default="pendiente", index=True)
    # pendiente | aprobado | revocado
    aprobado_por: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL")
    )
    aprobado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ultimo_uso: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    empleado: Mapped[Empleado] = relationship(lazy="joined")


class PasskeyCelular(UUIDPkMixin, TimestampMixin, Base):
    """Huella o rostro del celular vinculado (WebAuthn / passkey) para checar sin PIN.

    La llave privada nunca sale del teléfono; aquí solo se guarda la llave pública, el contador
    de firmas (detecta llaves clonadas) y el dominio (rp_id) y origen con que se registró.
    """

    __tablename__ = "passkeys_celular"

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    celular_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("celulares_vinculados.id", ondelete="CASCADE"), index=True
    )
    credencial_id: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    llave_publica: Mapped[bytes] = mapped_column(LargeBinary)
    contador: Mapped[int] = mapped_column(Integer, default=0)
    rp_id: Mapped[str] = mapped_column(String(253))
    origen: Mapped[str] = mapped_column(String(300))
    ultimo_uso: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
