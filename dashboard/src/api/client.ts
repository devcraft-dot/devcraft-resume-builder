import type {
  ApplicationScreenshotList,
  DashboardAnalytics,
  Generation,
  GenerationList,
} from "./types";

const BASE = import.meta.env.VITE_API_URL || "";

const TOKEN_KEY = "rb_access_token";

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setStoredToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export type AuthConfig = { auth_required: boolean };

export async function fetchAuthConfig(): Promise<AuthConfig> {
  const res = await fetch(`${BASE}/api/auth/config`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export type MeResponse = {
  email: string;
  is_admin: boolean;
  generation_count: number;
};

export async function fetchMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/me");
}

export async function postLogin(email: string, password: string): Promise<{ access_token: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text().catch(() => res.statusText);
  if (!res.ok) throw new Error(text || res.statusText);
  return JSON.parse(text);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  const tok = getStoredToken();
  if (tok) headers.set("Authorization", `Bearer ${tok}`);
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
