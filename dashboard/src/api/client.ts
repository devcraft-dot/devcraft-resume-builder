import type {
  ApplicationScreenshotList,
  DashboardAnalytics,
  Generation,
  GenerationList,
  RegisteredProfile,
} from "./types";

/** Normalized API origin from Vite env (no trailing slash). Empty = same-origin (dev proxy or static host). */
export function getApiOrigin(): string {
  return (import.meta.env.VITE_API_URL || "").trim().replace(/\/$/, "");
}

const BASE = getApiOrigin();

const ADMIN_KEY_KEY = "rb_admin_api_key";
const EXTENSION_TOKEN_KEY = "rb_extension_token";
const DASHBOARD_MODE_KEY = "rb_dashboard_mode";

export type DashboardAuthMode = "admin" | "extension";

function formatNetworkError(cause: unknown): Error {
  const devNoBase =
    import.meta.env.DEV &&
    !BASE &&
    " Leave VITE_API_URL unset and run `npm run dev` — /api is proxied to VITE_API_PROXY_TARGET (default http://127.0.0.1:8000). Start uvicorn there.";
  const prodNoBase =
    import.meta.env.PROD &&
    !BASE &&
    " Rebuild the dashboard with VITE_API_URL set to your API origin (e.g. https://your-api.vercel.app).";
  const baseHint = BASE
    ? ` Request URL base: ${BASE}. Check CORS, SSL, and that the server is up.`
    : import.meta.env.DEV
      ? devNoBase
      : prodNoBase;
  const inner = cause instanceof Error ? cause.message : String(cause);
  return new Error(`Cannot reach the API (${inner}).${baseHint}`);
}

export function getDashboardAuthMode(): DashboardAuthMode | null {
  const mode = localStorage.getItem(DASHBOARD_MODE_KEY);
  const admin = (localStorage.getItem(ADMIN_KEY_KEY) || "").trim();
  const ext = (localStorage.getItem(EXTENSION_TOKEN_KEY) || "").trim();
  if (mode === "extension" && ext) return "extension";
  if (mode === "admin" && admin) return "admin";
  // Legacy: admin key saved before mode existed
  if (!mode && admin) return "admin";
  if (!mode && ext) return "extension";
  return null;
}

export function getStoredAdminKey(): string {
  return localStorage.getItem(ADMIN_KEY_KEY) || "";
}

export function getStoredExtensionToken(): string {
  return localStorage.getItem(EXTENSION_TOKEN_KEY) || "";
}

/** Admin path: X-Admin-Key only. Extension path: Bearer only (different users see different rows). */
export function setDashboardAdminSession(adminApiKey: string | null): void {
  const k = (adminApiKey || "").trim();
  if (k) {
    localStorage.setItem(DASHBOARD_MODE_KEY, "admin");
    localStorage.setItem(ADMIN_KEY_KEY, k);
    localStorage.removeItem(EXTENSION_TOKEN_KEY);
  } else {
    localStorage.removeItem(ADMIN_KEY_KEY);
    if (localStorage.getItem(DASHBOARD_MODE_KEY) === "admin") {
      localStorage.removeItem(DASHBOARD_MODE_KEY);
    }
  }
}

export function setDashboardExtensionSession(accessToken: string | null): void {
  const t = (accessToken || "").trim();
  if (t) {
    localStorage.setItem(DASHBOARD_MODE_KEY, "extension");
    localStorage.setItem(EXTENSION_TOKEN_KEY, t);
    localStorage.removeItem(ADMIN_KEY_KEY);
  } else {
    localStorage.removeItem(EXTENSION_TOKEN_KEY);
    if (localStorage.getItem(DASHBOARD_MODE_KEY) === "extension") {
      localStorage.removeItem(DASHBOARD_MODE_KEY);
    }
  }
}

export function clearDashboardSession(): void {
  localStorage.removeItem(ADMIN_KEY_KEY);
  localStorage.removeItem(EXTENSION_TOKEN_KEY);
  localStorage.removeItem(DASHBOARD_MODE_KEY);
}

function applyDashboardAuth(headers: Headers): void {
  const mode = getDashboardAuthMode();
  if (mode === "extension") {
    const t = getStoredExtensionToken().trim();
    if (t) headers.set("Authorization", `Bearer ${t}`);
    return;
  }
  const adm = getStoredAdminKey().trim();
  if (adm) headers.set("X-Admin-Key", adm);
}

export type AuthConfig = { auth_required: boolean };

export async function fetchAuthConfig(): Promise<AuthConfig> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/auth/config`);
  } catch (e) {
    throw formatNetworkError(e);
  }
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export type WhoAmIResponse = {
  username: string;
  profile_names: string[];
};

export async function fetchAuthWhoami(): Promise<WhoAmIResponse> {
  return request<WhoAmIResponse>("/api/auth/whoami");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  applyDashboardAuth(headers);
  if (
    init?.body != null &&
    typeof init.body === "string" &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      method,
      headers,
    });
  } catch (e) {
    throw formatNetworkError(e);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function fetchDashboardAnalytics() {
  return request<DashboardAnalytics>("/api/dashboard/analytics");
}

export function fetchApplicationScreenshots(page: number, pageSize: number) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  return request<ApplicationScreenshotList>(
    `/api/application-screenshots?${params}`,
  );
}

export function fetchGenerations(
  page: number,
  pageSize: number,
  q?: string,
  stage?: string | null,
) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (q?.trim()) params.set("q", q.trim());
  if (stage?.trim()) params.set("stage", stage.trim());
  return request<GenerationList>(`/api/generations?${params}`);
}

export function patchGeneration(id: number, data: Partial<Generation>) {
  return request<Generation>(`/api/generations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteGeneration(id: number) {
  return request<void>(`/api/generations/${id}`, { method: "DELETE" });
}

export function fetchRegisteredProfiles() {
  return request<RegisteredProfile[]>("/api/admin/registered-profiles");
}

export function createRegisteredProfile(body: {
  name: string;
  profile_text: string;
}) {
  return request<RegisteredProfile>("/api/admin/registered-profiles", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchRegisteredProfile(
  id: number,
  body: Partial<{ name: string; profile_text: string }>,
) {
  return request<RegisteredProfile>(`/api/admin/registered-profiles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteRegisteredProfile(id: number) {
  return request<void>(`/api/admin/registered-profiles/${id}`, {
    method: "DELETE",
  });
}

export function extractDriveFileId(url: string): string | null {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export function driveExportUrl(driveUrl: string, format: "pdf" | "docx") {
  const id = extractDriveFileId(driveUrl);
  if (!id) return driveUrl;
  const mime =
    format === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return `https://docs.google.com/document/d/${id}/export?formatType=compiled&format=${format}&mimeType=${encodeURIComponent(mime)}`;
}
