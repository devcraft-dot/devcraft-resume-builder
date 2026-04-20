const $ = (s) => document.querySelector(s);

/* ─── Tab switching ─────────────────────────────────────────────── */
const API_ERROR_LOG_KEY = "indeedApiErrorLog";

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`#panel-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "errors") renderApiErrorLog();
  });
});

function formatApiErrorRow(r) {
  const ts = r.at ? new Date(r.at).toLocaleString() : "";
  const head = `[${ts}] ${r.method || "POST"} ${r.path || ""} → HTTP ${r.status != null ? r.status : "?"}`;
  const ctx = r.context ? `Context: ${r.context}\n` : "";
  const det = r.detail ? String(r.detail) : "";
  return `${head}\n${ctx}${det}`;
}

function renderApiErrorLog() {
  const pre = $("#api-error-log-pre");
  if (!pre) return;
  chrome.storage.local.get({ [API_ERROR_LOG_KEY]: [] }, (d) => {
    const arr = d[API_ERROR_LOG_KEY] || [];
    if (!arr.length) {
      pre.textContent =
        "No API errors yet. Failed /api/generate or /api/check-generation-keys responses are saved here automatically.";
      return;
    }
    pre.textContent = arr.map(formatApiErrorRow).join("\n\n————————————————\n\n");
  });
}

$("#btn-api-errors-refresh")?.addEventListener("click", () => renderApiErrorLog());

$("#btn-api-errors-clear")?.addEventListener("click", () => {
  if (!confirm("Clear all stored API error entries in this browser?")) return;
  chrome.storage.local.set({ [API_ERROR_LOG_KEY]: [] }, () => renderApiErrorLog());
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[API_ERROR_LOG_KEY]) return;
  const panel = $("#panel-errors");
  if (panel?.classList.contains("active")) renderApiErrorLog();
});

/* ─── Profiles (Settings + Run summary) ─────────────────────────── */
let profiles = [];

function renderRunProfilesSummary() {
  const host = $("#run-profiles-list");
  if (!host) return;
  host.innerHTML = "";
  profiles.forEach((p, i) => {
    const li = document.createElement("li");
    const name = (p.name || "").trim() || `Profile ${i + 1}`;
    li.textContent = `${name} — ${p.model || "gpt-5.4-mini"}`;
    host.appendChild(li);
  });
}

function loadProfiles() {
  chrome.storage.sync.get({ profiles: [] }, (d) => {
    profiles = d.profiles || [];
    if (!profiles.length) {
      profiles.push({ name: "Default", model: "gpt-5.4-mini", text: "" });
    }
    chrome.runtime.sendMessage({ action: "getState" }, (s) => {
      renderProfiles();
      renderRunProfilesSummary();
      if (s) updateUI(s);
      else updateStatsNoteOnly();
    });
  });
}

function renderProfiles() {
  const container = $("#profiles-container");
  container.innerHTML = "";
  profiles.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "profile-card";
    card.innerHTML = `
      <div class="card-header">
        <span class="card-title">Profile #${i + 1}</span>
        ${profiles.length > 1 ? `<button class="btn-delete" data-idx="${i}" title="Delete">&times;</button>` : ""}
      </div>
      <div class="field">
        <label>Profile Name</label>
        <input type="text" class="p-name" data-idx="${i}" value="${esc(p.name)}" placeholder="Andrew Roberts" />
      </div>
      <div class="field">
        <label>AI Model</label>
        <select class="p-model" data-idx="${i}">
          <option value="gpt-5.4-mini" ${p.model === "gpt-5.4-mini" ? "selected" : ""}>GPT-5.4 Mini</option>
          <option value="gpt-5.4" ${p.model === "gpt-5.4" ? "selected" : ""}>GPT-5.4</option>
          <option value="deepseek" ${p.model === "deepseek" ? "selected" : ""}>DeepSeek Chat</option>
          <option value="deepseek-reasoner" ${p.model === "deepseek-reasoner" ? "selected" : ""}>DeepSeek Reasoner</option>
        </select>
      </div>
      <div class="field">
        <label>Profile Text</label>
        <textarea class="p-text" data-idx="${i}" placeholder="Full resume / profile text…">${esc(p.text)}</textarea>
        <div class="hint">Sent directly to AI as candidate context</div>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      profiles.splice(parseInt(btn.dataset.idx), 1);
      renderProfiles();
      renderRunProfilesSummary();
    });
  });
}

