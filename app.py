import os
import re
import sqlite3
from datetime import datetime
from functools import wraps

from flask import (
    Flask, flash, g, jsonify, redirect, render_template,
    request, session, url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__)

# Set SECRET_KEY in the environment for any real deployment (Docker, CI, ...).
# The fallback is only a convenience for local development.
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-only-change-me")
app.config["DATABASE"] = os.environ.get(
    "DATABASE_PATH", os.path.join(BASE_DIR, "database.db")
)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Used so a login attempt for an unknown email takes about as long as a real one.
DUMMY_HASH = generate_password_hash("not-a-real-password")


# ----------------------------------------------------------------------
# Database (SQLite, standard library only)
# ----------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    email      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts (user_id);
"""


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(app.config["DATABASE"])
    try:
        db.executescript(SCHEMA)
        db.commit()
    finally:
        db.close()


init_db()


# ----------------------------------------------------------------------
# Auth helpers
# ----------------------------------------------------------------------
def current_user():
    """Return the logged-in user row, or None."""
    user_id = session.get("user_id")
    if user_id is None:
        return None
    return get_db().execute(
        "SELECT id, email FROM users WHERE id = ?", (user_id,)
    ).fetchone()


def login_required(view):
    """Pages redirect to /login; API routes answer 401 JSON."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            session.clear()
            if request.path.startswith("/items"):
                return jsonify({"error": "Authentication required"}), 401
            return redirect(url_for("login"))
        g.user = user
        return view(*args, **kwargs)
    return wrapped


@app.after_request
def no_cache_dynamic(response):
    # Stops the Back button from showing a cached dashboard after logout.
    if request.endpoint != "static":
        response.headers["Cache-Control"] = "no-store"
    return response


def render_auth(mode, status=200, **context):
    context.setdefault("error", None)
    context.setdefault("errors", {})
    context.setdefault("email", "")
    return render_template("auth.html", mode=mode, **context), status


# ----------------------------------------------------------------------
# Pages: login / register / logout / app
# ----------------------------------------------------------------------
@app.route("/")
@login_required
def home():
    return render_template("index.html", user_email=g.user["email"])


