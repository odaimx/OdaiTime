"""Bitácora tipo chatter: registra quién cambió qué (antes → después) y notas internas."""

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Actividad, Usuario

MODELOS = (
    "empleado",
    "sucursal",
    "turno",
    "checada",
    "config_checadas",
    "dispositivo",
    "politica_asistencia",
)

ETIQUETAS: dict[str, dict[str, str]] = {
    "empleado": {
        "numero": "Número",
        "nombre": "Nombre",
        "apellido_paterno": "Apellido paterno",
        "apellido_materno": "Apellido materno",
        "curp": "CURP",
        "rfc": "RFC",
        "nss": "NSS",
        "fecha_ingreso": "Fecha de ingreso",
        "puesto": "Puesto",
        "departamento": "Departamento",
        "salario_diario": "Salario diario",
        "email": "Correo",
        "telefono": "Teléfono",
        "sucursal": "Sucursal",
        "turno": "Turno",
        "activo": "Activo",
        "pin": "PIN del kiosco",
        "medios_checado": "Medios de checado",
        "dispositivos_checado": "Kioscos / relojes",
    },
    "sucursal": {
        "clave": "Clave",
        "nombre": "Nombre",
        "zona_horaria": "Zona horaria",
        "direccion": "Dirección",
        "calle": "Calle y número",
        "colonia": "Colonia",
        "codigo_postal": "C.P.",
        "ciudad": "Ciudad",
        "entidad": "Estado",
        "latitud": "Latitud",
        "longitud": "Longitud",
        "radio_metros": "Radio (m)",
        "activa": "Activa",
    },
    "turno": {
        "nombre": "Nombre",
        "tipo_jornada": "Jornada",
        "tolerancia_minutos": "Tolerancia (min)",
        "horario": "Horario",
        "activo": "Activo",
    },
    "checada": {
        "tipo": "Tipo",
        "momento": "Hora",
        "estado": "Estado",
    },
    "config_checadas": {
        "permitir_movil": "Checar desde el celular",
        "permitir_kiosco": "Checar en kiosco",
        "validar_gps": "Validar GPS",
        "validar_qr": "QR del kiosco",
        "foto": "Foto al checar",
        "pin_kiosco": "PIN en kiosco",
        "minutos_antes_entrada": "Minutos antes de la entrada",
        "ignorar_repetida_min": "Ignorar repetida (min)",
        "permitir_offline": "Checar sin internet",
        "offline_max_horas": "Horas máx. sin internet",
    },
    "dispositivo": {"nombre": "Nombre", "activo": "Activo", "sucursal": "Sucursal"},
    "politica_asistencia": {
        "retardos_por_falta": "Retardos que equivalen a una falta",
        "retardo_falta_min": "Retardo que cuenta como falta (min)",
        "minimo_extra_min": "Tiempo extra mínimo (min)",
        "redondeo_extra_min": "Redondeo de tiempo extra (min)",
        "festivo_opcional_pago": "Pago de festivo opcional trabajado",
    },
}


def _ser(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return "Sí" if v else "No"
    if isinstance(v, Enum):
        return v.value
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, time):
        return v.strftime("%H:%M")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal | float):
        return f"{v:.2f}".rstrip("0").rstrip(".") if isinstance(v, float) else str(v)
    if isinstance(v, uuid.UUID):
        return str(v)
    return str(v)


def snapshot(obj, campos, extra: dict | None = None) -> dict:
    datos = {c: _ser(getattr(obj, c, None)) for c in campos}
    datos.update({k: _ser(v) for k, v in (extra or {}).items()})
    return datos


def diff(modelo: str, antes: dict, despues: dict) -> list[dict]:
    etiquetas = ETIQUETAS.get(modelo, {})
    return [
        {
            "campo": c,
            "etiqueta": etiquetas.get(c, c),
            "antes": antes.get(c),
            "despues": despues.get(c),
        }
        for c in despues
        if antes.get(c) != despues.get(c)
    ]


async def registrar(
    db: AsyncSession,
    *,
    empresa_id: uuid.UUID,
    modelo: str,
    registro_id: uuid.UUID,
    usuario: Usuario | None,
    tipo: str,
    mensaje: str | None = None,
    cambios: list[dict] | None = None,
) -> Actividad | None:
    """Agrega la entrada a la sesión (sin commit). Un "cambio" sin diferencias no se guarda."""
    if tipo == "cambio" and not cambios and not mensaje:
        return None
    act = Actividad(
        empresa_id=empresa_id,
        modelo=modelo,
        registro_id=registro_id,
        usuario_id=usuario.id if usuario else None,
        tipo=tipo,
        mensaje=mensaje,
        cambios=cambios or None,
    )
    db.add(act)
    return act


async def cambios(
    db: AsyncSession,
    *,
    empresa_id: uuid.UUID,
    modelo: str,
    registro_id: uuid.UUID,
    usuario: Usuario | None,
    antes: dict,
    despues: dict,
    mensaje: str | None = None,
) -> None:
    await registrar(
        db,
        empresa_id=empresa_id,
        modelo=modelo,
        registro_id=registro_id,
        usuario=usuario,
        tipo="cambio",
        mensaje=mensaje,
        cambios=diff(modelo, antes, despues),
    )