function collectProfiles() {
  document.querySelectorAll(".p-name").forEach((el) => {
    profiles[el.dataset.idx].name = el.value.trim();
  });
  document.querySelectorAll(".p-model").forEach((el) => {
    profiles[el.dataset.idx].model = el.value;
  });
  document.querySelectorAll(".p-text").forEach((el) => {
    profiles[el.dataset.idx].text = el.value.trim();
  });
}

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

$("#btn-add").addEventListener("click", () => {
  collectProfiles();
  profiles.push({ name: "", model: "gpt-5.4-mini", text: "" });
  renderProfiles();
  renderRunProfilesSummary();
});

$("#btn-save").addEventListener("click", () => {
  collectProfiles();
  chrome.storage.sync.set({ profiles }, () => {
    renderRunProfilesSummary();
    const el = $("#save-status");
    el.textContent = "Saved!";
    setTimeout(() => (el.textContent = ""), 2000);
  });
});

function updateStatsNoteOnly() {
  const note = $("#stats-note");
  const pd = $("#progress-detail");
  const n = profiles.length;
  if (note) {
    note.textContent = n
      ? `Counts are per resume (not per job). Up to ${n} resume(s) can be produced per job.`
      : "";
  }
  if (pd) {
    pd.textContent = n ? `Using ${n} saved profile(s) for each new job.` : "";
  }
}

/* ─── State display ─────────────────────────────────────────────── */
function updateUI(s) {
  $("#s-processed").textContent = s.processed || 0;
  $("#s-skipped").textContent = s.skipped || 0;
  $("#s-failed").textContent = s.failed || 0;
  $("#s-page").textContent = s.currentPage || 1;
  $("#s-job").textContent = s.currentJobIndex || 0;
  $("#s-total").textContent = s.totalJobsOnPage || 0;

  updateStatsNoteOnly();

  const msg = $("#status-msg");
  msg.textContent = s.lastError || (s.running ? "Running…" : "Ready");
  msg.className = "status-msg";
  if (s.running && !s.paused) msg.classList.add("running");
  else if (s.paused) msg.classList.add("paused");
  else if (s.lastError?.toLowerCase().includes("error") || s.lastError?.toLowerCase().includes("fail"))
    msg.classList.add("error");

  const skipLogEl = $("#skip-log");
  if (skipLogEl) {
    const lines = Array.isArray(s.skipLog) ? s.skipLog : [];
    skipLogEl.textContent =
      lines.length > 0 ? lines.join("\n") : "No skips recorded yet (also check extension service worker console).";
  }

  const isRunning = s.running && !s.paused;
  const isPaused = s.running && s.paused;
  const isStopped = !s.running;

  $("#btn-start").disabled = isRunning;
  $("#btn-resume").disabled = !isPaused;
  $("#btn-pause").disabled = !isRunning;
  $("#btn-stop").disabled = isStopped;
}

/* ─── Controls ──────────────────────────────────────────────────── */
$("#btn-start").addEventListener("click", () => {
  chrome.runtime.sendMessage(
    { action: "start", reset: true, profileIndex: 0 },
    (res) => {
      if (!res?.ok) alert(res?.error || "Failed to start");
    },
  );
});

$("#btn-resume").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "resume" }, (res) => {
    if (!res?.ok) alert(res?.error || "Failed to resume");
  });
});

$("#btn-pause").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "pause" });
});

$("#btn-stop").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stop" });
});

$("#btn-reset").addEventListener("click", () => {
  if (!confirm("Reset all progress?")) return;
  chrome.runtime.sendMessage({ action: "resetState" }, () => {
    chrome.runtime.sendMessage({ action: "getState" }, updateUI);
  });
});

$("#btn-link-settings").addEventListener("click", () => {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  document.querySelector('.tab-btn[data-tab="settings"]')?.classList.add("active");
  $("#panel-settings")?.classList.add("active");
});

/* ─── Listen for live updates from background ───────────────────── */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "stateUpdate") updateUI(msg.state);
});

/* ─── Init ──────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  loadProfiles();
});
