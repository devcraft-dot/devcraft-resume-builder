/* global ManualJD */
(function () {
  const HOST_ID = "resume-builder-manual-jd-host";
  if (document.getElementById(HOST_ID)) return;

  const href = window.location?.href || "";
  if (!/^https?:\/\//i.test(href)) return;
  if (/^https?:\/\/(chrome\.google\.com|chromewebstore\.google\.com)\//i.test(href)) return;

  const { fetchHealth } = ManualJD;

  const host = document.createElement("div");
  host.id = HOST_ID;
  (document.body || document.documentElement).appendChild(host);
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host, * { box-sizing: border-box; }
    .wrap {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: #111827;
      --rb-gap: 14px;
      --rb-btn: 48px;
      --rb-rail-pad: 10px;
    }
    .dock {
      position: fixed;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      z-index: 2147483640;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0;
      pointer-events: none;
    }
    .dock > * { pointer-events: auto; }
    .rail-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--rb-gap);
      padding: var(--rb-rail-pad);
      background: rgba(255,255,255,0.92);
      border-radius: 999px;
      box-shadow: 0 8px 32px rgba(15, 23, 42, 0.12), 0 1px 3px rgba(15, 23, 42, 0.08);
      border: 1px solid rgba(226, 232, 240, 0.9);
    }
    .rail-btn {
      width: var(--rb-btn);
      height: var(--rb-btn);
      border-radius: 50%;
      border: none;
      background: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.1);
      color: #1e293b;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .rail-btn:hover {
      transform: scale(1.06);
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.14);
    }
    .rail-btn:active { transform: scale(0.98); }
    .rail-btn svg { width: 22px; height: 22px; stroke: currentColor; fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
    .rail-btn.primary-ring {
      padding: 3px;
      border-radius: 50%;
      background: linear-gradient(135deg, #a855f7, #6366f1, #3b82f6, #ec4899);
      box-shadow: 0 4px 20px rgba(99, 102, 241, 0.35);
    }
    .rail-btn.primary-ring .inner {
      width: 100%; height: 100%;
      border-radius: 50%;
      background: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .rail-btn.primary-ring .inner img {
      width: 28px; height: 28px;
      object-fit: contain;
    }
    .toast {
      position: fixed;
      right: 88px;
      bottom: 24px;
      z-index: 2147483641;
      max-width: 280px;
      padding: 10px 12px;
      border-radius: 10px;
      background: #0f172a;
      color: #f8fafc;
      font-size: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.2s, transform 0.2s;
      pointer-events: none;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
  `;
  root.appendChild(style);

  const extIcon = chrome.runtime.getURL("icons/icon48.png");

  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.innerHTML = `
    <div class="dock">
      <div class="rail-wrap" id="rail">
        <button type="button" class="rail-btn" id="btn-selection" title="Send selection to side panel as JD">
          <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>
        </button>
        <button type="button" class="rail-btn" id="btn-health" title="Check API health">
          <svg viewBox="0 0 24 24"><path d="M12 20a8 8 0 0 0 8-8"/><path d="M12 20a8 8 0 0 1-8-8"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>
        </button>
        <button type="button" class="rail-btn" id="btn-profiles" title="Profiles on this device">
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        </button>
        <button type="button" class="rail-btn primary-ring" id="btn-main" title="Open Manual JD side panel">
          <span class="inner"><img src="${extIcon}" alt="" /></span>
        </button>
      </div>
    </div>
    <div class="toast" id="toast"></div>
  `;
  root.appendChild(wrap);

  const toastEl = root.getElementById("toast");
  let toastTimer = 0;

  function showToast(msg, ms = 3200) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
  }

  function sendOpen(msg, onFail) {
    chrome.runtime.sendMessage(msg, (res) => {
      const err = chrome.runtime.lastError?.message;
      if (err || !res?.ok) {
        showToast(err || res?.error || "Could not open side panel", 5000);
        onFail?.();
      }
    });
  }

  root.getElementById("btn-selection").addEventListener("click", () => {
    const sel = window.getSelection?.()?.toString?.() || "";
    const t = sel.trim();
    if (!t) {
      showToast("Select text on the page first, then click the book.");
      return;
    }
    sendOpen({ action: "stashSelectionAndOpenPanel", text: t });
  });

  root.getElementById("btn-health").addEventListener("click", async () => {
    try {
      const j = await fetchHealth();
      showToast(`API: ${j.status || "ok"}`);
    } catch (e) {
      showToast(String(e?.message || e || "unreachable"));
    }
  });

  root.getElementById("btn-profiles").addEventListener("click", () => {
    chrome.storage.local.get({ serverProfiles: [] }, (d) => {
      const profiles = d.serverProfiles || [];
      const usable = profiles.filter((p) => p.id);
      const summary = profiles
        .map((p, i) => {
          const n = (p.name || "").trim() || `P${i + 1}`;
          const ok = (p.text || "").trim().length > 0;
          return `${n}${ok ? "" : " ∅"}`;
        })
        .join(", ");
      showToast(`${usable.length}/${profiles.length} profiles ready: ${summary}`, 5500);
    });
  });

  root.getElementById("btn-main").addEventListener("click", () => {
    sendOpen({ action: "openSidePanel" });
  });
})();
