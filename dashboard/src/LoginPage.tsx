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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        <h1 className="text-xl font-semibold text-gray-900">Admin sign-in</h1>
        <p className="text-sm text-gray-500 mt-2">
          This page is for <strong>administrators</strong> only. Regular users created in the
          dashboard sign in inside the <strong>Chrome extension</strong> (Account / Settings → Sign
          in), not here.
        </p>
        <p className="text-sm text-gray-500 mt-2">
          Use an admin username and password. The first admin is created from server env:{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">BOOTSTRAP_ADMIN_USERNAME</code> /{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">BOOTSTRAP_ADMIN_PASSWORD</code> (plus{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">JWT_SECRET_KEY</code>). If the UI is on
          a different host than the API, set{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">VITE_API_URL</code> to your FastAPI
          origin (e.g. <code className="text-xs">https://…vercel.app</code>).
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              autoComplete="username"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
