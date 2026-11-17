"""Comandos de administración.

docker compose exec api python -m app.cli crear-superadmin --email tu@correo.mx --nombre "Tu Nombre"
"""

import argparse
import asyncio
import getpass
import sys

from sqlalchemy import func, select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import Rol, Usuario


async def crear_superadmin(email: str, nombre: str, password: str) -> None:
    async with SessionLocal() as db:
        email = email.lower()
        if await db.scalar(select(func.count()).where(func.lower(Usuario.email) == email)):
            sys.exit(f"Ya existe un usuario con el correo {email}")
        db.add(
            Usuario(
                email=email,
                nombre=nombre,
                password_hash=hash_password(password),
                rol=Rol.SUPERADMIN,
            )
        )
        await db.commit()
    print(f"Superadmin {email} creado.")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("crear-superadmin", help="Crea un usuario superadmin del SaaS")
    p.add_argument("--email", required=True)
    p.add_argument("--nombre", required=True)
    args = parser.parse_args()

    if args.cmd == "crear-superadmin":
        password = getpass.getpass("Contraseña (mín. 8): ")
        if len(password) < 8:
            sys.exit("La contraseña debe tener al menos 8 caracteres")
        if password != getpass.getpass("Repite la contraseña: "):
            sys.exit("Las contraseñas no coinciden")
        asyncio.run(crear_superadmin(args.email, args.nombre, password))


if __name__ == "__main__":
    main()
