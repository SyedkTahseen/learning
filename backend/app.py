from datetime import date, datetime
import re

import bcrypt
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from mysql.connector import Error, IntegrityError

from auth import auth_required, create_token
from config import Config
from db import get_connection

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": Config.FRONTEND_URLS}}, allow_headers=["Content-Type", "Authorization"])

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
    return payload if isinstance(payload, dict) else None


def valid_due_date(value):
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError
    return date.fromisoformat(value)


def normalize_tags(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 10:
        raise ValueError
    tags = []
    for item in value:
        if not isinstance(item, str) or not item.strip() or len(item.strip()) > 35:
            raise ValueError
        name = item.strip()
        if name.casefold() not in {tag.casefold() for tag in tags}:
            tags.append(name)
    return tags


def normalize_subtasks(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 50:
        raise ValueError
    subtasks = []
    for item in value:
        if isinstance(item, str):
            title, completed = item.strip(), False
        elif isinstance(item, dict):
            title = item.get("title")
            completed = item.get("completed", False)
            if not isinstance(completed, bool):
                raise ValueError
            title = title.strip() if isinstance(title, str) else ""
        else:
            raise ValueError
        if not title or len(title) > 255:
            raise ValueError
        subtasks.append({"title": title, "completed": completed})
    return subtasks


def normalize_project_id(value):
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        raise ValueError
    try:
        project_id = int(value)
    except (TypeError, ValueError):
        raise ValueError from None
    if project_id < 1:
        raise ValueError
    return project_id


def project_belongs_to_user(cursor, project_id, user_id):
    if project_id is None:
        return True
    cursor.execute("SELECT id FROM projects WHERE id = %s AND user_id = %s", (project_id, user_id))
    return cursor.fetchone() is not None


def replace_task_tags(cursor, task_id, user_id, tags):
    cursor.execute("DELETE FROM task_tags WHERE task_id = %s", (task_id,))
    for name in tags:
        cursor.execute(
            "INSERT INTO tags (user_id, name) VALUES (%s, %s) "
            "ON DUPLICATE KEY UPDATE name = VALUES(name)",
            (user_id, name),
        )
        cursor.execute("SELECT id FROM tags WHERE user_id = %s AND name = %s", (user_id, name))
        tag_id = cursor.fetchone()["id"]
        cursor.execute("INSERT INTO task_tags (task_id, tag_id) VALUES (%s, %s)", (task_id, tag_id))


def replace_subtasks(cursor, task_id, subtasks):
    cursor.execute("DELETE FROM subtasks WHERE task_id = %s", (task_id,))
    for subtask in subtasks:
        cursor.execute(
            "INSERT INTO subtasks (task_id, title, completed) VALUES (%s, %s, %s)",
            (task_id, subtask["title"], subtask["completed"]),
        )


def enrich_tasks(cursor, tasks):
    if not tasks:
        return tasks
    task_ids = [task["id"] for task in tasks]
    placeholders = ", ".join(["%s"] * len(task_ids))
    for task in tasks:
        task["tags"] = []
        task["subtasks"] = []
    cursor.execute(
        f"SELECT task_tags.task_id, tags.name FROM task_tags "
        f"JOIN tags ON tags.id = task_tags.tag_id WHERE task_tags.task_id IN ({placeholders}) "
        "ORDER BY tags.name",
        task_ids,
    )
    tags_by_task = {}
    for row in cursor.fetchall():
        tags_by_task.setdefault(row["task_id"], []).append(row["name"])
    cursor.execute(
        f"SELECT task_id, id, title, completed FROM subtasks WHERE task_id IN ({placeholders}) ORDER BY id",
        task_ids,
    )
    subtasks_by_task = {}
    for row in cursor.fetchall():
        subtasks_by_task.setdefault(row["task_id"], []).append(
            {"id": row["id"], "title": row["title"], "completed": bool(row["completed"])}
        )
    for task in tasks:
        task["tags"] = tags_by_task.get(task["id"], [])
        task["subtasks"] = subtasks_by_task.get(task["id"], [])
    return tasks


@app.get("/health")
def health():
    try:
        connection = get_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
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
    if not all(isinstance(payload[key], str) for key in ("name", "email", "password")):
        return jsonify({"error": "name, email and password must be text"}), 400

    name, email, password = payload["name"].strip(), payload["email"].strip().lower(), payload["password"]
    if not name or len(name) > 100 or len(email) > 255 or len(password) < 8:
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
        app.logger.exception("Could not create account")
        return jsonify({"error": "Could not create account"}), 500
    finally:
        if connection and connection.is_connected():
            connection.close()


@app.post("/api/auth/login")
def login():
    payload = body()
    if not payload or not isinstance(payload.get("email"), str) or not isinstance(payload.get("password"), str) or not payload["email"] or not payload["password"]:
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
        app.logger.exception("Could not log in")
        return jsonify({"error": "Could not log in"}), 500
    finally:
        if connection and connection.is_connected():
            connection.close()


@app.get("/api/projects")
@auth_required
def list_projects():
    connection = None
    try:
        connection = get_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT projects.id, projects.name, projects.color, projects.created_at, COUNT(tasks.id) AS task_count "
            "FROM projects LEFT JOIN tasks ON tasks.project_id = projects.id "
            "WHERE projects.user_id = %s GROUP BY projects.id ORDER BY projects.created_at DESC",
            (g.user_id,),
        )
        projects = [serialize_task(project) for project in cursor.fetchall()]
        cursor.close()
        return jsonify({"projects": projects})
    except Error:
        app.logger.exception("Could not retrieve projects")
        return jsonify({"error": "Could not retrieve projects"}), 500
    finally:
        if connection and connection.is_connected():
            connection.close()


@app.post("/api/projects")
@auth_required
def create_project():
    payload = body()
    name = payload.get("name") if payload else None
    color = payload.get("color", "#5b5bd6") if payload else "#5b5bd6"
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
        return jsonify({"error": "Project name must be 1 to 100 characters"}), 400
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        return jsonify({"error": "Project color must be a six-digit hex color"}), 400
    connection = None
    try:
        connection = get_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("INSERT INTO projects (user_id, name, color) VALUES (%s, %s, %s)", (g.user_id, name.strip(), color))
        connection.commit()
        project_id = cursor.lastrowid
        cursor.execute("SELECT id, name, color, created_at, 0 AS task_count FROM projects WHERE id = %s", (project_id,))
        project = serialize_task(cursor.fetchone())
        cursor.close()
        return jsonify({"project": project}), 201
    except Error:
        app.logger.exception("Could not create project")
        return jsonify({"error": "Could not create project"}), 500
    finally:
        if connection and connection.is_connected():
            connection.close()


@app.delete("/api/projects/<int:project_id>")
@auth_required
def delete_project(project_id):
    connection = None
    try:
        connection = get_connection()
        cursor = connection.cursor()
        cursor.execute("DELETE FROM projects WHERE id = %s AND user_id = %s", (project_id, g.user_id))
        if cursor.rowcount == 0:
            return jsonify({"error": "Project not found"}), 404
        connection.commit()
        cursor.close()
        return "", 204
    except Error:
        app.logger.exception("Could not delete project")
        return jsonify({"error": "Could not delete project"}), 500
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
        tasks = enrich_tasks(cursor, cursor.fetchall())
        cursor.close()
        return jsonify({"tasks": [serialize_task(task) for task in tasks]})
    except Error:
        app.logger.exception("Could not retrieve tasks")
        return jsonify({"error": "Could not retrieve tasks"}), 500
    finally:
        if connection and connection.is_connected():
            connection.close()


@app.post("/api/tasks")
@auth_required
def create_task():
    payload = body()
    title = payload.get("title") if payload else None
    status = payload.get("status", "pending") if payload else "pending"
    priority = payload.get("priority", "medium") if payload else "medium"
    if (
        not isinstance(title, str)
        or not title.strip()
        or len(title.strip()) > 255
        or not isinstance(status, str)
        or status not in VALID_STATUSES
        or not isinstance(priority, str)
        or priority not in VALID_PRIORITIES
    ):
        return jsonify({"error": "title is required (max 255 characters) and status and priority must be valid"}), 400
    description = payload.get("description", "") if payload else ""
    if description is not None and not isinstance(description, str):
        return jsonify({"error": "description must be text"}), 400
    description = description.strip() or None if description else None
    if description and len(description) > 2000:
        return jsonify({"error": "description cannot exceed 2000 characters"}), 400
    try:
        due_date = valid_due_date(payload.get("due_date") if payload else None)
        project_id = normalize_project_id(payload.get("project_id") if payload else None)
        tags = normalize_tags(payload.get("tags") if payload else None)
        subtasks = normalize_subtasks(payload.get("subtasks") if payload else None)
    except ValueError:
        return jsonify({"error": "Check the due date, project, tags, and subtasks"}), 400

    connection = None
    try:
        connection = get_connection()
        cursor = connection.cursor(dictionary=True)
        if not project_belongs_to_user(cursor, project_id, g.user_id):
            return jsonify({"error": "Project not found"}), 400
        cursor.execute(
            "INSERT INTO tasks (user_id, title, description, status, priority, due_date, project_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (g.user_id, title.strip(), description, status, priority, due_date, project_id),
        )
        task_id = cursor.lastrowid
        replace_task_tags(cursor, task_id, g.user_id, tags)
        replace_subtasks(cursor, task_id, subtasks)
        connection.commit()
        cursor.execute("SELECT * FROM tasks WHERE id = %s", (task_id,))
        task = enrich_tasks(cursor, [cursor.fetchone()])[0]
        cursor.close()
        return jsonify({"task": serialize_task(task)}), 201
    except Error:
        if connection:
            connection.rollback()
        app.logger.exception("Could not create task")
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
    allowed = {key: value for key, value in payload.items() if key in {"title", "description", "status", "priority", "due_date", "project_id"}}
    if not allowed and not {"tags", "subtasks"}.intersection(payload):
        return jsonify({"error": "Provide at least one task field to update"}), 400
    if "title" in allowed and (not isinstance(allowed["title"], str) or not allowed["title"].strip() or len(allowed["title"].strip()) > 255):
        return jsonify({"error": "title must be 1 to 255 characters"}), 400
    if "description" in allowed and (allowed["description"] is not None and (not isinstance(allowed["description"], str) or len(allowed["description"]) > 2000)):
        return jsonify({"error": "description must be at most 2000 characters"}), 400
    if "status" in allowed and (not isinstance(allowed["status"], str) or allowed["status"] not in VALID_STATUSES):
        return jsonify({"error": "Invalid status"}), 400
    if "priority" in allowed and (not isinstance(allowed["priority"], str) or allowed["priority"] not in VALID_PRIORITIES):
        return jsonify({"error": "Invalid priority"}), 400
    if "title" in allowed:
        allowed["title"] = allowed["title"].strip()
    if "description" in allowed and isinstance(allowed["description"], str):
        allowed["description"] = allowed["description"].strip() or None
    try:
        if "due_date" in allowed:
            allowed["due_date"] = valid_due_date(allowed["due_date"])
        if "project_id" in allowed:
            allowed["project_id"] = normalize_project_id(allowed["project_id"])
        tags = normalize_tags(payload["tags"]) if "tags" in payload else None
        subtasks = normalize_subtasks(payload["subtasks"]) if "subtasks" in payload else None
    except ValueError:
        return jsonify({"error": "Check the due date, project, tags, and subtasks"}), 400

    connection = None
    try:
        connection = get_connection()
        cursor = connection.cursor(dictionary=True)
        if "project_id" in allowed and not project_belongs_to_user(cursor, allowed["project_id"], g.user_id):
            return jsonify({"error": "Project not found"}), 400
        if allowed:
            assignments = ", ".join(f"{key} = %s" for key in allowed)
            cursor.execute(
                f"UPDATE tasks SET {assignments} WHERE id = %s AND user_id = %s",
                [*allowed.values(), task_id, g.user_id],
            )
            if cursor.rowcount == 0:
                cursor.execute("SELECT id FROM tasks WHERE id = %s AND user_id = %s", (task_id, g.user_id))
                if cursor.fetchone() is None:
                    return jsonify({"error": "Task not found"}), 404
        else:
            cursor.execute("SELECT id FROM tasks WHERE id = %s AND user_id = %s", (task_id, g.user_id))
            if cursor.fetchone() is None:
                return jsonify({"error": "Task not found"}), 404
        if tags is not None:
            replace_task_tags(cursor, task_id, g.user_id, tags)
        if subtasks is not None:
            replace_subtasks(cursor, task_id, subtasks)
        connection.commit()
        cursor.execute("SELECT * FROM tasks WHERE id = %s AND user_id = %s", (task_id, g.user_id))
        task = enrich_tasks(cursor, [cursor.fetchone()])[0]
        cursor.close()
        return jsonify({"task": serialize_task(task)})
    except Error:
        if connection:
            connection.rollback()
        app.logger.exception("Could not update task")
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
        app.logger.exception("Could not delete task")
        return jsonify({"error": "Could not delete task"}), 500
    finally:
        if connection and connection.is_connected():
            connection.close()


@app.errorhandler(404)
def not_found(_error):
    return jsonify({"error": "Route not found"}), 404


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=Config.PORT, debug=Config.DEBUG)
