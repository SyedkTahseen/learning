const API_URL = window.APP_CONFIG.API_URL.replace(/\/$/, "");
const storedUser = (() => {
  try {
    return JSON.parse(localStorage.getItem("flowlist_user") || "null");
  } catch {
    return null;
  }
})();
const state = {
  token: localStorage.getItem("flowlist_token"),
  user: storedUser,
  tasks: [],
  projects: [],
  filter: "",
  search: "",
  sort: "newest",
  projectId: "",
  taskPage: 1,
  taskPageSize: 8,
  view: "dashboard",
  calendarDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  editSubtasks: [],
};
const $ = (selector) => document.querySelector(selector);
const todayKey = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(`${API_URL}${path}`, { ...options, headers }).then(async (response) => {
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Something went wrong. Please try again.");
    return data;
  });
}
function showMessage(id, text, success = false) {
  const element = $(`#${id}`);
  element.textContent = text;
  element.className = `message${success ? " success" : ""}`;
}
function toast(text) {
  const element = $("#toast");
  element.textContent = text;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2800);
}
function setLoading(button, loading) {
  button.disabled = loading;
  button.dataset.text ??= button.textContent;
  button.textContent = loading ? "Please wait…" : button.dataset.text;
}
function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value == null ? "" : String(value);
  return element.innerHTML;
}
function formatDate(value, options = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", options).format(new Date(`${value}T00:00:00`));
}
function statusLabel(status) {
  return ({ pending: "To do", in_progress: "In progress", completed: "Completed" })[status] || "To do";
}
function openSidebar(open) {
  $("#sidebar").classList.toggle("open", open);
  $("#sidebar-scrim").classList.toggle("visible", open);
  $("#menu-toggle").setAttribute("aria-expanded", String(open));
}
function switchView(view) {
  state.view = view;
  document.querySelectorAll(".app-panel").forEach((panel) => { panel.hidden = panel.id !== `view-${view}`; });
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const headings = {
    dashboard: ["Good day, ", "A clear view of what deserves your attention."],
    tasks: ["My tasks", "Everything you need to move forward."],
    board: ["Your board", "Move tasks through each stage of your workflow."],
    calendar: ["Calendar", "Plan your work around the days that matter."],
    projects: ["Projects", "Keep related tasks organized in one place."],
  };
  const [title, subtitle] = headings[view] || headings.dashboard;
  $("#view-title").innerHTML = view === "dashboard" ? `${escapeHtml(title)}<span id="greeting-name">${escapeHtml(state.user?.name?.split(" ")[0] || "there")}</span>.` : escapeHtml(title);
  $("#view-subheading").textContent = subtitle;
  renderBreadcrumb();
  openSidebar(false);
  if (view === "board") renderBoard();
  if (view === "calendar") renderCalendar();
  if (view === "projects") renderProjects();
}
function renderBreadcrumb() {
  const labels = { dashboard: "Overview", tasks: "My tasks", board: "Board", calendar: "Calendar", projects: "Projects" };
  const project = state.view === "tasks"
    ? state.projects.find((item) => String(item.id) === state.projectId)
    : null;
  $("#breadcrumb").innerHTML = `<a href="#overview" data-view-link="dashboard">Workspace</a><span aria-hidden="true">/</span><span>${labels[state.view] || "Overview"}</span>${project ? `<span aria-hidden="true">/</span><span>${escapeHtml(project.name)}</span>` : ""}`;
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("flowlist_theme", theme);
  $("#theme-toggle").innerHTML = theme === "dark" ? '<span aria-hidden="true">☀</span> Light mode' : '<span aria-hidden="true">☾</span> Dark mode';
}
function completeLogin(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem("flowlist_token", data.token);
  localStorage.setItem("flowlist_user", JSON.stringify(data.user));
  showApp();
}
function logout() {
  localStorage.removeItem("flowlist_token");
  localStorage.removeItem("flowlist_user");
  state.token = null;
  state.user = null;
  $("#app-view").hidden = true;
  $("#auth-view").hidden = false;
  $("#login-form").reset();
  toast("You’ve been signed out.");
}
function showApp() {
  $("#auth-view").hidden = true;
  $("#app-view").hidden = false;
  const name = state.user?.name?.trim() || "Your workspace";
  $("#user-name").textContent = name;
  $("#avatar").textContent = name[0].toUpperCase();
  $("#today-label").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  applyTheme(localStorage.getItem("flowlist_theme") || "light");
  switchView("dashboard");
  loadWorkspace();
}
async function loadWorkspace() {
  try {
    const [taskData, projectData] = await Promise.all([request("/api/tasks"), request("/api/projects")]);
    state.tasks = taskData.tasks;
    state.projects = projectData.projects;
    renderWorkspace();
  } catch (error) {
    if (/token|authorization/i.test(error.message)) {
      logout();
      return;
    }
    $("#focus-list").innerHTML = `<div class="empty-state"><h3>We couldn’t load your workspace</h3><p>${escapeHtml(error.message)}</p></div>`;
    $("#task-list").innerHTML = `<div class="empty-state"><h3>We couldn’t load your tasks</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}
function renderWorkspace() {
  populateProjectOptions();
  renderDashboard();
  renderTasks();
  renderBoard();
  renderCalendar();
  renderProjects();
}
function dueInfo(value, completed) {
  if (!value) return "";
  const overdue = !completed && value < todayKey();
  return `<span class="due-date ${overdue ? "overdue" : ""}">${overdue ? "Overdue · " : "Due · "}${formatDate(value)}</span>`;
}
function taskMatches(task) {
  const search = state.search.trim().toLowerCase();
  const content = `${task.title} ${task.description || ""} ${(task.tags || []).join(" ")}`.toLowerCase();
  return (!state.filter || task.status === state.filter)
    && (!state.projectId || String(task.project_id || "") === state.projectId)
    && (!search || content.includes(search));
}
function sortedTasks(tasks) {
  const priority = { high: 0, medium: 1, low: 2 };
  return [...tasks].sort((a, b) => {
    if (state.sort === "priority") return priority[a.priority || "medium"] - priority[b.priority || "medium"];
    if (state.sort === "due") return (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31");
    return new Date(b.created_at) - new Date(a.created_at);
  });
}
function taskCard(task, compact = false) {
  const completed = task.status === "completed";
  const subtasks = task.subtasks || [];
  const completedSubtasks = subtasks.filter((item) => item.completed).length;
  const project = state.projects.find((item) => item.id === task.project_id);
  const tags = (task.tags || []).map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join("");
  return `<article class="task ${completed ? "done" : ""} ${compact ? "compact-task" : ""}" ${compact ? "" : 'data-task-row'}><button class="task-check ${completed ? "done" : ""}" data-complete="${task.id}" aria-label="${completed ? "Reopen" : "Mark"} task: ${escapeHtml(task.title)}">${completed ? "✓" : ""}</button><div class="task-main"><button class="task-title task-title-button" data-edit="${task.id}" type="button">${escapeHtml(task.title)}</button>${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ""}<div class="task-meta">${project ? `<span class="project-dot-label"><i style="--project-color:${escapeHtml(project.color)}"></i>${escapeHtml(project.name)}</span>` : ""}${tags}${subtasks.length ? `<span class="subtask-progress">☷ ${completedSubtasks}/${subtasks.length}</span>` : ""}${dueInfo(task.due_date, completed)}</div></div><span class="priority ${escapeHtml(task.priority || "medium")}">${escapeHtml(task.priority || "medium")}</span><select class="status-select status ${escapeHtml(task.status)}" data-status-task="${task.id}" aria-label="Change status for ${escapeHtml(task.title)}"><option value="pending" ${task.status === "pending" ? "selected" : ""}>To do</option><option value="in_progress" ${task.status === "in_progress" ? "selected" : ""}>In progress</option><option value="completed" ${completed ? "selected" : ""}>Done</option></select><details class="overflow-menu task-overflow"><summary aria-label="More actions for ${escapeHtml(task.title)}">⋮</summary><div class="overflow-popover"><button data-edit="${task.id}" type="button">Edit task</button><button data-complete="${task.id}" type="button">${completed ? "Reopen task" : "Mark complete"}</button><button class="danger-action" data-delete="${task.id}" type="button">Delete task</button></div></details></article>`;
}
function renderTasks() {
  const filtered = sortedTasks(state.tasks.filter(taskMatches));
  $("#all-count").textContent = state.tasks.length;
  $("#progress-count").textContent = state.tasks.filter((task) => task.status === "in_progress").length;
  $("#done-count").textContent = state.tasks.filter((task) => task.status === "completed").length;
  const pageCount = Math.ceil(filtered.length / state.taskPageSize);
  state.taskPage = Math.max(1, Math.min(state.taskPage, pageCount || 1));
  const start = (state.taskPage - 1) * state.taskPageSize;
  $("#task-list").innerHTML = filtered.slice(start, start + state.taskPageSize).map((task) => taskCard(task)).join("");
  $("#empty-state").hidden = filtered.length !== 0;
  renderTaskPagination(filtered.length, pageCount, start);
  $("#project-filter").value = state.projectId;
}
function renderTaskPagination(total, pageCount, start) {
  const navigation = $("#task-pagination");
  if (pageCount <= 1) {
    navigation.innerHTML = total ? `<span>${start + 1}–${total} of ${total} tasks</span>` : "";
    navigation.hidden = !total;
    return;
  }
  navigation.hidden = false;
  navigation.innerHTML = `<span>${start + 1}–${Math.min(start + state.taskPageSize, total)} of ${total} tasks</span><div class="pagination-controls"><button class="page-button" data-page="${state.taskPage - 1}" ${state.taskPage === 1 ? "disabled" : ""} aria-label="Previous page">← Previous</button><span class="page-indicator">Page ${state.taskPage} of ${pageCount}</span><button class="page-button" data-page="${state.taskPage + 1}" ${state.taskPage === pageCount ? "disabled" : ""} aria-label="Next page">Next →</button></div>`;
}
async function deleteProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project || !confirm(`Delete “${project.name}”? Its tasks will stay in your list.`)) return;
  try {
    await request(`/api/projects/${project.id}`, { method: "DELETE" });
    state.projectId = "";
    state.taskPage = 1;
    toast("Project deleted. Its tasks are still safe.");
    await loadWorkspace();
  } catch (error) {
    toast(error.message);
  }
}
function renderDashboard() {
  const today = todayKey();
  const overdue = state.tasks.filter((task) => task.due_date && task.due_date < today && task.status !== "completed");
  const dueToday = state.tasks.filter((task) => task.due_date === today && task.status !== "completed");
  const completed = state.tasks.filter((task) => task.status === "completed").length;
  const completion = state.tasks.length ? Math.round(completed / state.tasks.length * 100) : 0;
  $("#overdue-count").textContent = overdue.length;
  $("#due-count").textContent = dueToday.length;
  $("#completion-rate").textContent = `${completion}%`;
  $("#completion-bar").style.width = `${completion}%`;
  const focusTasks = sortedTasks(state.tasks.filter((task) => task.status !== "completed" && (task.due_date === today || task.status === "in_progress"))).slice(0, 6);
  $("#focus-list").innerHTML = focusTasks.map((task) => taskCard(task, true)).join("");
  $("#focus-empty").hidden = focusTasks.length !== 0;
  $("#dashboard-projects").innerHTML = state.projects.slice(0, 3).map(projectCard).join("")
    || '<p class="project-empty">Create a project to group related tasks.</p>';
}
function renderBoard() {
  if (!$("#kanban-board")) return;
  const columns = [
    ["pending", "To do"],
    ["in_progress", "In progress"],
    ["completed", "Done"],
  ];
  $("#kanban-board").innerHTML = columns.map(([status, title]) => {
    const tasks = sortedTasks(state.tasks.filter((task) => task.status === status && (!state.projectId || String(task.project_id || "") === state.projectId)));
    return `<section class="kanban-column" data-drop-status="${status}"><header><h2>${title}</h2><span>${tasks.length}</span></header><div class="kanban-cards">${tasks.map((task) => `<article class="kanban-card" draggable="true" data-drag-task="${task.id}"><div class="kanban-card-top"><span class="priority ${escapeHtml(task.priority || "medium")}">${escapeHtml(task.priority || "medium")}</span><button class="icon-button" data-edit="${task.id}" type="button" aria-label="Edit ${escapeHtml(task.title)}">✎</button></div><button class="task-title task-title-button" data-edit="${task.id}" type="button">${escapeHtml(task.title)}</button>${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}<div class="task-meta">${dueInfo(task.due_date, status === "completed")}${(task.tags || []).map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join("")}</div><label class="board-status-label">Move to<select data-status-task="${task.id}" aria-label="Move ${escapeHtml(task.title)}"><option value="pending" ${status === "pending" ? "selected" : ""}>To do</option><option value="in_progress" ${status === "in_progress" ? "selected" : ""}>In progress</option><option value="completed" ${status === "completed" ? "selected" : ""}>Done</option></select></label></article>`).join("") || '<p class="column-empty">Drop a task here or create one.</p>'}</div></section>`;
  }).join("");
  document.querySelectorAll("[data-drag-task]").forEach((card) => card.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", card.dataset.dragTask);
    card.classList.add("dragging");
  }));
  document.querySelectorAll("[data-drag-task]").forEach((card) => card.addEventListener("dragend", () => card.classList.remove("dragging")));
  document.querySelectorAll("[data-drop-status]").forEach((column) => {
    column.addEventListener("dragover", (event) => { event.preventDefault(); column.classList.add("drag-over"); });
    column.addEventListener("dragleave", () => column.classList.remove("drag-over"));
    column.addEventListener("drop", (event) => {
      event.preventDefault();
      column.classList.remove("drag-over");
      const taskId = Number(event.dataTransfer.getData("text/plain"));
      updateTaskStatus(taskId, column.dataset.dropStatus);
    });
  });
}
function renderCalendar() {
  if (!$("#calendar-grid")) return;
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  $("#calendar-month").textContent = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(state.calendarDate);
  const offset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;
  $("#calendar-grid").innerHTML = Array.from({ length: cellCount }, (_, index) => {
    const day = index - offset + 1;
    const inMonth = day > 0 && day <= daysInMonth;
    const date = new Date(year, month, day);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const tasks = state.tasks.filter((task) => task.due_date === key);
    return `<div class="calendar-day ${inMonth ? "" : "outside-month"} ${key === todayKey() ? "today" : ""}"><span class="calendar-day-number">${date.getDate()}</span><div class="calendar-day-tasks">${tasks.slice(0, 3).map((task) => `<button class="calendar-task ${escapeHtml(task.status)}" data-edit="${task.id}" type="button" title="${escapeHtml(task.title)}"><i style="--project-color:${escapeHtml(state.projects.find((project) => project.id === task.project_id)?.color || "#5b5bd6")}"></i>${escapeHtml(task.title)}</button>`).join("")}${tasks.length > 3 ? `<span class="calendar-more">+${tasks.length - 3} more</span>` : ""}</div></div>`;
  }).join("");
}
function projectCard(project) {
  const count = Number(project.task_count ?? state.tasks.filter((task) => task.project_id === project.id).length);
  const done = state.tasks.filter((task) => task.project_id === project.id && task.status === "completed").length;
  const percent = count ? Math.round(done / count * 100) : 0;
  return `<article class="project-card"><button class="project-open" data-project-open="${project.id}" type="button"><span class="project-color" style="--project-color:${escapeHtml(project.color)}"></span><strong>${escapeHtml(project.name)}</strong><span class="project-count">${count} ${count === 1 ? "task" : "tasks"}</span><span class="project-progress"><i style="width:${percent}%;--project-color:${escapeHtml(project.color)}"></i></span></button><details class="overflow-menu project-overflow"><summary aria-label="More actions for ${escapeHtml(project.name)}">⋮</summary><div class="overflow-popover"><button data-project-open="${project.id}" type="button">Open project</button><button class="danger-action" data-project-delete="${project.id}" type="button">Delete project</button></div></details></article>`;
}
function renderProjects() {
  if (!$("#project-list")) return;
  $("#project-list").innerHTML = state.projects.map(projectCard).join("") || '<p class="project-empty">No projects yet. Create one above to get started.</p>';
}
function populateProjectOptions() {
  const options = state.projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join("");
  $("#task-project").innerHTML = `<option value="">No project</option>${options}`;
  $("#project-filter").innerHTML = `<option value="">All projects</option>${options}`;
}
function renderSubtasks() {
  $("#subtask-list").innerHTML = state.editSubtasks.map((subtask, index) => `<label class="subtask-row"><input type="checkbox" data-subtask-complete="${index}" ${subtask.completed ? "checked" : ""} /><span class="${subtask.completed ? "subtask-done" : ""}">${escapeHtml(subtask.title)}</span><button class="icon-button" data-subtask-remove="${index}" type="button" aria-label="Remove subtask">×</button></label>`).join("");
}
function openModal(task = null) {
  $("#task-form").reset();
  $("#task-id").value = task?.id || "";
  $("#modal-title").textContent = task ? "Edit task" : "Create a task";
  $("#task-submit-text").textContent = task ? "Save changes" : "Create task";
  if (task) {
    $("#task-title").value = task.title;
    $("#task-description").value = task.description || "";
    $("#task-status").value = task.status;
    $("#task-priority").value = task.priority || "medium";
    $("#task-project").value = task.project_id || "";
    $("#task-tags").value = (task.tags || []).join(", ");
    $("#task-due-date").value = task.due_date || "";
    state.editSubtasks = (task.subtasks || []).map(({ title, completed }) => ({ title, completed }));
  } else {
    state.editSubtasks = [];
  }
  $(".subtask-editor").open = Boolean(task?.subtasks?.length);
  renderSubtasks();
  showMessage("task-message", "");
  $("#task-modal").hidden = false;
  $("#task-title").focus();
}
function closeModal() {
  $("#task-modal").hidden = true;
}
async function updateTaskStatus(id, status) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || task.status === status) return;
  try {
    await request(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    toast("Task status updated.");
    await loadWorkspace();
  } catch (error) {
    toast(error.message);
  }
}

document.querySelectorAll("[data-show]").forEach((button) => button.addEventListener("click", () => {
  ["login-panel", "register-panel"].forEach((id) => { $(`#${id}`).hidden = id !== button.dataset.show; });
  showMessage("auth-message", "");
}));
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button");
  setLoading(button, true);
  showMessage("auth-message", "");
  try {
    completeLogin(await request("/api/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) }));
  } catch (error) {
    showMessage("auth-message", error.message);
  } finally {
    setLoading(button, false);
  }
});
$("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button");
  setLoading(button, true);
  showMessage("auth-message", "");
  try {
    completeLogin(await request("/api/auth/register", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) }));
  } catch (error) {
    showMessage("auth-message", error.message);
  } finally {
    setLoading(button, false);
  }
});
$("#logout-button").addEventListener("click", logout);
$("#menu-toggle").addEventListener("click", () => openSidebar(!$("#sidebar").classList.contains("open")));
$("#sidebar-scrim").addEventListener("click", () => openSidebar(false));
$("#side-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) switchView(button.dataset.view);
});
$("#theme-toggle").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$("#quick-actions-toggle").addEventListener("click", () => {
  const menu = $("#quick-actions-menu");
  menu.hidden = !menu.hidden;
  $("#quick-actions-toggle").setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".bento-wrap")) {
    $("#quick-actions-menu").hidden = true;
    $("#quick-actions-toggle").setAttribute("aria-expanded", "false");
  }
  if (!event.target.closest(".overflow-menu")) {
    document.querySelectorAll(".overflow-menu[open]").forEach((menu) => { menu.open = false; });
  }
  if (event.target.closest(".overflow-popover button")) {
    event.target.closest(".overflow-menu").open = false;
  }
});
$("#open-task-modal").addEventListener("click", () => openModal());
document.querySelectorAll("[data-open-modal]").forEach((button) => button.addEventListener("click", () => openModal()));
document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModal));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#task-modal").hidden) closeModal();
  if (event.key === "Escape") {
    $("#quick-actions-menu").hidden = true;
    $("#quick-actions-toggle").setAttribute("aria-expanded", "false");
    document.querySelectorAll(".overflow-menu[open]").forEach((menu) => { menu.open = false; });
  }
});
$("#task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#task-id").value;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const payload = {
    title: $("#task-title").value,
    description: $("#task-description").value,
    status: $("#task-status").value,
    priority: $("#task-priority").value,
    project_id: $("#task-project").value || null,
    due_date: $("#task-due-date").value || null,
    tags: $("#task-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean),
    subtasks: state.editSubtasks,
  };
  setLoading(button, true);
  showMessage("task-message", "");
  try {
    await request(id ? `/api/tasks/${id}` : "/api/tasks", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
    closeModal();
    state.taskPage = 1;
    toast(id ? "Task updated." : "Task added to your list.");
    await loadWorkspace();
  } catch (error) {
    showMessage("task-message", error.message);
  } finally {
    setLoading(button, false);
  }
});
$("#add-subtask").addEventListener("click", () => {
  const input = $("#subtask-input");
  const title = input.value.trim();
  if (!title) return;
  if (state.editSubtasks.length >= 50) {
    showMessage("task-message", "A task can have up to 50 subtasks.");
    return;
  }
  state.editSubtasks.push({ title, completed: false });
  input.value = "";
  renderSubtasks();
  input.focus();
});
$("#subtask-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("#add-subtask").click();
  }
});
$("#subtask-list").addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-subtask-complete]");
  if (!checkbox) return;
  state.editSubtasks[Number(checkbox.dataset.subtaskComplete)].completed = checkbox.checked;
  renderSubtasks();
});
$("#subtask-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-subtask-remove]");
  if (!button) return;
  state.editSubtasks.splice(Number(button.dataset.subtaskRemove), 1);
  renderSubtasks();
});
$("#filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-status]");
  if (!button) return;
  state.filter = button.dataset.status;
  state.taskPage = 1;
  document.querySelectorAll(".filter[data-status]").forEach((item) => {
    item.classList.toggle("active", item === button);
    item.setAttribute("aria-selected", String(item === button));
  });
  renderTasks();
});
$("#task-search").addEventListener("input", (event) => {
  state.search = event.target.value;
  state.taskPage = 1;
  renderTasks();
});
$("#project-filter").addEventListener("change", (event) => {
  state.projectId = event.target.value;
  state.taskPage = 1;
  renderBreadcrumb();
  renderTasks();
});
$("#task-sort").addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderTasks();
});
$("#task-pagination").addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || button.disabled) return;
  state.taskPage = Number(button.dataset.page);
  renderTasks();
  $("#view-tasks").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  setLoading(button, true);
  showMessage("project-message", "");
  try {
    await request("/api/projects", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    $("#project-color").value = "#5b5bd6";
    showMessage("project-message", "Project created.", true);
    await loadWorkspace();
  } catch (error) {
    showMessage("project-message", error.message);
  } finally {
    setLoading(button, false);
  }
});
$("#project-list").addEventListener("click", async (event) => {
  const open = event.target.closest("[data-project-open]");
  if (open) {
    state.projectId = open.dataset.projectOpen;
    state.taskPage = 1;
    $("#project-filter").value = state.projectId;
    switchView("tasks");
    renderTasks();
  }
});
$("#dashboard-projects").addEventListener("click", (event) => {
  const button = event.target.closest("[data-project-open]");
  if (!button) return;
  state.projectId = button.dataset.projectOpen;
  state.taskPage = 1;
  $("#project-filter").value = state.projectId;
  switchView("tasks");
  renderTasks();
});
$("#calendar-prev").addEventListener("click", () => {
  state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1);
  renderCalendar();
});
$("#calendar-next").addEventListener("click", () => {
  state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1);
  renderCalendar();
});
$("#calendar-today").addEventListener("click", () => {
  const now = new Date();
  state.calendarDate = new Date(now.getFullYear(), now.getMonth(), 1);
  renderCalendar();
});
document.addEventListener("change", (event) => {
  const select = event.target.closest("[data-status-task]");
  if (select) updateTaskStatus(Number(select.dataset.statusTask), select.value);
});
document.addEventListener("click", async (event) => {
  const viewLink = event.target.closest("[data-view-link]");
  const action = event.target.closest("[data-action]");
  if (viewLink) {
    $("#quick-actions-menu").hidden = true;
    $("#quick-actions-toggle").setAttribute("aria-expanded", "false");
    switchView(viewLink.dataset.viewLink);
    return;
  }
  const projectDelete = event.target.closest("[data-project-delete]");
  if (projectDelete) {
    await deleteProject(Number(projectDelete.dataset.projectDelete));
    return;
  }
  if (action) {
    if (action.dataset.action === "new-task") {
      $("#quick-actions-menu").hidden = true;
      openModal();
    } else if (action.dataset.action === "new-project") {
      $("#quick-actions-menu").hidden = true;
      switchView("projects");
      $("#project-name").focus();
    } else if (action.dataset.action === "clear-filters") {
      state.filter = "";
      state.search = "";
      state.projectId = "";
      state.sort = "newest";
      state.taskPage = 1;
      $("#task-search").value = "";
      $("#project-filter").value = "";
      $("#task-sort").value = "newest";
      document.querySelectorAll(".filter[data-status]").forEach((button) => {
        const isAll = button.dataset.status === "";
        button.classList.toggle("active", isAll);
        button.setAttribute("aria-selected", String(isAll));
      });
      renderBreadcrumb();
      renderTasks();
    } else if (action.dataset.action === "export-tasks") {
      const rows = sortedTasks(state.tasks.filter(taskMatches));
      const quote = (value) => {
        let text = String(value ?? "");
        if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replaceAll('"', '""')}"`;
      };
      const header = ["Title", "Description", "Status", "Priority", "Due date", "Project", "Tags", "Subtasks"];
      const csv = [header.map(quote).join(","), ...rows.map((task) => [
        task.title,
        task.description,
        statusLabel(task.status),
        task.priority,
        task.due_date,
        state.projects.find((project) => project.id === task.project_id)?.name,
        (task.tags || []).join("; "),
        (task.subtasks || []).map((subtask) => `${subtask.completed ? "[x]" : "[ ]"} ${subtask.title}`).join("; "),
      ].map(quote).join(","))].join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "flowlist-tasks.csv";
      link.click();
      URL.revokeObjectURL(url);
      toast(`${rows.length} tasks exported.`);
    }
    document.querySelectorAll(".overflow-menu[open]").forEach((menu) => { menu.open = false; });
    return;
  }
  const edit = event.target.closest("[data-edit]");
  const remove = event.target.closest("[data-delete]");
  const complete = event.target.closest("[data-complete]");
  if (edit) {
    const task = state.tasks.find((item) => item.id === Number(edit.dataset.edit));
    if (task) openModal(task);
  } else if (remove) {
    const task = state.tasks.find((item) => item.id === Number(remove.dataset.delete));
    if (!task || !confirm("Delete this task? This can’t be undone.")) return;
    try {
      await request(`/api/tasks/${task.id}`, { method: "DELETE" });
      toast("Task deleted.");
      await loadWorkspace();
    } catch (error) {
      toast(error.message);
    }
  } else if (complete) {
    const task = state.tasks.find((item) => item.id === Number(complete.dataset.complete));
    if (task) updateTaskStatus(task.id, task.status === "completed" ? "pending" : "completed");
  }
});

if (state.token && state.user) showApp();
