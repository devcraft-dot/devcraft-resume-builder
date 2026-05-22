/**
 * Injected into jobs.ashbyhq.com. Reads window.__appData (Ashby embeds posting + form schema).
 * Sets globalThis.__MANUAL_JD_ASHBY_SCRAPE__ — same shape as Greenhouse scrape for the side panel.
 */
(function () {
  function ashbySelectOptions(field) {
    const m = field?.metadata;
    if (!m || typeof m !== "object") return [];
    const raw = m.selectableValues || m.selectableOptions || m.options || m.values;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((x) => {
        if (typeof x === "string") return x.trim();
        if (x == null) return "";
        return String(x.label ?? x.title ?? x.name ?? x.value ?? "").trim();
      })
      .filter(Boolean);
  }

  function salaryFromPosting(posting) {
    const direct = String(posting?.scrapeableCompensationSalarySummary || "").trim();
    if (direct) return direct;
    const tiers = posting?.compensationTiers;
    if (Array.isArray(tiers) && tiers.length) {
      const bits = tiers
        .map((t) => {
          if (typeof t === "string") return t.trim();
          return String(t?.summary || t?.label || "").trim();
        })
        .filter(Boolean);
      if (bits.length) return bits.join(" · ");
    }
    return "";
  }

  function manualJdScrapeAshbyJobPost() {
    const host = (window.location.hostname || "").toLowerCase();
    if (host !== "jobs.ashbyhq.com") {
      return { ok: false, error: "Not an Ashby jobs page (expected jobs.ashbyhq.com)." };
    }

    const data = window.__appData;
    if (!data?.posting) {
      return {
        ok: false,
        error:
          "Ashby job data not found (__appData). Wait for the page to finish loading, then try again.",
      };
    }

    const posting = data.posting;
    const org = data.organization || {};

    const title = String(posting.title || "").trim();
    if (!title) {
      return { ok: false, error: "Could not read job title from Ashby data." };
    }

    const company = String(org.name || "").trim();
    let description_text = String(posting.descriptionPlainText || "").trim();
    if (!description_text) {
      const descEl = document.querySelector(
        '#overview [class*="descriptionText"], .ashby-job-posting-right-pane [class*="descriptionText"]',
      );
      description_text = (descEl?.innerText || "").replace(/\r\n/g, "\n").trim();
    }

    const salary_range = salaryFromPosting(posting);
    const posting_url = String(window.location.href || "")
      .split("#")[0]
      .replace(/\/application\/?$/i, "");

    const SKIP_TYPES = new Set(["File", "Email", "Phone"]);
    const SKIP_LABEL_RE =
      /^(first name|last name|full name|name|email|e-mail|phone|country|resume|cv|cover letter|linkedin|github|portfolio|website|address|city|state|zip|postal|location)\b/i;

    const questions = [];
    const seen = new Set();
    const fieldEntries = posting.applicationForm?.fieldEntries || [];

    for (const entry of fieldEntries) {
      const field = entry.field;
      if (!field) continue;

      const path = String(field.path || "");
      if (path.startsWith("_systemfield_")) continue;

      const ftype = String(field.type || "");
      if (SKIP_TYPES.has(ftype)) continue;

      const label = String(field.title || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!label || SKIP_LABEL_RE.test(label)) continue;

      const dedupeKey = `${path}::${label.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const required = entry.isRequired === true;

      if (ftype === "LongText" || ftype === "RichText") {
        questions.push({ label, type: "textarea", required, options: [] });
        continue;
      }

      if (ftype === "Boolean") {
        questions.push({ label, type: "select", required, options: ["Yes", "No"] });
        continue;
      }

      if (ftype === "Select") {
        const options = ashbySelectOptions(field);
        questions.push({ label, type: "select", required, options });
        continue;
      }

      if (ftype === "MultiSelect") {
        questions.push({ label, type: "textarea", required, options: [] });
        continue;
      }

      questions.push({ label, type: "input", required, options: [] });
    }

    return {
      ok: true,
      title,
      company,
      salary_range,
      description_text,
      posting_url,
      questions,
    };
  }

  try {
    globalThis.__MANUAL_JD_ASHBY_SCRAPE__ = manualJdScrapeAshbyJobPost();
  } catch (e) {
    globalThis.__MANUAL_JD_ASHBY_SCRAPE__ = {
      ok: false,
      error: String(e?.message || e),
    };
  }
})();
