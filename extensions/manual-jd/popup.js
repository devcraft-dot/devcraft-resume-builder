const $ = (s) => document.querySelector(s);

const API_ERROR_LOG_KEY = "manualJdApiErrorLog";
const API_ERROR_LOG_MAX = 40;

/** @param {string} text */
async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Must match `canonical_url_for_manual_entry` in app/schemas/generate.py (order + trimming).
 * @param {string} profileName
 * @param {{ title: string, company: string, jd: string, referenceUrl: string }} job
 */
async function canonicalJobUrl(profileName, job) {
  const ref = (job.referenceUrl || "").trim();
  if (ref) return ref.slice(0, 2000);
  const pn = (profileName || "").trim() || "default";
  const key = `${pn}\n${job.title.trim()}\n${(job.company || "").trim()}\n${(job.jd || "").trim()}`;
  const digest = await sha256Hex(key);
  return `manual:${digest}`;
}

function setStatus(text, kind) {
  const el = $("#status-msg");
  if (!el) return;
  el.textContent = text;
  el.className = "status-msg" + (kind ? ` ${kind}` : "");
}

async function appendApiErrorLog(entry) {
  try {
    const r = await chrome.storage.local.get(API_ERROR_LOG_KEY);
    const prev = Array.isArray(r[API_ERROR_LOG_KEY]) ? r[API_ERROR_LOG_KEY] : [];
    const row = {
      at: new Date().toISOString(),
      path: String(entry.path || "").slice(0, 400),
      method: String(entry.method || "POST").slice(0, 16),
      status: typeof entry.status === "number" ? entry.status : 0,
      detail: String(entry.detail || "").slice(0, 3000),
      context: String(entry.context || "").slice(0, 500),
    };
    await chrome.storage.local.set({
      [API_ERROR_LOG_KEY]: [row, ...prev].slice(0, API_ERROR_LOG_MAX),
    });
  } catch (e) {
    console.error("[Manual JD] appendApiErrorLog", e);
  }
}

/**
 * @param {string} jdUrl
 * @param {{ name?: string, model?: string, text?: string }[]} profilesList
 */
async function checkGenerationKeys(jdUrl, profilesList) {
  if (!jdUrl || !profilesList?.length) return [];
  const items = profilesList.map((p) => ({
    url: jdUrl,
    profile_name: (p.name || "").trim() || "default",
  }));
  try {
    const res = await fetch(`${API_URL}/api/check-generation-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      let detail = text?.slice(0, 1200) || res.statusText;
      try {
        const j = JSON.parse(text);
        if (j?.detail != null) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      } catch {
        /* */
      }
      await appendApiErrorLog({
        path: "/api/check-generation-keys",
        method: "POST",
        status: res.status,
        detail,
        context: (jdUrl || "").slice(0, 400),
      });
      return null;
    }
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch (e) {
    const msg = e?.message || String(e);
    await appendApiErrorLog({
      path: "/api/check-generation-keys",
      method: "POST",
      status: 0,
      detail: msg,
      context: (jdUrl || "").slice(0, 400),
    });
    return null;
  }
}

/**
 * @param {{ name?: string, model?: string, text?: string }} profile
 * @param {{ title: string, company: string, salary: string, jd: string, referenceUrl: string }} job
 */
async function postGenerateManual(profile, job) {
  const body = {
    title: job.title.trim(),
    company_name: (job.company || "").trim(),
    description_text: (job.jd || "").trim(),
    salary_range: (job.salary || "").trim(),
    questions: [],
    profile_name: (profile.name || "").trim() || "default",
    profile_text: (profile.text || "").trim(),
    model: profile.model || "gpt-5.4-mini",
    reference_url: (job.referenceUrl || "").trim(),
  };
  let res;
  try {
    res = await fetch(`${API_URL}/api/generate/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e?.message || String(e);
    await appendApiErrorLog({
      path: "/api/generate/manual",
      method: "POST",
      status: 0,
      detail: msg,
      context: `${job.title} · ${profile.name || "default"}`,
    });
    throw new Error(`Network/CORS (${API_URL}): ${msg}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let detail = text?.slice(0, 1200) || res.statusText;
    try {
      const j = JSON.parse(text);
      if (j?.detail != null) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* */
    }
    await appendApiErrorLog({
      path: "/api/generate/manual",
      method: "POST",
      status: res.status,
      detail,
      context: `${job.title} · ${profile.name || "default"}`,
    });
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json();
}

/* ─── Tabs ─────────────────────────────────────────────────────── */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`#panel-${btn.dataset.tab}`)?.classList.add("active");
  });
});

