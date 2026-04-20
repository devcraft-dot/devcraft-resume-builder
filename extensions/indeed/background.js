importScripts("config.js");

const DEFAULT_STATE = {
  running: false,
  paused: false,
  currentPage: 1,
  currentJobIndex: 0,
  totalJobsOnPage: 0,
  processed: 0,
  skipped: 0,
  failed: 0,
  lastError: "",
  activeProfileIndex: 0,
  /** "" | "collect_urls" | "scrape_details" */
  phase: "",
  scrapeIndex: 0,
  /** Recent skip reasons (newest last), for popup + debugging */
  skipLog: [],
};

const PENDING_DETAIL_URLS_KEY = "indeedPendingDetailUrls";
/** Failed resume-API calls only (local extension storage; nothing on Vercel). */
const API_ERROR_LOG_KEY = "indeedApiErrorLog";
const API_ERROR_LOG_MAX = 60;

let state = { ...DEFAULT_STATE };
let searchTabId = null;
let keepAliveInterval = null;

async function loadState() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ runState: DEFAULT_STATE }, (d) => {
      state = { ...DEFAULT_STATE, ...d.runState };
      resolve(state);
    });
  });
}

async function saveState() {
  return chrome.storage.local.set({ runState: state });
}

async function getProfiles() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ profiles: [] }, (d) => resolve(d.profiles || []));
  });
}

function broadcastState() {
  chrome.runtime.sendMessage({ type: "stateUpdate", state }).catch(() => {});
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
    console.error("[Indeed ext] appendApiErrorLog failed", e);
  }
}

function appendSkipLog(message) {
  if (!Array.isArray(state.skipLog)) state.skipLog = [];
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `${ts} — ${message}`;
  state.skipLog.push(line);
  const max = 80;
  if (state.skipLog.length > max) state.skipLog.splice(0, state.skipLog.length - max);
  console.warn("[Indeed ext] skip:", line);
}

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    if (state.running) chrome.storage.local.get("runState", () => {});
  }, 20000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

function sendToTab(tabId, action, extra = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action, ...extra }, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

async function sendToTabRetry(tabId, action, extra = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await sendToTab(tabId, action, extra);
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(1000);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tabEffectiveUrl(t) {
  return String(t?.pendingUrl || t?.url || "");
}

function normalizeSerpUrlForCompare(u) {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.href;
  } catch {
    return String(u || "");
  }
}

/** Wait until Indeed SERP tab URL changes (pagination navigation). */
async function waitForSerpUrlChangedFrom(tabId, prevUrl, timeoutMs) {
  const prevNorm = normalizeSerpUrlForCompare(prevUrl);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const t = await chrome.tabs.get(tabId);
      const cur = tabEffectiveUrl(t);
      if (cur && normalizeSerpUrlForCompare(cur) !== prevNorm) {
        const remaining = Math.max(2000, deadline - Date.now() + 2000);
        await waitForTabComplete(tabId, Math.min(45000, remaining)).catch(() => {});
        await sleep(500);
        return true;
      }
    } catch {
      /* */
    }
    await sleep(120);
  }
  return false;
}

/** Inject content script if needed. Returns false if the tab no longer exists or is not scriptable. */
async function ensureContentScript(tabId, file) {
  if (typeof tabId !== "number") return false;
  try {
    await sendToTab(tabId, "ping");
    return true;
  } catch {
    /* inject */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    await sleep(400);
    return true;
  } catch (e) {
    console.warn("[Indeed ext] ensureContentScript failed", tabId, e?.message || e);
    return false;
  }
}

function mosaicRowForJk(rows, jk) {
  if (!jk || !rows?.length) return null;
  const low = jk.toLowerCase();
  return rows.find((r) => String(r.jk || "").toLowerCase() === low) || null;
}

function jkFromDetailUrl(u) {
  const m = String(u || "").match(/jk=([a-f0-9]+)/i);
  return m ? m[1].toLowerCase() : "";
}

