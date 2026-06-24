from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_find_leads_dev_token() -> None:
    response = client.post(
        "/api/leads/find",
        headers={"Authorization": "Bearer dev"},
        json={"niche": "Real estate", "country": "United States", "city": "Austin"}
    )
    assert response.status_code == 200
    assert len(response.json()) >= 3
