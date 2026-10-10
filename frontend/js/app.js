const API_URL = window.APP_CONFIG.API_URL.replace(/\/$/, "");
const state = {
  token: localStorage.getItem("flowlist_token"),
  user: JSON.parse(localStorage.getItem("flowlist_user") || "null"),
  tasks: [], filter: "", search: "", sort: "newest",
};
const $ = (selector) => document.querySelector(selector);

function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(`${API_URL}${path}`, { ...options, headers }).then(async (response) => {
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  });
}
function showMessage(id, text, success = false) { const el = $(`#${id}`); el.textContent = text; el.className = `message${success ? " success" : ""}`; }
function toast(text) { const el = $("#toast"); el.textContent = text; el.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2800); }
function setLoading(button, loading) { button.disabled = loading; button.dataset.text ??= button.textContent; button.textContent = loading ? "Please wait…" : button.dataset.text; }
function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value || ""; return div.innerHTML; }

function switchAuth(panel) { ["login-panel", "register-panel"].forEach((id) => { $(`#${id}`).hidden = id !== panel; }); showMessage("auth-message", ""); }
document.querySelectorAll("[data-show]").forEach((button) => button.addEventListener("click", () => switchAuth(button.dataset.show)));

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget); const button = event.currentTarget.querySelector("button"); setLoading(button, true); showMessage("auth-message", "");
  try { completeLogin(await request("/api/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) })); } catch (error) { showMessage("auth-message", error.message); } finally { setLoading(button, false); }
});
$("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget); const button = event.currentTarget.querySelector("button"); setLoading(button, true); showMessage("auth-message", "");
  try { completeLogin(await request("/api/auth/register", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) })); } catch (error) { showMessage("auth-message", error.message); } finally { setLoading(button, false); }
});

function completeLogin(data) { state.token = data.token; state.user = data.user; localStorage.setItem("flowlist_token", data.token); localStorage.setItem("flowlist_user", JSON.stringify(data.user)); showApp(); }
function logout() { localStorage.removeItem("flowlist_token"); localStorage.removeItem("flowlist_user"); state.token = null; state.user = null; $("#app-view").hidden = true; $("#auth-view").hidden = false; $("#login-form").reset(); toast("You’ve been signed out."); }
$("#logout-button").addEventListener("click", logout);

function showApp() { $("#auth-view").hidden = true; $("#app-view").hidden = false; const name = state.user.name.split(" ")[0]; $("#user-name").textContent = state.user.name; $("#greeting-name").textContent = name; $("#avatar").textContent = name[0].toUpperCase(); $("#today-label").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()); loadTasks(); }
async function loadTasks() {
  $("#task-list").innerHTML = `<div class="empty-state"><p>Loading your tasks…</p></div>`;
  try { state.tasks = (await request("/api/tasks")).tasks; renderTasks(); }
  catch (error) { if (error.message.includes("token")) logout(); else $("#task-list").innerHTML = `<div class="empty-state"><h3>We couldn’t load your tasks</h3><p>${escapeHtml(error.message)}</p></div>`; }
}