async function loadPendingDetailUrls() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [PENDING_DETAIL_URLS_KEY]: [] }, (d) => {
      const arr = d[PENDING_DETAIL_URLS_KEY];
      resolve(Array.isArray(arr) ? arr : []);
    });
  });
}

async function savePendingDetailUrls(urls) {
  return chrome.storage.local.set({ [PENDING_DETAIL_URLS_KEY]: urls });
}

async function appendPendingDetailUrlsUnique(newUrls) {
  const cur = await loadPendingDetailUrls();
  const seen = new Set();
  for (const u of cur) {
    const jk = jkFromDetailUrl(u);
    seen.add(jk || String(u).toLowerCase());
  }
  const out = cur.slice();
  for (const u of newUrls || []) {
    const s = String(u || "").trim();
    if (!s) continue;
    const jk = jkFromDetailUrl(s);
    const key = jk || s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  await savePendingDetailUrls(out);
  return out;
}

async function clearPendingDetailUrls() {
  await savePendingDetailUrls([]);
}

/**
 * Full job URLs from SERP mosaic (`viewJobLink` / `desktopViewJobLink`).
 */
async function extractMosaicDetailUrls(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        try {
          const root = window.mosaic?.providerData?.["mosaic-provider-jobcards"];
          const model = root?.metaData?.mosaicProviderJobCardsModel;
          const r = model?.results || root?.results;
          if (!r?.length) return { urls: [] };
          const urls = [];
          const seen = new Set();
          for (const j of r) {
            const jk = j.jobkey || j.jk;
            const link = j.viewJobLink || j.desktopViewJobLink || "";
            let abs = "";
            try {
              if (link) {
                abs = link.startsWith("http") ? link : new URL(link, "https://www.indeed.com").href;
              }
            } catch {
              /* */
            }
            if (!abs && jk) {
              abs = "https://www.indeed.com/viewjob?jk=" + encodeURIComponent(jk);
            }
            if (!abs) continue;
            const key = String(jk || abs).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            urls.push(abs);
          }
          return { urls };
        } catch {
          return { urls: [] };
        }
      },
    });
    const urls = result?.urls;
    return { urls: Array.isArray(urls) ? urls : [] };
  } catch {
    return { urls: [] };
  }
}

async function waitForBotClearOnTab(tabId) {
  const maxMs = DELAYS.BOT_CHECK_MAX_WAIT_MS ?? 30000;
  const poll = DELAYS.BOT_CHECK_POLL_MS ?? 1000;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    let bot = false;
    try {
      const r = await sendToTabRetry(tabId, "detectBotInterstitial", {}, 2);
      bot = !!r?.bot;
    } catch {
      /* */
    }
    if (!bot) return;
    await sleep(poll);
  }
}

async function findApplyTabAfterClick(clickSourceTabId, winId, idsBefore, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tabs = await chrome.tabs.query({ windowId: winId });
    for (const t of tabs) {
      if (idsBefore.has(t.id)) continue;
      const u = String(t.pendingUrl || t.url || "").trim();
      if (!u || u === "about:blank" || u.startsWith("chrome://") || u.startsWith("chrome-devtools:"))
        continue;
      if (u.startsWith("edge://") || u.startsWith("brave://")) continue;
      if (isIndeedJobListingViewUrl(u)) continue;
      if (isIndeedBffTabUrl(u)) return t.id;
    }
    try {
      const t = await chrome.tabs.get(clickSourceTabId);
      const u = String(t.url || t.pendingUrl || "").trim();
      if (isIndeedBffTabUrl(u)) return clickSourceTabId;
    } catch {
      /* */
    }
    await sleep(DELAYS.APPLY_NEW_TAB_POLL);
  }
  return null;
}

/** Indeed SEO job page / view — never treat as apply or wait on it as the apply tab. */
function isIndeedJobListingViewUrl(u) {
  if (!u) return false;
  return /indeed\.com\/job\//i.test(u) || /indeed\.com\/viewjob/i.test(u);
}

