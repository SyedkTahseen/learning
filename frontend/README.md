# Flowlist frontend

This is a vanilla HTML, CSS, and JavaScript interface for the Flask Task Manager API.

## Run locally

Start the Flask API first, then open this folder through VS Code **Live Server** on `http://127.0.0.1:5500`. Opening `index.html` directly from the file system will not work with the API's CORS setup.

The API address is configured once in `js/config.js`. For local development it is already set to `http://127.0.0.1:5000`. After deploying the backend to Render, replace it with your Render API URL, for example `https://your-api.onrender.com`.

## Deploy to Vercel

Import the repository in Vercel and set the project Root Directory to `frontend`. No build command is required.
