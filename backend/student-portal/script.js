(() => {
  const STORAGE_KEY = "campusfix-kcc-reports-v1";
  const form = document.getElementById("report-form");
  const building = document.getElementById("building");
  const sectionSelect = document.getElementById("section");
  const photoInput = document.getElementById("photo");
  const toast = document.getElementById("toast");
  let toastTimer;
  const localFileMode = location.protocol === "file:";

  function getLocalReports() {
    try { const reports = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(reports) ? reports : []; }
    catch { return []; }
  }
  function saveLocalReports(reports) { localStorage.setItem(STORAGE_KEY, JSON.stringify(reports)); }
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message; toast.classList.add("visible"); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
  }
  function makeTrackerId() {
    const now = new Date();
    const day = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}`;
    return `KCC-${day}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
  }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch])); }
  function updateSectionOptions() {
    const letter = building.value.slice(-1);
    sectionSelect.innerHTML = letter ? `<option value="">Choose section</option>${Array.from({length:10},(_,i)=>`<option>${letter}${i+1}</option>`).join("")}` : '<option value="">Select building first</option>';
    sectionSelect.disabled = !letter;
  }
  function renderReport(report) {
    const list = document.getElementById("report-list");
    const empty = document.getElementById("empty-state");
    list.innerHTML = ""; empty.hidden = !!report;
    if (!report) return;
    const card = document.createElement("article"); card.className = "report-item";
    const status = report.status || "Received";
    card.innerHTML = `<div><div class="report-meta"><span class="report-id">${escapeHtml(report.id)}</span><span class="status-pill">${escapeHtml(status)}</span></div><h3 class="report-title">${escapeHtml(report.type)} · ${escapeHtml(report.building)}, ${escapeHtml(report.section)}</h3><div class="report-detail">Submitted ${escapeHtml(report.date || "today")}</div></div><div class="report-priority">${escapeHtml(report.priority)} priority</div>`;
    list.appendChild(card);
  }
  async function fileAsDataUrl(file) {
    if (!file) return null;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({name:file.name, data:reader.result});
      reader.onerror = () => reject(new Error("Could not read the selected photo."));
      reader.readAsDataURL(file);
    });
  }
  async function sendReport(payload) {
    if (localFileMode) {
      const report = {...payload, id:makeTrackerId(), status:"Received", date:new Intl.DateTimeFormat("en-IN", {day:"numeric",month:"short",year:"numeric"}).format(new Date())};
      const local = getLocalReports(); local.push(report); saveLocalReports(local); return report;
    }
    const response = await fetch("/api/reports", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Report submit nahi ho saka.");
    return result;
  }
  building.addEventListener("change", updateSectionOptions);
  document.getElementById("description").addEventListener("input", event => { document.getElementById("char-count").textContent = event.target.value.length; });
  photoInput.addEventListener("change", () => {
    const file = photoInput.files[0];
    document.getElementById("file-name").textContent = file ? file.name : "Add a photo";
    if (file && (file.size > 5 * 1024 * 1024 || !["image/jpeg","image/png","image/webp"].includes(file.type))) {
      photoInput.value = ""; document.getElementById("file-name").textContent = "Add a photo";
      showToast("JPG, PNG ya WEBP photo choose karein (max 5 MB).");
    }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true; submitButton.textContent = "Submitting…";
    try {
      const photo = await fileAsDataUrl(photoInput.files[0]);
      const payload = {
        building:building.value, section:sectionSelect.value,
        type:document.getElementById("type").value,
        priority:new FormData(form).get("priority"),
        description:document.getElementById("description").value.trim(), photo
      };
      const report = await sendReport(payload);
      document.getElementById("tracker-id").textContent = report.id;
      form.hidden = true; document.getElementById("success-card").hidden = false;
      showToast("Report submit ho gayi. Tracker ID save kar lein.");
    } catch (error) { showToast(error.message || "Server se connection nahi ho saka."); }
    finally { submitButton.disabled = false; submitButton.innerHTML = 'Submit report <span>↗</span>'; }
  });
  document.getElementById("another-report").addEventListener("click", () => {
    form.reset(); form.hidden = false; document.getElementById("success-card").hidden = true;
    sectionSelect.disabled = true; sectionSelect.innerHTML = '<option value="">Select building first</option>';
    document.getElementById("char-count").textContent = "0"; document.getElementById("file-name").textContent = "Add a photo";
    document.getElementById("report").scrollIntoView({behavior:"smooth"});
  });
  document.getElementById("copy-id").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(document.getElementById("tracker-id").textContent); showToast("Tracker ID copied."); }
    catch { showToast("Tracker ID select karke copy karein."); }
  });
  async function findReport() {
    const query = document.getElementById("tracker-search").value.trim().toUpperCase();
    const feedback = document.getElementById("search-feedback");
    if (!query) { feedback.textContent = "Tracker ID enter karein."; return; }
    try {
      let report;
      if (localFileMode) report = getLocalReports().find(item => item.id.toUpperCase() === query);
      else {
        const response = await fetch(`/api/reports?id=${encodeURIComponent(query)}`);
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "Report nahi mili."); report = data;
      }
      if (!report) throw new Error("Is tracker ID ki report nahi mili.");
      feedback.textContent = `Report found · ${report.id}`; renderReport(report);
    } catch (error) { feedback.textContent = error.message; renderReport(null); }
  }
  document.getElementById("search-button").addEventListener("click", findReport);
  document.getElementById("tracker-search").addEventListener("keydown", event => { if (event.key === "Enter") findReport(); });
  document.getElementById("tracker-search").addEventListener("input", () => {
    if (!document.getElementById("tracker-search").value.trim()) {
      document.getElementById("search-feedback").textContent = "Tracker ID enter karke apni report dekhein."; renderReport(null);
    }
  });
  document.querySelector(".menu-toggle").addEventListener("click", () => document.querySelector(".topbar nav").classList.toggle("open"));
  document.querySelectorAll(".topbar nav a").forEach(link => link.addEventListener("click", () => document.querySelector(".topbar nav").classList.remove("open")));
})();
