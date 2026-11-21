from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update

from app.db.session import SessionLocal
from app.models import Checada
from app.services import checadas as svc
from app.services import retencion
from tests.test_checadas import CERCA, JPG, _config, _setup


def test_limite_de_meses():
    d = datetime(2026, 3, 31, 12, tzinfo=UTC)
    assert retencion.limite(1, d) == datetime(2026, 2, 28, 12, tzinfo=UTC)
    assert retencion.limite(24, d) == datetime(2024, 3, 31, 12, tzinfo=UTC)
    assert retencion.limite(3, datetime(2026, 1, 15, tzinfo=UTC)).month == 10


async def test_retencion_de_fotos(client, superadmin, tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "dir_fotos", lambda: tmp_path)
    a, e, _, _ = await _setup(client, superadmin)
    await _config(client, a, permitir_movil=True, foto="movil", ignorar_repetida_min=0)
    r = await client.post("/api/checadas", headers=e, data=CERCA, files={"foto": JPG})
    assert r.status_code == 201, r.text

    # Solo el superadmin la configura; por defecto 24 meses.
    assert (await client.get("/api/sistema/retencion-fotos", headers=a)).status_code == 403
    cfg = (await client.get("/api/sistema/retencion-fotos", headers=superadmin)).json()
    assert cfg["meses"] == 24 and cfg["por_borrar"] == 0
    r = await client.put("/api/sistema/retencion-fotos", headers=superadmin, json={"meses": 7})
    assert r.status_code == 422

    # La checada "envejece" 13 meses: con 12 meses de retención su foto se borra.
    async with SessionLocal() as db:
        await db.execute(update(Checada).values(momento=datetime.now(UTC) - timedelta(days=400)))
        await db.commit()
        rel = await db.scalar(select(Checada.foto))
    archivo = tmp_path / rel
    assert archivo.exists()
    cfg = (
        await client.put("/api/sistema/retencion-fotos", headers=superadmin, json={"meses": 12})
    ).json()
    assert cfg["por_borrar"] == 1
    async with SessionLocal() as db:
        assert await retencion.purgar_fotos(db, 12) == 1
        c = await db.scalar(select(Checada))
        assert c.foto is None and c.tipo == "entrada"  # la checada se conserva
    assert not archivo.exists()

    # "No borrar": nada pendiente.
    cfg = (
        await client.put("/api/sistema/retencion-fotos", headers=superadmin, json={"meses": None})
    ).json()
    assert cfg["meses"] is None and cfg["por_borrar"] == 0


async def test_precision_gps_por_sucursal(client, superadmin):
    a, e, suc, _ = await _setup(client, superadmin)
    await _config(client, a, permitir_movil=True, ignorar_repetida_min=0)
    assert suc.get("precision_gps_m") == 100  # por defecto
    impreciso = {**CERCA, "precision": "80"}
    r = await client.patch(f"/api/sucursales/{suc['id']}", headers=a, json={"precision_gps_m": 50})
    assert r.status_code == 200 and r.json()["precision_gps_m"] == 50
    r = await client.post("/api/checadas", headers=e, data=impreciso)
    assert r.status_code == 422 and r.json()["detail"]["codigo"] == "gps_impreciso"
    assert r.json()["detail"]["maxima"] == 50
    await client.patch(f"/api/sucursales/{suc['id']}", headers=a, json={"precision_gps_m": 100})
    r = await client.post("/api/checadas", headers=e, data=impreciso)
    assert r.status_code == 201, r.text
