import os
import sqlite3
import tempfile

import pytest

# app.py reads DATABASE_PATH and runs init_db() at import time, so the
# environment variable must point at a throwaway file BEFORE "app" is
# imported. This keeps the real database.db untouched.
_IMPORT_TMP_DIR = tempfile.mkdtemp(prefix="contact_manager_import_")
os.environ["DATABASE_PATH"] = os.path.join(_IMPORT_TMP_DIR, "import.db")

from app import app, init_db  # noqa: E402

TEST_EMAIL = "tester@example.com"
TEST_PASSWORD = "StrongPass123"


@pytest.fixture
def client(tmp_path):
    """Test client backed by a fresh, empty SQLite database for every test."""
    app.config["TESTING"] = True
    app.config["DATABASE"] = str(tmp_path / "test.db")
    init_db()
    with app.test_client() as test_client:
        yield test_client


def register_and_login(client, email=TEST_EMAIL, password=TEST_PASSWORD):
    """Use the real /register and /login routes (form-encoded, as app.py expects)."""
    register_response = client.post(
        "/register",
        data={"email": email, "password": password, "confirm": password},
    )
    assert register_response.status_code == 302
    assert register_response.headers["Location"].endswith("/login")

    login_response = client.post(
        "/login", data={"email": email, "password": password}
    )
    assert login_response.status_code == 302
    assert login_response.headers["Location"].endswith("/")
    return login_response


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "healthy"
    assert data["service"] == "Contact Manager"
    assert "timestamp" in data


def test_items_require_login(client):
    # Authentication must stay enforced: no session -> 401, not 200.
    response = client.get("/items")
    assert response.status_code == 401
    assert response.get_json() == {"error": "Authentication required"}


def test_get_contacts(client):
    register_and_login(client)
    response = client.get("/items")
    assert response.status_code == 200
    assert response.get_json() == []


def test_add_contact(client):
    register_and_login(client)
    payload = {
        "name": "Charlie Brown",
        "phone": "9998887770",
        "email": "charlie@example.com",
    }
    response = client.post("/items", json=payload)
    assert response.status_code == 201

    created = response.get_json()
    assert created["name"] == "Charlie Brown"
    assert created["phone"] == "9998887770"
    assert created["email"] == "charlie@example.com"
    assert isinstance(created["id"], int)

    # The contact is really stored and visible to the logged-in user.
    listing = client.get("/items")
    assert listing.status_code == 200
    assert [c["name"] for c in listing.get_json()] == ["Charlie Brown"]

    # And it is in the isolated test database, not the real one.
    conn = sqlite3.connect(app.config["DATABASE"])
    try:
        count = conn.execute("SELECT COUNT(*) FROM contacts").fetchone()[0]
    finally:
        conn.close()
    assert count == 1
