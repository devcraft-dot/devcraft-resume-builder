import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  deleteGeneration,
  driveExportUrl,
  fetchAdminUsers,
  fetchGenerations,
  patchGeneration,
} from "./api/client";
import type { Generation, GenerationSnip, User } from "./api/types";
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
        className="cursor-pointer hover:bg-violet-50/80 px-1 rounded-lg block text-sm leading-snug line-clamp-2 break-words"
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
      className="border border-violet-300 rounded-xl px-2 py-1 text-sm w-full min-w-0 outline-none focus:ring-2 focus:ring-violet-400/50"
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

/** Large tap target + centered label for the files grid. */
function FileFormatLink({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-10 min-w-[3.5rem] items-center justify-center rounded-lg border border-transparent px-2.5 text-base font-semibold text-blue-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-900"
      title={title}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  );
}

const FILES_GRID =
  "grid grid-cols-[minmax(5.5rem,7rem)_minmax(3.25rem,1fr)_minmax(3.25rem,1fr)_minmax(3.25rem,1fr)] gap-x-2 gap-y-1";

/** Controlled menu; panel is portaled + fixed so later table rows don’t paint over it. */
function FilesMenu({
  row,
  isOpen,
  onToggle,
  onClose,
}: {
  row: Generation;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState({
    top: 0,
    left: 0,
    width: 352,
  });

  const hasAny =
    row.resume_drive_url || row.questions_drive_url || row.jd_drive_url;
  if (!hasAny) return <span className="text-gray-300">—</span>;

  const updatePanelPosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = Math.min(352, Math.max(280, window.innerWidth - 24));
    let left = rect.left;
    if (left + width > window.innerWidth - 12) {
      left = window.innerWidth - 12 - width;
    }
    if (left < 12) left = 12;
    const top = rect.bottom + 8;
    setPanelPos({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePanelPosition();
    const el = panelRef.current;
    const ro =
      el && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updatePanelPosition())
        : null;
    if (el && ro) ro.observe(el);
    window.addEventListener("resize", updatePanelPosition);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", updatePanelPosition);
    };
  }, [isOpen, updatePanelPosition, row.id]);

  useEffect(() => {
    if (!isOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onScrollCapture() {
      onClose();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScrollCapture, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScrollCapture, true);
    };
  }, [isOpen, onClose]);

  const fileRow = (kind: string, url: string | undefined) => {
    if (!url) return null;
    return (
      <div className={`${FILES_GRID} items-center border-b border-gray-100 py-2.5 last:border-b-0`}>
        <span className="text-sm font-semibold text-gray-900">{kind}</span>
        <div className="flex justify-center">
          <FileFormatLink href={url} title={`Open ${kind} in Google Docs`}>
            Doc
          </FileFormatLink>
        </div>
        <div className="flex justify-center">
          <FileFormatLink
            href={driveExportUrl(url, "pdf")}
            title={`Download ${kind} as PDF`}
          >
            PDF
          </FileFormatLink>
        </div>
        <div className="flex justify-center">
          <FileFormatLink
            href={driveExportUrl(url, "docx")}
            title={`Download ${kind} as Word`}
          >
            Docx
          </FileFormatLink>
        </div>
      </div>
    );
  };

  const panel = isOpen ? (
    <div
      ref={panelRef}
      id={`files-menu-${row.id}`}
      role="menu"
      aria-labelledby={`files-trigger-${row.id}`}
      style={{
        position: "fixed",
        top: panelPos.top,
        left: panelPos.left,
        width: panelPos.width,
        zIndex: 9999,
      }}
      className="max-h-[min(70vh,calc(100dvh-2rem))] overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 text-base shadow-xl ring-1 ring-gray-900/10"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={`${FILES_GRID} border-b border-gray-200 pb-2 text-sm font-bold uppercase tracking-wide text-gray-600`}
      >
        <span className="pl-0.5">Document</span>
        <span className="text-center">Doc</span>
        <span className="text-center">PDF</span>
        <span className="text-center">Docx</span>
      </div>
      {fileRow("Resume", row.resume_drive_url)}
      {fileRow("Q&A", row.questions_drive_url)}
      {fileRow("JD", row.jd_drive_url)}
    </div>
  ) : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-controls={`files-menu-${row.id}`}
        id={`files-trigger-${row.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`w-full max-w-full rounded-md border px-3 py-2 text-sm font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
          isOpen
            ? "border-blue-300 bg-blue-50 text-blue-900"
            : "border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100"
        }`}
      >
        Files
      </button>
      {panel ? createPortal(panel, document.body) : null}
    </div>
  );
}

/** Application snips linked to this generation (Manual JD uploads). */
function SnipsMenu({
  row,
  isOpen,
  onToggle,
  onClose,
}: {
  row: Generation;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 320 });

  const snips: GenerationSnip[] = row.application_snips ?? [];
  if (!snips.length) return <span className="text-gray-300">—</span>;

  const updatePanelPosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = Math.min(320, Math.max(260, window.innerWidth - 24));
    let left = rect.left;
    if (left + width > window.innerWidth - 12) {
      left = window.innerWidth - 12 - width;
    }
    if (left < 12) left = 12;
    setPanelPos({ top: rect.bottom + 8, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    return () => window.removeEventListener("resize", updatePanelPosition);
  }, [isOpen, updatePanelPosition, row.id]);

  useEffect(() => {
    if (!isOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  const panel = isOpen ? (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: panelPos.top,
        left: panelPos.left,
        width: panelPos.width,
        zIndex: 9999,
      }}
      className="max-h-[min(70vh,calc(100dvh-2rem))] overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 text-sm shadow-xl ring-1 ring-gray-900/10"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
        Application snips ({snips.length})
      </p>
      <div className="grid gap-3">
        {snips.map((s) => (
          <a
            key={s.id}
            href={s.drive_url}
            target="_blank"
            rel="noreferrer"
            className="flex gap-2 rounded-lg border border-gray-100 p-2 hover:bg-gray-50"
          >
            {s.thumbnail_url ? (
              <img
                src={s.thumbnail_url}
                alt=""
                className="h-14 w-20 shrink-0 rounded object-cover bg-gray-100"
              />
            ) : (
              <div className="h-14 w-20 shrink-0 rounded bg-gray-100" />
            )}
            <span className="min-w-0 text-xs text-gray-700 break-words">
              {new Date(s.created_at).toLocaleString()}
              <br />
              <span className="font-medium text-gray-900">{s.filename}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`w-full max-w-full rounded-md border px-2 py-2 text-xs font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
          isOpen
            ? "border-violet-300 bg-violet-50 text-violet-900"
            : "border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100"
        }`}
      >
        Snips ({snips.length})
      </button>
      {panel ? createPortal(panel, document.body) : null}
    </div>
  );
}

function JdLink({ url }: { url: string }) {
  if (!url) return <span className="text-gray-300">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex text-violet-600 hover:text-violet-800"
      title="Open job posting"
      onClick={(e) => e.stopPropagation()}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
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
  const [userFilterId, setUserFilterId] = useState<number | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** Only one Files menu open at a time (avoids stacked popovers). */
  const [openFilesRowId, setOpenFilesRowId] = useState<number | null>(null);
  const [openSnipsRowId, setOpenSnipsRowId] = useState<number | null>(null);
  const closeFilesMenu = useCallback(() => setOpenFilesRowId(null), []);
  const closeSnipsMenu = useCallback(() => setOpenSnipsRowId(null), []);
  const toggleFilesMenu = useCallback((id: number) => {
    setOpenSnipsRowId(null);
    setOpenFilesRowId((cur) => (cur === id ? null : id));
  }, []);
  const toggleSnipsMenu = useCallback((id: number) => {
    setOpenFilesRowId(null);
    setOpenSnipsRowId((cur) => (cur === id ? null : id));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchGenerations(
        page,
        PAGE_SIZE,
        search,
        stageFilter,
        userFilterId,
      );
      setRows(data.items);
      setPages(data.pages);
      setTotal(data.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [page, search, stageFilter, userFilterId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [stageFilter]);

  useEffect(() => {
    fetchAdminUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  const userFilterLabel =
    userFilterId != null
      ? users.find((u) => u.id === userFilterId)?.username ??
        rows.find((r) => r.user_id === userFilterId)?.generated_by_username ??
        `User #${userFilterId}`
      : null;

  useEffect(() => {
    if (
      openFilesRowId != null &&
      !rows.some((r) => r.id === openFilesRowId)
    ) {
      setOpenFilesRowId(null);
    }
    if (
      openSnipsRowId != null &&
      !rows.some((r) => r.id === openSnipsRowId)
    ) {
      setOpenSnipsRowId(null);
    }
  }, [rows, openFilesRowId, openSnipsRowId]);

  async function handlePatch(
    id: number,
    field: keyof Generation | "stage",
    value: string | boolean,
  ) {
    try {
      const updated = await patchGeneration(id, { [field]: value } as Partial<Generation>);
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl bg-white/90 p-4 shadow-lg shadow-slate-900/5 ring-1 ring-slate-200/80 backdrop-blur-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search title or company…"
            className="dash-input w-full max-w-xs sm:w-60"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            className="dash-input w-full max-w-[11rem] sm:w-44"
            value={userFilterId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setUserFilterId(v === "" ? null : Number(v));
              setPage(1);
            }}
            title="Filter by user"
          >
            <option value="">All users</option>
            {users
              .slice()
              .sort((a, b) => a.username.localeCompare(b.username))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                  {u.display_name && u.display_name !== u.username
                    ? ` (${u.display_name})`
                    : ""}
                </option>
              ))}
          </select>
          {stageFilter ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-900">
              Stage: {stageFilter}
              <button
                type="button"
                className="ml-0.5 rounded-full p-0.5 text-violet-700 transition hover:bg-violet-200/80"
                title="Clear stage filter"
                onClick={() => onClearStageFilter?.()}
              >
                ×
              </button>
            </span>
          ) : null}
          {userFilterId != null ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-800">
              User: {userFilterLabel}
              <button
                type="button"
                className="ml-0.5 rounded-full p-0.5 text-slate-600 transition hover:bg-slate-200/80"
                title="Clear user filter"
                onClick={() => {
                  setUserFilterId(null);
                  setPage(1);
                }}
              >
                ×
              </button>
            </span>
          ) : null}
          <span className="text-sm font-medium tabular-nums text-slate-500">
            {total} result{total !== 1 ? "s" : ""}
          </span>
          {loading && (
            <span className="inline-flex items-center gap-2 text-sm font-medium text-violet-600">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
              Loading…
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="dash-btn shrink-0"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      <div className="overflow-visible rounded-2xl bg-white/95 shadow-xl shadow-slate-900/5 ring-1 ring-slate-200/80 backdrop-blur-sm">
        <table className="w-full table-fixed border-collapse text-left text-sm leading-normal">
          <colgroup>
            <col className="w-[96px]" />
            <col className="w-[100px]" />
            <col className="w-[100px]" />
            <col className="w-[112px]" />
            <col className="w-[22%]" />
            <col className="w-[16%]" />
            <col className="w-[80px]" />
            <col className="w-[18%]" />
            <col className="w-[40px]" />
            <col className="w-[96px]" />
            <col className="w-[88px]" />
            <col className="w-[56px]" />
            <col className="w-[140px]" />
            <col className="w-[40px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200/90 bg-slate-50/95 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">User</th>
              <th className="px-3 py-3">Profile</th>
              <th className="px-3 py-3">Stage</th>
              <th className="px-3 py-3">Title</th>
              <th className="px-3 py-3">Company</th>
              <th className="px-3 py-3">Salary</th>
              <th className="px-3 py-3">Note</th>
              <th className="px-2 py-3 text-center" title="Job posting">
                JD
              </th>
              <th className="px-2 py-3">Files</th>
              <th className="px-2 py-3">Snips</th>
              <th className="px-2 py-3 text-center" title="Admin reviewed">
                OK
              </th>
              <th className="px-2 py-3">Model</th>
              <th className="px-1 py-3" aria-label="Delete" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {rows.map((row) => (
              <tr key={row.id} className="align-top transition hover:bg-violet-50/40">
                <td className="px-3 py-2.5 whitespace-nowrap text-sm text-slate-500">
                  {formatDate(row.created_at)}
                </td>
                <td
                  className="px-3 py-2.5 text-xs font-mono text-gray-800 truncate"
                  title={row.generated_by_username || ""}
                >
                  {row.generated_by_username || "—"}
                </td>
                <td
                  className="px-3 py-2.5 text-sm font-medium truncate"
                  title={row.profile_name}
                >
                  {row.profile_name}
                </td>
                <td className="px-2 py-2.5">
                  <select
                    value={row.stage}
                    onChange={(e) =>
                      handlePatch(row.id, "stage", e.target.value)
                    }
                    className={`w-full max-w-full cursor-pointer rounded-lg border-0 px-2 py-1.5 text-xs font-semibold shadow-sm transition focus:ring-2 focus:ring-violet-400/50 focus:ring-offset-0 ${STAGE_COLORS[row.stage] || "bg-slate-100 text-slate-700"}`}
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2.5 min-w-0">
                  <EditableCell
                    value={row.title}
                    onSave={(v) => handlePatch(row.id, "title", v)}
                  />
                </td>
                <td className="px-3 py-2.5 min-w-0">
                  <EditableCell
                    value={row.company_name}
                    onSave={(v) => handlePatch(row.id, "company_name", v)}
                  />
                </td>
                <td
                  className="px-2 py-2.5 min-w-0 text-sm"
                  title={row.salary_range}
                >
                  <EditableCell
                    value={row.salary_range}
                    onSave={(v) => handlePatch(row.id, "salary_range", v)}
                  />
                </td>
                <td className="px-3 py-2.5 min-w-0">
                  <EditableCell
                    value={row.note}
                    onSave={(v) => handlePatch(row.id, "note", v)}
                  />
                </td>
                <td className="px-1 py-2.5 text-center align-middle">
                  <JdLink url={row.url} />
                </td>
                <td className="px-2 py-2.5 min-w-0 align-middle">
                  <FilesMenu
                    row={row}
                    isOpen={openFilesRowId === row.id}
                    onToggle={() => toggleFilesMenu(row.id)}
                    onClose={closeFilesMenu}
                  />
                </td>
                <td className="px-2 py-2.5 min-w-0 align-middle">
                  <SnipsMenu
                    row={row}
                    isOpen={openSnipsRowId === row.id}
                    onToggle={() => toggleSnipsMenu(row.id)}
                    onClose={closeSnipsMenu}
                  />
                </td>
                <td className="px-2 py-2.5 text-center align-middle">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500/40"
                    checked={!!row.admin_checked}
                    title="Admin checked"
                    onChange={(e) =>
                      void handlePatch(row.id, "admin_checked", e.target.checked)
                    }
                  />
                </td>
                <td
                  className="px-2 py-2.5 text-xs font-mono text-gray-700 leading-snug break-words hyphens-auto min-w-0"
                  title={row.model_name}
                >
                  {row.model_name}
                </td>
                <td className="px-1 py-2.5 text-center align-middle">
                  <button
                    type="button"
                    onClick={() => handleDelete(row.id)}
                    className="text-gray-400 hover:text-red-600 transition rounded p-1"
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
                  colSpan={14}
                  className="text-center py-12 text-sm font-medium text-slate-400"
                >
                  No generations found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3 text-sm shadow-sm">
          <span className="font-medium text-slate-500">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="dash-btn px-4 py-2 text-sm disabled:pointer-events-none disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="dash-btn px-4 py-2 text-sm disabled:pointer-events-none disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
