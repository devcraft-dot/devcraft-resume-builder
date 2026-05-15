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
          Choose how you sign in. <strong>Admin</strong> uses the server{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">ADMIN_API_KEY</code> and sees all data.
          <strong> Extension user</strong> pastes the same JWT the Manual JD extension stores (minted
          from Profiles) — you only see generations and screenshots tied to your extension username.
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

export default function App() {
  const [nav, setNav] = useState<NavKey>("generations");
  const [resumeStageFilter, setResumeStageFilter] = useState<string | null>(
    null,
  );
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [sessionOk, setSessionOk] = useState(false);
  const [whoami, setWhoami] = useState<WhoAmIResponse | null>(null);

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
  }, [sessionOk, authRequired]);

  function goToResumesForStage(stage: string) {
    setResumeStageFilter(stage);
    setNav("generations");
  }

  function onLoggedIn() {
    setSessionOk(true);
  }

  const dashMode = sessionOk && authRequired ? getDashboardAuthMode() : null;
  const navItems = dashMode === "extension" ? NAV_EXTENSION : NAV_ADMIN;

  useEffect(() => {
    if (dashMode === "extension" && nav === "profiles") {
      setNav("generations");
    }
  }, [dashMode, nav]);

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
            {authRequired && dashMode === "admin" && (
              <p className="text-xs text-gray-600 mt-2">
                Signed in as <strong>admin</strong> —{" "}
                <code className="text-xs bg-gray-100 px-1 rounded">X-Admin-Key</code> on every
                request; you see all users&apos; data.
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
            {authRequired && (
              <button
                type="button"
                onClick={() => {
                  clearDashboardSession();
                  setSessionOk(false);
                  setWhoami(null);
                }}
                className="text-xs font-medium text-gray-600 hover:text-gray-900 underline"
              >
                Sign out
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