/* ─── Profiles (same storage as Indeed: chrome.storage.sync profiles) ─ */
let profiles = [];

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function renderProfiles() {
  const container = $("#profiles-container");
  if (!container) return;
  container.innerHTML = "";
  profiles.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "profile-card";
    card.innerHTML = `
      <div class="card-header">
        <span class="card-title">Profile #${i + 1}</span>
        ${profiles.length > 1 ? `<button type="button" class="btn-delete" data-idx="${i}" title="Delete">&times;</button>` : ""}
      </div>
      <div class="field">
        <label>Profile name</label>
        <input type="text" class="p-name" data-idx="${i}" value="${esc(p.name)}" placeholder="Andrew Roberts" />
      </div>
      <div class="field">
        <label>AI model</label>
        <select class="p-model" data-idx="${i}">
          <option value="gpt-5.4-mini" ${p.model === "gpt-5.4-mini" ? "selected" : ""}>GPT-5.4 Mini</option>
          <option value="gpt-5.4" ${p.model === "gpt-5.4" ? "selected" : ""}>GPT-5.4</option>
          <option value="deepseek" ${p.model === "deepseek" ? "selected" : ""}>DeepSeek Chat</option>
          <option value="deepseek-reasoner" ${p.model === "deepseek-reasoner" ? "selected" : ""}>DeepSeek Reasoner</option>
        </select>
      </div>
      <div class="field">
        <label>Profile text</label>
        <textarea class="p-text" data-idx="${i}" placeholder="Full resume / profile text…">${esc(p.text)}</textarea>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      profiles.splice(parseInt(btn.dataset.idx, 10), 1);
      renderProfiles();
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

function loadProfiles() {
  chrome.storage.sync.get({ profiles: [] }, (d) => {
    profiles = d.profiles || [];
    if (!profiles.length) {
      profiles.push({ name: "Default", model: "gpt-5.4-mini", text: "" });
    }
    renderProfiles();
  });
}

$("#btn-add")?.addEventListener("click", () => {
  collectProfiles();
  profiles.push({ name: "", model: "gpt-5.4-mini", text: "" });
  renderProfiles();
});

$("#btn-save")?.addEventListener("click", () => {
  collectProfiles();
  chrome.storage.sync.set({ profiles }, () => {
    const el = $("#save-status");
    if (el) {
      el.textContent = "Saved";
      setTimeout(() => (el.textContent = ""), 2000);
    }
  });
});

/* ─── Run ────────────────────────────────────────────────────────── */
let running = false;

$("#btn-start")?.addEventListener("click", async () => {
  if (running) return;
  const title = ($("#job-title")?.value || "").trim();
  const company = ($("#company")?.value || "").trim();
  const salary = ($("#salary")?.value || "").trim();
  const jd = ($("#jd")?.value || "").trim();
  const referenceUrl = ($("#reference-url")?.value || "").trim();

  if (!title) {
    setStatus("Enter a job title.", "err");
    return;
  }
  if (!jd) {
    setStatus("Paste the job description.", "err");
    return;
  }

  collectProfiles();
  const usable = profiles.filter((p) => (p.text || "").trim().length > 0);
  if (!usable.length) {
    setStatus('No profile text — open "Profiles" and paste your resume facts.', "err");
    return;
  }

  const job = { title, company, salary, jd, referenceUrl };
  running = true;
  const btn = $("#btn-start");
  if (btn) btn.disabled = true;

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (let i = 0; i < usable.length; i++) {
      const profile = usable[i];
      const label = (profile.name || "").trim() || "default";
      setStatus(`Checking ${label} (${i + 1}/${usable.length})…`, "run");

      const url = await canonicalJobUrl(label, job);
      const presence = await checkGenerationKeys(url, [profile]);
      const exists = presence?.[0]?.exists === true;
      if (exists) {
        skipped++;
        setStatus(`Skipped (already in DB): ${label}`, "ok");
        continue;
      }

      setStatus(`Generating ${label}…`, "run");
      try {
        await postGenerateManual(profile, job);
        generated++;
        setStatus(`Generated: ${label}`, "ok");
      } catch (e) {
        failed++;
        setStatus(e?.message || String(e), "err");
        break;
      }
    }

    if (failed === 0) {
      setStatus(
        `Done. Generated: ${generated}, skipped (duplicate): ${skipped}. Drive/Sheets same as Indeed flow.`,
        generated > 0 || skipped > 0 ? "ok" : "",
      );
    }
  } finally {
    running = false;
    if (btn) btn.disabled = false;
  }
});

document.addEventListener("DOMContentLoaded", loadProfiles);
