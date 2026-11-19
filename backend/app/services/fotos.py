"""Fotos de la ficha del empleado.

Como Odoo, de cada foto se generan varios tamaños al subirla: 512 px para la ficha y 128 px
para los listados (miniatura de pocos KB). Se guardan como JPEG sin metadatos (EXIF/GPS).
"""

from io import BytesIO

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.services.checadas import error

MAX_ENTRADA = 10 * 1024 * 1024
TAMANOS = (512, 128)


async def procesar(archivo: UploadFile) -> dict[int, bytes]:
    datos = await archivo.read(MAX_ENTRADA + 1)
    if len(datos) > MAX_ENTRADA:
        raise error("foto_grande", "La foto supera 10 MB.")
    try:
        img = Image.open(BytesIO(datos))
        img.load()
    except (UnidentifiedImageError, OSError):
        raise error("foto_invalida", "El archivo no es una imagen válida.") from None
    img = ImageOps.exif_transpose(img)  # respeta la orientación de la cámara del celular
    if img.mode not in ("RGB", "L"):
        fondo = Image.new("RGB", img.size, (255, 255, 255))
        fondo.paste(img, mask=img.convert("RGBA").split()[-1])
        img = fondo
    img = img.convert("RGB")
    resultado: dict[int, bytes] = {}
    for lado in TAMANOS:
        copia = img.copy()
        copia.thumbnail((lado, lado))
        salida = BytesIO()
        copia.save(salida, "JPEG", quality=82 if lado > 128 else 78, optimize=True)
        resultado[lado] = salida.getvalue()
    return resultado


LOGO_LADO = 512


async def procesar_logo(archivo: UploadFile) -> bytes:
    """Logo de la empresa: PNG de máx. 512 px que conserva la transparencia."""
    datos = await archivo.read(MAX_ENTRADA + 1)
    if len(datos) > MAX_ENTRADA:
        raise error("logo_grande", "El logo supera 10 MB.")
    try:
        img = Image.open(BytesIO(datos))
        img.load()
    except (UnidentifiedImageError, OSError):
        raise error(
            "logo_invalido", "El archivo no es una imagen válida (usa PNG o JPG)."
        ) from None
    img = ImageOps.exif_transpose(img)
    img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P", "PA") else "RGB")
    img.thumbnail((LOGO_LADO, LOGO_LADO))
    salida = BytesIO()
    img.save(salida, "PNG", optimize=True)
    return salida.getvalue()


FONDO_ANCHO = 1920


async def procesar_fondo(archivo: UploadFile) -> bytes:
    """Imagen de fondo de la empresa: JPEG de máx. 1920 px de ancho."""
    datos = await archivo.read(MAX_ENTRADA + 1)
    if len(datos) > MAX_ENTRADA:
        raise error("fondo_grande", "La imagen supera 10 MB.")
    try:
        img = Image.open(BytesIO(datos))
        img.load()
    except (UnidentifiedImageError, OSError):
        raise error(
            "fondo_invalido", "El archivo no es una imagen válida (usa PNG o JPG)."
        ) from None
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((FONDO_ANCHO, FONDO_ANCHO))
    salida = BytesIO()
    img.save(salida, "JPEG", quality=82, optimize=True, progressive=True)
    return salida.getvalue()


ICONO_LADO = 128


async def procesar_icono(archivo: UploadFile) -> bytes:
    """Ícono de la pestaña del navegador: PNG cuadrado de 128 px (se recorta al centro)."""
    datos = await archivo.read(MAX_ENTRADA + 1)
    if len(datos) > MAX_ENTRADA:
        raise error("icono_grande", "La imagen supera 10 MB.")
    try:
        img = Image.open(BytesIO(datos))
        img.load()
    except (UnidentifiedImageError, OSError):
        raise error("icono_invalido", "El archivo no es una imagen válida (usa PNG).") from None
    img = ImageOps.exif_transpose(img).convert("RGBA")
    img = ImageOps.fit(img, (ICONO_LADO, ICONO_LADO), Image.Resampling.LANCZOS)
    salida = BytesIO()
    img.save(salida, "PNG", optimize=True)
    return salida.getvalue()
