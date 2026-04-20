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

type DashboardProps = {
  stageFilter?: string | null;
  onClearStageFilter?: () => void;
};

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
        className="cursor-pointer hover:bg-gray-100 px-0.5 rounded block truncate"
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
      className="border border-blue-400 rounded px-1 py-0.5 text-xs w-full min-w-0 outline-none"
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

function TinyLink({
  href,
  label,
  title,
}: {
  href: string;
  label: string;
  title: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 hover:underline font-medium"
      title={title}
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </a>
  );
}

/** One column: resume + Q&A + JD links (replaces three wide FileBtn columns). */
function FilesMenu({ row }: { row: Generation }) {
  const hasAny =
    row.resume_drive_url || row.questions_drive_url || row.jd_drive_url;
  if (!hasAny) return <span className="text-gray-300">—</span>;

  const block = (
    label: string,
    url: string,
    short: string,
  ) => {
    if (!url) return null;
    return (
      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-gray-100 pb-1.5 mb-1.5 last:border-0 last:pb-0 last:mb-0">
        <span className="w-10 shrink-0 text-gray-500">{short}</span>
        <TinyLink href={url} label="Doc" title={`Open ${label} in Drive`} />
        <span className="text-gray-300">·</span>
        <TinyLink
          href={driveExportUrl(url, "pdf")}
          label="PDF"
          title={`${label} PDF`}
        />
        <span className="text-gray-300">·</span>
        <TinyLink
          href={driveExportUrl(url, "docx")}
          label="Docx"
          title={`${label} DOCX`}
        />
      </div>
    );
  };

  return (
    <details className="relative">
      <summary className="cursor-pointer select-none list-none rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-[10px] font-semibold text-gray-700 hover:bg-gray-100 max-w-full truncate [&::-webkit-details-marker]:hidden">
        Files
      </summary>
      <div
        className="absolute right-0 z-30 mt-0.5 min-w-[9.5rem] max-w-[12rem] rounded-md border border-gray-200 bg-white p-2 text-[10px] shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        {block("Resume", row.resume_drive_url, "CV")}
        {block("Q&A", row.questions_drive_url, "Q&A")}
        {block("JD", row.jd_drive_url, "JD")}
      </div>
    </details>
  );
}

function JdLink({ url }: { url: string }) {
  if (!url) return <span className="text-gray-300">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex text-blue-600 hover:text-blue-800"
      title="Open job posting"
      onClick={(e) => e.stopPropagation()}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
        <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
      </svg>
    </a>
  );
}

/* ─── Main Dashboard ────────────────────────────────────────────────── */

export function Dashboard({
  stageFilter = null,
  onClearStageFilter,
}: DashboardProps) {
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
      const data = await fetchGenerations(
        page,
        PAGE_SIZE,
        search,
        stageFilter,
      );
      setRows(data.items);
      setPages(data.pages);
      setTotal(data.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [page, search, stageFilter]);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search title or company…"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-60 max-w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {stageFilter ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-800 border border-indigo-200">
              Stage: {stageFilter}
              <button
                type="button"
                className="ml-1 rounded-full p-0.5 hover:bg-indigo-200 text-indigo-900"
                title="Clear stage filter"
                onClick={() => onClearStageFilter?.()}
              >
                ×
              </button>
            </span>
          ) : null}
          <span className="text-sm text-gray-500">
            {total} result{total !== 1 ? "s" : ""}
          </span>
          {loading && (
            <span className="text-sm text-blue-500 animate-pulse">
              Loading…
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 transition shrink-0"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full table-fixed text-xs text-left border-collapse">
          <colgroup>
            <col className="w-[76px]" />
            <col className="w-[72px]" />
            <col className="w-[92px]" />
            <col />
            <col className="w-[22%]" />
            <col className="w-[52px]" />
            <col className="w-[28px]" />
            <col className="w-[56px]" />
            <col className="w-[72px]" />
            <col className="w-[28px]" />
          </colgroup>
          <thead>
            <tr className="bg-gray-50 text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              <th className="px-1.5 py-2">Date</th>
              <th className="px-1.5 py-2">Profile</th>
              <th className="px-1.5 py-2">Stage</th>
              <th className="px-1.5 py-2">Title</th>
              <th className="px-1.5 py-2">Company</th>
              <th className="px-1.5 py-2">Sal</th>
              <th className="px-1 py-2 text-center" title="Job posting">
                JD
              </th>
              <th className="px-1 py-2">Files</th>
              <th className="px-1 py-2">Model</th>
              <th className="px-0.5 py-2 w-7" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50/80 align-top">
                <td className="px-1.5 py-1.5 whitespace-nowrap text-gray-600">
                  {formatDate(row.created_at)}
                </td>
                <td className="px-1.5 py-1.5 truncate" title={row.profile_name}>
                  {row.profile_name}
                </td>
                <td className="px-1 py-1.5">
                  <select
                    value={row.stage}
                    onChange={(e) =>
                      handlePatch(row.id, "stage", e.target.value)
                    }
                    className={`max-w-full truncate text-[10px] font-medium rounded-md px-1 py-0.5 border-0 cursor-pointer focus:ring-1 focus:ring-blue-400 ${STAGE_COLORS[row.stage] || "bg-gray-100 text-gray-700"}`}
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-1.5 py-1.5 min-w-0">
                  <EditableCell
                    value={row.title}
                    onSave={(v) => handlePatch(row.id, "title", v)}
                  />
                </td>
                <td className="px-1.5 py-1.5 min-w-0">
                  <EditableCell
                    value={row.company_name}
                    onSave={(v) => handlePatch(row.id, "company_name", v)}
                  />
                </td>
                <td className="px-1 py-1.5 min-w-0 truncate" title={row.salary_range}>
                  <EditableCell
                    value={row.salary_range}
                    onSave={(v) => handlePatch(row.id, "salary_range", v)}
                  />
                </td>
                <td className="px-0.5 py-1.5 text-center">
                  <JdLink url={row.url} />
                </td>
                <td className="px-1 py-1.5 min-w-0">
                  <FilesMenu row={row} />
                </td>
                <td
                  className="px-1 py-1.5 text-gray-500 truncate font-mono text-[10px]"
                  title={row.model_name}
                >
                  {row.model_name}
                </td>
                <td className="px-0.5 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => handleDelete(row.id)}
                    className="text-gray-400 hover:text-red-600 transition p-0.5"
                    title="Delete"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5"
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
                  colSpan={10}
                  className="text-center py-12 text-gray-400 text-sm"
                >
                  No generations found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Previous
            </button>
            <button
              type="button"
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