/** Tab URL is one where we expect window.bffContext (Indeed-hosted apply). */
function isIndeedBffTabUrl(u) {
  if (!u || isIndeedJobListingViewUrl(u)) return false;
  if (/preloadresumeapply|\/preload/i.test(u)) return false;
  return (
    /smartapply\.indeed\.com/i.test(u) ||
    /apply\.indeed\.com/i.test(u) ||
    /\/applystart/i.test(u)
  );
}

async function focusSearchTab(searchTabId) {
  await sleep(400);
  if (typeof searchTabId !== "number") return;
  try {
    await chrome.tabs.get(searchTabId);
  } catch {
    return;
  }
  try {
    await chrome.tabs.update(searchTabId, { active: true });
  } catch {
    /* */
  }
}

async function waitForNewTabNotInSet(windowId, idsBefore, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tabs = await chrome.tabs.query({ windowId });
    for (const t of tabs) {
      if (idsBefore.has(t.id)) continue;
      const u = String(t.pendingUrl || t.url || "").trim();
      if (!u || u === "about:blank" || u === "chrome://newtab/" || u.startsWith("chrome-devtools:")) continue;
      if (u.startsWith("edge://") || u.startsWith("brave://")) continue;
      if (isIndeedJobListingViewUrl(u)) continue;
      return t;
    }
    await sleep(DELAYS.APPLY_NEW_TAB_POLL);
  }
  return null;
}

async function closeApplyTabSafe(applyTabId) {
  try {
    await chrome.tabs.remove(applyTabId);
  } catch {
    /* */
  }
}

/**
 * Close tabs opened for this apply attempt only. Never blindly close every "new" tab — that can
 * kill the SERP tab or unrelated user tabs if idsBefore was wrong or a tab navigated.
 */
function looksLikeIndeedApplyTabUrl(url) {
  const u = String(url || "").toLowerCase();
  return (
    /smartapply\.indeed\./i.test(u) ||
    /apply\.indeed\./i.test(u) ||
    /\/applystart/i.test(u) ||
    u === "about:blank" ||
    u.startsWith("chrome://newtab")
  );
}

async function closeSpawnedTabsExceptSearch(windowId, idsBefore, searchTabId) {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    const toClose = tabs
      .filter((t) => {
        if (idsBefore.has(t.id) || t.id === searchTabId) return false;
        const u = t.url || t.pendingUrl || "";
        if (looksLikeIndeedApplyTabUrl(u)) return true;
        if (typeof t.openerTabId === "number" && t.openerTabId === searchTabId) return true;
        return false;
      })
      .map((t) => t.id);
    for (const id of toClose) {
      await closeApplyTabSafe(id);
    }
  } catch {
    /* */
  }
}

const QUESTION_TYPES = {
  SELECT: "select",
  RADIO: "select",
  TEXT_BOX: "input",
  TEXT_AREA: "textarea",
  NUMERIC: "input",
  CHECKBOX: "select",
  DATE: "input",
};

function mapScreenerQuestions(rows) {
  if (!rows?.length) return [];
  return rows
    .map((item) => {
      const q = item.question;
      if (!q?.details?.label) return null;
      return {
        id: q.id || null,
        label: q.details.label,
        type: QUESTION_TYPES[q.type] || "input",
        required: q.details.requirement === "REQUIRED",
        options: (q.details.options || []).map((o) => o.label || o.value).filter(Boolean),
      };
    })
    .filter(Boolean);
}

/**
 * `null` = BFF not ready yet; `[]` = loaded, no screener rows.
 */
function extractQuestionsFromBffRoot(root) {
  if (!root || typeof root !== "object") return null;
  if (!root.applicationDraftContext && !root.jobContext) return null;
  const agg = root.applicationDraftContext?.screenerQuestionAnswers;
  if (agg == null) return null;
  const rows = agg.screenerQuestionAnswers;
  if (!Array.isArray(rows)) return null;
  return mapScreenerQuestions(rows);
}

