const $ = (s) => document.querySelector(s);
const {
  canonicalJobUrl,
  checkGenerationKeys,
  postGenerateManual,
  postUploadApplicationScreenshot,
  extractDriveFileId,
  driveExportUrl,
} = globalThis.ManualJD;

function setStatus(text, kind) {
  const el = $("#status-msg");
  if (!el) return;
  el.textContent = text;
  el.className = "status-msg" + (kind ? ` ${kind}` : "");
}

/* ─── Tabs ─────────────────────────────────────────────────────── */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`#panel-${btn.dataset.tab}`)?.classList.add("active");
    if (btn.dataset.tab === "history") renderHistory();
  });
});

/* ─── Profiles (server-synced) ─ */
let profiles = [];

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function renderProfilesList() {
  const container = $("#profiles-container");
  if (!container) return;
  container.innerHTML = "";
  if (!profiles.length) {
    const li = document.createElement("li");
    li.textContent = "No profiles — sign in under Account and sync";
    container.appendChild(li);
    return;
  }
  profiles.forEach((p, i) => {
    const li = document.createElement("li");
    li.style.padding = "6px 0";
    li.textContent = `${(p.name || "").trim() || `Profile ${i + 1}`} — ${p.model || "gpt-5.4-mini"}`;
    container.appendChild(li);
  });
}

async function loadProfiles() {
  profiles = await ResumeAuth.getServerProfiles();
  renderProfilesList();
}

async function loadAuthFields() {
  const u = await ResumeAuth.getSavedUsername();
  const ue = $("#auth-username");
  const pe = $("#auth-password");
  if (ue) ue.value = u || "";
  if (pe) pe.value = "";
}

$("#btn-sign-in")?.addEventListener("click", async () => {
  const st = $("#sync-status");
  const username = $("#auth-username")?.value?.trim() || "";
  const password = $("#auth-password")?.value || "";
  if (!username || !password) {
    if (st) st.textContent = "Enter username and password";
    return;
  }
  try {
    await ResumeAuth.login(API_URL, username, password);
    const pe = $("#auth-password");
    if (pe) pe.value = "";
    if (st) st.textContent = "Signed in";
  } catch (e) {
    if (st) st.textContent = e?.message || "Sign-in failed";
  }
});

$("#btn-sign-out")?.addEventListener("click", async () => {
  await ResumeAuth.signOut();
  const st = $("#sync-status");
  if (st) st.textContent = "Signed out";
});

$("#btn-sync-profiles")?.addEventListener("click", async () => {
  const st = $("#sync-status");
  try {
    profiles = await ResumeAuth.syncServerProfiles(API_URL);
    renderProfilesList();
    if (st) st.textContent = `Synced ${profiles.length} profile(s)`;
  } catch (e) {
    if (st) st.textContent = e?.message || "Sync failed";
  }
});

async function renderHistory() {
  const pre = $("#history-log");
  if (!pre) return;
  pre.textContent = "Loading…";
  try {
    const data = await ResumeAuth.fetchMyGenerations(API_URL, 1, 30);
    const lines = (data.items || []).map((g) => {
      const when = g.created_at ? new Date(g.created_at).toLocaleString() : "";
      const link = g.resume_drive_url ? ` | ${g.resume_drive_url}` : "";
      return `[${when}] ${g.stage} | ${g.title} @ ${g.company_name || "?"}${link}`;
    });
    pre.textContent = lines.length ? lines.join("\n\n") : "No generations yet.";
  } catch (e) {
    pre.textContent = e?.message || "Failed to load history";
  }
}

$("#btn-refresh-history")?.addEventListener("click", () => renderHistory());

