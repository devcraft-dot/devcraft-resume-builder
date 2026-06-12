importScripts("config.js", "authApi.js", "jobBoardUtils.js", "manualExtensionCore.js", "queueAutomation.js");

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "manualJdQueueState") return;

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

  if (message.action === "queueStart") {
    ManualJDQueue.startQueue(!!message.reset)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }

  if (message.action === "queuePause") {
    ManualJDQueue.pauseQueue()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }

  if (message.action === "queueStop") {
    ManualJDQueue.stopQueue()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }

  if (message.action === "queueReset") {
    ManualJDQueue.resetQueueState()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }

  if (message.action === "queueGetState") {
    ManualJDQueue.getState()
      .then((s) => sendResponse({ ok: true, state: s }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }

  return undefined;
});