async function pollQuestionsFromBffTab(applyTabId) {
  for (let i = 0; i < 24; i++) {
    try {
      const root = await readBffRootFromApplyTab(applyTabId);
      const qs = extractQuestionsFromBffRoot(root);
      if (qs !== null) return qs;
    } catch {
      /* tab closed or scripting blocked */
    }
    await sleep(DELAYS.APPLY_BFF_POLL);
  }
  return null;
}

function jobBaseFromEssentialsAndRow(essentials, row) {
  const e = essentials && typeof essentials === "object" ? essentials : {};
  const r = row && typeof row === "object" ? row : {};
  const title = (e.title || r.title || "").trim();
  const company_name = (e.company || "").trim();
  const description_text = (e.descriptionSnippet || "").trim();
  const salary_range = (r.salary || "").trim();
  return {
    title,
    company_name,
    description_text,
    salary_range,
    url: "",
    questions: [],
  };
}

/**
 * On a job detail tab: click Indeed apply or company applystart, then read screener questions from
 * `window.bffContext` on the apply surface (new tab or same-tab navigation).
 */
async function fetchQuestionsViaApplyClick(clickSourceTabId, refocusTabId) {
  let winId;
  try {
    winId = (await chrome.tabs.get(clickSourceTabId)).windowId;
  } catch {
    return { questions: [], note: "source-tab-missing" };
  }

  const idsBefore = new Set((await chrome.tabs.query({ windowId: winId })).map((t) => t.id));
  let outcome = { questions: [], note: "click-failed" };

  try {
    let r;
    try {
      r = await sendToTabRetry(clickSourceTabId, "clickDetailApplyButton");
    } catch {
      outcome = { questions: [], note: "click-failed" };
      return outcome;
    }
    if (!r?.ok) {
      outcome = { questions: [], note: r?.reason || "no-apply-button" };
      return outcome;
    }

    const applyTabId = await findApplyTabAfterClick(
      clickSourceTabId,
      winId,
      idsBefore,
      DELAYS.APPLY_CLICK_NEW_TAB_WAIT,
    );
    if (applyTabId == null) {
      outcome = { questions: [], note: "no-apply-surface" };
      return outcome;
    }

    try {
      await waitForTabComplete(applyTabId, 38000);
    } catch {
      /* still try BFF */
    }
    await sleep(DELAYS.APPLY_TAB_SETTLE);

    let url = "";
    try {
      url = (await chrome.tabs.get(applyTabId)).url || "";
    } catch {
      outcome = { questions: [], note: "apply-tab-missing" };
      return outcome;
    }

    if (!isIndeedBffTabUrl(url)) {
      outcome = { questions: [], note: "non-indeed-apply-tab" };
      return outcome;
    }

    const questions = await pollQuestionsFromBffTab(applyTabId);
    if (questions === null) {
      outcome = { questions: [], note: "no-bff-questions" };
      return outcome;
    }
    outcome = { questions, note: "" };
    return outcome;
  } catch (e) {
    outcome = { questions: [], note: String(e?.message || e || "apply-flow-error") };
    return outcome;
  } finally {
    try {
      await closeSpawnedTabsExceptSearch(winId, idsBefore, refocusTabId);
      await focusSearchTab(refocusTabId);
    } catch {
      /* */
    }
  }
}

