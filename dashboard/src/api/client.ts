import type {
  ApplicationScreenshotList,
  DashboardAnalytics,
  Generation,
  GenerationList,
  RegisteredProfile,
} from "./types";

const BASE = import.meta.env.VITE_API_URL || "";

const ADMIN_KEY_KEY = "rb_admin_api_key";

export function getStoredAdminKey(): string {
  return localStorage.getItem(ADMIN_KEY_KEY) || "";
}

export function setStoredAdminKey(key: string | null): void {
  if (key) localStorage.setItem(ADMIN_KEY_KEY, key);
  else localStorage.removeItem(ADMIN_KEY_KEY);
}

export type AuthConfig = { auth_required: boolean };

export async function fetchAuthConfig(): Promise<AuthConfig> {
  const res = await fetch(`${BASE}/api/auth/config`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  const adm = getStoredAdminKey();
  if (adm) headers.set("X-Admin-Key", adm);
  if (
    init?.body != null &&
    typeof init.body === "string" &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    method,
    headers,
  });
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
