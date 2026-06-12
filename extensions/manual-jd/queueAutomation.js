/**
 * Background queue runner: load manualJD-support.json URLs, scrape, generate per profile.
 */
(function () {
  const QUEUE_STORAGE_KEY = "manualJd_urlQueue";
  const QUEUE_STATE_KEY = "manualJd_queueState";
  const TAB_LOAD_TIMEOUT_MS = 45000;
  const BETWEEN_JOBS_MS = 2500;
  const DETAIL_TAB_SETTLE_MS = 2800;
  const GENERATE_BETWEEN_PROFILES_MS = 3500;
  const PAUSE_AFTER_CONSECUTIVE_API_FAILURES = 6;
  const SCRAPE_RETRY_ATTEMPTS = 6;
  const SCRAPE_RETRY_DELAY_MS = 2000;
  const PROGRESS_LOG_MAX = 120;

  const DEFAULT_STATE = {
    running: false,
    paused: false,
    queueIndex: 0,
    total: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
    phase: "idle",
    statusMessage: "",
    lastError: "",
    currentUrl: "",
    currentTitle: "",
    currentCompany: "",
    currentBoard: "",
    currentJobNum: 0,
    profileIndex: 0,
    profileTotal: 0,
    profileName: "",
    startedAt: "",
    progressLog: [],
  };

  let state = { ...DEFAULT_STATE };
  let runTabId = null;
  let keepAliveInterval = null;
  let loopPromise = null;
  let consecutiveApiFailures = 0;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function logTime() {
    return new Date().toISOString().slice(11, 19);
  }

  function appendLog(message, level = "info") {
    if (!Array.isArray(state.progressLog)) state.progressLog = [];
    state.progressLog.unshift({
      t: logTime(),
      m: String(message || ""),
      level: level || "info",
    });
    if (state.progressLog.length > PROGRESS_LOG_MAX) {
      state.progressLog.length = PROGRESS_LOG_MAX;
    }
  }

  async function setProgress(patch, logLine, logLevel) {
    Object.assign(state, patch);
    if (logLine) appendLog(logLine, logLevel);
    state.statusMessage = patch.statusMessage ?? state.statusMessage ?? "";
    await saveQueueState();
  }

  function startKeepAlive() {
    if (keepAliveInterval) return;
    keepAliveInterval = setInterval(() => {
      if (state.running) chrome.storage.local.get(QUEUE_STATE_KEY, () => {});
    }, 20000);
  }

  function stopKeepAlive() {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
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

  async function getQueueItems() {
    const stored = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
    const queueDoc = stored[QUEUE_STORAGE_KEY];
    if (Array.isArray(queueDoc?.items)) return queueDoc.items;
    if (Array.isArray(queueDoc?.urls)) return queueDoc.urls;
    return [];
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

  async function readScrapeResult(tabId, globalName, ashby) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      ...(ashby ? { world: "MAIN" } : {}),
      func: (name) => globalThis[name],
      args: [globalName],
    });
    return results?.[0]?.result ?? null;
  }

  async function scrapeUrlInTab(tabId, url, jobLabel) {
    const board = JobBoardUtils.detectJobBoardFromUrl(url);
    if (!board) throw new Error(`Unsupported URL for autofill: ${url}`);

    const file = JobBoardUtils.scrapeScriptFile(board);
    const globalName = JobBoardUtils.scrapeGlobalName(board);
    const ashby = board === "ashby";
    const boardName = JobBoardUtils.boardLabel(board);
    let lastError = "Scrape failed";

    await setProgress(
      {
        phase: "scraping",
        currentBoard: board,
        statusMessage: `Scraping ${boardName} page…`,
      },
      `Scrape started (${boardName}): ${jobLabel}`,
    );

    for (let attempt = 1; attempt <= SCRAPE_RETRY_ATTEMPTS; attempt++) {
      await setProgress({
        phase: "scraping",
        statusMessage: `Scraping ${boardName}… attempt ${attempt}/${SCRAPE_RETRY_ATTEMPTS}`,
      });

      await chrome.scripting.executeScript({
        target: { tabId },
        files: [file],
        ...(ashby ? { world: "MAIN" } : {}),
      });

      if (attempt === 1) await sleep(DETAIL_TAB_SETTLE_MS);
      else await sleep(SCRAPE_RETRY_DELAY_MS);

      const result = await readScrapeResult(tabId, globalName, ashby);
      if (!result) {
        lastError = "Scrape script returned no data";
        appendLog(`Scrape attempt ${attempt}: no data`, "warn");
        await saveQueueState();
        continue;
      }
      if (!result.ok) {
        lastError = result.error || "Scrape failed";
        appendLog(`Scrape attempt ${attempt}: ${lastError}`, "warn");
        await saveQueueState();
        continue;
      }
      const desc = String(result.description_text || "").trim();
      if (desc.length >= 40) {
        const title = result.title || jobLabel;
        await setProgress(
          {
            phase: "scraping",
            currentTitle: title,
            currentCompany: result.company || state.currentCompany || "",
            statusMessage: `Scraped ${title} (${desc.length.toLocaleString()} chars JD)`,
          },
          `Scraped OK: ${title} · ${desc.length.toLocaleString()} chars · ${(result.questions || []).length} question(s)`,
          "ok",
        );
        return { payload: result, board };
      }
      lastError = desc
        ? "Job description still loading — retrying…"
        : "Empty job description after scrape";
      appendLog(`Scrape attempt ${attempt}: ${lastError}`, "warn");
      await saveQueueState();
    }

    throw new Error(lastError);
  }

  function buildJobFromPayload(payload, item, url) {
    return {
      title: payload.title || item.role || item.title || "Role",
      company: payload.company || item.company || "",
      salary: payload.salary_range || "",
      jd: String(payload.description_text || "").trim(),
      referenceUrl: payload.posting_url || url,
      questions: Array.isArray(payload.questions) ? payload.questions : [],
    };
  }

  async function probeApiHealth() {
    try {
      await ResumeAuth.fetchHealth(ManualJD.API_URL, 12000);
      return true;
    } catch {
      return false;
    }
  }

  async function generateForProfiles(job, profiles, jdUrl) {
    if (!String(job.jd || "").trim()) {
      throw new Error("No job description text — cannot generate resume");
    }

    const presence = await ManualJD.checkGenerationKeys(jdUrl, profiles);
    const presenceList = presence || [];

    await setProgress(
      {
        phase: "generating",
        profileTotal: profiles.length,
        profileIndex: 0,
        profileName: "",
        statusMessage: `Checking duplicates for ${profiles.length} profile(s)…`,
      },
      `Generate phase: ${profiles.length} profile(s) for ${job.title}`,
    );

    for (let pi = 0; pi < profiles.length; pi++) {
      if (!state.running || state.paused) break;

      const profile = profiles[pi];
      const label = (profile.name || "").trim() || "default";
      const row = presenceList[pi];

      await setProgress({
        phase: "generating",
        profileIndex: pi + 1,
        profileTotal: profiles.length,
        profileName: label,
      });

      if (row?.exists) {
        state.skipped++;
        await setProgress(
          {
            statusMessage: `Skipped duplicate: ${label} (${pi + 1}/${profiles.length})`,
          },
          `Skipped (exists): ${label} — ${job.title}`,
          "skip",
        );
        continue;
      }

      await setProgress(
        {
          statusMessage: `Generating resume: ${label} (${pi + 1}/${profiles.length})…`,
        },
        `Generating: ${job.title} — ${label} (${pi + 1}/${profiles.length})`,
      );

      try {
        await ManualJD.postGenerateManual(profile, job);
        consecutiveApiFailures = 0;
        state.generated++;
        await setProgress(
          {
            statusMessage: `Generated: ${label} (${pi + 1}/${profiles.length})`,
          },
          `Generated OK: ${label} — ${job.title}`,
          "ok",
        );
      } catch (e) {
        state.failed++;
        consecutiveApiFailures++;
        const msg = e?.message || String(e);
        await setProgress(
          {
            statusMessage: `Generate failed: ${label} — ${msg}`,
          },
          `Generate failed (${label}): ${msg}`,
          "err",
        );

        if (consecutiveApiFailures >= PAUSE_AFTER_CONSECUTIVE_API_FAILURES) {
          const healthy = await probeApiHealth();
          state.paused = true;
          const hint = healthy
            ? "Health check OK — server may be rate-limiting generate. Wait 2-3 min, then Resume."
            : "Health check failed — Vercel/API may be down or cold-starting. Wait ~1 min, then Resume.";
          await setProgress(
            {
              phase: "idle",
              statusMessage: `Paused after ${consecutiveApiFailures} API failures. ${hint}`,
            },
            `Queue paused: ${consecutiveApiFailures} consecutive API failures. ${hint}`,
            "err",
          );
          break;
        }
      }

      if (pi < profiles.length - 1 && state.running && !state.paused) {
        await sleep(GENERATE_BETWEEN_PROFILES_MS);
      }
    }
    return state.paused;
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

  async function processQueueItem(item, profiles, jobNum, totalJobs) {
    const url = String(item.url || "").trim();
    if (!url) throw new Error("Empty URL in queue item");

    const titleHint = item.role || item.title || url;
    state.currentUrl = url;
    state.currentTitle = item.role || item.title || "";
    state.currentCompany = item.company || "";
    state.currentJobNum = jobNum;
    state.currentBoard = item.board || JobBoardUtils.detectJobBoardFromUrl(url) || "";

    await setProgress(
      {
        phase: "opening",
        profileIndex: 0,
        profileTotal: profiles.length,
        profileName: "",
        statusMessage: `Job ${jobNum}/${totalJobs}: opening tab…`,
      },
      `Job ${jobNum}/${totalJobs}: ${titleHint}`,
    );

    const tab = await chrome.tabs.create({ url, active: false });
    runTabId = tab.id;

    try {
      await setProgress(
        { phase: "loading", statusMessage: `Job ${jobNum}/${totalJobs}: waiting for page load…` },
        `Loading tab for job ${jobNum}/${totalJobs}`,
      );
      await waitForTabComplete(tab.id);

      const { payload } = await scrapeUrlInTab(tab.id, url, titleHint);
      if (!payload.title && item.role) payload.title = item.role;
      if (!payload.company && item.company) payload.company = item.company;
      if (!payload.posting_url) payload.posting_url = url;

      const job = buildJobFromPayload(payload, item, url);
      state.currentTitle = job.title;
      state.currentCompany = job.company;
      const jdUrl = job.referenceUrl || (await ManualJD.canonicalJobUrl("default", job));

      await generateForProfiles(job, profiles, jdUrl);
    } finally {
      await closeRunTab();
    }
    return state.paused;
  }

  async function runQueueLoop() {
    startKeepAlive();
    await loadQueueState();

    try {
      await ensureToken();
    } catch (e) {
      state.running = false;
      state.phase = "idle";
      state.lastError = e.message || String(e);
      state.statusMessage = state.lastError;
      appendLog(state.lastError, "err");
      await saveQueueState();
      stopKeepAlive();
      return;
    }

    const profiles = await getProfiles();
    if (!profiles.length) {
      state.running = false;
      state.phase = "idle";
      state.lastError = "No profiles — sign in and sync under Account.";
      state.statusMessage = state.lastError;
      appendLog(state.lastError, "err");
      await saveQueueState();
      stopKeepAlive();
      return;
    }

    if (!state.startedAt) {
      state.startedAt = new Date().toISOString();
      appendLog(`Queue started · ${profiles.length} profile(s) per job`, "info");
    }

    while (state.running && !state.paused) {
      const items = await getQueueItems();
      if (!items.length) {
        state.running = false;
        state.phase = "idle";
        state.lastError = "Queue is empty — load manualJD-support.json first.";
        state.statusMessage = state.lastError;
        appendLog(state.lastError, "err");
        await saveQueueState();
        stopKeepAlive();
        return;
      }

      state.total = items.length;
      if (state.queueIndex >= items.length) {
        state.running = false;
        state.phase = "done";
        state.lastError = `Done. Generated: ${state.generated}, skipped: ${state.skipped}, failed: ${state.failed}.`;
        state.statusMessage = state.lastError;
        appendLog(state.lastError, "ok");
        await saveQueueState();
        stopKeepAlive();
        return;
      }

      const item = items[state.queueIndex];
      const jobNum = state.queueIndex + 1;

      try {
        const pausedMidJob = await processQueueItem(item, profiles, jobNum, items.length);
        if (pausedMidJob || state.paused) {
          state.lastError = state.statusMessage || "Paused";
          await saveQueueState();
          stopKeepAlive();
          return;
        }
        state.queueIndex++;
        await setProgress(
          {
            phase: "between",
            profileIndex: 0,
            profileName: "",
            statusMessage: `Finished job ${jobNum}/${items.length}. Next in ${BETWEEN_JOBS_MS / 1000}s…`,
          },
          `Finished job ${jobNum}/${items.length} · generated ${state.generated} · skipped ${state.skipped} · failed ${state.failed}`,
          "ok",
        );
      } catch (e) {
        state.failed++;
        state.queueIndex++;
        const msg = e?.message || String(e);
        await setProgress(
          {
            phase: "between",
            statusMessage: `Skipped job ${jobNum}/${items.length}: ${msg}`,
          },
          `Skipped job ${jobNum}/${items.length}: ${msg}`,
          "err",
        );
        await closeRunTab();
      }

      if (state.running && !state.paused && state.queueIndex < items.length) {
        await setProgress({ phase: "between", statusMessage: "Waiting before next job…" });
        await sleep(BETWEEN_JOBS_MS);
      }
    }

    if (state.paused) {
      state.phase = "idle";
      state.statusMessage = state.statusMessage || "Paused by user";
      state.lastError = "Paused";
      appendLog("Queue paused", "warn");
    } else if (state.queueIndex >= (await getQueueItems()).length && state.running) {
      state.running = false;
      state.phase = "done";
      state.lastError = `Done. Generated: ${state.generated}, skipped: ${state.skipped}, failed: ${state.failed}.`;
      state.statusMessage = state.lastError;
      appendLog(state.lastError, "ok");
    }
    await saveQueueState();
    stopKeepAlive();
  }

  async function startQueue(reset) {
    await loadQueueState();

    if (reset) {
      state.running = false;
      state.paused = false;
      await closeRunTab();
      stopKeepAlive();
      loopPromise = null;
      consecutiveApiFailures = 0;
      Object.assign(state, DEFAULT_STATE);
      state.startedAt = new Date().toISOString();
      appendLog("Queue reset — starting fresh", "info");
    }

    state.running = true;
    state.paused = false;
    state.phase = "opening";
    state.statusMessage = reset ? "Starting queue…" : "Resuming queue…";
    if (!reset) consecutiveApiFailures = 0;
    if (!state.startedAt) state.startedAt = new Date().toISOString();
    appendLog(state.statusMessage, "info");
    await saveQueueState();

    if (loopPromise) return;

    loopPromise = runQueueLoop().finally(() => {
      loopPromise = null;
    });
  }

  async function pauseQueue() {
    state.paused = true;
    state.phase = "idle";
    state.statusMessage = "Paused by user";
    state.lastError = "Paused";
    appendLog("Paused by user", "warn");
    await saveQueueState();
  }

  async function stopQueue() {
    state.running = false;
    state.paused = false;
    state.phase = "idle";
    state.statusMessage = "Stopped";
    state.lastError = "Stopped";
    appendLog("Stopped by user", "warn");
    await closeRunTab();
    await saveQueueState();
    stopKeepAlive();
    if (loopPromise) {
      try {
        await loopPromise;
      } catch {
        /* */
      }
    }
  }

  async function resetQueueState() {
    Object.assign(state, DEFAULT_STATE);
    await closeRunTab();
    stopKeepAlive();
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
