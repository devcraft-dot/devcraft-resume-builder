/* global ManualJD */
(function () {
  const HOST_ID = "resume-builder-manual-jd-host";
  if (document.getElementById(HOST_ID)) return;

  const href = window.location?.href || "";
  if (!/^https?:\/\//i.test(href)) return;
  if (/^https?:\/\/(chrome\.google\.com|chromewebstore\.google\.com)\//i.test(href)) return;

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
        <button type="button" class="rail-btn" id="btn-autofill" title="Autofill from Greenhouse / Ashby job tab (opens side panel)">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/></svg>
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
        showToast(err || res?.error || "Could not complete action", 5000);
        onFail?.();
      }
    });
  }

  root.getElementById("btn-autofill").addEventListener("click", () => {
    sendOpen({ action: "autofillJobTabAndOpenPanel" });
  });

  root.getElementById("btn-main").addEventListener("click", () => {
    sendOpen({ action: "openSidePanel" });
  });
})();
