import { useCallback, useEffect, useState } from "react";
import {
  deleteGeneration,
  driveExportUrl,
  fetchGenerations,
  patchGeneration,
} from "./api/client";
import type { Generation } from "./api/types";
import { STAGES } from "./api/types";

const PAGE_SIZE = 20;

const STAGE_COLORS: Record<string, string> = {
  generated: "bg-gray-100 text-gray-700",
  intro: "bg-blue-100 text-blue-700",
  tech: "bg-purple-100 text-purple-700",
  final: "bg-amber-100 text-amber-700",
  success: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}


/* ─── Inline-editable text cell ─────────────────────────────────────── */

function EditableCell({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <span
        className="cursor-pointer hover:bg-gray-100 px-1 -mx-1 rounded"
        onDoubleClick={() => setEditing(true)}
        title="Double-click to edit"
      >
        {value || "—"}
      </span>
    );
  }

  return (
    <input
      autoFocus
      className="border border-blue-400 rounded px-1.5 py-0.5 text-sm w-full outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft.trim() !== value) onSave(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}

/* ─── Download button for Drive files ───────────────────────────────── */

function DownloadBtn({ url, label }: { url: string; label: string }) {
  if (!url) return <span className="text-gray-300">—</span>;

  return (
    <span className="inline-flex items-center gap-1.5">
      <a
        href={driveExportUrl(url, "pdf")}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 transition"
        title={`Download ${label} as PDF`}
      >
        PDF
      </a>
      <a
        href={driveExportUrl(url, "docx")}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition"
        title={`Download ${label} as DOCX`}
      >
        DOCX
      </a>
    </span>
  );
}

function LinkBtn({ url }: { url: string }) {
  if (!url) return <span className="text-gray-300">—</span>;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
      title={url}
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
        <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
      </svg>
      Open
    </a>
  );
}

/* ─── Main Dashboard ────────────────────────────────────────────────── */

export function Dashboard() {
  const [rows, setRows] = useState<Generation[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchGenerations(page, PAGE_SIZE, search);
      setRows(data.items);
      setPages(data.pages);
      setTotal(data.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePatch(id: number, field: string, value: string) {
    try {
      const updated = await patchGeneration(id, { [field]: value });
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this generation?")) return;
    try {
      await deleteGeneration(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      setTotal((t) => t - 1);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search title or company…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <span className="text-sm text-gray-500">
          {total} result{total !== 1 ? "s" : ""}
        </span>
        {loading && (
          <span className="text-sm text-blue-500 animate-pulse">
            Loading…
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Profile</th>
              <th className="px-3 py-3">Stage</th>
              <th className="px-3 py-3">Title</th>
              <th className="px-3 py-3">Company</th>
              <th className="px-3 py-3">Salary</th>
              <th className="px-3 py-3">JD Link</th>
              <th className="px-3 py-3">Resume</th>
              <th className="px-3 py-3">Q&A</th>
              <th className="px-3 py-3">JD File</th>
              <th className="px-3 py-3">Model</th>
              <th className="px-3 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50 transition">
                {/* Date */}
                <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                  {formatDate(row.created_at)}
                </td>

                {/* Profile */}
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {row.profile_name}
                </td>

                {/* Stage (dropdown) */}
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <select
                    value={row.stage}
                    onChange={(e) =>
                      handlePatch(row.id, "stage", e.target.value)
                    }
                    className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer focus:ring-2 focus:ring-blue-400 ${STAGE_COLORS[row.stage] || "bg-gray-100 text-gray-700"}`}
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>

                {/* Title */}
                <td className="px-3 py-2.5 min-w-[140px] max-w-[220px]">
                  <div className="line-clamp-2">
                    <EditableCell
                      value={row.title}
                      onSave={(v) => handlePatch(row.id, "title", v)}
                    />
                  </div>
                </td>

                {/* Company (editable) */}
                <td className="px-3 py-2.5 min-w-[100px] max-w-[160px]">
                  <div className="line-clamp-2">
                    <EditableCell
                      value={row.company_name}
                      onSave={(v) => handlePatch(row.id, "company_name", v)}
                    />
                  </div>
                </td>

                {/* Salary (editable) */}
                <td className="px-3 py-2.5 min-w-[90px] max-w-[140px]">
                  <div className="line-clamp-2">
                    <EditableCell
                      value={row.salary_range}
                      onSave={(v) => handlePatch(row.id, "salary_range", v)}
                    />
                  </div>
                </td>

                {/* URL link */}
                <td className="px-3 py-2.5">
                  <LinkBtn url={row.url} />
                </td>

                {/* Resume download */}
                <td className="px-3 py-2.5">
                  <DownloadBtn url={row.resume_drive_url} label="Resume" />
                </td>

                {/* Q&A download */}
                <td className="px-3 py-2.5">
                  <DownloadBtn url={row.questions_drive_url} label="Q&A" />
                </td>

                {/* JD file download */}
                <td className="px-3 py-2.5">
                  <DownloadBtn url={row.jd_drive_url} label="JD" />
                </td>

                {/* Model */}
                <td className="px-3 py-2.5 whitespace-nowrap text-gray-500 text-xs">
                  {row.model_name}
                </td>

                {/* Delete */}
                <td className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => handleDelete(row.id)}
                    className="text-gray-400 hover:text-red-600 transition"
                    title="Delete"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={12}
                  className="text-center py-12 text-gray-400 text-sm"
                >
                  No generations found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Previous
            </button>
            <button
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
