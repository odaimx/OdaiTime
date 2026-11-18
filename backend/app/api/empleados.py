import secrets
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, CurrentUser, empresa_scope, require_roles
from app.api.turnos import obtener_turno
from app.core.security import hash_password
from app.models import AsignacionTurno, Checada, Empleado, Rol, Sesion, Sucursal, Turno, Usuario
from app.schemas.empleado import (
    AccesoIn,
    BajaIn,
    EmpleadoCreate,
    EmpleadoDetalle,
    EmpleadoOut,
    EmpleadoUpdate,
    ImportResultado,
)
from app.schemas.turno import AsignarTurnoIn
from app.services import accesos, bitacora, fotos, importar, licencia

_ADMIN = (Rol.SUPERADMIN, Rol.ADMIN_EMPRESA)
_GESTION = (*_ADMIN, Rol.GERENTE_SUCURSAL)

# Los gerentes gestionan a los empleados de sus sucursales; los administradores, a todos.
router = APIRouter(
    prefix="/empleados", tags=["empleados"], dependencies=[Depends(require_roles(*_GESTION))]
)

_DUPLICADO = HTTPException(
    status.HTTP_409_CONFLICT, "Ya existe un empleado con ese número o CURP en la empresa"
)


CAMPOS_BITACORA = (
    "numero",
    "nombre",
    "apellido_paterno",
    "apellido_materno",
    "curp",
    "rfc",
    "nss",
    "fecha_ingreso",
    "puesto",
    "departamento",
    "salario_diario",
    "email",
    "telefono",
)


def _snap(e: Empleado) -> dict:
    return bitacora.snapshot(
        e, CAMPOS_BITACORA, {"sucursal": e.sucursal.clave if e.sucursal else None}
    )


async def _log(db: DB, user: Usuario, e: Empleado, tipo: str, mensaje: str | None = None, **kw):
    await bitacora.registrar(
        db,
        empresa_id=e.empresa_id,
        modelo="empleado",
        registro_id=e.id,
        usuario=user,
        tipo=tipo,
        mensaje=mensaje,
        **kw,
    )


def _sucursales_permitidas(user: Usuario) -> set[uuid.UUID] | None:
    """None = todas las de la empresa."""
    if user.rol == Rol.GERENTE_SUCURSAL:
        return {s.id for s in user.sucursales}
    return None


async def _validar_sucursal(db: DB, user: Usuario, empresa_id: uuid.UUID, sucursal_id: uuid.UUID):
    permitidas = _sucursales_permitidas(user)
    sucursal = await db.scalar(
        select(Sucursal).where(Sucursal.id == sucursal_id, Sucursal.empresa_id == empresa_id)
    )
    if sucursal is None or (permitidas is not None and sucursal_id not in permitidas):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Sucursal inválida")
    return sucursal


async def _get(db: DB, user: Usuario, empleado_id: uuid.UUID, empresa_id: uuid.UUID) -> Empleado:
    q = select(Empleado).where(Empleado.id == empleado_id, Empleado.empresa_id == empresa_id)
    permitidas = _sucursales_permitidas(user)
    if permitidas is not None:
        q = q.where(Empleado.sucursal_id.in_(permitidas))
    empleado = await db.scalar(q)
    if empleado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empleado no encontrado")
    return empleado


def _recalcular_vigencias(empleado: Empleado) -> None:
    """Cada asignación termina el día anterior al inicio de la siguiente."""
    orden = sorted(empleado.asignaciones, key=lambda a: a.fecha_inicio)
    for actual, siguiente in zip(orden, [*orden[1:], None], strict=True):
        actual.fecha_fin = siguiente.fecha_inicio - timedelta(days=1) if siguiente else None


async def _asignar(db: DB, empleado: Empleado, turno: Turno, inicio: date) -> None:
    if not turno.activo:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El turno está inactivo")
    if inicio < empleado.fecha_ingreso:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "El turno no puede iniciar antes de la fecha de ingreso",
        )
    existente = next((a for a in empleado.asignaciones if a.fecha_inicio == inicio), None)
    if existente:
        existente.turno_id = turno.id
        existente.turno = turno
    else:
        empleado.asignaciones.append(
            AsignacionTurno(turno_id=turno.id, turno=turno, fecha_inicio=inicio)
        )
    _recalcular_vigencias(empleado)


