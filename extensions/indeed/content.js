/**
 * One element per job. Mosaic cards nest `.job_seen_beacon`, `.cardOutline`, and `[data-jk]`
 * inside the same listing — a union selector matches all of them and triples the count.
 * Indeed’s hydrated markup uses a single `div.cardOutline.tapItem.result` (or `.result.tapItem`) per row.
 */
function jobCardElements() {
  const byJk = new Map();

  const addCard = (el) => {
    if (!el || el.nodeType !== 1) return;
    const jk = jobKeyFromCard(el);
    if (!jk || byJk.has(jk)) return;
    byJk.set(jk, el);
  };

  const mosaic = document.getElementById("mosaic-provider-jobcards");
  if (mosaic) {
    mosaic.querySelectorAll("div.cardOutline.tapItem.result").forEach(addCard);
    if (byJk.size === 0) {
      mosaic.querySelectorAll("div.cardOutline.result.tapItem").forEach(addCard);
    }
    if (byJk.size === 0) {
      mosaic.querySelectorAll("ul > li").forEach((li) => {
        const outline = li.querySelector("div.cardOutline.result, div.cardOutline.tapItem.result");
        if (outline && li.querySelector("a[data-jk], a.jcs-JobTitle")) addCard(outline);
      });
    }
  }

  if (byJk.size > 0) {
    return Array.from(byJk.values());
  }

  document.querySelectorAll(".jobsearch-ResultsList > li .resultContent").forEach(addCard);
  if (byJk.size > 0) {
    return Array.from(byJk.values());
  }

  document.querySelectorAll("ul.jobsearch-ResultsList > li").forEach((li) => {
    if (li.querySelector("a[data-jk], a.jcs-JobTitle, h2 a")) addCard(li);
  });
  return Array.from(byJk.values());
}

function jobKeyFromCard(card) {
  const jk =
    card.querySelector("[data-jk]")?.getAttribute("data-jk") ||
    card.closest("[data-jk]")?.getAttribute("data-jk");
  if (jk) return jk;
  const href = card.querySelector("a[href*='jk=']")?.href;
  const m = href?.match(/jk=([a-f0-9]+)/i);
  if (m) return m[1];
  const oc = card.getAttribute("data-occludable-job-id");
  return oc || null;
}

function jobCount() {
  return jobCardElements().length;
}

function jkAtIndex(index) {
  const cards = jobCardElements();
  if (index >= cards.length) return null;
  return jobKeyFromCard(cards[index]);
}

function clickJobAt(index) {
  const cards = jobCardElements();
  if (index >= cards.length) return false;
  const card = cards[index];
  const link =
    card.querySelector("a.jcs-JobTitle") ||
    card.querySelector("h2 a") ||
    card.querySelector("a[data-jk]") ||
    card.querySelector("a");
  if (link) {
    link.click();
    return true;
  }
  card.click();
  return true;
}

function isPreloadSmartApplyUrl(h) {
  return /preloadresumeapply|\/preload/i.test(h);
}

