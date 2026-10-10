(() => {
  const REPORTS_KEY = "campusfix-kcc-reports-v1";
  const AUTH_KEY = "campusfix-admin-session";
  const DEMO_USERNAME = "admin";
  const DEMO_PASSWORD = "KCC@2026";
  const statuses = ["Received", "Under Review", "Verified", "In Progress", "Resolved"];
  const loginForm = document.getElementById("login-form");
  const dashboard = document.body.classList.contains("dashboard-page");

  function safeReports() {
    try { const parsed = JSON.parse(localStorage.getItem(REPORTS_KEY) || "[]"); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  function writeReports(reports) { localStorage.setItem(REPORTS_KEY, JSON.stringify(reports)); }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function showToast(message) {
    const el = document.getElementById("admin-toast"); if (!el) return;
    el.textContent = message; el.classList.add("visible"); clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.classList.remove("visible"), 2400);
  }
  if (loginForm) {
    if (sessionStorage.getItem(AUTH_KEY) === "true") location.replace("dashboard.html");
    loginForm.addEventListener("submit", event => {
      event.preventDefault();
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      const error = document.getElementById("login-error");
      if (username !== DEMO_USERNAME || password !== DEMO_PASSWORD) {
        error.textContent = "Username ya password sahi nahi hai."; return;
      }
      sessionStorage.setItem(AUTH_KEY, "true"); location.href = "dashboard.html";
    });
    document.getElementById("toggle-password").addEventListener("click", event => {
      const input = document.getElementById("password");
      input.type = input.type === "password" ? "text" : "password";
      event.currentTarget.textContent = input.type === "password" ? "Show" : "Hide";
    });
    return;
  }
  if (!dashboard) return;
  if (sessionStorage.getItem(AUTH_KEY) !== "true") { location.replace("login.html"); return; }
  const list = document.getElementById("admin-report-list");
  const statusFilter = document.getElementById("status-filter");
  const priorityFilter = document.getElementById("priority-filter");
  const searchInput = document.getElementById("admin-search");
  document.getElementById("today-label").textContent = new Intl.DateTimeFormat("en-IN", {weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date());

  function render() {
    const all = safeReports();
    const normalized = all.map(report => ({...report, status: statuses.includes(report.status) ? report.status : "Received"}));
    const reviewCount = normalized.filter(r => ["Received", "Under Review"].includes(r.status)).length;
    document.getElementById("stat-total").textContent = normalized.length;
    document.getElementById("stat-review").textContent = reviewCount;
    document.getElementById("stat-progress").textContent = normalized.filter(r => r.status === "In Progress").length;
    document.getElementById("stat-resolved").textContent = normalized.filter(r => r.status === "Resolved").length;
    document.getElementById("report-count").textContent = normalized.length;
    const query = searchInput.value.trim().toLowerCase();
    const filtered = normalized.filter(r => {
      const searchable = [r.id,r.type,r.building,r.section,r.description].join(" ").toLowerCase();
      return (!query || searchable.includes(query)) &&
        (statusFilter.value === "all" || r.status === statusFilter.value) &&
        (priorityFilter.value === "all" || r.priority === priorityFilter.value);
    }).reverse();
    list.innerHTML = "";
    document.getElementById("admin-empty").hidden = filtered.length > 0;
    filtered.forEach(report => {
      const card = document.createElement("article"); card.className = "admin-report";
      const statusClass = report.status.toLowerCase().replaceAll(" ", "-");
      const priorityClass = String(report.priority || "normal").toLowerCase();
      card.innerHTML = `<div class="report-info"><div class="report-topline"><span class="report-id">${escapeHtml(report.id)}</span><span class="status-badge ${statusClass}">${escapeHtml(report.status)}</span></div><h3 class="issue-title">${escapeHtml(report.type)} · ${escapeHtml(report.building)}, ${escapeHtml(report.section)}</h3><p class="issue-description">${escapeHtml(report.description || "No description provided.")}</p><div class="report-meta"><span>${escapeHtml(report.date || "Date unavailable")}</span><span class="priority-tag ${priorityClass}">${escapeHtml(report.priority || "Normal")} priority</span>${report.photoName ? `<span>📎 ${escapeHtml(report.photoName)}</span>` : ""}</div></div><div class="report-controls"><label class="control-label" for="status-${escapeHtml(report.id)}">UPDATE STATUS</label><select class="status-select" id="status-${escapeHtml(report.id)}" data-report-id="${escapeHtml(report.id)}">${statuses.map(status => `<option ${status === report.status ? "selected" : ""}>${status}</option>`).join("")}</select><span class="status-saved" aria-live="polite"></span></div>`;
      list.appendChild(card);
    });
  }
  list.addEventListener("change", event => {
    const select = event.target.closest(".status-select"); if (!select) return;
    const reports = safeReports(); const report = reports.find(item => item.id === select.dataset.reportId);
    if (!report) { showToast("Report nahi mila. Refresh karke dekho."); return; }
    report.status = select.value;
    try { writeReports(reports); render(); showToast(`Report status: ${select.value}`); }
    catch { showToast("Status save nahi hua. Browser storage check karo."); }
  });
  [statusFilter, priorityFilter].forEach(el => el.addEventListener("change", render));
  searchInput.addEventListener("input", render);
  document.getElementById("refresh-button").addEventListener("click", () => { render(); showToast("Reports refreshed."); });
  document.getElementById("logout-button").addEventListener("click", () => { sessionStorage.removeItem(AUTH_KEY); location.replace("login.html"); });
  window.addEventListener("storage", event => { if (event.key === REPORTS_KEY) render(); });
  render();
})();
