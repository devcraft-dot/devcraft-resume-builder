/**
 * Injected into a Greenhouse job-board tab. Sets globalThis.__MANUAL_JD_GREENHOUSE_SCRAPE__.
 * Selectors aligned with job-boards.greenhouse.io (Remix / external boards).
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
    return false;
  }

  function collectReactSelectOptions(inputId) {
    if (!inputId) return [];
    const menus = document.querySelectorAll('[id$="-listbox"][role="listbox"]');
    for (const menu of menus) {
      if (!menu.id || !menu.id.includes(inputId)) continue;
      const opts = [];
      menu.querySelectorAll('[role="option"]').forEach((opt) => {
        const t = (opt.textContent || "").replace(/\s+/g, " ").trim();
        if (t && !opts.includes(t)) opts.push(t);
      });
      if (opts.length) return opts;
    }
    return [];
  }

  function optionsFromLinkedNativeSelect(wrapper, inputId) {
    if (!inputId) return [];
    try {
      const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(inputId) : inputId.replace(/[^a-zA-Z0-9_-]/g, "");
      let sel = wrapper.querySelector(`select#${esc}`);
      if (!sel) sel = wrapper.querySelector(`select[name="${esc}"]`);
      if (!sel) sel = document.querySelector(`select#${esc}, form#application-form select[name="${esc}"]`);
      if (!sel) return [];
      return Array.from(sel.options || [])
        .map((o) => (o.textContent || "").trim())
        .filter((t) => t && !/^select/i.test(t) && !/^choose/i.test(t));
    } catch {
      return [];
    }
  }

  function manualJdScrapeGreenhouseJobPost() {
    const root = document.querySelector("main.job-post");
    if (!root) {
      return { ok: false, error: "Not a Greenhouse job post (expected main.job-post)." };
    }

    const h1 = root.querySelector(".job__title h1.section-header, .job__title h1");
    const title = (h1?.textContent || "").trim();
    if (!title) {
      return { ok: false, error: "Could not find job title (.job__title h1)." };
    }

    let company = "";
    const logo = root.querySelector(".image-container img.logo");
    const alt = (logo?.getAttribute("alt") || "").trim();
    if (alt) company = alt.replace(/\s+logo\s*$/i, "").trim();
    if (!company) {
      const m = document.title.match(/\bat\s+(.+?)\s*$/i);
      if (m) company = m[1].replace(/\s*[|–-].*$/, "").trim();
    }

    const payBlock = root.querySelector(".job__pay-ranges");
    const salary_range = payBlock ? (payBlock.innerText || "").replace(/\s+/g, " ").trim() : "";

    const descEl = root.querySelector(".job__description");
    const description_text = (descEl?.innerText || "").trim();

    const posting_url = String(window.location.href || "").split("#")[0];

    const SKIP_INPUT_IDS = new Set([
      "first_name",
      "last_name",
      "email",
      "phone",
      "country",
      "school_name",
      "education_start_date",
      "education_end_date",
      "education_degree",
      "education_discipline",
    ]);

    const SKIP_LABEL_RE = new RegExp(
      "^(first name|last name|email|phone|country|resume|cv|cover letter|linkedin|github|portfolio|website|address|city|state|zip|postal|location)\\b",
      "i",
    );

    const questions = [];
    const form = document.querySelector("#application-form");
    const seenKeys = new Set();

    if (form) {
      /** Document order; skip EEO blocks (.eeoc__question__wrapper) entirely. */
      const nodes = form.querySelectorAll(".field-wrapper");

      nodes.forEach((wrapper) => {
        if (wrapper.closest("fieldset.phone-input")) return;
        if (wrapper.closest(".eeoc__question__wrapper")) return;

        if (wrapper.classList.contains("field-wrapper")) {
          let anc = wrapper.parentElement;
          while (anc && anc !== form) {
            if (anc !== wrapper && anc.classList?.contains("field-wrapper")) return;
            anc = anc.parentElement;
          }
        }

        if (wrapper.querySelector("fieldset.phone-input")) return;

        const fileInput = wrapper.querySelector('input[type="file"]');
        if (fileInput) return;

        const lab = wrapper.querySelector("label.label, label.select__label");
        const label = cleanLabel(lab);
        if (!label || SKIP_LABEL_RE.test(label)) return;

        if (wrapper.querySelector(".select__container, .select-shell")) {
          const combobox = wrapper.querySelector("input.select__input");
          const inputId = (combobox?.id || "").trim();
          if (!inputId || SKIP_INPUT_IDS.has(inputId.toLowerCase())) return;
          let options = collectReactSelectOptions(inputId);
          if (!options.length) options = optionsFromLinkedNativeSelect(wrapper, inputId);
          const key = `sel|${label.toLowerCase()}|${inputId}`;
          if (seenKeys.has(key)) return;
          seenKeys.add(key);
          questions.push({
            label,
            type: "select",
            required: labelRequired(lab) || combobox?.getAttribute("aria-required") === "true",
            options,
          });
          return;
        }

        const inp = wrapper.querySelector("textarea, input.input__single-line, input.input__multi-line");
        if (!inp || inp.type === "hidden" || inp.type === "file") return;

        const id = (inp.id || "").toLowerCase();
        if (SKIP_INPUT_IDS.has(id)) return;

        const key = `txt|${label.toLowerCase()}|${id}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);

        const type =
          inp.tagName === "TEXTAREA" || String(inp.className || "").includes("multi") ? "textarea" : "input";

        questions.push({
          label,
          type,
          required: labelRequired(lab) || inp.getAttribute("aria-required") === "true" || inp.required === true,
          options: [],
        });
      });
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
    globalThis.__MANUAL_JD_GREENHOUSE_SCRAPE__ = manualJdScrapeGreenhouseJobPost();
  } catch (e) {
    globalThis.__MANUAL_JD_GREENHOUSE_SCRAPE__ = {
      ok: false,
      error: String(e?.message || e),
    };
  }
})();
