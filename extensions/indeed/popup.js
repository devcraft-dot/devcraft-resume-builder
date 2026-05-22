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
    if (btn.dataset.tab === "history") renderHistory();
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

function renderProfilesList() {
  const container = $("#profiles-container");
  if (!container) return;
  container.innerHTML = "";
  if (!profiles.length) {
    const li = document.createElement("li");
    li.textContent = "No profiles — sign in under Settings and sync from server";
    container.appendChild(li);
    return;
  }
  profiles.forEach((p, i) => {
    const li = document.createElement("li");
    const name = (p.name || "").trim() || `Profile ${i + 1}`;
    li.textContent = `${name} — ${p.model || "gpt-5.4-mini"}`;
    container.appendChild(li);
  });
}

async function loadProfiles() {
  profiles = await ResumeAuth.getServerProfiles();
  renderProfilesList();
  renderRunProfilesSummary();
  chrome.runtime.sendMessage({ action: "getState" }, (s) => {
    if (s) updateUI(s);
    else updateStatsNoteOnly();
  });
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
    renderRunProfilesSummary();
    if (st) st.textContent = `Synced ${profiles.length} profile(s)`;
  } catch (e) {
    if (st) st.textContent = e?.message || "Sync failed";
  }
});

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

const HISTORY_PAGE_SIZE = 100;
const HISTORY_DISMISSED_IDS_KEY = "indeed_historyDismissedGenerationIds";

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
        `<tr class="hist-day"><td colspan="5">${escHtml(label)} — ${dayItems.length} resume${dayItems.length === 1 ? "" : "s"}</td></tr>`,
      );
      for (const g of dayItems) {
        parts.push(`<tr class="hist-row">
        <td><input type="checkbox" class="history-cb" data-id="${g.id}" /></td>
        <td class="hist-time">${escHtml(formatHistoryCellDateTime(g.created_at))}</td>
        <td style="word-break:break-word">${escHtml(g.title)}</td>
        <td style="word-break:break-word">${escHtml(g.company_name || "")}</td>
        <td><span style="font-weight:700;color:var(--text)">${escHtml(g.stage)}</span></td>
      </tr>`);
      }
    }

    wrap.innerHTML = head + parts.join("") + "</tbody></table>";
    const all = $("#history-select-all");
    all?.addEventListener("change", (e) => {
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

  const smartPre = $("#smart-skip-manual");
  if (smartPre) {
    const live = Array.isArray(s.smartSkips) ? s.smartSkips : [];
    if (live.length) {
      smartPre.textContent = live
        .map((x) => `[${x.reason || "?"}] ${(x.title || "").trim() || "(no title)"}\n${x.url || ""}`)
        .join("\n\n");
    } else {
      chrome.storage.local.get("indeedSmartSkipReport", (d) => {
        const rep = d.indeedSmartSkipReport;
        const items = rep && Array.isArray(rep.items) ? rep.items : [];
        if (items.length) {
          const when = rep.finishedAt ? new Date(rep.finishedAt).toLocaleString() : "";
          smartPre.textContent =
            `(Last completed run${when ? ", " + when : ""})\n\n` +
            items
              .map((x) => `[${x.reason || "?"}] ${(x.title || "").trim() || "(no title)"}\n${x.url || ""}`)
              .join("\n\n");
        } else {
          smartPre.textContent = "None yet this session. After a full run, skipped gov/clearance jobs appear here.";
        }
      });
    }
  }

  const isRunning = s.running && !s.paused;
  const isPaused = s.running && s.paused;
  const isStopped = !s.running;

  $("#btn-start").disabled = isRunning;
  $("#btn-resume").disabled = !isPaused;
  $("#btn-pause").disabled = !isRunning;
  $("#btn-stop").disabled = isStopped;
}

async function requireSignedIn() {
  const token = await ResumeAuth.getAccessToken();
  if (token) return true;
  alert("Sign in under Settings before starting. The API needs your access token.");
  $("#btn-link-settings")?.click();
  return false;
}

/* ─── Controls ──────────────────────────────────────────────────── */
$("#btn-start").addEventListener("click", async () => {
  if (!(await requireSignedIn())) return;
  chrome.runtime.sendMessage(
    { action: "start", reset: true, profileIndex: 0 },
    (res) => {
      if (!res?.ok) alert(res?.error || "Failed to start");
    },
  );
});

$("#btn-resume").addEventListener("click", async () => {
  if (!(await requireSignedIn())) return;
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

$("#btn-smart-skip-copy")?.addEventListener("click", async () => {
  const pre = $("#smart-skip-manual");
  const text = pre?.textContent?.trim() || "";
  if (!text || text.startsWith("None yet")) {
    alert("Nothing to copy yet.");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    const btn = $("#btn-smart-skip-copy");
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = prev), 1500);
    }
  } catch {
    alert("Could not copy — select the text in the box and copy manually.");
  }
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
  loadAuthFields();
  loadProfiles();
});