/* ─── Application questions ─────────────────────────────────────── */
function addQuestionRow(data = {}) {
  const host = $("#questions-container");
  if (!host) return;
  const label = data.label != null ? String(data.label) : "";
  const type = data.type === "textarea" || data.type === "select" ? data.type : "input";
  const required = data.required === true;
  let optionsStr = "";
  if (Array.isArray(data.options)) optionsStr = data.options.join(", ");
  else if (data.options != null) optionsStr = String(data.options);

  const row = document.createElement("div");
  row.className = "q-row";
  row.innerHTML = `
    <div class="q-row-head">
      <span class="q-row-title">Question</span>
      <button type="button" class="q-remove" title="Remove">&times;</button>
    </div>
    <input type="text" class="q-label" placeholder="e.g. Are you authorized to work in the US?" value="${esc(label)}" />
    <div class="q-row-grid">
      <label class="q-inline"><span>Field type</span>
        <select class="q-type">
          <option value="input" ${type === "input" ? "selected" : ""}>Short text</option>
          <option value="textarea" ${type === "textarea" ? "selected" : ""}>Long text</option>
          <option value="select" ${type === "select" ? "selected" : ""}>Single choice</option>
        </select>
      </label>
      <label class="q-inline q-check"><input type="checkbox" class="q-required" ${required ? "checked" : ""} /> Required</label>
    </div>
    <input type="text" class="q-options" placeholder="Single choice options: Yes, No, Prefer not to say" value="${esc(optionsStr)}" />
  `;
  row.querySelector(".q-remove")?.addEventListener("click", () => row.remove());
  host.appendChild(row);
}

function collectApplicationQuestions() {
  const out = [];
  document.querySelectorAll("#questions-container .q-row").forEach((row) => {
    const label = row.querySelector(".q-label")?.value?.trim() || "";
    if (!label) return;
    const type = row.querySelector(".q-type")?.value || "input";
    const required = row.querySelector(".q-required")?.checked === true;
    const optionsRaw = row.querySelector(".q-options")?.value || "";
    const options = optionsRaw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    out.push({ label, type, required, options });
  });
  return out;
}

function escAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function openUrl(url) {
  const u = String(url || "").trim();
  if (!u) return;
  try {
    chrome.tabs.create({ url: u });
  } catch {
    window.open(u, "_blank", "noopener,noreferrer");
  }
}

function renderDownloadButtons(title, url) {
  const u = String(url || "").trim();
  if (!u) {
    return `<div class="dl-group"><strong>${esc(title)}</strong><span class="dl-missing">No file URL</span></div>`;
  }
  const id = extractDriveFileId(u);
  let btns = "";
  if (id) {
    const pdf = escAttr(driveExportUrl(u, "pdf"));
    const docx = escAttr(driveExportUrl(u, "docx"));
    btns += `<button type="button" class="btn-dl" data-open-url="${pdf}">PDF</button>`;
    btns += `<button type="button" class="btn-dl" data-open-url="${docx}">DOCX</button>`;
  }
  btns += `<button type="button" class="btn-dl btn-dl-open" data-open-url="${escAttr(u)}">Open in Drive</button>`;
  return `<div class="dl-group"><strong>${esc(title)}</strong><div class="dl-row">${btns}</div></div>`;
}

function renderDownloads(results) {
  const list = $("#downloads-list");
  const section = $("#downloads-section");
  if (!list || !section) return;
  if (!results?.length) {
    section.style.display = "none";
    list.innerHTML = "";
    return;
  }
  section.style.display = "block";
  list.innerHTML = results
    .map(({ profileLabel, gen }) => {
      const name = esc(profileLabel || "Profile");
      return `
        <div class="dl-card">
          <h3>${name}</h3>
          ${renderDownloadButtons("Tailored resume", gen.resume_drive_url)}
          ${renderDownloadButtons("Job description", gen.jd_drive_url)}
          ${renderDownloadButtons("Application answers", gen.questions_drive_url)}
        </div>`;
    })
    .join("");

  list.querySelectorAll("button[data-open-url]").forEach((btn) => {
    btn.addEventListener("click", () => openUrl(btn.getAttribute("data-open-url")));
  });
}

$("#btn-add-question")?.addEventListener("click", () => addQuestionRow());

function isGreenhouseJobUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    if (!u.pathname.includes("/jobs/")) return false;
    const h = u.hostname.toLowerCase();
    return (
      h === "job-boards.greenhouse.io" ||
      h === "boards.greenhouse.io" ||
      h.endsWith(".greenhouse.io")
    );
  } catch {
    return false;
  }
}

/** Public Ashby board: /{orgSlug}/{jobPostingId}( /application ) */
function isAshbyJobUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== "jobs.ashbyhq.com") return false;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return false;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const last = parts[parts.length - 1];
    const idPart = last.toLowerCase() === "application" ? parts[parts.length - 2] : last;
    return uuidRe.test(idPart);
  } catch {
    return false;
  }
}

