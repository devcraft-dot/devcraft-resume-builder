import type { DashboardAnalytics, Generation, GenerationList } from "./types";

const BASE = import.meta.env.VITE_API_URL || "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
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
