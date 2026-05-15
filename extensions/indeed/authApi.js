/**
 * API token auth + authenticated fetch for Resume Builder extensions.
 */
const API_TOKEN_KEY = "apiToken";
const SERVER_PROFILES_KEY = "serverProfiles";

async function getApiToken() {
  const r = await chrome.storage.local.get(API_TOKEN_KEY);
  return String(r[API_TOKEN_KEY] || "").trim();
}

async function setApiToken(token) {
  await chrome.storage.local.set({ [API_TOKEN_KEY]: String(token || "").trim() });
}

async function authHeaders(extra) {
  const headers = new Headers(extra || {});
  const token = await getApiToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function apiFetch(baseUrl, path, init = {}) {
  const headers = await authHeaders(init.headers);
  if (
    init.body != null &&
    typeof init.body === "string" &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  return res;
}

function mapServerProfile(p) {
  return {
    id: p.id,
    name: p.name || "",
    model: p.model || "gpt-5.4-mini",
    text: p.profile_text || "",
    profile_text: p.profile_text || "",
  };
}

async function fetchMyProfiles(baseUrl) {
  const res = await apiFetch(baseUrl, "/api/me/profiles");
  if (res.status === 401) {
    throw new Error("Invalid or expired API token — check Settings");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data.map(mapServerProfile) : [];
}

async function syncServerProfiles(baseUrl) {
  const profiles = await fetchMyProfiles(baseUrl);
  await chrome.storage.local.set({ [SERVER_PROFILES_KEY]: profiles });
  return profiles;
}

async function getServerProfiles() {
  const r = await chrome.storage.local.get(SERVER_PROFILES_KEY);
  const list = r[SERVER_PROFILES_KEY];
  return Array.isArray(list) ? list : [];
}

async function fetchMyGenerations(baseUrl, page = 1, pageSize = 20) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  const res = await apiFetch(baseUrl, `/api/me/generations?${params}`);
  if (res.status === 401) {
    throw new Error("Invalid or expired API token");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

async function verifyToken(baseUrl) {
  const res = await apiFetch(baseUrl, "/api/me");
  if (!res.ok) return null;
  return res.json();
}

globalThis.ResumeAuth = {
  API_TOKEN_KEY,
  SERVER_PROFILES_KEY,
  getApiToken,
  setApiToken,
  apiFetch,
  fetchMyProfiles,
  syncServerProfiles,
  getServerProfiles,
  fetchMyGenerations,
  verifyToken,
  mapServerProfile,
};
