import { useCallback, useEffect, useState } from "react";
import { AnalyticsView } from "./AnalyticsView";
import { Dashboard } from "./Dashboard";
import { RegisteredProfilesView } from "./RegisteredProfilesView";
import { ScreenshotsView } from "./ScreenshotsView";
import {
  clearDashboardSession,
  fetchAuthConfig,
  fetchAuthWhoami,
  fetchDashboardAnalytics,
  fetchRegisteredProfiles,
  getApiOrigin,
  getDashboardAuthMode,
  setDashboardAdminSession,
  setDashboardExtensionSession,
  type WhoAmIResponse,
} from "./api/client";

type NavKey = "generations" | "analytics" | "screenshots" | "profiles";

const NAV_ADMIN: { key: NavKey; label: string }[] = [
  { key: "generations", label: "Resumes" },
  { key: "screenshots", label: "Application snips" },
  { key: "analytics", label: "Analytics" },
  { key: "profiles", label: "Server profiles" },
];

const NAV_EXTENSION: { key: NavKey; label: string }[] = [
  { key: "generations", label: "Resumes" },
  { key: "screenshots", label: "Application snips" },
  { key: "analytics", label: "Analytics" },
];

function DashboardLoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const storedMode = getDashboardAuthMode();
  const [authTab, setAuthTab] = useState<"admin" | "extension">(
    storedMode === "extension" ? "extension" : "admin",
  );
  const [adminKey, setAdminKey] = useState("");
  const [extToken, setExtToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAdminKey(localStorage.getItem("rb_admin_api_key") || "");
    setExtToken(localStorage.getItem("rb_extension_token") || "");
  }, []);

  const submitAdmin = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      setDashboardAdminSession(adminKey.trim());
      await fetchDashboardAnalytics();
      onLoggedIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [adminKey, onLoggedIn]);

  const submitExtension = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      setDashboardExtensionSession(extToken.trim());
      await fetchAuthWhoami();
      onLoggedIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [extToken, onLoggedIn]);

  const submit = useCallback(() => {
    if (authTab === "admin") return void submitAdmin();
    return void submitExtension();
  }, [authTab, submitAdmin, submitExtension]);

  const canSubmit =
    authTab === "admin" ? !!adminKey.trim() : !!extToken.trim();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        <h1 className="text-lg font-semibold text-gray-900">Dashboard access</h1>
        <p className="text-sm text-gray-500 mt-1 mb-6">
          This screen appears because the API has <code className="text-xs bg-gray-100 px-1 rounded">JWT_SECRET</code>{" "}
          set (the server requires auth). Choose how you sign in: <strong>Admin</strong> uses the server{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">ADMIN_API_KEY</code> and sees all data.{" "}
          <strong>Extension user</strong> pastes the same JWT the Manual JD extension stores (minted from
          Profiles) — you only see generations and screenshots tied to your extension username.
        </p>

        <div className="flex rounded-lg border border-gray-200 p-1 mb-6 bg-gray-50">
          <button
            type="button"
            onClick={() => setAuthTab("admin")}
            className={`flex-1 py-2 text-sm font-semibold rounded-md transition ${
              authTab === "admin"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Admin API key
          </button>
          <button
            type="button"
            onClick={() => setAuthTab("extension")}
            className={`flex-1 py-2 text-sm font-semibold rounded-md transition ${
              authTab === "extension"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Extension token
          </button>
        </div>

        {authTab === "admin" ? (
          <>
            <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">
              Admin API key
            </label>
            <input
              type="password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 font-mono"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSubmit && !busy && void submitAdmin()}
              autoComplete="off"
              placeholder="Same value as ADMIN_API_KEY on the server"
            />
          </>
        ) : (
          <>
            <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">
              Extension JWT
            </label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 font-mono min-h-[100px]"
              value={extToken}
              onChange={(e) => setExtToken(e.target.value)}
              placeholder="Paste the API token from the extension (chrome.storage.local manualJd_accessToken)"
              spellCheck={false}
            />
            <p className="text-xs text-gray-500 mb-4">
              Mint the token in the extension under Profiles (Get API token or Save profiles). Each
              token is scoped to one extension username and a fixed set of profile names.
            </p>
          </>
        )}

        {err && (
          <p className="text-sm text-red-600 mb-4 whitespace-pre-wrap break-words">{err}</p>
        )}
        <button
          type="button"
          disabled={busy || !canSubmit}
          onClick={() => void submit()}
          className="w-full py-2.5 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {busy ? "Checking…" : "Continue"}
        </button>
        <button
          type="button"
          className="mt-3 w-full text-sm text-gray-600 hover:text-gray-900"
          onClick={() => {
            clearDashboardSession();
            setAdminKey("");
            setExtToken("");
            setErr("Stored credentials cleared.");
          }}
        >
          Clear stored credentials
        </button>
      </div>
    </div>
  );
}

