const $ = (s) => document.querySelector(s);
const {
  canonicalJobUrl,
  checkGenerationKeys,
  postGenerateManual,
  postUploadApplicationScreenshot,
  extractDriveFileId,
  driveExportUrl,
  fetchAuthConfig,
  getAccessToken,
  setAccessToken,
  postExtensionToken,
  fetchAuthWhoami,
  fetchExtensionProfiles,
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
    if (btn.dataset.tab === "run") refreshAuthBanner();
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
  chrome.storage.sync.get({ profiles: [], manualJd_clientUsername: "" }, (d) => {
    profiles = d.profiles || [];
    if (!profiles.length) {
      profiles.push({ name: "Default", model: "gpt-5.4-mini", text: "" });
    }
    const u = document.getElementById("ext-client-username");
    if (u) u.value = d.manualJd_clientUsername || "";
    renderProfiles();
  });
  chrome.storage.local.get({ manualJd_mintSecret: "" }, (d) => {
    const m = document.getElementById("mint-secret");
    if (m) m.value = d.manualJd_mintSecret || "";
  });
}

$("#btn-add")?.addEventListener("click", () => {
  collectProfiles();
  profiles.push({ name: "", model: "gpt-5.4-mini", text: "" });
  renderProfiles();
});

async function mintExtensionApiToken(options = {}) {
  const silent = options.silent === true;
  const msgEl = document.getElementById("profiles-api-msg");
  let cfg;
  try {
    cfg = await fetchAuthConfig();
  } catch (e) {
    if (msgEl) msgEl.textContent = e?.message || String(e);
    return false;
  }
  if (!cfg?.auth_required) {
    if (msgEl && !silent) msgEl.textContent = "Server auth is off — no API token needed.";
    return false;
  }
  collectProfiles();
  const un = ($("#ext-client-username")?.value || "").trim();
  if (!un) {
    if (msgEl) msgEl.textContent = "Enter extension username first.";
    return false;
  }
  const names = profiles.map((p) => (p.name || "").trim()).filter(Boolean);
  if (!names.length) {
    if (msgEl) msgEl.textContent = "Add at least one profile with a non-empty name (must match server).";
    return false;
  }
  const mintSecret = ($("#mint-secret")?.value || "").trim();
  try {
    const data = await postExtensionToken(un, names, mintSecret);
    await setAccessToken(data.access_token);
    if (msgEl) msgEl.textContent = "API token saved.";
    await refreshAuthBanner();
    return true;
  } catch (e) {
    if (msgEl) msgEl.textContent = e?.message || String(e);
    return false;
  }
}

$("#btn-save")?.addEventListener("click", () => {
  collectProfiles();
  const un = ($("#ext-client-username")?.value || "").trim();
  chrome.storage.sync.set({ profiles, manualJd_clientUsername: un }, async () => {
    const el = $("#save-status");
    if (el) {
      el.textContent = "Saved";
      setTimeout(() => {
        el.textContent = "";
      }, 2000);
    }
    await mintExtensionApiToken({ silent: true });
  });
});

$("#btn-mint-token")?.addEventListener("click", () => {
  mintExtensionApiToken();
});

$("#btn-pull-profiles")?.addEventListener("click", async () => {
  const msgEl = document.getElementById("profiles-api-msg");
  collectProfiles();
  try {
    const cfg = await fetchAuthConfig();
    if (!cfg?.auth_required) {
      if (msgEl) msgEl.textContent = "Server auth is off — nothing to pull.";
      return;
    }
    const tok = await getAccessToken();
    if (!tok) {
      if (msgEl) msgEl.textContent = "Get an API token first (Save profiles or Get API token).";
      return;
    }
    const rows = await fetchExtensionProfiles();
    if (!Array.isArray(rows)) throw new Error("Unexpected response from server");
    const by = new Map(rows.map((r) => [(String(r.name || "")).trim(), String(r.profile_text || "")]));
    let n = 0;
    profiles.forEach((p) => {
      const key = (p.name || "").trim();
      if (key && by.has(key)) {
        p.text = by.get(key);
        n += 1;
      }
    });
    renderProfiles();
    if (msgEl) msgEl.textContent = n ? `Updated ${n} profile text(s) from server.` : "No matching profile names on the server for your cards.";
  } catch (e) {
    if (msgEl) msgEl.textContent = e?.message || String(e);
  }
});

$("#mint-secret")?.addEventListener("change", () => {
  const v = ($("#mint-secret")?.value || "").trim();
  chrome.storage.local.set({ manualJd_mintSecret: v });
});

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

function tryConsumeAutofillPayload(raw) {
  let o;
  try {
    o = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    setStatus("Invalid autofill payload.", "err");
    return;
  }
  const r = o?.result;
  const board = o?.board;
  if (!r?.ok) {
    setStatus(r?.error || "Autofill failed.", "err");
    return;
  }
  applyScrapedJobPayload(r);
  const nq = (r.questions || []).length;
  const bl = board === "ashby" ? "Ashby" : "Greenhouse";
  setStatus(`${bl} autofill: ${r.title || "Job"}${r.company ? " @ " + r.company : ""} — ${nq} application field(s).`, "ok");
}

