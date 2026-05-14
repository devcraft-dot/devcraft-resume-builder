chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function openSidePanelFor(sender) {
  let windowId = sender?.tab?.windowId;
  if (windowId == null) {
    const w = await chrome.windows.getCurrent();
    windowId = w.id;
  }
  await chrome.sidePanel.open({ windowId });
}

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "openSidePanel") {
    openSidePanelFor(sender)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (message.action === "stashSelectionAndOpenPanel") {
    (async () => {
      try {
        await chrome.storage.local.set({
          manualJd_pendingJd: String(message.text || ""),
        });
        await openSidePanelFor(sender);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }
  if (message.action === "autofillJobTabAndOpenPanel") {
    (async () => {
      try {
        const { result, board } = await scrapeJobBoardFromTab();
        await chrome.storage.local.set({
          manualJd_autofillPayload: JSON.stringify({ result, board }),
        });
        await openSidePanelFor(sender);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }
  return undefined;
});
