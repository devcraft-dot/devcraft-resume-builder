import { useState } from "react";
import { login } from "./api/client";
import { clearToken } from "./auth";

interface LoginPageProps {
  onSuccess: () => void;
}

export function LoginPage({ onSuccess }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const u = username.trim().toLowerCase();
    if (!u) {
      setError("Enter your username");
      return;
    }
    if (!password) {
      setError("Enter your password");
      return;
    }
    setLoading(true);
    try {
      const me = await login(u, password);
      if (me.role !== "admin") {
        clearToken();
        setError(
          "This account is not an admin. Sign in with an admin user, or use a non-admin account in the Chrome extension.",
        );
        return;
      }
      onSuccess();
    } catch (err) {
      clearToken();
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white/90 shadow-2xl shadow-slate-900/10 ring-1 ring-slate-200/80 backdrop-blur-sm">
        <div className="h-1.5 bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500" />
        <div className="p-8 sm:p-10">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Admin sign-in
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            This page is for <strong className="text-slate-800">administrators</strong> only.
            Regular users sign in inside the{" "}
            <strong className="text-slate-800">Chrome extension</strong> (Account → Sign in), not
            here.
          </p>
          <details className="mt-4 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-xs text-slate-600 leading-relaxed">
            <summary className="cursor-pointer font-medium text-slate-700 outline-none select-none">
              Server setup hints
            </summary>
            <p className="mt-2">
              First admin:{" "}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-slate-200">
                BOOTSTRAP_ADMIN_USERNAME
              </code>{" "}
              /{" "}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-slate-200">
                BOOTSTRAP_ADMIN_PASSWORD
              </code>{" "}
              and{" "}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-slate-200">
                JWT_SECRET_KEY
              </code>
              . If the UI host differs from the API, set{" "}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-slate-200">
                VITE_API_URL
              </code>{" "}
              to your FastAPI origin.
            </p>
          </details>
          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Username
              </label>
              <input
                type="text"
                autoComplete="username"
                className="dash-input"
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                className="dash-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                role="alert"
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="dash-btn dash-btn-primary w-full py-3 text-base font-semibold"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
