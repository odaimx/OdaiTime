#!/usr/bin/env python3
"""Puente ZKTeco → ODAITIME (para relojes sin envío directo a la nube).

Corre en una PC de la sucursal que esté en la misma red que el reloj: lee las marcas por la red
local (puerto 4370) y las sube a ODAITIME por HTTPS con el token del dispositivo. Si se cae el
internet, guarda dónde se quedó y las sube cuando regresa (el servidor no duplica marcas).

Uso:
  1) En ODAITIME › Dispositivos, da de alta el reloj (tipo «Reloj biométrico») y copia el código.
  2) Vincula una sola vez:
       python zkteco_puente.py vincular --servidor https://tuempresa.odai.lat --codigo 123456 \
           --reloj 192.168.1.201 [--puerto 4370] [--clave 0]
  3) Déjalo corriendo (o como tarea programada al iniciar Windows):
       python zkteco_puente.py
     Una sola pasada (para probar):  python zkteco_puente.py --una-vez

Requiere Python 3.10+ y la librería pyzk:  pip install pyzk
"""

import argparse
import json
import logging
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

CONFIG = Path(__file__).with_name("puente.json")
LOTE = 500
DIAS_MAX = 30  # el servidor rechaza marcas de más de 31 días

log = logging.getLogger("puente")


def cargar() -> dict:
    if not CONFIG.exists():
        sys.exit("Primero vincula el puente:  python zkteco_puente.py vincular --help")
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def guardar(cfg: dict) -> None:
    tmp = CONFIG.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(CONFIG)  # escritura atómica: no se corrompe si se apaga la PC


def pedir(url: str, datos: dict, token: str | None = None) -> dict:
    if not url.startswith("https://") and "localhost" not in url:
        sys.exit("La dirección del servidor debe empezar con https://")
    req = urllib.request.Request(
        url,
        data=json.dumps(datos).encode(),
        headers={"Content-Type": "application/json", **({"X-Dispositivo-Token": token} if token else {})},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"{}")


def vincular(a: argparse.Namespace) -> None:
    servidor = a.servidor.rstrip("/")
    r = pedir(f"{servidor}/api/kiosco/vincular", {"codigo": a.codigo})
    if r.get("dispositivo", {}).get("tipo") != "biometrico":
        sys.exit("Ese código no es de un reloj biométrico. Revisa el tipo en ODAITIME › Dispositivos.")
    guardar(
        {
            "servidor": servidor,
            "token": r["token"],
            "reloj": a.reloj,
            "puerto": a.puerto,
            "clave": a.clave,
            "intervalo": a.intervalo,
            "ultimo": None,
        }
    )
    print(f"Listo: puente vinculado a «{r['dispositivo']['nombre']}» ({r.get('empresa')}).")
    print(f"Configuración guardada en {CONFIG} (contiene el token: no la compartas).")


def leer_reloj(cfg: dict) -> list:
    from zk import ZK  # pyzk

    zk = ZK(cfg["reloj"], port=int(cfg.get("puerto", 4370)), timeout=15, password=int(cfg.get("clave", 0)), ommit_ping=True)
    conn = zk.connect()
    try:
        conn.disable_device()  # que nadie marque mientras se lee (unos segundos)
        return conn.get_attendance() or []
    finally:
        try:
            conn.enable_device()
        finally:
            conn.disconnect()


def pasada(cfg: dict) -> int:
    """Sube las marcas nuevas; devuelve cuántas se enviaron."""
    marcas = leer_reloj(cfg)
    desde = datetime.now() - timedelta(days=DIAS_MAX)
    if cfg.get("ultimo"):
        desde = max(desde, datetime.fromisoformat(cfg["ultimo"]))
    nuevas = sorted((m for m in marcas if m.timestamp > desde), key=lambda m: m.timestamp)
    enviadas = 0
    for i in range(0, len(nuevas), LOTE):
        lote = nuevas[i : i + LOTE]
        r = pedir(
            f"{cfg['servidor']}/api/biometrico/registros",
            {"registros": [{"numero": str(m.user_id).strip(), "momento": m.timestamp.isoformat()} for m in lote]},
            cfg["token"],
        )
        for e in r.get("errores", [])[:10]:
            log.warning("Marca rechazada: %s", e)
        cfg["ultimo"] = lote[-1].timestamp.isoformat()
        guardar(cfg)  # avanza solo lo que el servidor ya recibió
        enviadas += len(lote)
        log.info("Lote enviado: %s creadas, %s repetidas", r.get("creadas"), r.get("omitidas"))
    return enviadas


def correr(a: argparse.Namespace) -> None:
    cfg = cargar()
    espera = int(cfg.get("intervalo", 60))
    while True:
        try:
            n = pasada(cfg)
            log.info("Revisión terminada: %s marcas nuevas", n)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                sys.exit("El servidor rechazó el token: vuelve a vincular el puente con un código nuevo.")
            log.error("Servidor respondió %s; se reintenta", e.code)
        except Exception as e:  # noqa: BLE001 — reloj apagado, sin internet, etc.
            log.error("No se pudo completar la revisión: %s", e)
        if a.una_vez:
            return
        time.sleep(espera)


def main() -> None:
    p = argparse.ArgumentParser(description="Puente ZKTeco → ODAITIME")
    p.add_argument("--una-vez", action="store_true", help="hace una sola revisión y termina")
    sub = p.add_subparsers(dest="cmd")
    v = sub.add_parser("vincular", help="vincula el puente con el código de ODAITIME")
    v.add_argument("--servidor", required=True, help="https://tuempresa.odai.lat")
    v.add_argument("--codigo", required=True, help="código de 6 dígitos de Dispositivos")
    v.add_argument("--reloj", required=True, help="IP del reloj en la red local")
    v.add_argument("--puerto", type=int, default=4370)
    v.add_argument("--clave", type=int, default=0, help="contraseña de comunicación del reloj (Comm Key)")
    v.add_argument("--intervalo", type=int, default=60, help="segundos entre revisiones")
    a = p.parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.StreamHandler(), logging.FileHandler(CONFIG.with_name("puente.log"), encoding="utf-8")],
    )
    if a.cmd == "vincular":
        vincular(a)
    else:
        correr(a)


if __name__ == "__main__":
    main()
