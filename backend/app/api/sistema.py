"""Configuración general de ODAITIME (todas las empresas): tema, imagen de inicio y enlaces."""

import csv
import uuid
from datetime import UTC, datetime
from io import BytesIO, StringIO
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from openpyxl import Workbook, load_workbook
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select

from app.api.deps import DB, require_roles
from app.core.config import get_settings
from app.models import ConfigSistema, Frase, Rol
from app.services import fotos

router = APIRouter(prefix="/sistema", tags=["sistema"])
_SUPER = [Depends(require_roles(Rol.SUPERADMIN))]
HEX = r"^#[0-9a-fA-F]{6}$"


class Colores(BaseModel):
    marca: str | None = Field(default=None, pattern=HEX)  # morado: botones activos, acentos
    acento: str | None = Field(default=None, pattern=HEX)  # azul secundario
    marino: str | None = Field(default=None, pattern=HEX)  # menú, encabezados y botón principal
    titulos: str | None = Field(default=None, pattern=HEX)  # beige: títulos y menú lateral
    texto: str | None = Field(default=None, pattern=HEX)  # texto principal
    texto_suave: str | None = Field(default=None, pattern=HEX)  # texto secundario


class Enlaces(BaseModel):
    url_tienda: str | None = Field(default=None, max_length=300, pattern=r"^https?://\S+$")
    url_soporte: str | None = Field(default=None, max_length=300, pattern=r"^https?://\S+$")


class TemaOut(BaseModel):
    colores: Colores
    imagen_version: str | None
    demo: bool = False
    url_tienda: str = ""
    url_soporte: str = ""
    # Valores guardados (vacío = se usa el del .env); solo para el formulario del superadmin.
    enlaces: Enlaces = Enlaces()
    # Fondo de la aplicación y pantalla de acceso (iguales para todas las empresas).
    fondo_color: str | None = None
    fondo_version: str | None = None
    login_version: str | None = None
    login_titulo: str | None = None
    login_subtitulo: str | None = None
    login_texto: str | None = None
    login_colores: dict[str, str | None] = {}  # titulo, subtitulo, texto
    frases: dict[str, int] = {}  # cuántos refranes y citas hay


async def _config(db: DB) -> ConfigSistema:
    c = await db.get(ConfigSistema, 1)
    if c is None:
        c = ConfigSistema(id=1, colores={})
        db.add(c)
        await db.flush()
    return c


def _version(d: datetime | None) -> str | None:
    return d.isoformat() if d else None


def _out(c: ConfigSistema | None, frases: dict[str, int] | None = None) -> TemaOut:
    cfg = get_settings()
    if c is None:
        return TemaOut(
            colores=Colores(),
            imagen_version=None,
            demo=cfg.demo,
            url_tienda=cfg.licencia_url_compra,
            url_soporte=cfg.url_soporte,
            frases=frases or {},
        )
    return TemaOut(
        colores=Colores(**(c.colores or {})),
        imagen_version=c.imagen_actualizada.isoformat() if c.imagen_actualizada else None,
        demo=cfg.demo,
        url_tienda=c.url_tienda or cfg.licencia_url_compra,
        url_soporte=c.url_soporte or cfg.url_soporte,
        enlaces=Enlaces(url_tienda=c.url_tienda, url_soporte=c.url_soporte),
        fondo_color=c.fondo_color,
        fondo_version=_version(c.fondo_actualizado),
        login_version=_version(c.login_actualizada),
        login_titulo=c.login_titulo,
        login_subtitulo=c.login_subtitulo,
        login_texto=c.login_texto,
        login_colores={
            "titulo": c.login_color_titulo,
            "subtitulo": c.login_color_subtitulo,
            "texto": c.login_color_texto,
        },
        frases=frases or {},
    )


@router.get("/tema", response_model=TemaOut)
async def tema(db: DB) -> TemaOut:
    """Público: los colores se aplican desde la pantalla de acceso."""
    conteo = dict((await db.execute(select(Frase.tipo, func.count()).group_by(Frase.tipo))).all())
    return _out(await db.get(ConfigSistema, 1), conteo)


@router.put("/tema", response_model=TemaOut, dependencies=_SUPER)
async def guardar_tema(data: Colores, db: DB) -> TemaOut:
    c = await _config(db)
    c.colores = {k: v.lower() for k, v in data.model_dump().items() if v}
    await db.commit()
    return _out(c)


