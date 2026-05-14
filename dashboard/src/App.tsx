import { useCallback, useEffect, useState } from "react";
import { AnalyticsView } from "./AnalyticsView";
import { Dashboard } from "./Dashboard";
import { ScreenshotsView } from "./ScreenshotsView";
import {
  fetchAuthConfig,
  fetchMe,
  getStoredToken,
  postLogin,
  setStoredToken,
  type MeResponse,
} from "./api/client";

type NavKey = "generations" | "analytics" | "screenshots";

const NAV: { key: NavKey; label: string }[] = [
  { key: "generations", label: "Resumes" },
  { key: "screenshots", label: "Application snips" },
  { key: "analytics", label: "Analytics" },
];

function LoginScreen({
  onLoggedIn,
}: {
  onLoggedIn: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      const { access_token } = await postLogin(email.trim(), password);
      setStoredToken(access_token);
      onLoggedIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [email, password, onLoggedIn]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        <h1 className="text-lg font-semibold text-gray-900">Sign in</h1>
        <p className="text-sm text-gray-500 mt-1 mb-6">
          Stateless sign-in: the server returns a JWT; this app stores it and sends{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">Authorization: Bearer</code> on each
          request. There is no server session. Use the same account as the Manual JD extension.
        </p>
        <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">
          Email
        </label>
        <input
          type="email"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
        />
        <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">
          Password
        </label>
        <input
          type="password"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoComplete="current-password"
        />
        {err && (
          <p className="text-sm text-red-600 mb-4 whitespace-pre-wrap break-words">{err}</p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="w-full py-2.5 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button
          type="button"
          className="mt-3 w-full text-sm text-gray-600 hover:text-gray-900"
          onClick={() => {
            setStoredToken(null);
            setErr("Session cleared.");
          }}
        >
          Clear stored token
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
  const [me, setMe] = useState<MeResponse | null>(null);

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
        const tok = getStoredToken();
        if (!tok) {
          setSessionOk(false);
          return;
        }
        const m = await fetchMe();
        if (cancelled) return;
        setMe(m);
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
    fetchMe()
      .then(setMe)
      .catch(() => setMe(null));
  }

  if (authRequired === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500 text-sm">
        Loading…
      </div>
    );
  }

  if (authRequired && !sessionOk) {
    return <LoginScreen onLoggedIn={onLoggedIn} />;
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
              Generations, application screenshots, and pipeline analytics
            </p>
            {me && (
              <p className="text-xs text-gray-600 mt-2">
                {me.email}
                {me.is_admin ? " · admin" : ""} · generations: {me.generation_count}
              </p>
            )}
          </div>
          <div className="flex flex-col sm:items-end gap-2">
            {authRequired && (
              <button
                type="button"
                onClick={() => {
                  setStoredToken(null);
                  setSessionOk(false);
                  setMe(null);
                }}
                className="text-xs font-medium text-gray-600 hover:text-gray-900 underline"
              >
                Log out
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
      </main>
    </div>
  );
}
