"""Plantillas de los correos que envía ODAITIME, editables por Odai.

Cada plantilla tiene asunto, título, cuerpo (párrafos separados por un renglón en blanco) y el
texto del botón. Se escriben como texto: los valores se escapan y **así** se pone en negritas.
Variables: {empresa}, {nombre}, {nombre_completo}, {correo}, {horas}, {usuario_envia} y, en
vacaciones, {empleado}, {fechas}, {dias}, {motivo}, {estado}, {comentario}.
El diseño (colores, encabezado con la empresa y pie de ODAI) es fijo.
"""

import html
import re
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PlantillaCorreo


@dataclass(frozen=True)
class Plantilla:
    nombre: str  # para la pantalla
    descripcion: str
    asunto: str
    titulo: str
    cuerpo: str
    boton: str | None


FABRICA: dict[str, Plantilla] = {
    "invitacion": Plantilla(
        "Invitación al portal del empleado",
        "Se envía al dar acceso al portal a un empleado.",
        "{empresa}: tu acceso al portal de asistencia",
        "Hola, {nombre}",
        "{empresa} te dio acceso al portal de ODAITIME, donde puedes registrar tu asistencia y "
        "consultar tu historial.\n\nTu usuario es **{correo}**. Crea tu contraseña con el botón; "
        "el enlace vence en {horas} horas.",
        "Crear mi contraseña",
    ),
    "bienvenida_admin": Plantilla(
        "Bienvenida al administrador de la empresa",
        "Se envía al asignar el administrador de una empresa nueva (desde Odai o desde Odoo).",
        "Bienvenido a ODAITIME, {empresa}",
        "Hola, {nombre}",
        "Ya puedes administrar el control de asistencia de **{empresa}** en ODAITIME.\n\n"
        "Tu usuario es **{correo}**. Crea tu contraseña con el botón; el enlace vence en "
        "{horas} horas.",
        "Crear mi contraseña",
    ),
    "recuperar": Plantilla(
        "Recuperar contraseña",
        "Se envía al pedir cambiar la contraseña o al mandar el enlace desde Usuarios.",
        "{empresa}: recupera tu contraseña",
        "Recupera tu contraseña",
        "Recibimos una solicitud para cambiar la contraseña de tu cuenta en ODAITIME.\n\n"
        "Si fuiste tú, usa el botón; el enlace vence en {horas} hora(s). Si no, ignora este "
        "correo: tu contraseña no cambia.",
        "Cambiar mi contraseña",
    ),
    "vacaciones_solicitud": Plantilla(
        "Solicitud de vacaciones",
        "Se envía al administrador y a los gerentes de la sucursal cuando un empleado pide "
        "vacaciones desde el portal.",
        "{empresa}: {empleado} pide vacaciones",
        "Solicitud de vacaciones",
        "**{empleado}** pidió vacaciones del **{fechas}** ({dias} día(s) hábiles).\n\n{motivo}",
        "Revisar solicitud",
    ),
    "vacaciones_respuesta": Plantilla(
        "Respuesta a la solicitud de vacaciones",
        "Se envía al empleado cuando aprueban, rechazan o cancelan su solicitud.",
        "{empresa}: tus vacaciones fueron {estado}",
        "Hola, {nombre}",
        "Tu solicitud de vacaciones del **{fechas}** fue **{estado}**.\n\n{comentario}",
        "Ver mis vacaciones",
    ),
    "prueba": Plantilla(
        "Correo de prueba",
        "Se envía desde Correo saliente para probar el servidor.",
        "Prueba de correo de ODAITIME",
        "¡Funciona!",
        "Este es un correo de prueba enviado por {usuario_envia}.",
        None,
    ),
}

VARIABLES = {
    "empresa": "Nombre de la empresa",
    "nombre": "Primer nombre del destinatario",
    "nombre_completo": "Nombre completo del destinatario",
    "correo": "Correo (usuario) del destinatario",
    "horas": "Horas que dura el enlace",
    "usuario_envia": "Quien envía (solo en la prueba)",
    "empleado": "Empleado que pide vacaciones",
    "fechas": "Fechas de las vacaciones",
    "dias": "Días hábiles de vacaciones",
    "motivo": "Motivo que escribió el empleado",
    "estado": "aprobada, rechazada o cancelada",
    "comentario": "Comentario de quien responde",
}

EJEMPLO = {
    "empresa": "Hotel Mar",
    "nombre": "Lucía",
    "nombre_completo": "Lucía Mar Pérez",
    "correo": "lucia@hotelmar.mx",
    "horas": "72",
    "usuario_envia": "Odai",
    "empleado": "Lucía Mar Pérez",
    "fechas": "02/12/2026 al 13/12/2026",
    "dias": "10",
    "motivo": "Motivo: viaje familiar",
    "estado": "aprobada",
    "comentario": "Comentario: ¡Disfrútalas!",
}


class _Valores(dict):
    def __missing__(self, k: str) -> str:  # una variable desconocida se deja tal cual
        return "{" + k + "}"


def _llenar(texto: str, valores: dict[str, str], escapar: bool) -> str:
    seguros = _Valores({k: html.escape(str(v)) if escapar else str(v) for k, v in valores.items()})
    base = html.escape(texto) if escapar else texto
    # Las llaves se escaparon como texto normal; format_map solo reemplaza {variable}.
    try:
        lleno = base.format_map(seguros)
    except (ValueError, IndexError):  # llaves sueltas: se envía sin reemplazar
        lleno = base
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", lleno) if escapar else lleno


async def obtener(db: AsyncSession, clave: str) -> Plantilla:
    base = FABRICA[clave]
    fila = await db.get(PlantillaCorreo, clave)
    if fila is None:
        return base
    return Plantilla(
        base.nombre, base.descripcion, fila.asunto, fila.titulo, fila.cuerpo, fila.boton
    )


@dataclass
class Correo:
    asunto: str
    titulo: str
    parrafos: list[str]  # HTML seguro
    boton: str | None


def armar(p: Plantilla, valores: dict[str, str]) -> Correo:
    parrafos = [x.strip() for x in re.split(r"\n\s*\n", p.cuerpo) if x.strip()]
    return Correo(
        asunto=_llenar(p.asunto, valores, escapar=False).replace("\n", " ")[:200],
        titulo=_llenar(p.titulo, valores, escapar=True),
        parrafos=[_llenar(x, valores, escapar=True).replace("\n", "<br>") for x in parrafos],
        boton=_llenar(p.boton, valores, escapar=True) if p.boton else None,
    )
