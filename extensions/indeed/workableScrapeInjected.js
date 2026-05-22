/**
 * Injected into apply.workable.com job pages. Sets globalThis.__MANUAL_JD_WORKABLE_SCRAPE__.
 */
(function () {
  function cleanLabel(el) {
    if (!el) return "";
    return (el.textContent || "")
      .replace(/\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function labelRequired(el) {
    if (!el) return false;
    if ((el.textContent || "").includes("*")) return true;
    const field = el.closest("[data-ui], .field, [class*='field']");
    if (field?.querySelector("[required], [aria-required='true']")) return true;
    return false;
  }

  function htmlToText(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = String(html || "");
    return (tmp.innerText || "").replace(/\s+/g, " ").trim();
  }

  function readJobPostingLd() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const j = JSON.parse(s.textContent || "");
        if (j && j["@type"] === "JobPosting") return j;
      } catch {
        /* */
      }
    }
    return null;
  }

  function normalizePostingUrl(href) {
    let u = String(href || location.href || "").split("#")[0];
    try {
      const parsed = new URL(u);
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length && parts[parts.length - 1].toLowerCase() === "apply") {
        parts.pop();
        parsed.pathname = "/" + parts.join("/");
      }
      if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
      return parsed.href;
    } catch {
      return u.replace(/\/apply\/?$/i, "/");
    }
  }

  const SKIP_UI = new Set([
    "firstname",
    "lastname",
    "email",
    "headline",
    "phone",
    "address",
    "resume",
    "cover_letter",
    "summary",
    "avatar",
    "education",
    "experience",
    "application-form",
    "section",
    "section-fields",
    "apply-button",
    "autofill-button",
  ]);

  const SKIP_LABEL_RE =
    /^(first name|last name|full name|email|phone|country|resume|cv|cover letter|linkedin|github|portfolio|website|address|city|state|zip|postal|location|headline|summary|photo|education|experience)\b/i;

  function readWorkableFieldLabel(fieldId, fieldEl) {
    const labelledBy = (fieldEl.getAttribute("aria-labelledby") || "").trim();
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const t = cleanLabel(document.getElementById(id));
        if (t) return t;
      }
    }
    return cleanLabel(document.getElementById(`${fieldId}_label`));
  }

  function controlRequired(fieldEl, labelEl) {
    if (fieldEl.required || fieldEl.getAttribute("aria-required") === "true") return true;
    return labelRequired(labelEl || document.getElementById(`${fieldEl.id}_label`));
  }

  function collectListboxOptions(wrapper, inputId) {
    const opts = [];
    const add = (t) => {
      const s = (t || "").replace(/\s+/g, " ").trim();
      if (s && !opts.includes(s)) opts.push(s);
    };
    if (inputId) {
      document.querySelectorAll(`[id$="-listbox"][role="listbox"]`).forEach((menu) => {
        if (!menu.id || !menu.id.includes(inputId)) return;
        menu.querySelectorAll('[role="option"]').forEach((opt) => add(opt.textContent));
      });
    }
    wrapper.querySelectorAll('[role="listbox"] [role="option"]').forEach((opt) => add(opt.textContent));
    return opts;
  }

  function cssEsc(id) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(id);
    return String(id).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function fieldWrapper(fieldEl) {
    return (
      fieldEl.closest("label") ||
      fieldEl.closest("[data-ui^='QA_']")?.parentElement?.closest("div") ||
      fieldEl.parentElement
    );
  }

  function scrapeWorkableApplicationQuestions(form) {
    const questions = [];
    const seen = new Set();
    const root = form || document.querySelector('[data-ui="application-form"]') || document;

    root.querySelectorAll("input[data-ui^='QA_'], textarea[data-ui^='QA_'], select[data-ui^='QA_']").forEach((fieldEl) => {
      const fieldId = (fieldEl.getAttribute("data-ui") || fieldEl.id || "").trim();
      if (!/^QA_\d+$/.test(fieldId)) return;

      const label = readWorkableFieldLabel(fieldId, fieldEl);
      if (!label || SKIP_LABEL_RE.test(label)) return;
      const key = label.toLowerCase();
      if (seen.has(key)) return;

      const wrapper = fieldWrapper(fieldEl);
      const labelEl = document.getElementById(`${fieldId}_label`);

      let type = "input";
      let options = [];
      const tag = fieldEl.tagName.toLowerCase();

      if (tag === "textarea") {
        type = "textarea";
      } else if (tag === "select") {
        type = "select";
        options = Array.from(fieldEl.options || [])
          .map((o) => (o.textContent || "").trim())
          .filter((t) => t && !/^select\b/i.test(t));
      } else if (fieldEl.type === "radio") {
        type = "select";
        const name = fieldEl.name;
        const group = name
          ? root.querySelectorAll(`input[type="radio"][name="${cssEsc(name)}"]`)
          : wrapper.querySelectorAll('input[type="radio"]');
        const names = new Set();
        group.forEach((r) => {
          let optLabel = "";
          if (r.id) {
            const l = document.querySelector(`label[for="${cssEsc(r.id)}"]`);
            optLabel = cleanLabel(l) || (r.value || "").trim();
          }
          if (!optLabel) optLabel = cleanLabel(r.closest("label")) || (r.value || "").trim();
          if (optLabel && !names.has(optLabel)) {
            names.add(optLabel);
            options.push(optLabel);
          }
        });
      } else {
        const wrapperDiv = fieldEl.closest("div") || wrapper;
        const combobox = wrapperDiv.querySelector('[role="combobox"]');
        const listOpts = collectListboxOptions(wrapperDiv, fieldEl.id);
        if (listOpts.length) {
          type = "select";
          options = listOpts;
        } else if (combobox) {
          const pressed = wrapperDiv.querySelectorAll('button[aria-pressed], [role="radio"]');
          if (pressed.length > 1) {
            type = "select";
            pressed.forEach((btn) => {
              const t = cleanLabel(btn) || (btn.getAttribute("value") || "").trim();
              if (t) options.push(t);
            });
          }
        }
      }

      seen.add(key);
      questions.push({
        label,
        type,
        required: controlRequired(fieldEl, labelEl),
        options,
      });
    });

    if (questions.length) return questions;

    root.querySelectorAll("label").forEach((lab) => {
      const label = cleanLabel(lab);
      if (!label || SKIP_LABEL_RE.test(label)) return;
      const key = label.toLowerCase();
      if (seen.has(key)) return;

      const uiHost = lab.closest("[data-ui]");
      const ui = (uiHost?.getAttribute("data-ui") || "").trim();
      if (SKIP_UI.has(ui) || /^QA_\d+$/.test(ui)) return;

      const wrapper = lab.closest("[data-ui], fieldset, div") || lab.parentElement;
      if (!wrapper || wrapper.querySelector('input[type="file"]')) return;

      const control = wrapper.querySelector("input, textarea, select");
      if (!control) return;
      const controlUi = (control.getAttribute("data-ui") || control.id || "").trim();
      if (SKIP_UI.has(controlUi)) return;

      let type = "input";
      let options = [];
      const select = wrapper.querySelector("select");
      const textarea = wrapper.querySelector("textarea");
      const radios = wrapper.querySelectorAll('input[type="radio"]');

      if (select) {
        type = "select";
        options = Array.from(select.options || [])
          .map((o) => (o.textContent || "").trim())
          .filter((t) => t && !/^select\b/i.test(t));
      } else if (radios.length > 1) {
        type = "select";
        const names = new Set();
        radios.forEach((r) => {
          const id = r.id;
          let optLabel = "";
          if (id) {
            const l = wrapper.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
            optLabel = cleanLabel(l) || (r.value || "").trim();
          }
          if (!optLabel) optLabel = cleanLabel(r.closest("label")) || (r.value || "").trim();
          if (optLabel && !names.has(optLabel)) {
            names.add(optLabel);
            options.push(optLabel);
          }
        });
      } else if (textarea) {
        type = "textarea";
      } else if (!wrapper.querySelector('input[type="text"], input:not([type]), textarea, select')) {
        return;
      }

      seen.add(key);
      questions.push({
        label,
        type,
        required: labelRequired(lab),
        options,
      });
    });

    return questions;
  }

  function manualJdScrapeWorkableJobPost() {
    if (location.hostname.toLowerCase() !== "apply.workable.com") {
      return { ok: false, error: "Not a Workable careers page (expected apply.workable.com)." };
    }

    const ld = readJobPostingLd();
    const h1 = document.querySelector('h1[data-ui="job-title"]');
    let title = (h1?.textContent || "").trim();
    if (!title && ld?.title) title = String(ld.title).trim();
    if (!title && document.title) {
      const m = document.title.match(/^(.+?)\s+-\s+/);
      if (m) title = m[1].trim();
    }
    if (!title) {
      return { ok: false, error: "Could not find job title on Workable page." };
    }

    let company = String(ld?.hiringOrganization?.name || "").trim();
    if (!company) {
      company = (document.querySelector('[data-ui="company-logo"] span')?.textContent || "").trim();
    }
    if (!company && document.title) {
      const parts = document.title.split(" - ");
      if (parts.length >= 2) company = parts[parts.length - 1].trim();
    }

    const chunks = [];
    const desc = document.querySelector('[data-ui="job-description"]');
    const req = document.querySelector('[data-ui="job-requirements"]');
    if (desc) chunks.push((desc.innerText || "").trim());
    if (req) chunks.push((req.innerText || "").trim());
    let description_text = chunks.filter(Boolean).join("\n\n");
    if (!description_text && ld?.description) {
      description_text = htmlToText(ld.description);
    }

    const salary_range = "";

    const posting_url = normalizePostingUrl(
      ld?.url || document.querySelector('link[rel="canonical"]')?.href || location.href,
    );

    const form =
      document.querySelector('[data-ui="application-form"]') ||
      document.querySelector("main form") ||
      document.querySelector("form");

    const questions = scrapeWorkableApplicationQuestions(form);

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
    globalThis.__MANUAL_JD_WORKABLE_SCRAPE__ = manualJdScrapeWorkableJobPost();
  } catch (e) {
    globalThis.__MANUAL_JD_WORKABLE_SCRAPE__ = {
      ok: false,
      error: String(e?.message || e),
    };
  }
})();
