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
    if (btn.dataset.tab === "queue") refreshQueueUi();
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

const HISTORY_PAGE_SIZE = 100;
const HISTORY_DISMISSED_IDS_KEY = "manualJd_historyDismissedGenerationIds";

async function loadDismissedHistoryIds() {
  const r = await chrome.storage.local.get(HISTORY_DISMISSED_IDS_KEY);
  const arr = r[HISTORY_DISMISSED_IDS_KEY];
  const set = new Set();
  if (Array.isArray(arr)) {
    for (const x of arr) {
      const n = Number(x);
      if (Number.isFinite(n) && n > 0) set.add(n);
    }
  }
  return set;
}

async function mergeDismissedHistoryIds(ids) {
  if (!ids.length) return;
  const cur = await loadDismissedHistoryIds();
  for (const id of ids) cur.add(id);
  await chrome.storage.local.set({ [HISTORY_DISMISSED_IDS_KEY]: [...cur] });
}

async function clearDismissedHistoryIds() {
  await chrome.storage.local.remove([HISTORY_DISMISSED_IDS_KEY]);
}

function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function passesHistoryDateFilter(iso, filter) {
  if (!filter || filter === "all") return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return true;
  const sod = startOfLocalDay(new Date());
  const dayMs = 86400000;
  if (filter === "today") return t >= sod && t < sod + dayMs;
  if (filter === "yesterday") {
    const yStart = sod - dayMs;
    return t >= yStart && t < sod;
  }
  if (filter === "7d") return t >= sod - 7 * dayMs;
  if (filter === "30d") return t >= sod - 30 * dayMs;
  return true;
}

function localDayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** @param {{ created_at: string }[]} items */
function partitionHistoryByLocalDay(items) {
  const groups = [];
  let curKey = null;
  let bucket = null;
  for (const g of items) {
    const key = localDayKey(g.created_at);
    if (!key) continue;
    if (key !== curKey) {
      curKey = key;
      bucket = { dayKey: key, items: [] };
      groups.push(bucket);
    }
    bucket.items.push(g);
  }
  return groups;
}

function formatHistoryCellDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function formatHistoryDayHeader(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

async function renderHistory() {
  const wrap = $("#history-table-wrap");
  const countEl = $("#history-count");
  if (!wrap) return;
  wrap.textContent = "Loading…";
  if (countEl) countEl.textContent = "";
  try {
    const order = $("#history-order")?.value || "desc";
    const dateFilter = $("#history-date-filter")?.value || "all";
    const data = await ResumeAuth.fetchMyGenerations(API_URL, 1, HISTORY_PAGE_SIZE, order);
    const loaded = data.items || [];
    const dismissed = await loadDismissedHistoryIds();
    const notDismissed = loaded.filter((g) => !dismissed.has(Number(g.id)));
    const filtered = notDismissed.filter((g) => passesHistoryDateFilter(g.created_at, dateFilter));
    const hiddenInList = loaded.length - notDismissed.length;

    if (countEl) {
      const f = filtered.length;
      const L = loaded.length;
      const baseHidden = hiddenInList > 0 ? ` · ${hiddenInList} hidden in this extension only` : "";
      if (!L) countEl.textContent = "0 resumes in this list.";
      else if (dateFilter === "all" || f === notDismissed.length)
        countEl.textContent = `${f} resume${f === 1 ? "" : "s"} visible (all loaded, up to ${HISTORY_PAGE_SIZE})${baseHidden}.`;
      else
        countEl.textContent = `${f} resume${f === 1 ? "" : "s"} match this filter · ${notDismissed.length} visible of ${L} loaded (up to ${HISTORY_PAGE_SIZE})${baseHidden}.`;
    }

    if (!loaded.length) {
      wrap.innerHTML = '<p class="empty-msg">No generations yet.</p>';
      return;
    }

    if (!notDismissed.length) {
      wrap.innerHTML =
        '<p class="empty-msg">All loaded rows are hidden in this extension only. Your generations are still on the server. Use “Show hidden again” to restore the list.</p>';
      return;
    }

    if (!filtered.length) {
      wrap.innerHTML =
        '<p class="empty-msg">No generations match this filter. Choose “All dates” or a wider range.</p>';
      return;
    }

    const head = `<table class="hist-table">
      <thead class="hist-thead"><tr>
        <th class="hist-th" style="width:28px"><input type="checkbox" id="history-select-all" title="Select all" /></th>
        <th class="hist-th">When</th>
        <th class="hist-th">Title</th>
        <th class="hist-th">Company</th>
        <th class="hist-th">Stage</th>
      </tr></thead><tbody>`;

    const parts = [];
    for (const { items: dayItems } of partitionHistoryByLocalDay(filtered)) {
      const first = dayItems[0];
      const label = formatHistoryDayHeader(first.created_at);
      parts.push(
        `<tr class="hist-day"><td colspan="5">${esc(label)} — ${dayItems.length} resume${dayItems.length === 1 ? "" : "s"}</td></tr>`,
      );
      for (const g of dayItems) {
        parts.push(`<tr class="hist-row">
        <td><input type="checkbox" class="history-cb" data-id="${g.id}" /></td>
        <td class="hist-time">${esc(formatHistoryCellDateTime(g.created_at))}</td>
        <td style="word-break:break-word">${esc(g.title)}</td>
        <td style="word-break:break-word">${esc(g.company_name || "")}</td>
        <td>${esc(g.stage)}</td>
      </tr>`);
      }
    }

    wrap.innerHTML = head + parts.join("") + "</tbody></table>";
    $("#history-select-all")?.addEventListener("change", (e) => {
      const on = e.target.checked;
      wrap.querySelectorAll(".history-cb").forEach((cb) => {
        cb.checked = on;
      });
    });
  } catch (e) {
    wrap.textContent = e?.message || "Failed to load history";
    if (countEl) countEl.textContent = "";
  }
}

$("#history-order")?.addEventListener("change", () => renderHistory());

$("#history-date-filter")?.addEventListener("change", () => renderHistory());

$("#btn-history-hide-selected")?.addEventListener("click", async () => {
  const wrap = $("#history-table-wrap");
  if (!wrap) return;
  const ids = [];
  wrap.querySelectorAll(".history-cb:checked").forEach((cb) => {
    const id = Number(cb.getAttribute("data-id"));
    if (id) ids.push(id);
  });
  if (!ids.length) {
    alert("Select at least one row.");
    return;
  }
  if (
    !confirm(
      `Hide ${ids.length} row(s) from this extension’s list only?\n\nYour resumes stay on the server; this only cleans up the local view.`,
    )
  )
    return;
  await mergeDismissedHistoryIds(ids);
  await renderHistory();
});

$("#btn-history-show-hidden")?.addEventListener("click", async () => {
  if (!confirm("Show all rows again that were hidden in this extension?")) return;
  await clearDismissedHistoryIds();
  await renderHistory();
});

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

const JBU = globalThis.JobBoardUtils;

function isGreenhouseJobUrl(url) {
  return JBU.isGreenhouseJobUrl(url);
}
function isAshbyJobUrl(url) {
  return JBU.isAshbyJobUrl(url);
}
function isWorkableJobUrl(url) {
  return JBU.isWorkableJobUrl(url);
}
function detectJobBoardFromUrl(url) {
  return JBU.detectJobBoardFromUrl(url);
}
function boardLabel(board) {
  return JBU.boardLabel(board);
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

async function scrapeJobBoardFromTab() {
  const tabId = await findJobBoardTabId();
  if (tabId == null) {
    throw new Error(
      "No supported job tab found. Open a Greenhouse posting (…greenhouse.io…/jobs/…), Ashby (jobs.ashbyhq.com), or Workable (apply.workable.com/…/j/…), focus that tab, then try again.",
    );
  }
  const tab = await chrome.tabs.get(tabId);
  const board = detectJobBoardFromUrl(tab?.url || "");
  if (!board) {
    throw new Error("Could not detect job board from tab URL.");
  }

  const file =
    board === "greenhouse"
      ? JBU.scrapeScriptFile("greenhouse")
      : board === "ashby"
        ? JBU.scrapeScriptFile("ashby")
        : JBU.scrapeScriptFile("workable");
  const ashby = board === "ashby";
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [file],
    ...(ashby ? { world: "MAIN" } : {}),
  });

  const readScrape = () => globalThis[JBU.scrapeGlobalName(board)];
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    ...(ashby ? { world: "MAIN" } : {}),
    func: readScrape,
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
/** Last successful /api/generate/manual id (for linking application snip upload). */
let lastManualGenerationId = null;

function runFormHasContent() {
  const fields = ["job-title", "company", "salary", "jd", "reference-url"];
  if (fields.some((id) => (document.getElementById(id)?.value || "").trim())) return true;
  if (document.querySelectorAll("#questions-container .q-row").length) return true;
  if (screenshotBlob) return true;
  const dl = $("#downloads-list");
  if (dl?.children?.length) return true;
  return false;
}

function clearRunForm() {
  const ids = ["job-title", "company", "salary", "jd", "reference-url"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  }
  const qc = $("#questions-container");
  if (qc) qc.innerHTML = "";
  setScreenshotPreviewFromBlob(null);
  const res = $("#screenshot-result");
  if (res) res.textContent = "";
  const fileIn = $("#screenshot-file");
  if (fileIn) fileIn.value = "";
  renderDownloads([]);
  lastManualGenerationId = null;
  setStatus("Form cleared — enter the next job.", "");
}

$("#btn-clear-run")?.addEventListener("click", () => {
  if (running) {
    setStatus("Wait until generation finishes before clearing.", "err");
    return;
  }
  if (runFormHasContent()) {
    if (
      !confirm(
        "Clear everything on the Run tab?\n\nTitle, company, JD, questions, screenshot preview, and download links will be removed. Your generated files stay on Drive and in your account history.",
      )
    )
      return;
  }
  clearRunForm();
});

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
        lastManualGenerationId = gen?.id ?? null;
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
      const data = await postUploadApplicationScreenshot(screenshotBlob, {
        title,
        company,
        generationId: lastManualGenerationId,
      });
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

function applyPendingJdFromStorage() {
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
    if (text.trim()) setStatus("Loaded pending job description into the JD field.", "ok");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadAuthFields();
  loadProfiles();
  applyPendingJdFromStorage();
  initScreenshotUpload();
  initQueuePanel();
});

