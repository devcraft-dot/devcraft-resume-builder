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

/** Bot / security interstitial on Indeed (captcha, unusual traffic, etc.). */
function detectBotInterstitial() {
  const title = (document.title || "").toLowerCase();
  const href = (location.href || "").toLowerCase();
  if (
    /captcha|robot|verify you|security check|unusual traffic|access denied|interstitial|just a moment/i.test(
      title,
    )
  ) {
    return { bot: true, kind: "title" };
  }
  if (/indeed\.com\/rc\/|interstitial|challenge|captcha/i.test(href)) return { bot: true };
  if (
    document.querySelector(
      [
        "iframe[src*='captcha']",
        "iframe[src*='hcaptcha']",
        "iframe[title*='Cloudflare security challenge']",
        "iframe[src*='challenges.cloudflare.com']",
        "script[src*='/cdn-cgi/challenge-platform/']",
        "script[src*='challenges.cloudflare.com/turnstile']",
        "input[name='cf-turnstile-response']",
        "input[name='cf_challenge_response']",
        "#captcha",
        ".g-recaptcha",
        "#cf-box-container",
      ].join(", "),
    )
  ) {
    return { bot: true, kind: "challenge-widget" };
  }
  if (window.INDEED_CLOUDFLARE_STATIC_PAGE?.PAGE_TYPE) {
    return { bot: true, kind: "indeed-cloudflare-page" };
  }
  const body = (document.body?.innerText || "").slice(0, 4000).toLowerCase();
  if (
    /unusual traffic from your computer network|verify you are human|please complete the security check|additional verification required|troubleshooting cloudflare errors|your ray id|enable javascript and cookies to continue|verifying/i.test(
      body,
    )
  )
    return { bot: true, kind: "body-copy" };
  return { bot: false };
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