async def _recargar(db: DB, empleado: Empleado) -> Empleado:
    await db.refresh(empleado, attribute_names=["sucursal", "asignaciones", "usuario"])
    return empleado


# --- Listado y plantilla (antes de /{empleado_id} para que no choquen las rutas) ---


@router.get("", response_model=list[EmpleadoOut])
async def listar(
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, max_length=100),
    sucursal_id: uuid.UUID | None = None,
    estado: str = Query(default="activos", pattern="^(activos|bajas|todos)$"),
) -> list[EmpleadoOut]:
    emp = empresa_scope(user, empresa_id)
    consulta = select(Empleado).where(Empleado.empresa_id == emp)
    permitidas = _sucursales_permitidas(user)
    if permitidas is not None:
        consulta = consulta.where(Empleado.sucursal_id.in_(permitidas))
    if sucursal_id:
        consulta = consulta.where(Empleado.sucursal_id == sucursal_id)
    if estado != "todos":
        consulta = consulta.where(Empleado.activo.is_(estado == "activos"))
    if q:
        patron = f"%{q.strip()}%"
        nombre = func.concat_ws(
            " ", Empleado.nombre, Empleado.apellido_paterno, Empleado.apellido_materno
        )
        consulta = consulta.where(
            or_(nombre.ilike(patron), Empleado.numero.ilike(patron), Empleado.curp.ilike(patron))
        )
    consulta = consulta.order_by(Empleado.apellido_paterno, Empleado.nombre)
    return [EmpleadoOut.de(e) for e in await db.scalars(consulta)]