@router.put("/enlaces", response_model=TemaOut, dependencies=_SUPER)
async def guardar_enlaces(data: Enlaces, db: DB) -> TemaOut:
    """Tienda en línea (cuando ya no hay cupo de empleados) y soporte de Odai."""
    c = await _config(db)
    c.url_tienda = data.url_tienda or None
    c.url_soporte = data.url_soporte or None
    await db.commit()
    return _out(c)


@router.get("/imagen-inicio")
async def imagen_inicio(db: DB) -> Response:
    datos = await db.scalar(select(ConfigSistema.imagen_inicio).where(ConfigSistema.id == 1))
    if not datos:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sin imagen de inicio")
    return Response(
        datos, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=31536000"}
    )


@router.put("/imagen-inicio", response_model=TemaOut, dependencies=_SUPER)
async def subir_imagen(db: DB, archivo: Annotated[UploadFile, File()]) -> TemaOut:
    c = await _config(db)
    c.imagen_inicio = await fotos.procesar_fondo(archivo)
    c.imagen_actualizada = datetime.now(UTC)
    await db.commit()
    return _out(c)


@router.delete("/imagen-inicio", response_model=TemaOut, dependencies=_SUPER)
async def quitar_imagen(db: DB) -> TemaOut:
    c = await _config(db)
    c.imagen_inicio = None
    c.imagen_actualizada = None
    await db.commit()
    return _out(c)


# --- Fondo de la aplicación e imagen de la pantalla de acceso ---

# tipo → (columna de la imagen, columna de su fecha)
_IMAGENES = {
    "inicio": ("imagen_inicio", "imagen_actualizada"),
    "fondo": ("fondo_imagen", "fondo_actualizado"),
    "login": ("login_imagen", "login_actualizada"),
}


def _tipo(tipo: str) -> tuple[str, str]:
    if tipo not in _IMAGENES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Imagen no encontrada")
    return _IMAGENES[tipo]


@router.get("/imagen/{tipo}")
async def ver_imagen(tipo: str, db: DB) -> Response:
    """Público: fondo de la app, imagen de inicio o del panel de acceso."""
    columna, _ = _tipo(tipo)
    datos = await db.scalar(select(getattr(ConfigSistema, columna)).where(ConfigSistema.id == 1))
    if not datos:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sin imagen")
    return Response(
        datos, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=31536000"}
    )


@router.put("/imagen/{tipo}", response_model=TemaOut, dependencies=_SUPER)
async def subir_imagen_tipo(tipo: str, db: DB, archivo: Annotated[UploadFile, File()]) -> TemaOut:
    columna, fecha = _tipo(tipo)
    c = await _config(db)
    setattr(c, columna, await fotos.procesar_fondo(archivo))
    setattr(c, fecha, datetime.now(UTC))
    await db.commit()
    return _out(c)


@router.delete("/imagen/{tipo}", response_model=TemaOut, dependencies=_SUPER)
async def quitar_imagen_tipo(tipo: str, db: DB) -> TemaOut:
    columna, fecha = _tipo(tipo)
    c = await _config(db)
    setattr(c, columna, None)
    setattr(c, fecha, None)
    await db.commit()
    return _out(c)


class AparienciaIn(BaseModel):
    fondo_color: str | None = Field(default=None, pattern=HEX)
    login_titulo: str | None = Field(default=None, max_length=120)
    login_subtitulo: str | None = Field(default=None, max_length=120)
    login_texto: str | None = Field(default=None, max_length=600)
    login_color_titulo: str | None = Field(default=None, pattern=HEX)
    login_color_subtitulo: str | None = Field(default=None, pattern=HEX)
    login_color_texto: str | None = Field(default=None, pattern=HEX)


@router.put("/apariencia", response_model=TemaOut, dependencies=_SUPER)
async def guardar_apariencia(data: AparienciaIn, db: DB) -> TemaOut:
    """Color de fondo de la app y textos del panel de la pantalla de acceso."""
    c = await _config(db)
    c.fondo_color = data.fondo_color.lower() if data.fondo_color else None
    c.login_titulo = (data.login_titulo or "").strip() or None
    c.login_subtitulo = (data.login_subtitulo or "").strip() or None
    c.login_texto = (data.login_texto or "").strip() or None
    for campo in ("login_color_titulo", "login_color_subtitulo", "login_color_texto"):
        valor = getattr(data, campo)
        setattr(c, campo, valor.lower() if valor else None)
    await db.commit()
    return _out(c)


