/**
 * JWT auth (username/password login) + authenticated fetch for Resume Builder extensions.
 */
const ACCESS_TOKEN_KEY = "apiToken";
const USERNAME_PREF_KEY = "resumeAuthUsername";
const SERVER_PROFILES_KEY = "serverProfiles";

async function getAccessToken() {
  const r = await chrome.storage.local.get(ACCESS_TOKEN_KEY);
  return String(r[ACCESS_TOKEN_KEY] || "").trim();
}

async function setAccessToken(token) {
  await chrome.storage.local.set({
    [ACCESS_TOKEN_KEY]: String(token || "").trim(),
  });
}

async function getSavedUsername() {
  const r = await chrome.storage.local.get(USERNAME_PREF_KEY);
  return String(r[USERNAME_PREF_KEY] || "").trim();
}

async function setSavedUsername(username) {
  await chrome.storage.local.set({
    [USERNAME_PREF_KEY]: String(username || "").trim().toLowerCase(),
  });
}

async function authHeaders(extra) {
  const headers = new Headers(extra || {});
  const token = await getAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("X-Resume-Auth", token);
  }
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
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function parseLoginError(text) {
  try {
    const j = JSON.parse(text);
    if (typeof j.detail === "string") return j.detail;
  } catch {
    /* */
  }
  return text?.slice(0, 500) || "Sign-in failed";
}

async function login(baseUrl, username, password) {
  const u = String(username || "").trim().toLowerCase();
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: String(password || "") }),
  });
  const text = await res.text().catch(() => res.statusText);
  if (!res.ok) {
    throw new Error(parseLoginError(text));
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid response from server");
  }
  if (!data?.access_token) {
    throw new Error("Invalid response from server");
  }
  await setAccessToken(data.access_token);
  if (u) await setSavedUsername(u);
  return data.user || null;
}

async function signOut() {
  await setAccessToken("");
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
    throw new Error("Session expired — sign in again under Account");
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
    throw new Error("Session expired — sign in again");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

globalThis.ResumeAuth = {
  ACCESS_TOKEN_KEY,
  USERNAME_PREF_KEY,
  SERVER_PROFILES_KEY,
  getAccessToken,
  setAccessToken,
  getApiToken: getAccessToken,
  setApiToken: setAccessToken,
  getSavedUsername,
  login,
  signOut,
  apiFetch,
  fetchMyProfiles,
  syncServerProfiles,
  getServerProfiles,
  fetchMyGenerations,
  mapServerProfile,
};
