# Task Manager API

## Local setup

1. Create the virtual environment: `python -m venv .venv`
2. Activate it in PowerShell: `.\.venv\Scripts\Activate.ps1`
3. Install dependencies: `pip install -r requirements.txt`
4. Copy `.env.example` to `.env` and fill in your MySQL credentials.
5. In MySQL Workbench, run `schema.sql`. If you ran it before this update, run `migrations/001_add_task_details.sql` instead.
6. Start the API: `python app.py`

The health endpoint is `http://localhost:5000/health`.

## API

- `POST /api/auth/register` — `{ "name", "email", "password" }`
- `POST /api/auth/login` — `{ "email", "password" }`
- `GET /api/tasks` — optional `?status=pending`; requires `Authorization: Bearer <token>`
- `POST /api/tasks` — `{ "title", "description?", "status?", "priority?", "due_date?" }`; requires a token
- `PUT /api/tasks/:id` — update title, description, status, priority, and/or due date; requires a token
- `DELETE /api/tasks/:id` — requires a token

## Render settings

- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn app:app`
- Root directory: `backend`

Set the same values from `.env` as Render environment variables. For Aiven, set `DB_SSL_ENABLED=true` and provide the Aiven CA certificate as a Render secret file, pointing `DB_SSL_CA` to its runtime path.
