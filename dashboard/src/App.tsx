import { useEffect, useState } from "react";
import { AnalyticsView } from "./AnalyticsView";
import { Dashboard } from "./Dashboard";
import { LoginPage } from "./LoginPage";
import { ProfilesView } from "./ProfilesView";
import { ScreenshotsView } from "./ScreenshotsView";
import { UsersView } from "./UsersView";
import { clearToken, getToken } from "./auth";
import { fetchMe } from "./api/client";

type NavKey =
  | "generations"
  | "analytics"
  | "screenshots"
  | "users"
  | "profiles";

const NAV: { key: NavKey; label: string }[] = [
  { key: "generations", label: "Resumes" },
  { key: "screenshots", label: "Application snips" },
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
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />;
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
              Admins manage the system here. End users sign in only in the Chrome extensions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Sign out
            </button>
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
        {nav === "users" && <UsersView />}
        {nav === "profiles" && <ProfilesView />}
      </main>
    </div>
  );
}