# --- Frases de la pantalla de acceso: frases, proverbios y citas bíblicas ---

TIPOS_FRASE = {"frase": "Frase", "proverbio": "Proverbio", "cita": "Cita bíblica"}


class FraseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tipo: str
    texto: str
    autor: str | None


@router.get("/frases/aleatoria", response_model=FraseOut | None)
async def frase_aleatoria(
    db: DB, tipo: str = "ambas", excluir: uuid.UUID | None = None
) -> Frase | None:
    """Público: una frase al azar del tipo pedido (frase, proverbio, cita o todas)."""
    q = select(Frase)
    if tipo in TIPOS_FRASE:
        q = q.where(Frase.tipo == tipo)
    if excluir is not None:
        q = q.where(Frase.id != excluir)
    frase = await db.scalar(q.order_by(func.random()).limit(1))
    if frase is None and excluir is not None:  # solo hay una: se repite
        frase = await db.get(Frase, excluir)
    return frase


@router.get("/frases", response_model=list[FraseOut], dependencies=_SUPER)
async def listar_frases(db: DB) -> list[Frase]:
    return list(await db.scalars(select(Frase).order_by(Frase.tipo, Frase.autor, Frase.texto)))


@router.get("/frases/plantilla", dependencies=_SUPER)
async def plantilla_frases() -> Response:
    wb = Workbook()
    ws = wb.active
    ws.title = "Frases"
    ws.append(["Tipo", "Texto", "Autor"])
    ws.append(["Frase", "La disciplina es el puente entre metas y logros.", "Jim Rohn"])
    ws.append(["Proverbio", "Al que madruga, Dios lo ayuda.", "Proverbio popular"])
    ws.append(["Cita bíblica", "Todo lo puedo en Cristo que me fortalece.", "Filipenses 4:13"])
    for col, ancho in zip("ABC", (14, 70, 28), strict=True):
        ws.column_dimensions[col].width = ancho
    salida = BytesIO()
    wb.save(salida)
    return Response(
        salida.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="plantilla_frases.xlsx"'},
    )


def _tipo_frase(valor: object) -> str | None:
    t = str(valor or "").strip().lower()
    t = t.replace("á", "a").replace("í", "i")
    if t.startswith("prov") or t.startswith("refr"):
        return "proverbio"
    if t.startswith("cita") or "bibl" in t:
        return "cita"
    if t.startswith("frase"):
        return "frase"
    return None


@router.post("/frases/importar", dependencies=_SUPER)
async def importar_frases(
    db: DB, archivo: Annotated[UploadFile, File()], reemplazar: bool = False
) -> dict[str, int]:
    """Importa de Excel o CSV: Tipo (Frase, Proverbio o Cita bíblica), Texto y Autor."""
    contenido = await archivo.read()
    if len(contenido) > 5 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Archivo mayor a 5 MB")
    nombre = (archivo.filename or "").lower()
    filas: list[list[object]] = []
    try:
        if nombre.endswith(".csv"):
            texto = contenido.decode("utf-8-sig")
            filas = list(csv.reader(StringIO(texto)))
        else:
            wb = load_workbook(BytesIO(contenido), read_only=True, data_only=True)
            filas = [list(f) for f in wb.active.iter_rows(values_only=True)]
    except Exception:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "No se pudo leer el archivo (Excel o CSV)"
        ) from None
    if filas and _tipo_frase(filas[0][0] if filas[0] else None) is None:
        filas = filas[1:]  # encabezados
    nuevas, omitidas = [], 0
    for f in filas:
        f = [*f, None, None, None]
        tipo, texto, autor = _tipo_frase(f[0]), str(f[1] or "").strip(), str(f[2] or "").strip()
        if not tipo or not texto:
            omitidas += 1
            continue
        nuevas.append(Frase(tipo=tipo, texto=texto[:600], autor=autor[:150] or None))
    if reemplazar:
        await db.execute(delete(Frase))
    db.add_all(nuevas)
    await db.commit()
    return {"importadas": len(nuevas), "omitidas": omitidas}


@router.delete("/frases/{frase_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=_SUPER)
async def borrar_frase(frase_id: uuid.UUID, db: DB) -> None:
    frase = await db.get(Frase, frase_id)
    if frase is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Frase no encontrada")
    await db.delete(frase)
    await db.commit()
