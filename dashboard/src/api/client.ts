import { getToken, onUnauthorized } from "../auth";
import type {
  ApplicationScreenshotList,
  AssignedProfile,
  DashboardAnalytics,
  Generation,
  GenerationList,
  MeUser,
  RegisteredProfile,
  RegisteredProfileSummary,
  TokenRotateResponse,
  User,
  UserCreateResponse,
} from "./types";

const BASE = import.meta.env.VITE_API_URL || "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  if (
    init?.body != null &&
    typeof init.body === "string" &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    /* Some hosts/proxies mishandle Authorization on cross-origin SPA requests. */
    headers.set("X-Resume-Auth", token);
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    method,
    headers,
  });
  if (res.status === 401) {
    onUnauthorized();
    throw new Error("Unauthorized — please sign in again");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function fetchMe() {
  return request<MeUser>("/api/me");
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

export function fetchAdminUsers() {
  return request<User[]>("/api/admin/users");
}

export function createAdminUser(data: {
  display_name: string;
  role: "admin" | "user";
}) {
  return request<UserCreateResponse>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function patchAdminUser(
  id: number,
  data: Partial<Pick<User, "display_name" | "is_active" | "role">>,
) {
  return request<User>(`/api/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function rotateAdminUserToken(id: number) {
  return request<TokenRotateResponse>(`/api/admin/users/${id}/rotate-token`, {
    method: "POST",
  });
}

export function setAdminUserProfiles(id: number, profileIds: number[]) {
  return request<User>(`/api/admin/users/${id}/profiles`, {
    method: "PUT",
    body: JSON.stringify({ profile_ids: profileIds }),
  });
}

export function fetchAdminProfiles() {
  return request<RegisteredProfileSummary[]>("/api/admin/profiles");
}

export function fetchAdminProfile(id: number) {
  return request<RegisteredProfile>(`/api/admin/profiles/${id}`);
}

export function createAdminProfile(data: {
  name: string;
  model: string;
  profile_text: string;
}) {
  return request<RegisteredProfile>("/api/admin/profiles", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function patchAdminProfile(
  id: number,
  data: Partial<{ name: string; model: string; profile_text: string }>,
) {
  return request<RegisteredProfile>(`/api/admin/profiles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteAdminProfile(id: number) {
  return request<void>(`/api/admin/profiles/${id}`, { method: "DELETE" });
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

export type { AssignedProfile };
