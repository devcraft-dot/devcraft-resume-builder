import { useState } from "react";
import { AnalyticsView } from "./AnalyticsView";
import { Dashboard } from "./Dashboard";

type NavKey = "generations" | "analytics";

const NAV: { key: NavKey; label: string }[] = [
  { key: "generations", label: "Resumes" },
  { key: "analytics", label: "Analytics" },
];

export default function App() {
  const [nav, setNav] = useState<NavKey>("generations");
  const [resumeStageFilter, setResumeStageFilter] = useState<string | null>(
    null,
  );

  function goToResumesForStage(stage: string) {
    setResumeStageFilter(stage);
    setNav("generations");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between max-w-7xl mx-auto">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Resume Builder Dashboard
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Generations and pipeline analytics
            </p>
          </div>
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
      </header>
      <main className="p-6 max-w-7xl mx-auto">
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
      </main>
    </div>
  );
}
