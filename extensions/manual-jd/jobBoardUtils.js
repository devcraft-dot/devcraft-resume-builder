/**
 * Shared job-board URL detection for Manual JD (popup + background queue).
 */
(function () {
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

  function boardLabel(board) {
    if (board === "ashby") return "Ashby";
    if (board === "workable") return "Workable";
    return "Greenhouse";
  }

  function scrapeScriptFile(board) {
    if (board === "greenhouse") return "greenhouseScrapeInjected.js";
    if (board === "ashby") return "ashbyScrapeInjected.js";
    if (board === "workable") return "workableScrapeInjected.js";
    return null;
  }

  function scrapeGlobalName(board) {
    if (board === "greenhouse") return "__MANUAL_JD_GREENHOUSE_SCRAPE__";
    if (board === "ashby") return "__MANUAL_JD_ASHBY_SCRAPE__";
    if (board === "workable") return "__MANUAL_JD_WORKABLE_SCRAPE__";
    return null;
  }

  globalThis.JobBoardUtils = {
    isGreenhouseJobUrl,
    isAshbyJobUrl,
    isWorkableJobUrl,
    detectJobBoardFromUrl,
    boardLabel,
    scrapeScriptFile,
    scrapeGlobalName,
  };
})();
