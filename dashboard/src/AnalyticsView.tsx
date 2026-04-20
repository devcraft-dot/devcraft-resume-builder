import { useCallback, useEffect, useState } from "react";
import { fetchDashboardAnalytics } from "./api/client";
import type { DashboardAnalytics } from "./api/types";

const STAGE_BAR_COLORS: Record<string, string> = {
  generated: "bg-gray-400",
  intro: "bg-blue-500",
  tech: "bg-purple-500",
  final: "bg-amber-500",
  success: "bg-green-500",
  failed: "bg-red-500",
};

function pct(success: number, total: number) {
  if (!total) return "—";
  return `${Math.round((100 * success) / total)}%`;
}

export function AnalyticsView() {
  const [data, setData] = useState<DashboardAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await fetchDashboardAnalytics();
      setData(d);
      setLoadedAt(new Date().toLocaleString());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const maxStage =
    data?.by_stage.reduce((m, s) => Math.max(m, s.count), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600 max-w-2xl">
          Pipeline stages are updated from the generations table.{" "}
          <strong>Success</strong> means the row&apos;s stage is{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">success</code>{" "}
          (useful for comparing models and profiles).
        </p>
        <div className="flex items-center gap-3">
          {loadedAt && (
            <span className="text-xs text-gray-400">Updated {loadedAt}</span>
          )}
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 transition"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {!data && !error && loading && (
        <p className="text-sm text-blue-600 animate-pulse">Loading analytics…</p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Total resumes
              </div>
              <div className="text-3xl font-semibold text-gray-900 mt-1">
                {data.total_generations}
              </div>
              <p className="text-xs text-gray-500 mt-2">Rows in generations</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Success-stage
              </div>
              <div className="text-3xl font-semibold text-green-700 mt-1">
                {data.by_stage.find((s) => s.stage === "success")?.count ?? 0}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Count where stage = success
              </p>
            </div>
          </div>

          <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-900">
                Resumes by pipeline stage
              </h2>
            </div>
            <div className="p-5 space-y-3">
              {data.by_stage.length === 0 && (
                <p className="text-sm text-gray-400">No data yet</p>
              )}
              {data.by_stage.map((s) => {
                const w = maxStage ? Math.max(8, (s.count / maxStage) * 100) : 0;
                const bar =
                  STAGE_BAR_COLORS[s.stage] ?? "bg-gray-400";
                return (
                  <div key={s.stage} className="flex items-center gap-3 text-sm">
                    <span className="w-24 font-medium text-gray-700 capitalize shrink-0">
                      {s.stage}
                    </span>
                    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${bar}`}
                        style={{ width: `${w}%` }}
                      />
                    </div>
                    <span className="w-12 text-right tabular-nums text-gray-600 shrink-0">
                      {s.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
                <h2 className="text-sm font-semibold text-gray-900">
                  By AI model
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Total generations vs. reached{" "}
                  <span className="text-green-700 font-medium">success</span> stage
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="px-4 py-2 font-medium">Model</th>
                      <th className="px-4 py-2 font-medium text-right">Total</th>
                      <th className="px-4 py-2 font-medium text-right">Success</th>
                      <th className="px-4 py-2 font-medium text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.by_model.map((m) => (
                      <tr key={m.model_name} className="hover:bg-gray-50/80">
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-800">
                          {m.model_name}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {m.total}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-green-700 font-medium">
                          {m.success}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                          {pct(m.success, m.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
                <h2 className="text-sm font-semibold text-gray-900">
                  By profile name
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Same success metric: stage = success
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="px-4 py-2 font-medium">Profile</th>
                      <th className="px-4 py-2 font-medium text-right">Total</th>
                      <th className="px-4 py-2 font-medium text-right">Success</th>
                      <th className="px-4 py-2 font-medium text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.by_profile.map((p) => (
                      <tr key={p.profile_name} className="hover:bg-gray-50/80">
                        <td className="px-4 py-2.5 text-gray-800">{p.profile_name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {p.total}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-green-700 font-medium">
                          {p.success}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                          {pct(p.success, p.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

        </>
      )}
    </div>
  );
}