@app.route("/register", methods=["GET", "POST"])
def register():
    if current_user() is not None:
        return redirect(url_for("home"))

    if request.method == "GET":
        return render_auth("register")

    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")
    confirm = request.form.get("confirm", "")

    errors = {}
    if not email:
        errors["email"] = "Email address is required."
    elif len(email) > 120 or not EMAIL_PATTERN.match(email):
        errors["email"] = "Please enter a valid email address."

    if not password:
        errors["password"] = "Password is required."
    elif len(password) < 8:
        errors["password"] = "Password must be at least 8 characters."
    elif len(password) > 128:
        errors["password"] = "Password must be 128 characters or fewer."

    if "password" not in errors and password != confirm:
        errors["confirm"] = "Passwords do not match."

    if not errors:
        db = get_db()
        exists = db.execute(
            "SELECT 1 FROM users WHERE email = ?", (email,)
        ).fetchone()
        if exists:
            errors["email"] = "An account with this email already exists."
        else:
            try:
                db.execute(
                    "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                    (email, generate_password_hash(password)),
                )
                db.commit()
            except sqlite3.IntegrityError:
                # Two registrations raced for the same email.
                errors["email"] = "An account with this email already exists."

    if errors:
        return render_auth("register", status=400, errors=errors, email=email)

    flash("Account created. Please sign in.", "success")
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user() is not None:
        return redirect(url_for("home"))

    if request.method == "GET":
        return render_auth("login")

    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")

    user = get_db().execute(
        "SELECT id, password_hash FROM users WHERE email = ?", (email,)
    ).fetchone()

    if user is None:
        check_password_hash(DUMMY_HASH, password)
        valid = False
    else:
        valid = check_password_hash(user["password_hash"], password)

    if not valid:
        return render_auth(
            "login", status=401, error="Invalid email or password.", email=email
        )

    session.clear()
    session["user_id"] = user["id"]
    return redirect(url_for("home"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# ----------------------------------------------------------------------
# Contacts API (every query is scoped to the logged-in user)
# ----------------------------------------------------------------------
def row_to_contact(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "phone": row["phone"],
        "email": row["email"],
    }


def like_pattern(text):
    escaped = (
        text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    )
    return f"%{escaped}%"


@app.route("/items", methods=["GET"])
@login_required
def get_items():
    rows = get_db().execute(
        "SELECT id, name, phone, email FROM contacts "
        "WHERE user_id = ? ORDER BY id",
        (g.user["id"],),
    ).fetchall()
    return jsonify([row_to_contact(r) for r in rows])


@app.route("/items", methods=["POST"])
@login_required
def add_item():
    data = request.get_json(silent=True)

    if not isinstance(data, dict) or not data:
        return jsonify({"error": "No data provided"}), 400

    name = str(data.get("name", "")).strip()
    phone = str(data.get("phone", "")).strip()
    email = str(data.get("email", "")).strip()

    if not name:
        return jsonify({"error": "Name is required"}), 400

    if len(name) > 100:
        return jsonify({"error": "Name must be 100 characters or fewer"}), 400

    if not (phone.isascii() and phone.isdigit() and len(phone) == 10):
        return jsonify({
            "error": "Phone number must contain exactly 10 digits"
        }), 400

    if not email or len(email) > 120 or not EMAIL_PATTERN.match(email):
        return jsonify({"error": "A valid email address is required"}), 400

    db = get_db()
    cursor = db.execute(
        "INSERT INTO contacts (user_id, name, phone, email) VALUES (?, ?, ?, ?)",
        (g.user["id"], name, phone, email),
    )
    db.commit()

    new_contact = {
        "id": cursor.lastrowid,
        "name": name,
        "phone": phone,
        "email": email,
    }
    return jsonify(new_contact), 201


@app.route("/items/search", methods=["GET"])
@login_required
def search_items():
    query = request.args.get("q", "").strip().lower()
    pattern = like_pattern(query)

    rows = get_db().execute(
        "SELECT id, name, phone, email FROM contacts "
        "WHERE user_id = ? AND ("
        "  lower(name)  LIKE ? ESCAPE '\\' OR"
        "  phone        LIKE ? ESCAPE '\\' OR"
        "  lower(email) LIKE ? ESCAPE '\\'"
        ") ORDER BY id",
        (g.user["id"], pattern, pattern, pattern),
    ).fetchall()
    return jsonify([row_to_contact(r) for r in rows])


@app.route("/items/<int:item_id>", methods=["DELETE"])
@login_required
def delete_item(item_id):
    db = get_db()
    # The user_id condition is the ownership check: another user's id
    # simply matches nothing and gets the same 404 as a missing contact.
    row = db.execute(
        "SELECT id, name, phone, email FROM contacts "
        "WHERE id = ? AND user_id = ?",
        (item_id, g.user["id"]),
    ).fetchone()

    if row is None:
        return jsonify({"error": "Contact not found"}), 404

    db.execute(
        "DELETE FROM contacts WHERE id = ? AND user_id = ?",
        (item_id, g.user["id"]),
    )
    db.commit()

    return jsonify({
        "message": "Contact deleted successfully",
        "deleted": row_to_contact(row)
    }), 200


# ----------------------------------------------------------------------
# DevOps routes (public, used by Docker / Prometheus / Grafana later)
# ----------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health():
    try:
        get_db().execute("SELECT 1").fetchone()
    except sqlite3.Error:
        return jsonify({
            "status": "unhealthy",
            "service": "Contact Manager",
            "timestamp": datetime.now().isoformat()
        }), 503

    return jsonify({
        "status": "healthy",
        "service": "Contact Manager",
        "timestamp": datetime.now().isoformat()
    })


@app.route("/metrics", methods=["GET"])
def metrics():
    db = get_db()
    contacts_total = db.execute("SELECT COUNT(*) FROM contacts").fetchone()[0]
    users_total = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    return (
        "# HELP contacts_total Total number of contacts\n"
        "# TYPE contacts_total gauge\n"
        f"contacts_total {contacts_total}\n"
        "# HELP users_total Total number of registered users\n"
        "# TYPE users_total gauge\n"
        f"users_total {users_total}\n"
    ), 200, {"Content-Type": "text/plain; version=0.0.4; charset=utf-8"}


if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
        debug=os.environ.get("FLASK_DEBUG", "1") == "1"
    )