async function readMosaicRows(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        try {
          const root = window.mosaic?.providerData?.["mosaic-provider-jobcards"];
          const model = root?.metaData?.mosaicProviderJobCardsModel;
          const r = model?.results || root?.results;
          const mobtk = String(model?.mobtk || model?.jobsearchTk || "").trim();
          if (!r?.length) return { rows: [], mobtk };
          function embeddedSmartApplyUrl(obj, depth) {
            if (depth > 10 || !obj) return "";
            if (typeof obj === "string") {
              if (/applybyapplyablejobid/i.test(obj) && /smartapply\.indeed\.com/i.test(obj)) {
                const m = obj.match(
                  /https:\/\/smartapply\.indeed\.com\/beta\/indeedapply\/applybyapplyablejobid\?[^\s"'<>]+/i
                );
                if (m && !/preload/i.test(m[0])) return m[0];
              }
              return "";
            }
            if (typeof obj !== "object") return "";
            for (const k of Object.keys(obj)) {
              const hit = embeddedSmartApplyUrl(obj[k], depth + 1);
              if (hit) return hit;
            }
            return "";
          }
          return {
            mobtk,
            rows: r.map((j) => ({
              jk: j.jobkey,
              title: j.displayTitle || j.title || "",
              salary:
                (j.estimatedSalary && j.estimatedSalary.formattedRange) ||
                (j.extractedSalary != null && j.extractedSalary.max != null
                  ? String(j.extractedSalary.min ?? "") + "-" + String(j.extractedSalary.max ?? "")
                  : ""),
              thirdPartyApplyUrl: String(j.thirdPartyApplyUrl || "")
                .replace(/^http:\/\//i, "https://")
                .replace(/(https:\/\/[^/]+)\/+/g, "$1/"),
              embeddedSmartApplyUrl: embeddedSmartApplyUrl(j, 0),
            })),
          };
        } catch {
          return { rows: [], mobtk: "" };
        }
      },
    });
    if (result && Array.isArray(result.rows)) return result;
    return { rows: [], mobtk: "" };
  } catch {
    return { rows: [], mobtk: "" };
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpd);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("apply tab load timeout"));
    }, timeoutMs);

    function onUpd(id, info) {
      if (id === tabId && info.status === "complete") {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete" && !settled) {
        settled = true;
        cleanup();
        resolve();
      }
    }).catch(() => {});
  });
}

async function readBffRootFromApplyTab(applyTabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: applyTabId },
      world: "MAIN",
      func: () => {
        const b = window.bffContext;
        if (!b || typeof b !== "object") return null;
        try {
          return JSON.parse(JSON.stringify(b));
        } catch {
          return null;
        }
      },
    });
    return result || null;
  } catch {
    return null;
  }
}

