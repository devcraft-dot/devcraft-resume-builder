/**
 * Background queue runner: load manualJD-support.json URLs, scrape, generate per profile.
 */
(function () {
  const QUEUE_STORAGE_KEY = "manualJd_urlQueue";
  const QUEUE_STATE_KEY = "manualJd_queueState";
  const TAB_LOAD_TIMEOUT_MS = 45000;
  const BETWEEN_JOBS_MS = 2500;

  const DEFAULT_STATE = {
    running: false,
    paused: false,
    queueIndex: 0,
    total: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
    lastError: "",
    currentUrl: "",
    currentTitle: "",
  };

  let state = { ...DEFAULT_STATE };
  let runTabId = null;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function loadQueueState() {
    const r = await chrome.storage.local.get(QUEUE_STATE_KEY);
    if (r[QUEUE_STATE_KEY] && typeof r[QUEUE_STATE_KEY] === "object") {
      state = { ...DEFAULT_STATE, ...r[QUEUE_STATE_KEY] };
    }
  }

  async function saveQueueState() {
    await chrome.storage.local.set({ [QUEUE_STATE_KEY]: state });
    chrome.runtime.sendMessage({ type: "manualJdQueueState", state: { ...state } }).catch(() => {});
  }

  async function getProfiles() {
    const r = await chrome.storage.local.get("serverProfiles");
    const arr = r.serverProfiles;
    return Array.isArray(arr) ? arr.filter((p) => p && p.id) : [];
  }

  async function ensureToken() {
    const token = await ResumeAuth.getAccessToken();
    if (!token) throw new Error("Sign in under Account before starting the queue.");
  }

  function waitForTabComplete(tabId, timeoutMs = TAB_LOAD_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error("Tab load timed out"));
      }, timeoutMs);

      function onUpdated(id, info) {
        if (id !== tabId) return;
        if (info.status === "complete") {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.get(tabId).then((tab) => {
        if (tab.status === "complete") {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      }).catch(reject);
    });
  }

  async function scrapeUrlInTab(tabId, url) {
    const board = JobBoardUtils.detectJobBoardFromUrl(url);
    if (!board) throw new Error(`Unsupported URL for autofill: ${url}`);

    const file = JobBoardUtils.scrapeScriptFile(board);
    const globalName = JobBoardUtils.scrapeGlobalName(board);
    const ashby = board === "ashby";

    await chrome.scripting.executeScript({
      target: { tabId },
      files: [file],
      ...(ashby ? { world: "MAIN" } : {}),
    });

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      ...(ashby ? { world: "MAIN" } : {}),
      func: (name) => globalThis[name],
      args: [globalName],
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Scrape failed");
    }
    return { payload: result, board };
  }

  async function generateForProfiles(payload, profiles) {
    let generated = 0;
    let skipped = 0;
    const job = {
      title: payload.title || "Role",
      company: payload.company || "",
      salary: payload.salary_range || "",
      jd: payload.description_text || "",
      referenceUrl: payload.posting_url || "",
      questions: Array.isArray(payload.questions) ? payload.questions : [],
    };

    for (const profile of profiles) {
      const label = (profile.name || "").trim() || "default";
      const url = await ManualJD.canonicalJobUrl(label, job);
      const presence = await ManualJD.checkGenerationKeys(url, [profile]);
      if (presence?.[0]?.exists) {
        skipped++;
        continue;
      }
      await ManualJD.postGenerateManual(profile, job);
      generated++;
    }
    return { generated, skipped };
  }

  async function closeRunTab() {
    if (runTabId != null) {
      try {
        await chrome.tabs.remove(runTabId);
      } catch {
        /* tab may already be closed */
      }
      runTabId = null;
    }
  }

  async function processQueueItem(item, profiles) {
    const url = String(item.url || "").trim();
    if (!url) throw new Error("Empty URL in queue item");

    state.currentUrl = url;
    state.currentTitle = item.role || item.title || "";
    await saveQueueState();

    const tab = await chrome.tabs.create({ url, active: false });
    runTabId = tab.id;
    await waitForTabComplete(tab.id);
    await sleep(800);

    const { payload } = await scrapeUrlInTab(tab.id, url);
    if (!payload.title && item.role) payload.title = item.role;
    if (!payload.company && item.company) payload.company = item.company;
    if (!payload.posting_url) payload.posting_url = url;

    const { generated, skipped } = await generateForProfiles(payload, profiles);
    state.generated += generated;
    state.skipped += skipped;
    await closeRunTab();
  }

  async function runQueueLoop() {
    await loadQueueState();
    try {
      await ensureToken();
    } catch (e) {
      state.running = false;
      state.lastError = e.message || String(e);
      await saveQueueState();
      return;
    }

    const profiles = await getProfiles();
    if (!profiles.length) {
      state.running = false;
      state.lastError = "No profiles — sign in and sync under Account.";
      await saveQueueState();
      return;
    }

    const stored = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
    const queueDoc = stored[QUEUE_STORAGE_KEY];
    const items = Array.isArray(queueDoc?.items)
      ? queueDoc.items
      : Array.isArray(queueDoc?.urls)
        ? queueDoc.urls
        : [];

    if (!items.length) {
      state.running = false;
      state.lastError = "Queue is empty — load manualJD-support.json first.";
      await saveQueueState();
      return;
    }

    state.total = items.length;
    if (state.queueIndex >= items.length) {
      state.running = false;
      state.lastError = "Queue complete.";
      await saveQueueState();
      return;
    }

    while (state.running && !state.paused && state.queueIndex < items.length) {
      const item = items[state.queueIndex];
      try {
        state.lastError = `Processing ${state.queueIndex + 1}/${items.length}…`;
        await saveQueueState();
        await processQueueItem(item, profiles);
        state.queueIndex++;
        state.lastError = "";
        await saveQueueState();
        if (state.running && !state.paused && state.queueIndex < items.length) {
          await sleep(BETWEEN_JOBS_MS);
        }
      } catch (e) {
        state.failed++;
        state.lastError = e?.message || String(e);
        state.paused = true;
        await closeRunTab();
        await saveQueueState();
        break;
      }
    }

    if (state.queueIndex >= items.length && state.running) {
      state.running = false;
      state.lastError = `Done. Generated profiles: ${state.generated}, skipped duplicates: ${state.skipped}, failures: ${state.failed}.`;
    }
    await saveQueueState();
  }

  async function startQueue(reset) {
    await loadQueueState();
    if (reset) {
      Object.assign(state, DEFAULT_STATE);
    }
    state.running = true;
    state.paused = false;
    if (reset) {
      state.queueIndex = 0;
      state.generated = 0;
      state.skipped = 0;
      state.failed = 0;
    }
    state.lastError = "Starting queue…";
    await saveQueueState();
    runQueueLoop();
  }

  async function pauseQueue() {
    state.paused = true;
    state.lastError = "Paused by user";
    await saveQueueState();
  }

  async function stopQueue() {
    state.running = false;
    state.paused = false;
    state.lastError = "Stopped";
    await closeRunTab();
    await saveQueueState();
  }

  async function resetQueueState() {
    Object.assign(state, DEFAULT_STATE);
    await closeRunTab();
    await saveQueueState();
  }

  globalThis.ManualJDQueue = {
    QUEUE_STORAGE_KEY,
    QUEUE_STATE_KEY,
    getState: async () => {
      await loadQueueState();
      return { ...state };
    },
    startQueue,
    pauseQueue,
    stopQueue,
    resetQueueState,
  };
})();
