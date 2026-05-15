import { getToken, onUnauthorized, setToken } from "../auth";
import type {
  AssignedProfile,
  DashboardAnalytics,
  Generation,
  GenerationList,
  MeUser,
  RegisteredProfile,
  RegisteredProfileSummary,
  User,
} from "./types";

const BASE = import.meta.env.VITE_API_URL || "";

async function parseErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => res.statusText);
  try {
    const j = JSON.parse(text) as { detail?: unknown };
    if (typeof j.detail === "string") return j.detail;
    if (Array.isArray(j.detail)) {
      const parts = j.detail.map((x: { msg?: string }) => x?.msg).filter(Boolean);
      if (parts.length) return parts.join("; ");
    }
  } catch {
    /* */
  }
  return `${res.status}: ${text}`;
}

export async function login(username: string, password: string): Promise<MeUser> {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }
  const data = (await res.json()) as {
    access_token: string;
    token_type?: string;
    user: MeUser;
  };
  setToken(data.access_token);
  return data.user;
}

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
  username: string;
  password: string;
  display_name: string;
  role: "admin" | "user";
}) {
  return request<User>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function patchAdminUser(
  id: number,
  data: Partial<
    Pick<User, "display_name" | "is_active" | "role"> & { password?: string }
  >,
) {
  return request<User>(`/api/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function setAdminUserPassword(id: number, password: string) {
  return request<User>(`/api/admin/users/${id}/set-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
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
