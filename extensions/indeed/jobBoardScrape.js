/**
 * Greenhouse / Ashby / Workable URL detection and tab scraping (shared with Manual JD logic).
 */
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

function isWorkableJobUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== "apply.workable.com") return false;
    const parts = u.pathname.split("/").filter(Boolean);
    const jIdx = parts.findIndex((p) => p.toLowerCase() === "j");
    return jIdx >= 0 && jIdx < parts.length - 1 && parts[jIdx + 1].length >= 4;
  } catch {
    return false;
  }
}

/** @returns {"greenhouse"|"ashby"|"workable"|null} */
function detectJobBoardFromUrl(url) {
  if (isGreenhouseJobUrl(url)) return "greenhouse";
  if (isAshbyJobUrl(url)) return "ashby";
  if (isWorkableJobUrl(url)) return "workable";
  return null;
}

function isExternalJobBoardTabUrl(u) {
  return !!detectJobBoardFromUrl(String(u || "").trim());
}

function normalizeJobBoardUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.hostname.toLowerCase() === "jobs.ashbyhq.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length && parts[parts.length - 1].toLowerCase() === "application") {
        parts.pop();
        u.pathname = "/" + parts.join("/");
      }
    }
    if (u.hostname.toLowerCase() === "apply.workable.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length && parts[parts.length - 1].toLowerCase() === "apply") {
        parts.pop();
        u.pathname = "/" + parts.join("/");
      }
      if (!u.pathname.endsWith("/")) u.pathname += "/";
    }
    u.hash = "";
    return u.href;
  } catch {
    return s.split("#")[0];
  }
}

function pickFirstJobBoardUrl(candidates) {
  for (const raw of candidates) {
    const u = normalizeJobBoardUrl(raw);
    if (detectJobBoardFromUrl(u)) return u;
  }
  return "";
}

async function scrapeJobBoardTab(tabId, board) {
  const file =
    board === "greenhouse"
      ? "greenhouseScrapeInjected.js"
      : board === "ashby"
        ? "ashbyScrapeInjected.js"
        : "workableScrapeInjected.js";
  const ashby = board === "ashby";
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [file],
    ...(ashby ? { world: "MAIN" } : {}),
  });
  const readScrape =
    board === "greenhouse"
      ? () => globalThis.__MANUAL_JD_GREENHOUSE_SCRAPE__
      : board === "ashby"
        ? () => globalThis.__MANUAL_JD_ASHBY_SCRAPE__
        : () => globalThis.__MANUAL_JD_WORKABLE_SCRAPE__;
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    ...(ashby ? { world: "MAIN" } : {}),
    func: readScrape,
  });
  return result;
}

function jobFromBoardScrape(scraped, indeedUrl) {
  if (!scraped?.ok) return null;
  return {
    title: (scraped.title || "").trim(),
    company_name: (scraped.company || "").trim(),
    description_text: (scraped.description_text || "").trim(),
    salary_range: (scraped.salary_range || "").trim(),
    url: (scraped.posting_url || indeedUrl || "").trim(),
    questions: Array.isArray(scraped.questions) ? scraped.questions : [],
  };
}
