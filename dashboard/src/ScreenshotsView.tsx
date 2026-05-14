import { useCallback, useEffect, useState } from "react";
import { fetchApplicationScreenshots } from "./api/client";
import type { ApplicationScreenshot } from "./api/types";

const PAGE_SIZE = 20;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ScreenshotsView() {
  const [items, setItems] = useState<ApplicationScreenshot[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchApplicationScreenshots(p, PAGE_SIZE);
      setItems(data.items);
      setTotal(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-600">
          Snips uploaded from the Manual JD extension (
          <strong>{total}</strong> total). Thumbnails load from Google when the
          file is shared publicly (same as Drive upload).
        </p>
        <button
          type="button"
          onClick={() => void load(page)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {err && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">
          No screenshots yet. Paste a snip in the extension side panel and click
          &quot;Upload to Drive&quot;.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-3 py-2 w-36">Preview</th>
                <th className="px-3 py-2">Company / job</th>
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2 w-44">When</th>
                <th className="px-3 py-2 w-32">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50/80">
                  <td className="px-3 py-2 align-top">
                    {row.thumbnail_url ? (
                      <a
                        href={row.drive_url}
                        target="_blank"
                        rel="noreferrer"
                        className="block"
                        title="Open in Drive"
                      >
                        <img
                          src={row.thumbnail_url}
                          alt=""
                          className="h-20 w-32 rounded border border-gray-200 object-cover bg-gray-100"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </a>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-gray-900">
                      {row.company_name || "—"}
                    </div>
                    <div className="text-gray-600 line-clamp-2">{row.job_title || "—"}</div>
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-500 break-all max-w-[12rem]">
                    {row.filename}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-600 whitespace-nowrap">
                    {formatDate(row.created_at)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <a
                      href={row.drive_url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-blue-700 hover:text-blue-900"
                    >
                      Drive
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => void load(page - 1)}
            className="rounded border border-gray-300 bg-white px-3 py-1 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {page} of {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => void load(page + 1)}
            className="rounded border border-gray-300 bg-white px-3 py-1 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