function rejectIndeedJobPageHref(h) {
  const s = String(h || "").trim();
  if (!s) return "";
  if (/indeed\.com\/job\//i.test(s) || /indeed\.com\/viewjob/i.test(s)) return "";
  return s;
}

function absolutizeHref(h) {
  const s = String(h || "").trim();
  if (!s) return "";
  try {
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    return new URL(s, "https://www.indeed.com/").href;
  } catch {
    return "";
  }
}

function collectHrefsFromOpenShadowRoots(root, depth, out) {
  if (!root || depth > 10) return;
  try {
    root.querySelectorAll?.("a[href], iframe[src]").forEach((el) => {
      const raw = el instanceof HTMLAnchorElement ? el.href : el.getAttribute("href") || el.getAttribute("src");
      const u = absolutizeHref(raw);
      if (u) out.push(u);
    });
    root.querySelectorAll?.("*").forEach((el) => {
      if (el.shadowRoot) collectHrefsFromOpenShadowRoots(el.shadowRoot, depth + 1, out);
    });
  } catch {
    /* */
  }
}

function pickSmartApplyFromUrlList(urls) {
  for (const h of urls) {
    if (!h || !/smartapply\.indeed\.com/i.test(h)) continue;
    if (isPreloadSmartApplyUrl(h)) continue;
    if (/applybyapplyablejobid/i.test(h) || /indeedApplyableJobId=/i.test(h)) return h;
  }
  for (const h of urls) {
    if (!h || !/smartapply\.indeed\.com\/beta\/indeedapply\//i.test(h)) continue;
    if (isPreloadSmartApplyUrl(h)) continue;
    return h;
  }
  return "";
}

function smartApplyUrlFromDetailPane() {
  const urls = [];
  document.querySelectorAll('a[href*="smartapply.indeed.com"], iframe[src*="smartapply.indeed.com"]').forEach((el) => {
    const raw =
      el instanceof HTMLAnchorElement ? el.href : el.getAttribute("href") || el.getAttribute("src");
    urls.push(absolutizeHref(raw));
  });
  collectHrefsFromOpenShadowRoots(document.body, 0, urls);
  const hit = rejectIndeedJobPageHref(pickSmartApplyFromUrlList(urls));
  if (hit) return hit;
  return rejectIndeedJobPageHref(extractSmartApplyUrlFromPageHtml()) || "";
}

function extractSmartApplyUrlFromPageHtml() {
  let raw = document.documentElement.innerHTML;
  raw = raw.replace(/\\u002f/gi, "/").replace(/\\\//g, "/");
  const re =
    /https:\/\/smartapply\.indeed\.com\/beta\/indeedapply\/applybyapplyablejobid\?[^"'\\s<]+/gi;
  let m;
  while ((m = re.exec(raw))) {
    let u = m[0].replace(/&amp;/g, "&");
    if (!isPreloadSmartApplyUrl(u)) {
      const ok = rejectIndeedJobPageHref(u);
      if (ok) return ok;
    }
  }
  return "";
}

function applyStartUrlFromDetailPane() {
  const smart = rejectIndeedJobPageHref(smartApplyUrlFromDetailPane());
  if (smart) return smart;

  const links = document.querySelectorAll('a[href*="applystart"], a[href*="/applystart"]');
  for (const a of links) {
    const h = rejectIndeedJobPageHref((a.href || "").trim());
    if (h.includes("applystart") && !/\/viewjob/i.test(h)) return h;
  }
  const wrap = document.querySelector("#indeedApplyButton, [data-testid='indeedApplyButton-test']");
  if (wrap) {
    const inner = wrap.matches("a[href]") ? wrap : wrap.querySelector("a[href]");
    const ih = rejectIndeedJobPageHref(inner?.href?.trim() || "");
    if (ih.includes("smartapply.indeed.com") && !isPreloadSmartApplyUrl(ih)) return ih;
    if (ih.includes("applystart")) return ih;
  }
  return "";
}

function jobDetailPaneRoot() {
  return (
    document.getElementById("jobsearch-ViewjobPaneWrapper") ||
    document.querySelector("[class*='ViewjobPane']") ||
    document.getElementById("viewJobSSRRoot") ||
    document.body
  );
}

function getEssentialApplyPane() {
  const pane = jobDetailPaneRoot();
  const h2 = pane.querySelector(
    "h2.jobsearch-JobInfoHeader-title, h2[data-testid='jobsearch-JobInfoHeader-title'], h2.jcs-JobTitle, h2 a.jcs-JobTitle"
  );
  const title = (h2?.textContent || "").trim();
  const companyEl = pane.querySelector(
    "[data-testid='inlineHeader-companyName'], .jobsearch-InlineCompanyRating a, [data-testid='company-name']"
  );
  const company = (companyEl?.textContent || "").trim();
  const btn = pane.querySelector("#indeedApplyButton, [data-testid='indeedApplyButton-test']");
  const applyButtonAria = (btn?.getAttribute("aria-label") || "").trim();
  const applyButtonText = (btn?.textContent || "").trim();
  const desc = pane.querySelector(
    "#jobsearch-JobComponent-description, #jobDescriptionText, [id*='jobDescriptionText']"
  );
  const descriptionSnippet = (desc?.textContent || "").trim().slice(0, 12000);
  return {
    title,
    company,
    applyButtonAria,
    applyButtonText,
    descriptionSnippet,
  };
}

/** Per-job Indeed Apply control only (after clicking the job in the list). Opens apply in a new tab. */
function clickIndeedApplyButton() {
  const pane = jobDetailPaneRoot();
  const indeed = pane.querySelector("#indeedApplyButton, [data-testid='indeedApplyButton-test']");
  if (!indeed) return { ok: false, reason: "no-indeed-apply-button" };
  if (indeed.disabled) return { ok: false, reason: "apply-button-disabled" };
  indeed.click();
  return { ok: true, reason: "" };
}

/**
 * Bot / security interstitial on Indeed.
 *
 * Detection is intentionally conservative: weak signals (a bare Cloudflare
 * iframe or a generic phrase) can appear on real pages, so we only return
 * `bot: true` when we see a *strong* signal, or two independent weak signals
 * together.
 */
function detectBotInterstitial() {
  const title = (document.title || "").trim().toLowerCase();
  const href = (location.href || "").toLowerCase();

  // --- Strong signals: these appear *only* on a real challenge page. ---

  // Indeed's own marker on their static Cloudflare pages.
  if (window.INDEED_CLOUDFLARE_STATIC_PAGE?.PAGE_TYPE) {
    return { bot: true, kind: "indeed-cloudflare-page" };
  }
  // Cloudflare's challenge platform URL.
  if (/\/cdn-cgi\/challenge-platform\//i.test(href)) {
    return { bot: true, kind: "cdn-cgi-url" };
  }
  // "Just a moment..." is Cloudflare's exact interstitial title.
  if (/^just a moment\.?\.?\.?$/.test(title)) {
    return { bot: true, kind: "title-just-a-moment" };
  }
  // Explicit CF challenge form elements in the main document (not an iframe).
  if (document.querySelector("form#challenge-form, main#challenge-error-title, #challenge-stage")) {
    return { bot: true, kind: "challenge-form" };
  }

  // --- Weak signals: need at least two to agree before we trust them. ---

  const weak = [];

  // Short body (under ~1500 chars) + cf challenge text is a strong
  // combination: the real Indeed page has far more content than that.
  const bodyText = (document.body?.innerText || "").trim();
  const shortBody = bodyText.length < 1500;
  const bodyLc = bodyText.slice(0, 4000).toLowerCase();
  const bodyCfPhrase =
    /verify you are human|additional verification required|troubleshooting cloudflare errors|your ray id is|enable javascript and cookies to continue|please complete the security check|checking if the site connection is secure/.test(
      bodyLc,
    );
  if (shortBody && bodyCfPhrase) return { bot: true, kind: "short-body-cf-copy" };
  if (bodyCfPhrase) weak.push("body-copy");
  if (shortBody && bodyText.length > 0) weak.push("short-body");

  // A Cloudflare challenge iframe in an otherwise empty-looking page.
  const cfIframe = document.querySelector(
    "iframe[src*='challenges.cloudflare.com'], iframe[title*='Cloudflare security challenge' i], iframe[title*='Widget containing a Cloudflare' i]",
  );
  if (cfIframe) weak.push("cf-iframe");

  // Title strongly suggesting a challenge (exact-ish match, not substring).
  if (/^(attention required|access denied|security check|please verify you are a human)/.test(title)) {
    weak.push("title");
  }

  if (weak.length >= 2) {
    return { bot: true, kind: `weak:${weak.join("+")}` };
  }
  return { bot: false };
}

/**
 * Best-effort nudge for Cloudflare Turnstile / interstitial checkboxes.
 *
 * Reality check: we can't reach into the Cloudflare iframe (cross-origin + closed
 * shadow root), and Turnstile rejects untrusted synthetic events. But on the
 * "managed challenge" path the checkbox often just needs ANY user-shaped
 * interaction near it before the server-side verdict flips. So we try:
 *   1. Scroll the widget into view.
 *   2. Dispatch pointer / mouse events at the center of the visible widget area.
 * This does NOT guarantee the challenge passes; the real fix is still manual.
 */
function attemptBotAutoSolve() {
  const results = { tried: false, clicks: 0, reason: "" };
  const candidates = [];

  document
    .querySelectorAll(
      [
        "iframe[title*='Cloudflare security challenge']",
        "iframe[src*='challenges.cloudflare.com']",
        "#cf-box-container",
        "#cf-chl-widget-7rsqt",
        "[id^='cf-chl-widget-']",
        ".cf-turnstile",
        "div[data-sitekey]",
      ].join(", "),
    )
    .forEach((el) => candidates.push(el));

  if (!candidates.length) {
    results.reason = "no-widget";
    return results;
  }

  for (const el of candidates) {
    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch {
      /* */
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) continue;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: cx,
      clientY: cy,
      button: 0,
      buttons: 1,
      view: window,
    };

    try {
      el.dispatchEvent(new PointerEvent("pointerover", init));
      el.dispatchEvent(new PointerEvent("pointermove", init));
      el.dispatchEvent(new PointerEvent("pointerdown", init));
      el.dispatchEvent(new MouseEvent("mousedown", init));
      el.dispatchEvent(new PointerEvent("pointerup", init));
      el.dispatchEvent(new MouseEvent("mouseup", init));
      el.dispatchEvent(new MouseEvent("click", init));
      results.clicks += 1;
      results.tried = true;
    } catch (e) {
      results.reason = String(e?.message || e);
    }
  }

  return results;
}

/**
 * Standalone job page: prefer "Apply with Indeed", else "Apply on company site" (applystart).
 */
function clickDetailApplyButton() {
  const pane = jobDetailPaneRoot();
  const indeed = pane.querySelector("#indeedApplyButton, [data-testid='indeedApplyButton-test']");
  if (indeed && !indeed.disabled) {
    indeed.click();
    return { ok: true, kind: "indeed", reason: "" };
  }
  const companyBtn = pane.querySelector(
    "#applyButtonLinkContainer a[href*='applystart'], #applyButtonLinkContainer button[href*='applystart'], #viewJobButtonLinkContainer button[href*='applystart'], a[href*='indeed.com/applystart']",
  );
  if (companyBtn && !companyBtn.disabled) {
    companyBtn.click();
    return { ok: true, kind: "company", reason: "" };
  }
  return { ok: false, kind: "", reason: "no-apply-button" };
}

function serpPaginationNextAnchor() {
  const selectors = [
    'nav[aria-label="pagination"] a[data-testid="pagination-page-next"]',
    'a[data-testid="pagination-page-next"]',
    'nav[aria-label="pagination"] a[aria-label="Next Page"]',
    'a[aria-label="Next Page"][href*="start="]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el instanceof HTMLAnchorElement) return el;
  }
  return null;
}

function nextPageLinkIsUsable(a) {
  if (!a || !(a instanceof HTMLAnchorElement)) return false;
  if (a.getAttribute("aria-disabled") === "true") return false;
  const href = (a.getAttribute("href") || "").trim();
  if (!href || href === "#") return false;
  return true;
}

function hasNextPage() {
  return nextPageLinkIsUsable(serpPaginationNextAnchor());
}

/** @returns {{ ok: boolean, method?: string, to?: string, reason?: string }} */
function prepareSerpNextNavigation() {
  const a = serpPaginationNextAnchor();
  if (!a || !nextPageLinkIsUsable(a)) return { ok: false, reason: "no-next-control" };
  let abs = "";
  try {
    abs = new URL(a.getAttribute("href"), location.origin).href;
  } catch {
    return { ok: false, reason: "bad-href" };
  }
  const here = location.href.split("#")[0];
  if (abs.split("#")[0] === here) return { ok: false, reason: "same-url" };
  return { ok: true, method: "assign", to: abs };
}

/**
 * Go to next SERP page. Prefer full navigation via resolved href (Indeed/React often ignores a bare .click()).
 * Falls back to clicking the anchor if assign target is unusable.
 */
function goSerpNextPage() {
  const prep = prepareSerpNextNavigation();
  if (prep.ok && prep.to) {
    setTimeout(() => {
      location.assign(prep.to);
    }, 0);
    return prep;
  }
  const a = serpPaginationNextAnchor();
  if (a && nextPageLinkIsUsable(a)) {
    a.click();
    return { ok: true, method: "click" };
  }
  return { ok: false, reason: prep.reason || "no-pagination" };
}

function clickNextPage() {
  const r = goSerpNextPage();
  return !!r.ok;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.action) {
    case "ping":
      sendResponse({ pong: true });
      break;
    case "getJobCount":
      sendResponse({ count: jobCount() });
      break;
    case "getJk":
      sendResponse({ jk: jkAtIndex(msg.index) });
      break;
    case "clickJob":
      sendResponse({ ok: clickJobAt(msg.index) });
      break;
    case "getApplyStartUrl":
      sendResponse({ applyUrl: applyStartUrlFromDetailPane() });
      break;
    case "getEssentialApplyPane":
      sendResponse({ essentials: getEssentialApplyPane() });
      break;
    case "clickIndeedApplyButton":
      sendResponse(clickIndeedApplyButton());
      break;
    case "clickDetailApplyButton":
      sendResponse(clickDetailApplyButton());
      break;
    case "detectBotInterstitial":
      sendResponse(detectBotInterstitial());
      break;
    case "attemptBotAutoSolve":
      sendResponse(attemptBotAutoSolve());
      break;
    case "hasNextPage":
      sendResponse({ has: hasNextPage() });
      break;
    case "clickNextPage":
      sendResponse({ ok: clickNextPage() });
      break;
    case "goSerpNextPage":
      sendResponse(goSerpNextPage());
      break;
    default:
      sendResponse({ error: "unknown action" });
  }
});