function label(status) { return ({ pending: "To do", in_progress: "In progress", completed: "Completed" })[status]; }
function dueInfo(value, completed) {
  if (!value) return "";
  const due = new Date(`${value}T00:00:00`), today = new Date(); today.setHours(0, 0, 0, 0);
  const text = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(due);
  return `<span class="due-date ${!completed && due < today ? "overdue" : ""}">${!completed && due < today ? "Overdue · " : "Due · "}${text}</span>`;
}
function sortedTasks(tasks) {
  const priority = { high: 0, medium: 1, low: 2 };
  return [...tasks].sort((a, b) => {
    if (state.sort === "priority") return priority[a.priority || "medium"] - priority[b.priority || "medium"];
    if (state.sort === "due") return (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31");
    return new Date(b.created_at) - new Date(a.created_at);
  });
}
function renderTasks() {
  const search = state.search.trim().toLowerCase();
  const filtered = sortedTasks(state.tasks.filter((task) => (!state.filter || task.status === state.filter) && (!search || `${task.title} ${task.description || ""}`.toLowerCase().includes(search))));
  $("#all-count").textContent = state.tasks.length;
  $("#progress-count").textContent = state.tasks.filter((t) => t.status === "in_progress").length;
  $("#done-count").textContent = state.tasks.filter((t) => t.status === "completed").length;
  $("#task-list").innerHTML = filtered.map((task) => {
    const completed = task.status === "completed";
    const priority = task.priority || "medium";
    return `<article class="task ${completed ? "done" : ""}"><button class="task-check ${completed ? "done" : ""}" data-complete="${task.id}" aria-label="Mark task complete">${completed ? "✓" : ""}</button><div class="task-main"><div class="task-title">${escapeHtml(task.title)}</div>${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ""}</div><span class="priority ${priority}">${priority}</span>${dueInfo(task.due_date, completed)}<span class="status ${task.status}">${label(task.status)}</span><div class="task-actions"><button class="icon-button" data-edit="${task.id}" aria-label="Edit task">✎</button><button class="icon-button" data-delete="${task.id}" aria-label="Delete task">×</button></div></article>`;
  }).join("");
  $("#empty-state").hidden = filtered.length !== 0;
  document.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => openModal(state.tasks.find((t) => t.id === Number(b.dataset.edit))));
  document.querySelectorAll("[data-delete]").forEach((b) => b.onclick = () => deleteTask(Number(b.dataset.delete)));
  document.querySelectorAll("[data-complete]").forEach((b) => b.onclick = () => toggleComplete(Number(b.dataset.complete)));
}
$("#filters").addEventListener("click", (event) => { const button = event.target.closest("[data-status]"); if (!button) return; state.filter = button.dataset.status; document.querySelectorAll(".filter").forEach((b) => b.classList.toggle("active", b === button)); renderTasks(); });
$("#task-search").addEventListener("input", (event) => { state.search = event.target.value; renderTasks(); });
$("#task-sort").addEventListener("change", (event) => { state.sort = event.target.value; renderTasks(); });

function openModal(task = null) {
  $("#task-form").reset(); $("#task-id").value = task?.id || ""; $("#modal-title").textContent = task ? "Edit task" : "Create a task"; $("#task-submit-text").textContent = task ? "Save changes" : "Create task";
  if (task) { $("#task-title").value = task.title; $("#task-description").value = task.description || ""; $("#task-status").value = task.status; $("#task-priority").value = task.priority || "medium"; $("#task-due-date").value = task.due_date || ""; }
  showMessage("task-message", ""); $("#task-modal").hidden = false; $("#task-title").focus();
}
function closeModal() { $("#task-modal").hidden = true; }
$("#open-task-modal").onclick = () => openModal(); document.querySelectorAll("[data-open-modal]").forEach((b) => b.onclick = () => openModal()); document.querySelectorAll("[data-close-modal]").forEach((b) => b.onclick = closeModal);
$("#task-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const id = $("#task-id").value; const button = event.currentTarget.querySelector("button"); const data = Object.fromEntries(new FormData(event.currentTarget)); setLoading(button, true); showMessage("task-message", "");
  try { await request(id ? `/api/tasks/${id}` : "/api/tasks", { method: id ? "PUT" : "POST", body: JSON.stringify(data) }); closeModal(); toast(id ? "Task updated." : "Task added to your list."); loadTasks(); } catch (error) { showMessage("task-message", error.message); } finally { setLoading(button, false); }
});
async function toggleComplete(id) { const task = state.tasks.find((item) => item.id === id); try { await request(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({ status: task.status === "completed" ? "pending" : "completed" }) }); toast(task.status === "completed" ? "Back on your list." : "Beautiful work — task completed!"); loadTasks(); } catch (error) { toast(error.message); } }
async function deleteTask(id) { if (!confirm("Delete this task? This can’t be undone.")) return; try { await request(`/api/tasks/${id}`, { method: "DELETE" }); toast("Task deleted."); loadTasks(); } catch (error) { toast(error.message); } }
if (state.token && state.user) showApp();
