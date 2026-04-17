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
};

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

async function ensureContentScript(tabId, file) {
  try {
    await sendToTab(tabId, "ping");
    return;
  } catch {
    /* inject */
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  await sleep(400);
}

function mosaicRowForJk(rows, jk) {
  if (!jk || !rows?.length) return null;
  const low = jk.toLowerCase();
  return rows.find((r) => String(r.jk || "").toLowerCase() === low) || null;
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
 * After list click + job pane visible: click "Apply with Indeed" so the browser opens a real apply tab.
 * Returns screener questions from `window.bffContext` only (JD/title come from the SERP pane, not BFF).
 */
async function fetchQuestionsViaIndeedApplyClick(searchTabId) {
  let winId;
  try {
    winId = (await chrome.tabs.get(searchTabId)).windowId;
  } catch {
    return { questions: [], note: "search-tab-missing" };
  }

  const idsBefore = new Set((await chrome.tabs.query({ windowId: winId })).map((t) => t.id));
  let outcome = { questions: [], note: "click-failed" };

  try {
    let r;
    try {
      r = await sendToTabRetry(searchTabId, "clickIndeedApplyButton");
    } catch {
      outcome = { questions: [], note: "click-failed" };
      return outcome;
    }
    if (!r?.ok) {
      outcome = { questions: [], note: r?.reason || "no-indeed-apply-button" };
      return outcome;
    }

    const newTab = await waitForNewTabNotInSet(winId, idsBefore, DELAYS.APPLY_CLICK_NEW_TAB_WAIT);
    if (newTab?.id == null) {
      outcome = { questions: [], note: "no-new-tab" };
      return outcome;
    }

    try {
      await waitForTabComplete(newTab.id, 38000);
    } catch {
      /* still try BFF */
    }
    await sleep(DELAYS.APPLY_TAB_SETTLE);

    let url = "";
    try {
      url = (await chrome.tabs.get(newTab.id)).url || "";
    } catch {
      outcome = { questions: [], note: "apply-tab-missing" };
      return outcome;
    }

    if (!isIndeedBffTabUrl(url)) {
      outcome = { questions: [], note: "non-indeed-apply-tab" };
      return outcome;
    }

    const questions = await pollQuestionsFromBffTab(newTab.id);
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
      await closeSpawnedTabsExceptSearch(winId, idsBefore, searchTabId);
      await focusSearchTab(searchTabId);
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
  const res = await fetch(`${API_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

async function checkUrl(url) {
  try {
    const res = await fetch(`${API_URL}/api/check-urls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: [url] }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data[url] === true;
  } catch {
    return false;
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

  const profile = profiles[state.activeProfileIndex] || profiles[0];

  while (state.running && !state.paused) {
    try {
      await ensureContentScript(searchTabId, "content.js");

      const { count } = await sendToTabRetry(searchTabId, "getJobCount");
      state.totalJobsOnPage = count;

      if (state.currentJobIndex >= count) {
        const { has } = await sendToTabRetry(searchTabId, "hasNextPage");
        if (!has) {
          state.lastError = "Reached last page — done!";
          state.running = false;
          await saveState();
          broadcastState();
          stopKeepAlive();
          return;
        }
        await sendToTabRetry(searchTabId, "clickNextPage");
        state.currentPage++;
        state.currentJobIndex = 0;
        state.totalJobsOnPage = 0;
        await saveState();
        broadcastState();
        await sleep(DELAYS.AFTER_PAGE_LOAD);
        continue;
      }

      broadcastState();

      const { jk } = await sendToTabRetry(searchTabId, "getJk", { index: state.currentJobIndex });
      if (!jk) {
        state.currentJobIndex++;
        state.skipped++;
        state.lastError = "Skipped: could not read job id from list";
        await saveState();
        broadcastState();
        await sleep(DELAYS.BETWEEN_JOBS);
        continue;
      }

      await sendToTabRetry(searchTabId, "clickJob", { index: state.currentJobIndex });
      await sleep(DELAYS.AFTER_CLICK_JOB);

      let essentials = {};
      try {
        const e = await sendToTabRetry(searchTabId, "getEssentialApplyPane");
        essentials = e?.essentials || {};
      } catch {
        essentials = {};
      }
      const { rows } = await readMosaicRows(searchTabId);
      const row = mosaicRowForJk(rows, jk) || {
        jk,
        title: "",
        salary: "",
        thirdPartyApplyUrl: "",
        embeddedSmartApplyUrl: "",
      };

      const job = jobBaseFromEssentialsAndRow(essentials, row);
      if (!job.title && !job.description_text) {
        state.currentJobIndex++;
        state.skipped++;
        state.lastError = `Skipped: no job title or description in pane (${jk})`;
        await saveState();
        broadcastState();
        await sleep(DELAYS.BETWEEN_JOBS);
        continue;
      }

      state.lastError = `Fetching questions: ${row.title || jk}`;
      broadcastState();

      const { questions } = await fetchQuestionsViaIndeedApplyClick(searchTabId);
      job.questions = questions || [];

      const indeedUrl = `https://www.indeed.com/viewjob?jk=${encodeURIComponent(jk)}`;
      job.url = indeedUrl;

      const exists = await checkUrl(indeedUrl);
      if (exists) {
        state.currentJobIndex++;
        state.skipped++;
        state.lastError = `Skipped (exists): ${job.title}`;
        await saveState();
        broadcastState();
        await sleep(DELAYS.BETWEEN_JOBS);
        continue;
      }

      state.lastError = `Generating: ${job.title}`;
      broadcastState();
      await generateResume(job, profile);

      state.processed++;
      state.currentJobIndex++;
      state.lastError = `Done: ${job.title}`;
      await saveState();
      broadcastState();
      await sleep(DELAYS.BETWEEN_JOBS);
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
        if (msg.reset) Object.assign(state, DEFAULT_STATE);
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
      saveState().then(() => {
        broadcastState();
        sendResponse({ ok: true });
      });
      return true;
  }
});