/* ─── Queue automation (manualJD-support.json) ─────────────────── */
const QUEUE_STORAGE_KEY = "manualJd_urlQueue";

function setQueueStatus(text, kind) {
  const el = $("#queue-status-msg");
  if (!el) return;
  el.textContent = text;
  el.className = "status-msg" + (kind ? ` ${kind}` : "");
}

function renderQueueState(s) {
  const st = s || {};
  const idxEl = $("#queue-stat-index");
  const totEl = $("#queue-stat-total");
  const genEl = $("#queue-stat-generated");
  const skipEl = $("#queue-stat-skipped");
  const curEl = $("#queue-current-url");
  if (idxEl) idxEl.textContent = String(st.queueIndex ?? 0);
  if (totEl) totEl.textContent = String(st.total ?? 0);
  if (genEl) genEl.textContent = String(st.generated ?? 0);
  if (skipEl) skipEl.textContent = String(st.skipped ?? 0);
  if (curEl) {
    curEl.textContent = st.currentUrl
      ? `Current: ${st.currentTitle ? st.currentTitle + " — " : ""}${st.currentUrl}`
      : "";
  }
  const msg = st.lastError || "";
  if (st.running && !st.paused) setQueueStatus(msg || "Running…", "run");
  else if (st.paused) setQueueStatus(msg || "Paused", "err");
  else if (msg) setQueueStatus(msg, st.failed ? "err" : "ok");
}

async function refreshQueueUi() {
  const stored = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
  const doc = stored[QUEUE_STORAGE_KEY];
  const meta = $("#queue-file-meta");
  if (meta) {
    const n = Array.isArray(doc?.items) ? doc.items.length : 0;
    meta.textContent = n
      ? `Loaded ${n} supported URL(s)${doc.generated_at ? ` · ${doc.generated_at}` : ""}`
      : "No queue loaded.";
  }
  chrome.runtime.sendMessage({ action: "queueGetState" }, (res) => {
    if (res?.ok && res.state) renderQueueState(res.state);
  });
}

function initQueuePanel() {
  $("#queue-json-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const items = Array.isArray(data.items) ? data.items : Array.isArray(data.urls) ? data.urls : null;
      if (!items?.length) {
        setQueueStatus("JSON must contain a non-empty items[] array.", "err");
        return;
      }
      for (const it of items) {
        if (!String(it.url || "").trim()) {
          setQueueStatus("Each item needs a url field.", "err");
          return;
        }
      }
      await chrome.storage.local.set({ [QUEUE_STORAGE_KEY]: data });
      await chrome.runtime.sendMessage({ action: "queueReset" });
      setQueueStatus(`Loaded ${items.length} URL(s). Click Start to begin.`, "ok");
      refreshQueueUi();
    } catch (err) {
      setQueueStatus(err?.message || "Invalid JSON file", "err");
    }
    e.target.value = "";
  });

  $("#btn-queue-start")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "queueStart", reset: true }, (res) => {
      if (!res?.ok) setQueueStatus(res?.error || "Failed to start", "err");
      else refreshQueueUi();
    });
  });

  $("#btn-queue-pause")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "queuePause" }, (res) => {
      if (!res?.ok) setQueueStatus(res?.error || "Failed to pause", "err");
      else refreshQueueUi();
    });
  });

  $("#btn-queue-resume")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "queueStart", reset: false }, (res) => {
      if (!res?.ok) setQueueStatus(res?.error || "Failed to resume", "err");
      else refreshQueueUi();
    });
  });

  $("#btn-queue-stop")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "queueStop" }, (res) => {
      if (!res?.ok) setQueueStatus(res?.error || "Failed to stop", "err");
      else refreshQueueUi();
    });
  });

  $("#btn-queue-reset")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "queueReset" }, (res) => {
      if (!res?.ok) setQueueStatus(res?.error || "Failed to reset", "err");
      else refreshQueueUi();
    });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "manualJdQueueState" && msg.state) {
      renderQueueState(msg.state);
    }
  });

  refreshQueueUi();
}

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
    setStatus("Updated job description from pending storage.", "ok");
  }
});
