import { useEffect, useState } from "react";
import { AnalyticsView } from "./AnalyticsView";
import { Dashboard } from "./Dashboard";
import { LoginPage } from "./LoginPage";
import { ProfilesView } from "./ProfilesView";
import { UsersView } from "./UsersView";
import { clearToken, getToken } from "./auth";
import { fetchMe } from "./api/client";

type NavKey = "generations" | "analytics" | "users" | "profiles";

const NAV: { key: NavKey; label: string }[] = [
  { key: "generations", label: "Resumes" },
  { key: "analytics", label: "Analytics" },
  { key: "users", label: "Users" },
  { key: "profiles", label: "Profiles" },
];

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [nav, setNav] = useState<NavKey>("generations");
  const [resumeStageFilter, setResumeStageFilter] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setAuthed(false);
      return;
    }
    fetchMe()
      .then((me) => setAuthed(me.role === "admin"))
      .catch(() => setAuthed(false));
  }, []);

  function goToResumesForStage(stage: string) {
    setResumeStageFilter(stage);
    setNav("generations");
  }

  function handleLogout() {
    clearToken();
    setAuthed(false);
    window.location.reload();
  }

  if (authed === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-slate-500">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
        <p className="text-sm font-medium">Loading dashboard…</p>
      </div>
    );
  }

  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />;
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/75 backdrop-blur-md shadow-sm">
        <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-600/90">
              Admin
            </p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
              Resume Builder
            </h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-500">
              Manage users and profiles here. End users sign in only in the Chrome extensions.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <nav
              className="flex flex-wrap gap-1 rounded-2xl bg-slate-100/90 p-1 ring-1 ring-slate-200/80"
              aria-label="Main"
            >
              {NAV.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setNav(key)}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                    nav === key
                      ? "bg-white text-slate-900 shadow-md ring-1 ring-slate-200/80"
                      : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
            <button
              type="button"
              onClick={handleLogout}
              className="dash-btn self-stretch sm:self-auto"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-screen-2xl px-4 py-8 sm:px-8">
        {nav === "generations" && (
          <Dashboard
            key={resumeStageFilter ?? "__all__"}
            stageFilter={resumeStageFilter}
            onClearStageFilter={() => setResumeStageFilter(null)}
          />
        )}
        {nav === "analytics" && (
          <AnalyticsView onViewResumesForStage={goToResumesForStage} />
        )}
        {nav === "users" && <UsersView />}
        {nav === "profiles" && <ProfilesView />}
      </main>
    </div>
  );
}
