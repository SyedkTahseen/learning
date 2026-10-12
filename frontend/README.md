# Flowlist frontend

Flowlist is a responsive vanilla HTML, CSS, and JavaScript client for the Flask task manager API.

## Features

- Overview dashboard with task counts, due-today/overdue summaries, completion progress, and projects
- Searchable and filterable task list with status, priority, due dates, and project filters
- Projects, tags, and checkable subtasks
- Kanban board with drag-and-drop and status-select alternatives
- Monthly calendar of tasks with due dates
- Persistent light/dark theme preference
- Mobile navigation, compact calendar, and responsive task layouts

## Run locally

1. Start the Flask API and MySQL database (see `../backend/README.md`).
2. Set `API_URL` in `js/config.js` to the API URL. For local development, use `http://127.0.0.1:5000`.
3. Open this folder through VS Code **Live Server** at `http://127.0.0.1:5500`. Opening `index.html` directly from the file system will not work with the API's CORS setup.

For deployment, configure `API_URL` to the deployed Flask API address before publishing.

## Deploy to Vercel

Import the repository in Vercel and set the project Root Directory to `frontend`. No build command is required.
