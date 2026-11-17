from httpx import ASGITransport, AsyncClient

from app.main import app


async def test_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_ready_reports_checks():
    # En CI hay PostgreSQL y Valkey reales; en local puede devolver 503 sin servicios.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/health/ready")
    body = response.json()
    assert set(body["checks"]) == {"database", "cache"}
    assert response.status_code in (200, 503)
