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
    <div className="space-y-8">
      <div className="flex flex-col gap-4 rounded-2xl bg-white/90 p-5 shadow-lg shadow-slate-900/5 ring-1 ring-slate-200/80 backdrop-blur-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:p-6">
        <div className="max-w-2xl text-sm leading-relaxed text-slate-600">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-600/90">
            Insights
          </p>
          <p className="mt-2">
            <strong className="text-slate-800">Pass check</strong> counts rows in{" "}
            <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200/80">
              intro
            </code>
            ,{" "}
            <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200/80">
              tech
            </code>
            ,{" "}
            <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200/80">
              final
            </code>
            , or{" "}
            <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200/80">
              success
            </code>{" "}
            (past initial generation). <strong className="text-slate-800">generated</strong> and{" "}
            <strong className="text-slate-800">failed</strong> are excluded. Click a pipeline stage
            to open the Resumes list filtered to that stage.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {loadedAt && (
            <span className="text-xs font-medium tabular-nums text-slate-400">Updated {loadedAt}</span>
          )}
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="dash-btn disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      {!data && !error && loading && (
        <div className="flex items-center gap-2 text-sm font-medium text-violet-600">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
          Loading analytics…
        </div>
      )}

      {data && (
        <>
          <div className="grid max-w-2xl grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/80 p-6 shadow-lg shadow-slate-900/5 ring-1 ring-slate-200/60">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Total resumes
              </div>
              <div className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-slate-900">
                {data.total_generations}
              </div>
              <p className="mt-2 text-xs text-slate-500">Rows in generations</p>
              <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-violet-500/10 blur-2xl" />
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50/90 to-teal-50/50 p-6 shadow-lg shadow-emerald-900/5 ring-1 ring-emerald-100/80">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800/80">
                Passed resume check
              </div>
              <div className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-emerald-800">
                {data.passed_resume_check_total}
              </div>
              <p className="mt-2 text-xs text-emerald-900/70">
                intro + tech + final + success (not generated / not failed)
              </p>
            </div>
          </div>

          <section className="overflow-hidden rounded-2xl bg-white/95 shadow-xl shadow-slate-900/5 ring-1 ring-slate-200/80 backdrop-blur-sm">
            <div className="border-b border-slate-200/90 bg-slate-50/95 px-6 py-5">
              <h2 className="text-base font-bold text-slate-900">Resumes by pipeline stage</h2>
              <p className="mt-1 text-xs font-medium text-slate-500">
                Click a row to view those resumes in the Resumes tab
              </p>
            </div>
            <div className="space-y-1 p-4 sm:p-5">
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
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-violet-50/80"
                  >
                    <span className="w-24 shrink-0 capitalize text-slate-800">{s.stage}</span>
                    <div className="h-2.5 min-w-0 flex-1 rounded-full bg-slate-100 ring-1 ring-slate-200/60">
                      <div
                        className={`h-full rounded-full ${bar}`}
                        style={{ width: `${w}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right tabular-nums text-slate-600">
                      {s.count}
                    </span>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-violet-600">
                      View →
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <section className="overflow-hidden rounded-2xl bg-white/95 shadow-xl shadow-slate-900/5 ring-1 ring-slate-200/80 backdrop-blur-sm">
              <div className="border-b border-slate-200/90 bg-slate-50/95 px-5 py-4">
                <h2 className="text-base font-bold text-slate-900">By AI model</h2>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  Per-stage counts; <strong className="text-slate-700">Pass</strong> = intro+tech+final+success
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[520px] w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="sticky left-0 z-10 bg-slate-50/98 px-3 py-3 font-bold backdrop-blur-sm">
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
                  <tbody className="divide-y divide-slate-100">
                    {data.by_model.map((m) => (
                      <tr key={m.model_name} className="transition hover:bg-violet-50/40">
                        <td className="sticky left-0 z-10 bg-white/95 px-3 py-2.5 font-mono text-xs text-slate-900 backdrop-blur-sm">
                          {m.model_name}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums">{m.total}</td>
                        <td className="px-1 py-2 text-right tabular-nums font-medium text-green-700">
                          {m.passed_resume_check}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-slate-600">{m.generated}</td>
                        <td className="px-1 py-2 text-right tabular-nums text-slate-600">{m.intro}</td>
                        <td className="px-1 py-2 text-right tabular-nums text-slate-600">{m.tech}</td>
                        <td className="px-1 py-2 text-right tabular-nums text-slate-600">{m.final}</td>
                        <td className="px-1 py-2 text-right tabular-nums text-slate-600">{m.success}</td>
                        <td className="px-1 py-2 text-right tabular-nums text-red-600">{m.failed}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                          {pct(m.passed_resume_check, m.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl bg-white/95 shadow-xl shadow-slate-900/5 ring-1 ring-slate-200/80 backdrop-blur-sm">
              <div className="border-b border-slate-200/90 bg-slate-50/95 px-5 py-4">
                <h2 className="text-base font-bold text-slate-900">By profile name</h2>
                <p className="mt-1 text-xs font-medium text-slate-500">Same columns as by model</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[520px] w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="sticky left-0 z-10 bg-slate-50/98 px-3 py-3 font-bold backdrop-blur-sm">
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
                  <tbody className="divide-y divide-slate-100">
                    {data.by_profile.map((p) => (
                      <tr key={p.profile_name} className="transition hover:bg-violet-50/40">
                        <td className="sticky left-0 z-10 bg-white/95 px-3 py-2.5 text-slate-900 backdrop-blur-sm">
                          {p.profile_name}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums">{p.total}</td>
                        <td className="px-1 py-2 text-right tabular-nums font-medium text-green-700">
                          {p.passed_resume_check}
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-slate-600">{p.generated}</td>
                        <td className="px-1 py-2 text-right tabular-nums text-slate-600">{p.intro}</td>
                        <td className="px-1 py-2 text-right tabular-nums text-slate-600">{p.tech}</td>
                        <td className="px-1 py-2 text-right tabular-nums text-slate-600">{p.final}</td>
                        <td className="px-1 py-2 text-right tabular-nums text-slate-600">{p.success}</td>
                        <td className="px-1 py-2 text-right tabular-nums text-red-600">{p.failed}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-600">
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