function OptionalCredentialsStrip({
  onCredentialsChanged,
}: {
  onCredentialsChanged: () => void;
}) {
  const [authTab, setAuthTab] = useState<"admin" | "extension">("admin");
  const [adminKey, setAdminKey] = useState("");
  const [extToken, setExtToken] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAdminKey(localStorage.getItem("rb_admin_api_key") || "");
    setExtToken(localStorage.getItem("rb_extension_token") || "");
  }, []);

  async function saveAdmin() {
    setMsg(null);
    setBusy(true);
    try {
      const k = adminKey.trim();
      if (!k) {
        setDashboardAdminSession(null);
        setMsg("Admin key cleared from this browser.");
        onCredentialsChanged();
        return;
      }
      setDashboardAdminSession(k);
      await fetchRegisteredProfiles();
      setMsg("Admin key saved. Server profiles and admin-scoped requests will use it.");
      onCredentialsChanged();
    } catch (e) {
      setDashboardAdminSession(null);
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveExtension() {
    setMsg(null);
    setBusy(true);
    try {
      const t = extToken.trim();
      if (!t) {
        setDashboardExtensionSession(null);
        setMsg("Extension token cleared.");
        onCredentialsChanged();
        return;
      }
      setDashboardExtensionSession(t);
      setMsg(
        "Token stored in this browser. It is sent as Bearer on requests; scoped data only applies when the API has JWT_SECRET set.",
      );
      onCredentialsChanged();
    } catch (e) {
      setDashboardExtensionSession(null);
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-4">
      <div className="max-w-screen-2xl mx-auto">
        <p className="text-sm text-amber-950 mb-3">
          <strong>No JWT on the API</strong> (<code className="text-xs bg-white/80 px-1 rounded">JWT_SECRET</code>{" "}
          unset), so you were not sent through the full login screen. You can still use the dashboard
          for public routes. If you see &quot;Cannot reach the API&quot;, set{" "}
          <code className="text-xs bg-white/80 px-1 rounded">VITE_API_URL</code> for production builds, or run{" "}
          <code className="text-xs bg-white/80 px-1 rounded">npm run dev</code> so{" "}
          <code className="text-xs bg-white/80 px-1 rounded">/api</code> proxies to your FastAPI server (default{" "}
          <code className="text-xs bg-white/80 px-1 rounded">http://127.0.0.1:8000</code>). To open{" "}
          <strong>Server profiles</strong> or send <code className="text-xs bg-white/80 px-1 rounded">X-Admin-Key</code>, save your{" "}
          <code className="text-xs bg-white/80 px-1 rounded">ADMIN_API_KEY</code> below.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={() => setAuthTab("admin")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md border ${
              authTab === "admin"
                ? "bg-amber-900 text-white border-amber-900"
                : "bg-white text-amber-900 border-amber-300"
            }`}
          >
            Admin API key
          </button>
          <button
            type="button"
            onClick={() => setAuthTab("extension")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md border ${
              authTab === "extension"
                ? "bg-amber-900 text-white border-amber-900"
                : "bg-white text-amber-900 border-amber-300"
            }`}
          >
            Extension JWT (optional)
          </button>
        </div>
        {authTab === "admin" ? (
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end max-w-3xl">
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-amber-900 uppercase tracking-wide mb-1">
                ADMIN_API_KEY (same as server env)
              </label>
              <input
                type="password"
                className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm font-mono bg-white"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                autoComplete="off"
                placeholder="Paste admin key, then Save"
              />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveAdmin()}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-900 text-white hover:bg-amber-800 disabled:opacity-50 shrink-0"
            >
              {busy ? "…" : "Save admin key"}
            </button>
          </div>
        ) : (
          <div className="max-w-3xl space-y-2">
            <label className="block text-xs font-medium text-amber-900 uppercase tracking-wide">
              Extension JWT (only validated when API has JWT_SECRET)
            </label>
            <textarea
              className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm font-mono min-h-[72px] bg-white"
              value={extToken}
              onChange={(e) => setExtToken(e.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveExtension()}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-900 text-white hover:bg-amber-800 disabled:opacity-50"
            >
              {busy ? "…" : "Save extension token"}
            </button>
          </div>
        )}
        {msg && (
          <p className="text-xs text-amber-950 mt-2 whitespace-pre-wrap break-words">{msg}</p>
        )}
        <button
          type="button"
          className="mt-2 text-xs text-amber-800 underline"
          onClick={() => {
            clearDashboardSession();
            setAdminKey("");
            setExtToken("");
            setMsg("All saved credentials cleared.");
            onCredentialsChanged();
          }}
        >
          Clear all saved credentials
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
  const [whoami, setWhoami] = useState<WhoAmIResponse | null>(null);
  const [credentialsTick, setCredentialsTick] = useState(0);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setConfigError(null);
      try {
        const cfg = await fetchAuthConfig();
        if (cancelled) return;
        setAuthRequired(!!cfg.auth_required);
        if (!cfg.auth_required) {
          setSessionOk(true);
          return;
        }
        const mode = getDashboardAuthMode();
        if (mode === "extension") {
          try {
            await fetchAuthWhoami();
            if (cancelled) return;
            setSessionOk(true);
          } catch {
            if (cancelled) return;
            setSessionOk(false);
          }
          return;
        }
        if (mode === "admin") {
          try {
            await fetchDashboardAnalytics();
            if (cancelled) return;
            setSessionOk(true);
          } catch {
            if (cancelled) return;
            setSessionOk(false);
          }
          return;
        }
        setSessionOk(false);
      } catch (e) {
        if (cancelled) return;
        setConfigError(e instanceof Error ? e.message : String(e));
        setAuthRequired(false);
        setSessionOk(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionOk || !authRequired) {
      setWhoami(null);
      return;
    }
    if (getDashboardAuthMode() !== "extension") {
      setWhoami(null);
      return;
    }
    let cancelled = false;
    fetchAuthWhoami()
      .then((w) => {
        if (!cancelled) setWhoami(w);
      })
      .catch(() => {
        if (!cancelled) setWhoami(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionOk, authRequired, credentialsTick]);

  function goToResumesForStage(stage: string) {
    setResumeStageFilter(stage);
    setNav("generations");
  }

  function onLoggedIn() {
    setSessionOk(true);
  }

  const dashMode = sessionOk ? getDashboardAuthMode() : null;
  const navItems =
    dashMode === "extension"
      ? NAV_EXTENSION
      : dashMode === "admin"
        ? NAV_ADMIN
        : NAV_ADMIN.filter((x) => x.key !== "profiles");

  useEffect(() => {
    if (dashMode === "extension" && nav === "profiles") {
      setNav("generations");
    }
  }, [dashMode, nav]);

  if (configError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-lg bg-white border border-red-200 rounded-xl p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-red-900">Cannot reach the API</h1>
          <p className="text-sm text-gray-700 mt-3 whitespace-pre-wrap break-words">{configError}</p>
          <p className="text-xs text-gray-500 mt-4">
            Current API base:{" "}
            <code className="text-xs bg-gray-100 px-1 rounded">
              {getApiOrigin() || "(same origin — Vite dev proxies /api by default)"}
            </code>
          </p>
          <button
            type="button"
            className="mt-6 w-full py-2.5 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (authRequired === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500 text-sm">
        Loading…
      </div>
    );
  }

  if (authRequired && !sessionOk) {
    return <DashboardLoginScreen onLoggedIn={onLoggedIn} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {sessionOk && !authRequired && (
        <OptionalCredentialsStrip
          onCredentialsChanged={() => setCredentialsTick((x) => x + 1)}
        />
      )}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between max-w-screen-2xl mx-auto w-full">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Resume Builder Dashboard
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Generations, application screenshots, and pipeline analytics
              {dashMode === "admin" ? " (admin: server profiles too)" : ""}
            </p>
            {dashMode === "admin" && (
              <p className="text-xs text-gray-600 mt-2">
                <strong>Admin key</strong> is stored — sent as{" "}
                <code className="text-xs bg-gray-100 px-1 rounded">X-Admin-Key</code>
                {authRequired
                  ? " on every request (full access)."
                  : " for admin routes (e.g. Server profiles)."}
              </p>
            )}
            {authRequired && dashMode === "extension" && whoami && (
              <p className="text-xs text-gray-600 mt-2">
                Extension user <strong>{whoami.username}</strong> — only your rows. Profiles on
                this token: {(whoami.profile_names || []).join(", ") || "(none)"}.
              </p>
            )}
            {authRequired && dashMode === "extension" && !whoami && (
              <p className="text-xs text-gray-600 mt-2">Extension token session (loading identity…)</p>
            )}
          </div>
          <div className="flex flex-col sm:items-end gap-2">
            {(authRequired || dashMode) && (
              <button
                type="button"
                onClick={() => {
                  clearDashboardSession();
                  setWhoami(null);
                  setCredentialsTick((x) => x + 1);
                  if (authRequired) setSessionOk(false);
                }}
                className="text-xs font-medium text-gray-600 hover:text-gray-900 underline"
              >
                {authRequired ? "Sign out" : "Clear saved credentials"}
              </button>
            )}
            <nav className="flex flex-wrap gap-2" aria-label="Main">
              {navItems.map(({ key, label }) => (
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
        {nav === "profiles" && dashMode === "admin" && <RegisteredProfilesView />}
      </main>
    </div>
  );
}
