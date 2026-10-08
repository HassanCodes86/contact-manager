import pytest
from app import app


@pytest.fixture
def client():
  app.config["TESTING"] = True
  with app.test_client() as client:
    yield client


def test_health(client):
  response = client.get("/health")
  assert response.status_code == 200
  assert response.get_json() == {"status": "OK"}


def test_get_contacts(client):
  response = client.get("/items")
  assert response.status_code == 200
  assert isinstance(response.get_json(), list)


def test_add_contact(client):
  payload = {"name": "Charlie Brown", "phone": "9998887770"}
  response = client.post("/items", json=payload)
  assert response.status_code == 201
  assert response.get_json()["name"] == "Charlie Brown"