"""Fotos de la ficha del empleado: se reducen y se guardan como JPEG en la base de datos."""

from io import BytesIO

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.services.checadas import error

MAX_ENTRADA = 10 * 1024 * 1024
LADO_MAX = 400


async def procesar(archivo: UploadFile) -> bytes:
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
    img.thumbnail((LADO_MAX, LADO_MAX))
    salida = BytesIO()
    img.convert("RGB").save(salida, "JPEG", quality=82, optimize=True)  # sin EXIF ni GPS
    return salida.getvalue()
