import { useCallback, useEffect, useState } from "react";
import { AnalyticsView } from "./AnalyticsView";
import { Dashboard } from "./Dashboard";
import { RegisteredProfilesView } from "./RegisteredProfilesView";
import { ScreenshotsView } from "./ScreenshotsView";
import {
  fetchAuthConfig,
  fetchDashboardAnalytics,
  getStoredAdminKey,
  setStoredAdminKey,
} from "./api/client";

type NavKey = "generations" | "analytics" | "screenshots" | "profiles";

const NAV: { key: NavKey; label: string }[] = [
  { key: "generations", label: "Resumes" },
  { key: "screenshots", label: "Application snips" },
  { key: "analytics", label: "Analytics" },
  { key: "profiles", label: "Server profiles" },
];

function AdminKeyScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [key, setKey] = useState(getStoredAdminKey());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      setStoredAdminKey(key.trim() || null);
      await fetchDashboardAnalytics();
      onLoggedIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [key, onLoggedIn]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        <h1 className="text-lg font-semibold text-gray-900">Dashboard access</h1>
        <p className="text-sm text-gray-500 mt-1 mb-6">
          When the API has <code className="text-xs bg-gray-100 px-1 rounded">JWT_SECRET</code> set,
          send the same <code className="text-xs bg-gray-100 px-1 rounded">ADMIN_API_KEY</code> value
          from the server environment as header{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">X-Admin-Key</code>. It is stored only in
          this browser.
        </p>
        <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">
          Admin API key
        </label>
        <input
          type="password"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 font-mono"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          autoComplete="off"
        />
        {err && (
          <p className="text-sm text-red-600 mb-4 whitespace-pre-wrap break-words">{err}</p>
        )}
        <button
          type="button"
          disabled={busy || !key.trim()}
          onClick={() => void submit()}
          className="w-full py-2.5 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {busy ? "Checking…" : "Continue"}
        </button>
        <button
          type="button"
          className="mt-3 w-full text-sm text-gray-600 hover:text-gray-900"
          onClick={() => {
            setStoredAdminKey(null);
            setKey("");
            setErr("Stored key cleared.");
          }}
        >
          Clear stored key
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [nav, setNav] = useState<NavKey>("generations");
  const [resumeStageFilter, setResumeStageFilter] = useState<string | null>(
    null,
  );
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [sessionOk, setSessionOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await fetchAuthConfig();
        if (cancelled) return;
        setAuthRequired(!!cfg.auth_required);
        if (!cfg.auth_required) {
          setSessionOk(true);
          return;
        }
        const k = getStoredAdminKey();
        if (!k) {
          setSessionOk(false);
          return;
        }
        try {
          await fetchDashboardAnalytics();
        } catch {
          setSessionOk(false);
          return;
        }
        setSessionOk(true);
      } catch {
        if (cancelled) return;
        setAuthRequired(false);
        setSessionOk(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function goToResumesForStage(stage: string) {
    setResumeStageFilter(stage);
    setNav("generations");
  }

  function onLoggedIn() {
    setSessionOk(true);
  }

  if (authRequired === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500 text-sm">
        Loading…
      </div>
    );
  }

  if (authRequired && !sessionOk) {
    return <AdminKeyScreen onLoggedIn={onLoggedIn} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between max-w-screen-2xl mx-auto w-full">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Resume Builder Dashboard
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Generations, application screenshots, pipeline analytics, and server-registered
              profiles
            </p>
            {authRequired && (
              <p className="text-xs text-gray-600 mt-2">
                Authenticated with admin API key (header{" "}
                <code className="text-xs bg-gray-100 px-1 rounded">X-Admin-Key</code>)
              </p>
            )}
          </div>
          <div className="flex flex-col sm:items-end gap-2">
            {authRequired && (
              <button
                type="button"
                onClick={() => {
                  setStoredAdminKey(null);
                  setSessionOk(false);
                }}
                className="text-xs font-medium text-gray-600 hover:text-gray-900 underline"
              >
                Clear admin key
              </button>
            )}
            <nav className="flex flex-wrap gap-2" aria-label="Main">
              {NAV.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setNav(key)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg border transition ${
                    nav === key
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>
      <main className="p-6 max-w-screen-2xl mx-auto w-full">
        {nav === "generations" && (
          <Dashboard
            key={resumeStageFilter ?? "__all__"}
            stageFilter={resumeStageFilter}
            onClearStageFilter={() => setResumeStageFilter(null)}
          />
        )}
        {nav === "screenshots" && <ScreenshotsView />}
        {nav === "analytics" && (
          <AnalyticsView onViewResumesForStage={goToResumesForStage} />
        )}
        {nav === "profiles" && <RegisteredProfilesView />}
      </main>
    </div>
  );
}