/** @returns {"greenhouse"|"ashby"|null} */
function detectJobBoardFromUrl(url) {
  if (isGreenhouseJobUrl(url)) return "greenhouse";
  if (isAshbyJobUrl(url)) return "ashby";
  return null;
}

async function findJobBoardTabId() {
  const last = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (last[0]?.id != null && detectJobBoardFromUrl(last[0].url)) return last[0].id;
  const wins = await chrome.windows.getAll({ populate: true });
  for (const win of wins) {
    if (win.type !== "normal" || !win.tabs) continue;
    const hit = win.tabs.find((t) => t.active && detectJobBoardFromUrl(t.url));
    if (hit?.id != null) return hit.id;
  }
  const any = await chrome.tabs.query({});
  const jobTab = any.find((t) => detectJobBoardFromUrl(t.url));
  return jobTab?.id ?? null;
}

function boardLabel(board) {
  return board === "ashby" ? "Ashby" : "Greenhouse";
}

async function scrapeJobBoardFromTab() {
  const tabId = await findJobBoardTabId();
  if (tabId == null) {
    throw new Error(
      "No supported job tab found. Open a Greenhouse posting (…greenhouse… URL with /jobs/…) or an Ashby job on jobs.ashbyhq.com, focus that tab, then try again.",
    );
  }
  const tab = await chrome.tabs.get(tabId);
  const board = detectJobBoardFromUrl(tab?.url || "");
  if (!board) {
    throw new Error("Could not detect job board from tab URL.");
  }

  const file = board === "greenhouse" ? "greenhouseScrapeInjected.js" : "ashbyScrapeInjected.js";
  const ashby = board === "ashby";
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [file],
    ...(ashby ? { world: "MAIN" } : {}),
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    ...(ashby ? { world: "MAIN" } : {}),
    func:
      board === "greenhouse"
        ? () => globalThis.__MANUAL_JD_GREENHOUSE_SCRAPE__
        : () => globalThis.__MANUAL_JD_ASHBY_SCRAPE__,
  });
  return { result, board };
}

function applyScrapedJobPayload(payload) {
  const jt = document.getElementById("job-title");
  const co = document.getElementById("company");
  const sa = document.getElementById("salary");
  const jd = document.getElementById("jd");
  const ref = document.getElementById("reference-url");
  if (jt) jt.value = payload.title || "";
  if (co) co.value = payload.company || "";
  if (sa) sa.value = payload.salary_range || "";
  if (jd) jd.value = payload.description_text || "";
  if (ref) ref.value = payload.posting_url || "";
  const qc = document.getElementById("questions-container");
  if (qc) qc.innerHTML = "";
  (payload.questions || []).forEach((q) => {
    addQuestionRow({
      label: q.label,
      type: q.type || "input",
      required: !!q.required,
      options: Array.isArray(q.options) ? q.options.join(", ") : String(q.options || ""),
    });
  });
}

