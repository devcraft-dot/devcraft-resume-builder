/**
 * Shared API + crypto for Manual JD (popup + content script).
 * Keep `API_URL` in sync with `config.js` and `manifest.json` host_permissions.
 */
(function () {
  const API_URL = "https://devcraft-resume-builder.vercel.app";
  const API_ERROR_LOG_KEY = "manualJdApiErrorLog";
  const API_ERROR_LOG_MAX = 40;

  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Must match `canonical_url_for_manual_entry` in app/schemas/generate.py.
   * @param {string} profileName
   * @param {{ title: string, company: string, jd: string, referenceUrl: string }} job
   */
  async function canonicalJobUrl(profileName, job) {
    const ref = (job.referenceUrl || "").trim();
    if (ref) return ref.slice(0, 2000);
    const pn = (profileName || "").trim() || "default";
    const key = `${pn}\n${job.title.trim()}\n${(job.company || "").trim()}\n${(job.jd || "").trim()}`;
    const digest = await sha256Hex(key);
    return `manual:${digest}`;
  }

  async function appendApiErrorLog(entry) {
    try {
      const r = await chrome.storage.local.get(API_ERROR_LOG_KEY);
      const prev = Array.isArray(r[API_ERROR_LOG_KEY]) ? r[API_ERROR_LOG_KEY] : [];
      const row = {
        at: new Date().toISOString(),
        path: String(entry.path || "").slice(0, 400),
        method: String(entry.method || "POST").slice(0, 16),
        status: typeof entry.status === "number" ? entry.status : 0,
        detail: String(entry.detail || "").slice(0, 3000),
        context: String(entry.context || "").slice(0, 500),
      };
      await chrome.storage.local.set({
        [API_ERROR_LOG_KEY]: [row, ...prev].slice(0, API_ERROR_LOG_MAX),
      });
    } catch (e) {
      console.error("[Manual JD] appendApiErrorLog", e);
    }
  }

  async function checkGenerationKeys(jdUrl, profilesList) {
    if (!jdUrl || !profilesList?.length) return [];
    const items = profilesList.map((p) => ({
      url: jdUrl,
      profile_name: (p.name || "").trim() || "default",
    }));
    try {
      const res = await fetch(`${API_URL}/api/check-generation-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        let detail = text?.slice(0, 1200) || res.statusText;
        try {
          const j = JSON.parse(text);
          if (j?.detail != null) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
        } catch {
          /* */
        }
        await appendApiErrorLog({
          path: "/api/check-generation-keys",
          method: "POST",
          status: res.status,
          detail,
          context: (jdUrl || "").slice(0, 400),
        });
        return null;
      }
      const data = await res.json();
      return Array.isArray(data.items) ? data.items : [];
    } catch (e) {
      const msg = e?.message || String(e);
      await appendApiErrorLog({
        path: "/api/check-generation-keys",
        method: "POST",
        status: 0,
        detail: msg,
        context: (jdUrl || "").slice(0, 400),
      });
      return null;
    }
  }

  function extractDriveFileId(url) {
    const m = String(url || "").match(/\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function driveExportUrl(driveUrl, format) {
    const id = extractDriveFileId(driveUrl);
    if (!id) return String(driveUrl || "");
    const mime =
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    return `https://docs.google.com/document/d/${id}/export?formatType=compiled&format=${format}&mimeType=${encodeURIComponent(mime)}`;
  }

  async function postGenerateManual(profile, job) {
    const questions = Array.isArray(job.questions) ? job.questions : [];
    const body = {
      title: job.title.trim(),
      company_name: (job.company || "").trim(),
      description_text: (job.jd || "").trim(),
      salary_range: (job.salary || "").trim(),
      questions,
      profile_name: (profile.name || "").trim() || "default",
      profile_text: (profile.text || "").trim(),
      model: profile.model || "gpt-5.4-mini",
      reference_url: (job.referenceUrl || "").trim(),
    };
    let res;
    try {
      res = await fetch(`${API_URL}/api/generate/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const msg = e?.message || String(e);
      await appendApiErrorLog({
        path: "/api/generate/manual",
        method: "POST",
        status: 0,
        detail: msg,
        context: `${job.title} · ${profile.name || "default"}`,
      });
      throw new Error(`Network/CORS (${API_URL}): ${msg}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      let detail = text?.slice(0, 1200) || res.statusText;
      try {
        const j = JSON.parse(text);
        if (j?.detail != null) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      } catch {
        /* */
      }
      await appendApiErrorLog({
        path: "/api/generate/manual",
        method: "POST",
        status: res.status,
        detail,
        context: `${job.title} · ${profile.name || "default"}`,
      });
      throw new Error(`API ${res.status}: ${detail}`);
    }
    return res.json();
  }

  async function fetchHealth() {
    const res = await fetch(`${API_URL}/health`, { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  globalThis.ManualJD = {
    API_URL,
    sha256Hex,
    canonicalJobUrl,
    appendApiErrorLog,
    checkGenerationKeys,
    postGenerateManual,
    fetchHealth,
    extractDriveFileId,
    driveExportUrl,
  };
})();
