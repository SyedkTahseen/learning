from datetime import date, datetime

import bcrypt
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from mysql.connector import Error, IntegrityError

from auth import auth_required, create_token
from config import Config
from db import get_connection

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": [Config.FRONTEND_URL]}}, allow_headers=["Content-Type", "Authorization"])

VALID_STATUSES = {"pending", "in_progress", "completed"}
VALID_PRIORITIES = {"low", "medium", "high"}


def json_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def serialize_task(task):
    return {key: json_value(value) for key, value in task.items()}


def body():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return None
    return payload


def valid_due_date(value):
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError
    return date.fromisoformat(value)


@app.get("/health")
def health():
    try:
        connection = get_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        connection.close()
        return jsonify({"status": "ok", "database": "connected"})
    except Error as error:
        app.logger.error("Database health check failed: %s", error)
        return jsonify({"status": "degraded", "database": "unavailable"}), 503


@app.post("/api/auth/register")
def register():
    payload = body()
    if not payload or not all(payload.get(key) for key in ("name", "email", "password")):
        return jsonify({"error": "name, email and password are required"}), 400

    name, email, password = payload["name"].strip(), payload["email"].strip().lower(), payload["password"]
    if len(name) > 100 or len(email) > 255 or len(password) < 8:
        return jsonify({"error": "Use a name up to 100 characters, valid email, and password of at least 8 characters"}), 400

    connection = None
    try:
        connection = get_connection()
        cursor = connection.cursor()
        hashed_password = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        cursor.execute("INSERT INTO users (name, email, password_hash) VALUES (%s, %s, %s)", (name, email, hashed_password))
        connection.commit()
        user_id = cursor.lastrowid
        cursor.close()
        return jsonify({"message": "Registration successful", "token": create_token(user_id), "user": {"id": user_id, "name": name, "email": email}}), 201
    except IntegrityError:
        return jsonify({"error": "An account with this email already exists"}), 409
    except Error:
        return jsonify({"error": "Could not create account"}), 500
    finally:
        if connection and connection.is_connected():
            connection.close()


@app.post("/api/auth/login")
def login():
    payload = body()
    if not payload or not payload.get("email") or not payload.get("password"):
        return jsonify({"error": "email and password are required"}), 400
    connection = None
    try:
        connection = get_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT id, name, email, password_hash FROM users WHERE email = %s", (payload["email"].strip().lower(),))
        user = cursor.fetchone()
        cursor.close()
        if not user or not bcrypt.checkpw(payload["password"].encode(), user["password_hash"].encode()):
            return jsonify({"error": "Invalid email or password"}), 401
        return jsonify({"message": "Login successful", "token": create_token(user["id"]), "user": {"id": user["id"], "name": user["name"], "email": user["email"]}})
    except Error:
        return jsonify({"error": "Could not log in"}), 500
    finally:
        if connection and connection.is_connected():
            connection.close()


@app.get("/api/tasks")
@auth_required
def list_tasks():
    status = request.args.get("status")
    if status and status not in VALID_STATUSES:
        return jsonify({"error": "Invalid status filter"}), 400
    connection = None
    try:
        connection = get_connection()
        cursor = connection.cursor(dictionary=True)
        query, params = "SELECT * FROM tasks WHERE user_id = %s", [g.user_id]
        if status:
            query += " AND status = %s"
            params.append(status)
        query += " ORDER BY created_at DESC"
        cursor.execute(query, params)
        tasks = cursor.fetchall()
        cursor.close()
        return jsonify({"tasks": [serialize_task(task) for task in tasks]})
    except Error:
        return jsonify({"error": "Could not retrieve tasks"}), 500
    finally:
        if connection and connection.is_connected():
            connection.close()