$("#btn-autofill-job-tab")?.addEventListener("click", async () => {
  setStatus("Scraping job tab…", "run");
  try {
    const { result: r, board } = await scrapeJobBoardFromTab();
    if (!r?.ok) {
      setStatus(r?.error || "Autofill failed.", "err");
      return;
    }
    applyScrapedJobPayload(r);
    const nq = (r.questions || []).length;
    setStatus(
      `${boardLabel(board)} autofill: ${r.title || "Job"}${r.company ? " @ " + r.company : ""} — ${nq} application field(s).`,
      "ok",
    );
  } catch (e) {
    setStatus(e?.message || String(e), "err");
  }
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

  const usable = profiles.filter((p) => p.id);
  if (!usable.length) {
    setStatus("No profiles — open Account, sign in, and sync from server.", "err");
    return;
  }

  const questions = collectApplicationQuestions();
  const job = { title, company, salary, jd, referenceUrl, questions };
  running = true;
  const btn = $("#btn-start");
  if (btn) btn.disabled = true;

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  const generationResults = [];
  renderDownloads([]);

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
        const gen = await postGenerateManual(profile, job);
        generated++;
        generationResults.push({ profileLabel: label, gen });
        renderDownloads(generationResults);
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

/* ─── Application screenshot (Win+Shift+S → paste → Drive) ───────── */
let screenshotObjectUrl = null;
let screenshotBlob = null;

function setScreenshotPreviewFromBlob(blob) {
  const zone = $("#screenshot-zone");
  const img = $("#screenshot-preview");
  const wrap = $("#screenshot-preview-wrap");
  const btnUp = $("#btn-screenshot-upload");
  const res = $("#screenshot-result");
  if (screenshotObjectUrl) {
    URL.revokeObjectURL(screenshotObjectUrl);
    screenshotObjectUrl = null;
  }
  screenshotBlob = blob || null;
  if (!zone || !img || !wrap || !btnUp) return;
  if (res) res.textContent = "";
  if (!blob) {
    img.removeAttribute("src");
    wrap.classList.remove("visible");
    zone.classList.remove("has-image");
    btnUp.disabled = true;
    return;
  }
  screenshotObjectUrl = URL.createObjectURL(blob);
  img.src = screenshotObjectUrl;
  wrap.classList.add("visible");
  zone.classList.add("has-image");
  btnUp.disabled = false;
}

function consumeImageFile(file) {
  if (!file) return;
  const t = (file.type || "").toLowerCase();
  if (!/^image\/(png|jpeg|jpg|webp)$/.test(t)) {
    setStatus("Use a PNG, JPEG, or WebP image.", "err");
    return;
  }
  setScreenshotPreviewFromBlob(file);
  setStatus("Image ready. Click Upload to Drive when ready.", "ok");
}

function initScreenshotUpload() {
  const zone = $("#screenshot-zone");
  const fileIn = $("#screenshot-file");
  if (!zone || !fileIn) return;

  zone.addEventListener("click", () => zone.focus());

  zone.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items?.length) return;
    for (const item of items) {
      if (item.kind === "file" && item.type?.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob) {
          consumeImageFile(blob);
          e.preventDefault();
          break;
        }
      }
    }
  });

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) consumeImageFile(f);
  });

  $("#btn-screenshot-pick")?.addEventListener("click", () => fileIn.click());
  fileIn.addEventListener("change", () => {
    const f = fileIn.files?.[0];
    if (f) consumeImageFile(f);
    fileIn.value = "";
  });

  $("#btn-screenshot-clear")?.addEventListener("click", () => {
    setScreenshotPreviewFromBlob(null);
    setStatus("Screenshot cleared.", "");
  });

  $("#btn-screenshot-upload")?.addEventListener("click", async () => {
    if (!screenshotBlob) return;
    const title = ($("#job-title")?.value || "").trim();
    const company = ($("#company")?.value || "").trim();
    const btn = $("#btn-screenshot-upload");
    if (btn) btn.disabled = true;
    setStatus("Uploading application screenshot…", "run");
    try {
      const data = await postUploadApplicationScreenshot(screenshotBlob, { title, company });
      const url = String(data?.drive_url || "").trim();
      const resEl = $("#screenshot-result");
      if (resEl && url) {
        resEl.textContent = "";
        resEl.appendChild(document.createTextNode("Uploaded — "));
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Open in Google Drive";
        resEl.appendChild(a);
      }
      setStatus("Screenshot uploaded to Drive.", "ok");
    } catch (e) {
      setStatus(e?.message || String(e), "err");
      if (btn) btn.disabled = false;
      return;
    }
    if (btn) btn.disabled = false;
  });
}

function applyPendingJdFromRail() {
  chrome.storage.local.get(["manualJd_pendingJd"], (d) => {
    if (d.manualJd_pendingJd == null) return;
    const ta = document.getElementById("jd");
    const text = String(d.manualJd_pendingJd);
    if (ta && text.trim()) ta.value = text;
    chrome.storage.local.remove(["manualJd_pendingJd"]);
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    document.querySelector('.tab-btn[data-tab="run"]')?.classList.add("active");
    document.getElementById("panel-run")?.classList.add("active");
    if (text.trim()) setStatus("Loaded JD from the page (book on the rail).", "ok");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadAuthFields();
  loadProfiles();
  applyPendingJdFromRail();
  initScreenshotUpload();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || changes.manualJd_pendingJd == null) return;
  const nv = changes.manualJd_pendingJd.newValue;
  if (nv != null && String(nv).trim()) {
    const ta = document.getElementById("jd");
    if (ta) ta.value = String(nv);
    chrome.storage.local.remove(["manualJd_pendingJd"]);
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    document.querySelector('.tab-btn[data-tab="run"]')?.classList.add("active");
    document.getElementById("panel-run")?.classList.add("active");
    setStatus("Updated JD from the page (book on the rail).", "ok");
  }
});