@router.get("/presentes", response_model=list[uuid.UUID])
async def presentes(
    user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> list[uuid.UUID]:
    """Empleados "en el trabajo": su última checada válida (últimas 16 h) es una entrada."""
    emp = empresa_scope(user, empresa_id)
    desde = datetime.now(UTC) - timedelta(hours=16)
    ultima = (
        select(
            Checada.empleado_id,
            Checada.tipo,
            func.row_number()
            .over(partition_by=Checada.empleado_id, order_by=Checada.momento.desc())
            .label("n"),
        )
        .where(Checada.empresa_id == emp, Checada.estado == "valida", Checada.momento >= desde)
        .subquery()
    )
    q = select(ultima.c.empleado_id).where(ultima.c.n == 1, ultima.c.tipo == "entrada")
    permitidas = _sucursales_permitidas(user)
    if permitidas is not None:
        q = q.join(Empleado, Empleado.id == ultima.c.empleado_id).where(
            Empleado.sucursal_id.in_(permitidas)
        )
    return list(await db.scalars(q))


@router.get("/plantilla", dependencies=[Depends(require_roles(*_ADMIN))])
async def plantilla(user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None) -> Response:
    emp = empresa_scope(user, empresa_id)
    sucursales = list(
        await db.scalars(select(Sucursal).where(Sucursal.empresa_id == emp, Sucursal.activa))
    )
    turnos = list(await db.scalars(select(Turno).where(Turno.empresa_id == emp, Turno.activo)))
    contenido = importar.generar_plantilla(sucursales, turnos)
    return Response(
        contenido,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="plantilla_empleados.xlsx"'},
    )


@router.post(
    "/importar",
    response_model=ImportResultado,
    dependencies=[Depends(require_roles(*_ADMIN))],
)
async def importar_excel(
    user: CurrentUser,
    db: DB,
    archivo: Annotated[UploadFile, File()],
    empresa_id: uuid.UUID | None = None,
) -> ImportResultado:
    """Importa todo o nada: si una fila tiene error no se guarda ninguna."""
    emp = empresa_scope(user, empresa_id)
    datos = await archivo.read(importar.MAX_BYTES + 1)
    if len(datos) > importar.MAX_BYTES:
        raise HTTPException(413, "El archivo supera 5 MB")

    sucursales = {
        s.clave.upper(): s
        for s in await db.scalars(select(Sucursal).where(Sucursal.empresa_id == emp))
    }
    turnos = {
        t.nombre.lower(): t for t in await db.scalars(select(Turno).where(Turno.empresa_id == emp))
    }
    existentes = await db.execute(
        select(Empleado.numero, Empleado.curp).where(Empleado.empresa_id == emp)
    )
    numeros, curps = set(), set()
    for numero, curp in existentes:
        numeros.add(numero.upper())
        if curp:
            curps.add(curp)

    filas, errores = importar.leer(datos, sucursales, turnos, numeros, curps)
    if errores:
        return ImportResultado(creados=0, errores=errores)
    await licencia.verificar_cupo(db, emp, nuevos=len(filas))

    for data, turno in filas:
        empleado = Empleado(empresa_id=emp, **data.model_dump(exclude={"turno_id", "pin"}))
        empleado.asignaciones = []
        db.add(empleado)
        if turno:
            await _asignar(db, empleado, turno, empleado.fecha_ingreso)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            raise _DUPLICADO from None
        await _log(db, user, empleado, "creacion", f"Importado desde Excel ({archivo.filename})")
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _DUPLICADO from None
    return ImportResultado(creados=len(filas), errores=[])


# --- CRUD ---


@router.post("", response_model=EmpleadoDetalle, status_code=status.HTTP_201_CREATED)
async def crear(
    data: EmpleadoCreate, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> EmpleadoDetalle:
    emp = empresa_scope(user, empresa_id)
    await _validar_sucursal(db, user, emp, data.sucursal_id)
    await licencia.verificar_cupo(db, emp)
    empleado = Empleado(empresa_id=emp, **data.model_dump(exclude={"turno_id", "pin"}))
    if data.pin:
        empleado.pin_hash = hash_password(data.pin)
    empleado.asignaciones = []
    db.add(empleado)
    if data.turno_id:
        await _asignar(
            db, empleado, await obtener_turno(db, data.turno_id, emp), data.fecha_ingreso
        )
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise _DUPLICADO from None
    await _log(db, user, empleado, "creacion", "Empleado dado de alta")
    await db.commit()
    return EmpleadoDetalle.de(await _recargar(db, empleado))


@router.get("/{empleado_id}", response_model=EmpleadoDetalle)
async def obtener(
    empleado_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> EmpleadoDetalle:
    return EmpleadoDetalle.de(await _get(db, user, empleado_id, empresa_scope(user, empresa_id)))


@router.patch("/{empleado_id}", response_model=EmpleadoDetalle)
async def actualizar(
    empleado_id: uuid.UUID,
    data: EmpleadoUpdate,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> EmpleadoDetalle:
    emp = empresa_scope(user, empresa_id)
    empleado = await _get(db, user, empleado_id, emp)
    antes = _snap(empleado)
    cambios = data.model_dump(exclude_unset=True)
    pin_cambio = None
    if "pin" in cambios:
        nuevo_pin = cambios.pop("pin")
        empleado.pin_hash = hash_password(nuevo_pin) if nuevo_pin else None
        pin_cambio = "PIN del kiosco asignado" if nuevo_pin else "PIN del kiosco eliminado"
    for requerido in ("numero", "nombre", "apellido_paterno", "fecha_ingreso", "sucursal_id"):
        if requerido in cambios and cambios[requerido] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{requerido} es obligatorio")

    if "sucursal_id" in cambios and cambios["sucursal_id"] != empleado.sucursal_id:
        await _validar_sucursal(db, user, emp, cambios["sucursal_id"])
        if empleado.usuario_id:
            usuario = await db.get(Usuario, empleado.usuario_id)
            if usuario:
                usuario.sucursales = [await db.get(Sucursal, cambios["sucursal_id"])]

    for campo, valor in cambios.items():
        setattr(empleado, campo, valor)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _DUPLICADO from None
    await _recargar(db, empleado)
    await bitacora.cambios(
        db,
        empresa_id=emp,
        modelo="empleado",
        registro_id=empleado.id,
        usuario=user,
        antes=antes,
        despues=_snap(empleado),
        mensaje=pin_cambio,
    )
    await db.commit()
    return EmpleadoDetalle.de(empleado)


@router.post("/{empleado_id}/turno", response_model=EmpleadoDetalle)
async def asignar_turno(
    empleado_id: uuid.UUID,
    data: AsignarTurnoIn,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> EmpleadoDetalle:
    emp = empresa_scope(user, empresa_id)
    empleado = await _get(db, user, empleado_id, emp)
    turno = await obtener_turno(db, data.turno_id, emp)
    previo = empleado.turno_en(data.fecha_inicio)
    await _asignar(db, empleado, turno, data.fecha_inicio)
    await _log(
        db,
        user,
        empleado,
        "cambio",
        f"Turno a partir del {data.fecha_inicio:%d/%m/%Y}",
        cambios=[
            {
                "campo": "turno",
                "etiqueta": "Turno",
                "antes": previo.turno.nombre if previo else None,
                "despues": turno.nombre,
            }
        ],
    )
    await db.commit()
    return EmpleadoDetalle.de(await _recargar(db, empleado))


async def _cerrar_acceso(db: DB, usuario_id: uuid.UUID | None, activo: bool) -> None:
    if usuario_id is None:
        return
    await db.execute(update(Usuario).where(Usuario.id == usuario_id).values(activo=activo))
    if not activo:
        await db.execute(
            update(Sesion)
            .where(Sesion.usuario_id == usuario_id, Sesion.revocada_en.is_(None))
            .values(revocada_en=datetime.now(UTC))
        )


@router.post("/{empleado_id}/baja", response_model=EmpleadoDetalle)
async def dar_de_baja(
    empleado_id: uuid.UUID,
    data: BajaIn,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> EmpleadoDetalle:
    empleado = await _get(db, user, empleado_id, empresa_scope(user, empresa_id))
    if not empleado.activo:
        raise HTTPException(status.HTTP_409_CONFLICT, "El empleado ya está dado de baja")
    if data.fecha_baja < empleado.fecha_ingreso:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "La baja no puede ser anterior al ingreso"
        )
    empleado.activo = False
    empleado.fecha_baja = data.fecha_baja
    empleado.motivo_baja = data.motivo
    await _cerrar_acceso(db, empleado.usuario_id, activo=False)
    await _log(db, user, empleado, "cambio", f"Baja al {data.fecha_baja:%d/%m/%Y}: {data.motivo}")
    await db.commit()
    return EmpleadoDetalle.de(await _recargar(db, empleado))


@router.post("/{empleado_id}/reactivar", response_model=EmpleadoDetalle)
async def reactivar(
    empleado_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> EmpleadoDetalle:
    emp = empresa_scope(user, empresa_id)
    empleado = await _get(db, user, empleado_id, emp)
    if empleado.activo:
        raise HTTPException(status.HTTP_409_CONFLICT, "El empleado ya está activo")
    await licencia.verificar_cupo(db, emp)
    empleado.activo = True
    empleado.fecha_baja = None
    empleado.motivo_baja = None
    await _cerrar_acceso(db, empleado.usuario_id, activo=True)
    await _log(db, user, empleado, "cambio", "Empleado reactivado")
    await db.commit()
    return EmpleadoDetalle.de(await _recargar(db, empleado))


@router.post(
    "/{empleado_id}/acceso", response_model=EmpleadoDetalle, status_code=status.HTTP_201_CREATED
)
async def crear_acceso(
    empleado_id: uuid.UUID,
    data: AccesoIn,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> EmpleadoDetalle:
    """Crea el usuario (rol empleado) con el que la persona checará desde su celular."""
    emp = empresa_scope(user, empresa_id)
    empleado = await _get(db, user, empleado_id, emp)
    if empleado.usuario_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "El empleado ya tiene acceso")
    if not empleado.activo:
        raise HTTPException(status.HTTP_409_CONFLICT, "El empleado está dado de baja")
    email = data.email.lower()
    if await db.scalar(select(func.count()).where(func.lower(Usuario.email) == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un usuario con ese correo")

    usuario = Usuario(
        empresa_id=emp,
        email=email,
        nombre=empleado.nombre_completo,
        password_hash=hash_password(data.password),
        rol=Rol.EMPLEADO,
        sucursales=[empleado.sucursal],
    )
    db.add(usuario)
    await db.flush()
    empleado.usuario_id = usuario.id
    await _log(db, user, empleado, "cambio", f"Acceso a la app creado ({email})")
    await db.commit()
    return EmpleadoDetalle.de(await _recargar(db, empleado))


# --- Portal del trabajador (invitación por correo) ---


class PortalIn(BaseModel):
    email: EmailStr | None = None  # si no se manda, se usa el correo del expediente


class PortalOut(BaseModel):
    empleado: EmpleadoDetalle
    enviado: bool  # se mandó el correo de invitación
    enlace: str | None = None  # solo si no se pudo enviar, para compartirlo a mano


@router.post("/{empleado_id}/portal", response_model=PortalOut)
async def dar_portal(
    empleado_id: uuid.UUID,
    data: PortalIn,
    request: Request,
    user: CurrentUser,
    db: DB,
    empresa_id: uuid.UUID | None = None,
) -> PortalOut:
    """Da acceso al portal: crea (o reactiva) su usuario y le manda el enlace para su clave."""
    emp = empresa_scope(user, empresa_id)
    empleado = await _get(db, user, empleado_id, emp)
    if not empleado.activo:
        raise HTTPException(status.HTTP_409_CONFLICT, "El empleado está dado de baja")
    usuario = await db.get(Usuario, empleado.usuario_id) if empleado.usuario_id else None
    if usuario is None:
        email = (data.email or empleado.email or "").lower()
        if not email:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Captura el correo del empleado para enviarle su acceso",
            )
        if await db.scalar(select(func.count()).where(func.lower(Usuario.email) == email)):
            raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un usuario con ese correo")
        usuario = Usuario(
            empresa_id=emp,
            email=email,
            nombre=empleado.nombre_completo,
            # Clave aleatoria que nadie conoce: la persona crea la suya con el enlace del correo.
            password_hash=hash_password(secrets.token_urlsafe(32)),
            rol=Rol.EMPLEADO,
            sucursales=[empleado.sucursal],
        )
        db.add(usuario)
        await db.flush()
        empleado.usuario_id = usuario.id
    else:
        usuario.activo = True
    enviado, enlace = await accesos.enviar_enlace(db, request, usuario, "invitacion")
    await _log(
        db,
        user,
        empleado,
        "cambio",
        f"Acceso al portal ({usuario.email}): "
        + (
            "invitación enviada por correo"
            if enviado
            else "invitación sin enviar (correo no configurado)"
        ),
    )
    await db.commit()
    return PortalOut(
        empleado=EmpleadoDetalle.de(await _recargar(db, empleado)),
        enviado=enviado,
        enlace=None if enviado else enlace,
    )


@router.delete("/{empleado_id}/portal", response_model=EmpleadoDetalle)
async def quitar_portal(
    empleado_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> EmpleadoDetalle:
    empleado = await _get(db, user, empleado_id, empresa_scope(user, empresa_id))
    await _cerrar_acceso(db, empleado.usuario_id, activo=False)
    await _log(db, user, empleado, "cambio", "Acceso al portal retirado")
    await db.commit()
    return EmpleadoDetalle.de(await _recargar(db, empleado))


# --- Foto de la ficha ---


@router.put("/{empleado_id}/foto", response_model=EmpleadoDetalle)
async def subir_foto(
    empleado_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    archivo: Annotated[UploadFile, File()],
    empresa_id: uuid.UUID | None = None,
) -> EmpleadoDetalle:
    empleado = await _get(db, user, empleado_id, empresa_scope(user, empresa_id))
    tamanos = await fotos.procesar(archivo)
    empleado.foto, empleado.foto_128 = tamanos[512], tamanos[128]
    empleado.foto_actualizada = datetime.now(UTC)
    await _log(db, user, empleado, "cambio", "Foto actualizada")
    await db.commit()
    return EmpleadoDetalle.de(await _recargar(db, empleado))


@router.delete("/{empleado_id}/foto", response_model=EmpleadoDetalle)
async def quitar_foto(
    empleado_id: uuid.UUID, user: CurrentUser, db: DB, empresa_id: uuid.UUID | None = None
) -> EmpleadoDetalle:
    empleado = await _get(db, user, empleado_id, empresa_scope(user, empresa_id))
    if empleado.foto_actualizada:
        empleado.foto = None
        empleado.foto_128 = None
        empleado.foto_actualizada = None
        await _log(db, user, empleado, "cambio", "Foto eliminada")
        await db.commit()
    return EmpleadoDetalle.de(await _recargar(db, empleado))


@router.get("/{empleado_id}/foto")
async def ver_foto(
    empleado_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    tam: int = Query(default=512, description="512 (ficha) o 128 (listados)"),
    empresa_id: uuid.UUID | None = None,
) -> Response:
    emp = empresa_scope(user, empresa_id)
    columna = Empleado.foto_128 if tam <= 128 else Empleado.foto
    q = select(columna).where(Empleado.id == empleado_id, Empleado.empresa_id == emp)
    permitidas = _sucursales_permitidas(user)
    if permitidas is not None:
        q = q.where(Empleado.sucursal_id.in_(permitidas))
    datos = await db.scalar(q)
    if not datos:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sin foto")
    return Response(
        datos, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"}
    )
