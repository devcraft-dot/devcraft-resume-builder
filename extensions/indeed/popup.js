const $ = (s) => document.querySelector(s);

/* ─── Tab switching ─────────────────────────────────────────────── */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`#panel-${btn.dataset.tab}`).classList.add("active");
  });
});

/* ─── Profiles ──────────────────────────────────────────────────── */
let profiles = [];

function loadProfiles() {
  chrome.storage.sync.get({ profiles: [] }, (d) => {
    profiles = d.profiles || [];
    if (!profiles.length) {
      profiles.push({ name: "Default", model: "gpt-5.4-mini", text: "" });
    }
    renderProfiles();
    renderProfilePicker();
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
          <option value="deepseek" ${p.model === "deepseek" ? "selected" : ""}>DeepSeek</option>
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
      renderProfilePicker();
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

function renderProfilePicker() {
  const sel = $("#profile-picker");
  const prev = sel.value;
  sel.innerHTML = "";
  profiles.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${p.name || "Profile " + (i + 1)} — ${p.model}`;
    sel.appendChild(opt);
  });
  if (prev && parseInt(prev) < profiles.length) sel.value = prev;
}

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

$("#btn-add").addEventListener("click", () => {
  collectProfiles();
  profiles.push({ name: "", model: "gpt-5.4-mini", text: "" });
  renderProfiles();
  renderProfilePicker();
});

$("#btn-save").addEventListener("click", () => {
  collectProfiles();
  chrome.storage.sync.set({ profiles }, () => {
    renderProfilePicker();
    const el = $("#save-status");
    el.textContent = "Saved!";
    setTimeout(() => (el.textContent = ""), 2000);
  });
});

/* ─── State display ─────────────────────────────────────────────── */
function updateUI(s) {
  $("#s-processed").textContent = s.processed || 0;
  $("#s-skipped").textContent = s.skipped || 0;
  $("#s-failed").textContent = s.failed || 0;
  $("#s-page").textContent = s.currentPage || 1;
  $("#s-job").textContent = s.currentJobIndex || 0;
  $("#s-total").textContent = s.totalJobsOnPage || 0;

  const msg = $("#status-msg");
  msg.textContent = s.lastError || (s.running ? "Running…" : "Ready");
  msg.className = "status-msg";
  if (s.running && !s.paused) msg.classList.add("running");
  else if (s.paused) msg.classList.add("paused");
  else if (s.lastError?.toLowerCase().includes("error") || s.lastError?.toLowerCase().includes("fail"))
    msg.classList.add("error");

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
  const idx = parseInt($("#profile-picker").value) || 0;
  chrome.runtime.sendMessage(
    { action: "start", reset: true, profileIndex: idx },
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

/* ─── Listen for live updates from background ───────────────────── */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "stateUpdate") updateUI(msg.state);
});

/* ─── Init ──────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  loadProfiles();
  chrome.runtime.sendMessage({ action: "getState" }, (s) => {
    if (s) updateUI(s);
  });
});