async function refreshAuthBanner() {
  const banner = document.getElementById("auth-banner-run");
  if (!banner) return;
  try {
    const cfg = await fetchAuthConfig();
    if (!cfg?.auth_required) {
      banner.style.display = "none";
      return;
    }
    banner.style.display = "block";
    const token = await getAccessToken();
    if (!token) {
      banner.className = "account-banner";
      banner.textContent =
        "This API requires a JWT. Open Profiles: set extension username, then Save profiles or Get API token (profile names must exist on the server).";
      return;
    }
    try {
      const w = await fetchAuthWhoami();
      const names = Array.isArray(w.profile_names) ? w.profile_names.join(", ") : "";
      banner.className = "account-banner ok";
      banner.textContent = `API token OK — user ${w.username || "?"}. Allowed profiles: ${names || "(none)"}.`;
    } catch {
      banner.className = "account-banner";
      banner.textContent = "API token present but invalid or expired. Mint a new token from the Profiles tab.";
    }
  } catch {
    banner.style.display = "none";
  }
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

  collectProfiles();
  const usable = profiles.filter((p) => (p.text || "").trim().length > 0);
  if (!usable.length) {
    setStatus('No profile text — open "Profiles" and paste your resume facts.', "err");
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
    const jd = ($("#jd")?.value || "").trim();
    const referenceUrl = ($("#reference-url")?.value || "").trim();
    const salary = ($("#salary")?.value || "").trim();
    const btn = $("#btn-screenshot-upload");
    if (btn) btn.disabled = true;
    setStatus("Uploading application screenshot…", "run");
    try {
      collectProfiles();
      const usable = profiles.filter((p) => (p.text || "").trim().length > 0);
      const questions = collectApplicationQuestions();
      const job = { title, company, salary, jd, referenceUrl, questions };
      let jobUrls = [];
      if (title && jd && usable.length) {
        for (const p of usable) {
          const label = (p.name || "").trim() || "default";
          jobUrls.push(await canonicalJobUrl(label, job));
        }
      }
      const data = await postUploadApplicationScreenshot(screenshotBlob, {
        title,
        company,
        jobUrls,
      });
      const url = String(data?.drive_url || "").trim();
      const nApplied = Number(data?.generations_marked_applied ?? 0);
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
      if (nApplied > 0) {
        setStatus(
          `Screenshot uploaded. Marked ${nApplied} generation row(s) as applied (was generated).`,
          "ok",
        );
      } else {
        setStatus(
          "Screenshot uploaded to Drive." +
            (jobUrls.length
              ? " No matching rows in stage “generated” (generate first, or URL/profile may differ)."
              : " Add job title + JD + profile text to link this upload to pipeline stages."),
          jobUrls.length ? "ok" : "",
        );
      }
    } catch (e) {
      setStatus(e?.message || String(e), "err");
      if (btn) btn.disabled = false;
      return;
    }
    if (btn) btn.disabled = false;
  });
}

function clearApplicationForm() {
  ["job-title", "company", "salary", "jd", "reference-url"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const qc = document.getElementById("questions-container");
  if (qc) qc.innerHTML = "";
  setScreenshotPreviewFromBlob(null);
  const res = document.getElementById("screenshot-result");
  if (res) res.textContent = "";
  renderDownloads([]);
  setStatus("Application form cleared.", "ok");
}

$("#btn-clear-application")?.addEventListener("click", () => {
  clearApplicationForm();
});

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
    if (text.trim()) setStatus("Loaded JD from a previous send-to-panel action.", "ok");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadProfiles();
  applyPendingJdFromRail();
  initScreenshotUpload();
  refreshAuthBanner();
  chrome.storage.local.get(["manualJd_autofillPayload"], (d) => {
    const raw = d.manualJd_autofillPayload;
    if (raw != null && String(raw).trim()) {
      tryConsumeAutofillPayload(raw);
      chrome.storage.local.remove(["manualJd_autofillPayload"]);
    }
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.manualJd_autofillPayload != null) {
    const nv = changes.manualJd_autofillPayload.newValue;
    if (nv != null && String(nv).trim()) {
      tryConsumeAutofillPayload(nv);
      chrome.storage.local.remove(["manualJd_autofillPayload"]);
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      document.querySelector('.tab-btn[data-tab="run"]')?.classList.add("active");
      document.getElementById("panel-run")?.classList.add("active");
    }
  }
  if (changes.manualJd_pendingJd == null) return;
  const nv = changes.manualJd_pendingJd.newValue;
  if (nv != null && String(nv).trim()) {
    const ta = document.getElementById("jd");
    if (ta) ta.value = String(nv);
    chrome.storage.local.remove(["manualJd_pendingJd"]);
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    document.querySelector('.tab-btn[data-tab="run"]')?.classList.add("active");
    document.getElementById("panel-run")?.classList.add("active");
    setStatus("Updated JD from send-to-panel.", "ok");
  }
});