async function generateResume(job, profile) {
  const body = {
    title: job.title || "",
    url: job.url || "",
    company_name: job.company_name || "",
    description_text: job.description_text || "",
    salary_range: job.salary_range || "",
    questions: job.questions || [],
    profile_name: profile.name || "default",
    profile_text: profile.text || "",
    model: profile.model || "gpt-5.4-mini",
  };
  let res;
  try {
    res = await fetch(`${API_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e?.message || String(e);
    console.error("[Indeed ext] POST /api/generate failed (network/CORS)", msg, job?.url);
    await appendApiErrorLog({
      path: "/api/generate",
      method: "POST",
      status: 0,
      detail: msg,
      context: `${job?.title || ""} · ${job?.url || ""}`.trim(),
    });
    throw new Error(
      `API unreachable or blocked by CORS (${API_URL}/api/generate): ${msg}. ` +
        `Redeploy the FastAPI app so responses include Access-Control-Allow-Origin (see app/main.py).`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let detail = text?.slice(0, 1200) || res.statusText;
    try {
      const j = JSON.parse(text);
      if (j?.detail != null) {
        detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      }
    } catch {
      /* plain text body */
    }
    console.error("[Indeed ext] generate HTTP error", res.status, detail?.slice(0, 500), job?.url);
    await appendApiErrorLog({
      path: "/api/generate",
      method: "POST",
      status: res.status,
      detail,
      context: `${job?.title || ""} · profile: ${profile?.name || "default"}`.trim(),
    });
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json();
}

/**
 * For one JD URL, check which saved profiles already have a generation row (url + profile_name).
 * Returns parallel array to profilesList, each { exists }; on failure returns null (caller treats as none known).
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
        if (j?.detail != null) {
          detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
        }
      } catch {
        /* plain text */
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

async function runLoop() {
  startKeepAlive();

  const profiles = await getProfiles();
  if (!profiles.length) {
    state.lastError = "No profiles configured — open Settings";
    state.running = false;
    await saveState();
    broadcastState();
    stopKeepAlive();
    return;
  }

  while (state.running && !state.paused) {
    try {
      if (!(await ensureContentScript(searchTabId, "content.js"))) {
        state.lastError =
          "Indeed search tab was closed or is not scriptable — reopen the SERP tab, then Resume.";
        state.paused = true;
        await saveState();
        broadcastState();
        break;
      }

      /* ── Phase 1: collect detail URLs from SERP (mosaic + pagination) ── */
      if (state.phase !== "scrape_details") {
        state.phase = "collect_urls";
        await saveState();
        broadcastState();

        while (state.running && !state.paused) {
          if (!(await ensureContentScript(searchTabId, "content.js"))) {
            state.lastError =
              "Search tab lost during URL collection — reopen the Indeed results page, then Resume.";
            state.paused = true;
            await saveState();
            broadcastState();
            break;
          }
          const { urls: pageUrls } = await extractMosaicDetailUrls(searchTabId);
          const merged = await appendPendingDetailUrlsUnique(pageUrls);
          state.totalJobsOnPage = merged.length;
          state.lastError = `Collecting URLs: +${pageUrls.length} on page ${state.currentPage} (${merged.length} total)`;
          await saveState();
          broadcastState();

          const { has } = await sendToTabRetry(searchTabId, "hasNextPage");
          if (!has) {
            state.phase = "scrape_details";
            state.scrapeIndex = 0;
            state.currentJobIndex = 0;
            await saveState();
            broadcastState();
            break;
          }

          let prevSerpUrl = "";
          try {
            prevSerpUrl = tabEffectiveUrl(await chrome.tabs.get(searchTabId));
          } catch {
            prevSerpUrl = "";
          }

          const nextRes = await sendToTabRetry(searchTabId, "goSerpNextPage");
          await sleep(120);
          if (!nextRes?.ok) {
            state.phase = "scrape_details";
            state.scrapeIndex = 0;
            state.lastError = `Pagination failed (${nextRes?.reason || "unknown"}) — scraping collected URLs only`;
            await saveState();
            broadcastState();
            break;
          }

          const urlWait = DELAYS.SERP_PAGINATION_URL_WAIT_MS ?? 28000;
          const urlChanged = await waitForSerpUrlChangedFrom(searchTabId, prevSerpUrl, urlWait);
          if (!urlChanged) {
            console.warn(
              "[Indeed ext] SERP URL did not change after next-page action; waiting extra for in-place mosaic updates",
            );
          }

          if (!(await ensureContentScript(searchTabId, "content.js"))) {
            state.lastError =
              "Search tab lost after pagination — reopen the Indeed results page, then Resume.";
            state.paused = true;
            await saveState();
            broadcastState();
            break;
          }
          await sleep(urlChanged ? DELAYS.AFTER_PAGE_LOAD : Math.max(DELAYS.AFTER_PAGE_LOAD, 5500));

          state.currentPage++;
          await saveState();
          broadcastState();
        }

        if (!state.running || state.paused) break;
      }

      /* ── Phase 2: open each detail tab, wait for bot check, apply → BFF → API ── */
      if (state.phase === "scrape_details") {
        let pendingUrls = await loadPendingDetailUrls();
        if (!pendingUrls.length) {
          state.lastError = "No job URLs collected — done";
          state.running = false;
          state.phase = "";
          await clearPendingDetailUrls();
          await saveState();
          broadcastState();
          stopKeepAlive();
          return;
        }

        state.totalJobsOnPage = pendingUrls.length;

        while (state.running && !state.paused && state.scrapeIndex < pendingUrls.length) {
          const url = pendingUrls[state.scrapeIndex];
          const jk = jkFromDetailUrl(url);
          const indeedUrl = jk
            ? `https://www.indeed.com/viewjob?jk=${encodeURIComponent(jk)}`
            : String(url).split("#")[0];

          state.currentJobIndex = state.scrapeIndex + 1;
          state.lastError = `Job ${state.scrapeIndex + 1}/${pendingUrls.length}`;
          await saveState();
          broadcastState();

          let detailTabId = null;
          try {
            let t = null;
            try {
              t = await chrome.tabs.create({
                url,
                active: false,
                openerTabId: searchTabId,
              });
            } catch {
              t = await chrome.tabs.create({ url, active: false });
            }
            detailTabId = t?.id ?? null;
          } catch {
            state.scrapeIndex++;
            state.skipped++;
            const shortUrl = String(url || "").slice(0, 120);
            appendSkipLog(`could not open detail tab | jk=${jk || "?"} | ${shortUrl}`);
            state.lastError = `Skipped: could not open detail tab (${jk || shortUrl})`;
            await saveState();
            broadcastState();
            await sleep(DELAYS.BETWEEN_JOBS);
            continue;
          }

          try {
            try {
              await waitForTabComplete(detailTabId, 45000);
            } catch {
              /* */
            }
            await sleep(DELAYS.DETAIL_TAB_SETTLE ?? 2500);

            if (!(await ensureContentScript(detailTabId, "content.js"))) {
              state.scrapeIndex++;
              state.skipped++;
              appendSkipLog(`detail tab closed or blocked before script | jk=${jk || "?"}`);
              state.lastError = `Skipped: detail tab gone (${jk || "no-jk"})`;
              await saveState();
              broadcastState();
              continue;
            }
            await waitForBotClearOnTab(detailTabId);

            let essentials = {};
            try {
              const e = await sendToTabRetry(detailTabId, "getEssentialApplyPane");
              essentials = e?.essentials || {};
            } catch {
              essentials = {};
            }

            let row = { jk, title: "", salary: "", thirdPartyApplyUrl: "", embeddedSmartApplyUrl: "" };
            try {
              const { rows } = await readMosaicRows(searchTabId);
              const hit = mosaicRowForJk(rows, jk);
              if (hit) row = hit;
            } catch {
              /* */
            }

            const job = jobBaseFromEssentialsAndRow(essentials, row);
            if (!job.title && !job.description_text) {
              state.scrapeIndex++;
              state.skipped++;
              appendSkipLog(
                `no title or description on detail page | jk=${jk || "?"} | tabUrl=${String(url).slice(0, 100)}`,
              );
              state.lastError = `Skipped: no title/description (${jk || "no-jk"})`;
              await saveState();
              broadcastState();
              continue;
            }

            const presence = await checkGenerationKeys(indeedUrl, profiles);
            const presenceList = presence || [];
            const allProfilesDone =
              profiles.length > 0 &&
              profiles.every((p, i) => {
                const row = presenceList[i];
                return row && row.exists === true;
              });
            if (allProfilesDone) {
              state.scrapeIndex++;
              state.skipped++;
              appendSkipLog(
                `all profiles already in DB for this job | title=${(job.title || "").slice(0, 80)} | ${indeedUrl}`,
              );
              state.lastError = `Skipped (all profiles exist): ${job.title}`;
              await saveState();
              broadcastState();
              continue;
            }

            state.lastError = `Fetching questions: ${job.title}`;
            await saveState();
            broadcastState();

            const { questions } = await fetchQuestionsViaApplyClick(detailTabId, searchTabId);
            job.questions = questions || [];
            job.url = indeedUrl;

            let generatedForJob = 0;
            for (let pi = 0; pi < profiles.length; pi++) {
              if (!state.running || state.paused) break;
              const profile = profiles[pi];
              const row = presenceList[pi];
              const already = row && row.exists === true;
              if (already) {
                state.skipped++;
                appendSkipLog(
                  `already in DB | profile=${(profile.name || "").trim() || "default"} | ${indeedUrl}`,
                );
                state.lastError = `Skipped profile: ${profile.name || "default"} — ${job.title}`;
                await saveState();
                broadcastState();
                continue;
              }

              state.lastError = `Generating: ${job.title} — ${profile.name || `profile ${pi + 1}`}`;
              await saveState();
              broadcastState();
              await generateResume(job, profile);
              state.processed++;
              generatedForJob++;
              state.lastError = `Generated: ${job.title} — ${profile.name || `profile ${pi + 1}`}`;
              await saveState();
              broadcastState();
            }

            state.scrapeIndex++;
            state.lastError =
              generatedForJob > 0
                ? `Done: ${job.title} (${generatedForJob} profile(s) generated)`
                : `Done: ${job.title} (no new profiles)`;
            await saveState();
            broadcastState();
          } catch (innerErr) {
            state.failed++;
            state.scrapeIndex++;
            state.lastError = innerErr?.message || String(innerErr);
            console.error(
              "[Indeed ext] scrape job failed",
              innerErr?.message || String(innerErr),
              `jk=${jk} detail=${String(url).slice(0, 100)}`,
            );
            await saveState();
            broadcastState();
          } finally {
            if (typeof detailTabId === "number") {
              try {
                await closeApplyTabSafe(detailTabId);
              } catch {
                /* */
              }
            }
            await focusSearchTab(searchTabId);
            await sleep(DELAYS.BETWEEN_JOBS);
          }

          pendingUrls = await loadPendingDetailUrls();
        }

        if (state.scrapeIndex >= (await loadPendingDetailUrls()).length && state.running && !state.paused) {
          state.lastError = "All jobs processed — done!";
          state.running = false;
          state.phase = "";
          await clearPendingDetailUrls();
          await saveState();
          broadcastState();
          stopKeepAlive();
          return;
        }
      }
    } catch (err) {
      state.failed++;
      state.lastError = err.message;
      state.paused = true;
      await saveState();
      broadcastState();
    }
  }

  stopKeepAlive();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "stateUpdate") return;
  if (msg.action === "ping") {
    sendResponse({ pong: true });
    return;
  }

  switch (msg.action) {
    case "start": {
      (async () => {
        await loadState();
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url?.includes("indeed.com")) {
          sendResponse({ ok: false, error: "Not an Indeed page" });
          return;
        }
        searchTabId = tab.id;
        if (msg.reset) {
          Object.assign(state, DEFAULT_STATE);
          await clearPendingDetailUrls();
        }
        state.running = true;
        state.paused = false;
        state.activeProfileIndex = msg.profileIndex ?? state.activeProfileIndex;
        state.lastError = "";
        await saveState();
        broadcastState();
        sendResponse({ ok: true });
        runLoop();
      })();
      return true;
    }

    case "resume": {
      (async () => {
        await loadState();
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url?.includes("indeed.com")) {
          sendResponse({ ok: false, error: "Not an Indeed page" });
          return;
        }
        searchTabId = tab.id;
        state.running = true;
        state.paused = false;
        state.lastError = "Resumed";
        await saveState();
        broadcastState();
        sendResponse({ ok: true });
        runLoop();
      })();
      return true;
    }

    case "pause":
      state.paused = true;
      state.lastError = "Paused by user";
      saveState().then(() => broadcastState());
      sendResponse({ ok: true });
      break;

    case "stop":
      state.running = false;
      state.paused = false;
      state.lastError = "Stopped";
      stopKeepAlive();
      saveState().then(() => broadcastState());
      sendResponse({ ok: true });
      break;

    case "getState":
      loadState().then(() => sendResponse(state));
      return true;

    case "resetState":
      Object.assign(state, DEFAULT_STATE);
      clearPendingDetailUrls().then(() =>
        saveState().then(() => {
          broadcastState();
          sendResponse({ ok: true });
        }),
      );
      return true;
  }
});
