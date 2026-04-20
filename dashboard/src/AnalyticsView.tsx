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

function pct(passed: number, total: number) {
  if (!total) return "—";
  return `${Math.round((100 * passed) / total)}%`;
}

type AnalyticsViewProps = {
  onViewResumesForStage?: (stage: string) => void;
};

export function AnalyticsView({ onViewResumesForStage }: AnalyticsViewProps) {
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
          <strong>Pass check</strong> counts rows in{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">intro</code>,{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">tech</code>,{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">final</code>, or{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">success</code>{" "}
          (past initial generation).{" "}
          <strong>generated</strong> and <strong>failed</strong> are excluded from
          that metric. Click a pipeline stage to open the Resumes list filtered to
          that stage.
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
                Passed resume check
              </div>
              <div className="text-3xl font-semibold text-green-700 mt-1">
                {data.passed_resume_check_total}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                intro + tech + final + success (not generated / not failed)
              </p>
            </div>
          </div>

          <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-900">
                Resumes by pipeline stage
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Click a row to view those resumes in the Resumes tab
              </p>
            </div>
            <div className="p-5 space-y-1">
              {data.by_stage.length === 0 && (
                <p className="text-sm text-gray-400">No data yet</p>
              )}
              {data.by_stage.map((s) => {
                const w = maxStage ? Math.max(8, (s.count / maxStage) * 100) : 0;
                const bar = STAGE_BAR_COLORS[s.stage] ?? "bg-gray-400";
                return (
                  <button
                    key={s.stage}
                    type="button"
                    onClick={() => onViewResumesForStage?.(s.stage)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-gray-50"
                  >
                    <span className="w-24 shrink-0 font-medium capitalize text-gray-800">
                      {s.stage}
                    </span>
                    <div className="h-2.5 min-w-0 flex-1 rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full ${bar}`}
                        style={{ width: `${w}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right tabular-nums text-gray-600">
                      {s.count}
                    </span>
                    <span className="shrink-0 text-[10px] font-medium text-blue-600">
                      View →
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <h2 className="text-sm font-semibold text-gray-900">
                  By AI model
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Per-stage counts; <strong>Pass</strong> = intro+tech+final+success
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[520px] w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-gray-500">
                      <th className="sticky left-0 z-10 bg-gray-50 px-2 py-2 font-medium">
                        Model
                      </th>
                      <th className="px-1 py-2 font-medium text-right" title="Total">
                        Tot
                      </th>
                      <th
                        className="px-1 py-2 font-medium text-right text-green-800"
                        title="Passed resume check"
                      >
                        Pass
                      </th>
                      <th className="px-1 py-2 font-medium text-right" title="generated">
                        gen
                      </th>
                      <th className="px-1 py-2 font-medium text-right" title="intro">
                        in
                      </th>
                      <th className="px-1 py-2 font-medium text-right" title="tech">
                        te
                      </th>
                      <th className="px-1 py-2 font-medium text-right" title="final">
                        fi
                      </th>
                      <th className="px-1 py-2 font-medium text-right" title="success">
                        ok
                      </th>
                      <th className="px-1 py-2 font-medium text-right" title="failed">
                        fail
                      </th>
                      <th className="px-2 py-2 font-medium text-right" title="Pass / total">
                        %
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.by_model.map((m) => (
                      <tr key={m.model_name} className="hover:bg-gray-50/80">
                        <td className="sticky left-0 z-10 bg-white px-2 py-2 font-mono text-gray-900">
                          {m.model_name}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums">{m.total}</td>
                        <td className="px-1 py-2 text-right tabular-nums font-medium text-green-700">
                          {m.passed_resume_check}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-gray-600">
                          {m.generated}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-gray-600">
                          {m.intro}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-gray-600">
                          {m.tech}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-gray-600">
                          {m.final}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-gray-600">
                          {m.success}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-red-600">
                          {m.failed}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-gray-600">
                          {pct(m.passed_resume_check, m.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <h2 className="text-sm font-semibold text-gray-900">
                  By profile name
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Same columns as by model
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[520px] w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-gray-500">
                      <th className="sticky left-0 z-10 bg-gray-50 px-2 py-2 font-medium">
                        Profile
                      </th>
                      <th className="px-1 py-2 font-medium text-right">Tot</th>
                      <th className="px-1 py-2 font-medium text-right text-green-800">
                        Pass
                      </th>
                      <th className="px-1 py-2 font-medium text-right" title="generated">
                        gen
                      </th>
                      <th className="px-1 py-2 font-medium text-right" title="intro">
                        in
                      </th>
                      <th className="px-1 py-2 font-medium text-right" title="tech">
                        te
                      </th>
                      <th className="px-1 py-2 font-medium text-right" title="final">
                        fi
                      </th>
                      <th className="px-1 py-2 font-medium text-right" title="success">
                        ok
                      </th>
                      <th className="px-1 py-2 font-medium text-right" title="failed">
                        fail
                      </th>
                      <th className="px-2 py-2 font-medium text-right">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.by_profile.map((p) => (
                      <tr key={p.profile_name} className="hover:bg-gray-50/80">
                        <td className="sticky left-0 z-10 bg-white px-2 py-2 text-gray-900">
                          {p.profile_name}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums">{p.total}</td>
                        <td className="px-1 py-2 text-right tabular-nums font-medium text-green-700">
                          {p.passed_resume_check}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-gray-600">
                          {p.generated}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-gray-600">
                          {p.intro}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-gray-600">
                          {p.tech}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-gray-600">
                          {p.final}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-gray-600">
                          {p.success}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-red-600">
                          {p.failed}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-gray-600">
                          {pct(p.passed_resume_check, p.total)}
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
