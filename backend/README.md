# Task Manager API

## Local setup

1. Create the virtual environment: `python -m venv .venv`
2. Activate it in PowerShell: `.\.venv\Scripts\Activate.ps1`
3. Install dependencies: `pip install -r requirements.txt`
4. Copy `.env.example` to `.env` and fill in your MySQL credentials.
5. In MySQL Workbench, run `schema.sql` for a new database. For an existing installation, apply unapplied scripts in order: `migrations/001_add_task_details.sql` (if the database predates task priorities and due dates), then `migrations/002_projects_tags_subtasks.sql`.
6. Start the API: `python app.py`

The health endpoint is `http://localhost:5000/health`.

## API

- `POST /api/auth/register` — `{ "name", "email", "password" }`
- `POST /api/auth/login` — `{ "email", "password" }`
- `GET /api/projects` — list the signed-in user's projects; requires a token
- `POST /api/projects` — `{ "name", "color?" }`; requires a token
- `DELETE /api/projects/:id` — delete a project without deleting its tasks; requires a token
- `GET /api/tasks` — optional `?status=pending`; task responses include tags and subtasks; requires `Authorization: Bearer <token>`
- `POST /api/tasks` — `{ "title", "description?", "status?", "priority?", "due_date?", "project_id?", "tags?", "subtasks?" }`; requires a token
- `PUT /api/tasks/:id` — update task fields; tags and subtasks are replaced only when those properties are included; requires a token
- `DELETE /api/tasks/:id` — requires a token

Task tags are limited to 10 per task (35 characters each), and a task can contain up to 50 subtasks. Project colors must be six-digit hexadecimal colors such as `#5b5bd6`.

## First-release features

The UI includes a productivity overview, searchable/filterable task list, project organization, task tags and subtasks, a drag-and-drop Kanban board (with status selectors as an accessible alternative), a monthly due-date calendar, dark mode, and responsive mobile navigation.

## Render settings

- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn app:app`
- Root directory: `backend`

Set the same values from `.env` as Render environment variables. Set `FRONTEND_URL` to the exact origin of the deployed frontend (scheme and host, without a path). If you also need local development access, set `FRONTEND_URLS` to a comma-separated list of exact origins, for example `https://your-site.vercel.app,http://127.0.0.1:5500,http://localhost:5500`. After changing environment variables or backend code, redeploy the Render service.

For Aiven, set `DB_SSL_ENABLED=true` and provide the Aiven CA certificate as a Render secret file, pointing `DB_SSL_CA` to its runtime path.