@app.post("/api/tasks")
@auth_required
def create_task():
    payload = body()
    title = payload.get("title", "").strip() if payload else ""
    status = payload.get("status", "pending") if payload else "pending"
    priority = payload.get("priority", "medium") if payload else "medium"
    if not title or len(title) > 255 or status not in VALID_STATUSES or priority not in VALID_PRIORITIES:
        return jsonify({"error": "title is required (max 255 characters) and status must be valid"}), 400
    description = payload.get("description", "").strip() or None
    if description and len(description) > 2000:
        return jsonify({"error": "description cannot exceed 2000 characters"}), 400
    try:
        due_date = valid_due_date(payload.get("due_date"))
    except ValueError:
        return jsonify({"error": "due_date must use YYYY-MM-DD"}), 400
    connection = None
    try:
        connection = get_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("INSERT INTO tasks (user_id, title, description, status, priority, due_date) VALUES (%s, %s, %s, %s, %s, %s)", (g.user_id, title, description, status, priority, due_date))
        connection.commit()
        task_id = cursor.lastrowid
        cursor.execute("SELECT * FROM tasks WHERE id = %s", (task_id,))
        task = cursor.fetchone()
        cursor.close()
        return jsonify({"task": serialize_task(task)}), 201
    except Error:
        return jsonify({"error": "Could not create task"}), 500
    finally:
        if connection and connection.is_connected():
            connection.close()


@app.put("/api/tasks/<int:task_id>")
@auth_required
def update_task(task_id):
    payload = body()
    if not payload:
        return jsonify({"error": "JSON body is required"}), 400
    allowed = {key: value for key, value in payload.items() if key in {"title", "description", "status", "priority", "due_date"}}
    if not allowed:
        return jsonify({"error": "Provide title, description, status, priority, or due_date"}), 400
    if "title" in allowed and (not isinstance(allowed["title"], str) or not allowed["title"].strip() or len(allowed["title"].strip()) > 255):
        return jsonify({"error": "title must be 1 to 255 characters"}), 400
    if "description" in allowed and (allowed["description"] is not None and (not isinstance(allowed["description"], str) or len(allowed["description"]) > 2000)):
        return jsonify({"error": "description must be at most 2000 characters"}), 400
    if "status" in allowed and allowed["status"] not in VALID_STATUSES:
        return jsonify({"error": "Invalid status"}), 400
    if "priority" in allowed and allowed["priority"] not in VALID_PRIORITIES:
        return jsonify({"error": "Invalid priority"}), 400
    if "title" in allowed:
        allowed["title"] = allowed["title"].strip()
    if "description" in allowed and isinstance(allowed["description"], str):
        allowed["description"] = allowed["description"].strip() or None
    if "due_date" in allowed:
        try:
            allowed["due_date"] = valid_due_date(allowed["due_date"])
        except ValueError:
            return jsonify({"error": "due_date must use YYYY-MM-DD"}), 400
    assignments = ", ".join(f"{key} = %s" for key in allowed)
    connection = None
    try:
        connection = get_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(f"UPDATE tasks SET {assignments} WHERE id = %s AND user_id = %s", [*allowed.values(), task_id, g.user_id])
        if cursor.rowcount == 0:
            cursor.close()
            return jsonify({"error": "Task not found"}), 404
        connection.commit()
        cursor.execute("SELECT * FROM tasks WHERE id = %s", (task_id,))
        task = cursor.fetchone()
        cursor.close()
        return jsonify({"task": serialize_task(task)})
    except Error:
        return jsonify({"error": "Could not update task"}), 500
    finally:
        if connection and connection.is_connected():
            connection.close()


@app.delete("/api/tasks/<int:task_id>")
@auth_required
def delete_task(task_id):
    connection = None
    try:
        connection = get_connection()
        cursor = connection.cursor()
        cursor.execute("DELETE FROM tasks WHERE id = %s AND user_id = %s", (task_id, g.user_id))
        if cursor.rowcount == 0:
            cursor.close()
            return jsonify({"error": "Task not found"}), 404
        connection.commit()
        cursor.close()
        return "", 204
    except Error:
        return jsonify({"error": "Could not delete task"}), 500
    finally:
        if connection and connection.is_connected():
            connection.close()


@app.errorhandler(404)
def not_found(_error):
    return jsonify({"error": "Route not found"}), 404


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=Config.PORT, debug=Config.DEBUG)
