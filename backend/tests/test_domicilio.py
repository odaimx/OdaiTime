from tests.test_checadas import _setup


async def test_domicilio_desglosado_arma_la_direccion(client, superadmin):
    a, _, suc, _ = await _setup(client, superadmin)
    r = await client.patch(
        f"/api/sucursales/{suc['id']}",
        headers=a,
        json={
            "calle": "Calle 71 No. 800",
            "colonia": "Ciudad Caucel",
            "codigo_postal": "97314",
            "ciudad": "Mérida",
            "entidad": "Yucatán",
        },
    )
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["colonia"] == "Ciudad Caucel" and s["codigo_postal"] == "97314"
    assert s["direccion"] == ("Calle 71 No. 800, Col. Ciudad Caucel, C.P. 97314, Mérida, Yucatán")

    r = await client.patch(
        f"/api/sucursales/{suc['id']}", headers=a, json={"codigo_postal": "9731"}
    )
    assert r.status_code == 422

    r = await client.patch(
        "/api/tenant/empresa",
        headers=a,
        json={"nombre": "Hotel Caribe", "calle": "Av. Tulum 123", "ciudad": "Cancún"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["direccion"] == "Av. Tulum 123, Cancún"
