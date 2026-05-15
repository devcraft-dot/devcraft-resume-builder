import { useState } from "react";
import { fetchMe } from "./api/client";
import { clearToken, setToken } from "./auth";

interface LoginPageProps {
  onSuccess: () => void;
}

export function LoginPage({ onSuccess }: LoginPageProps) {
  const [token, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Enter your admin API token");
      return;
    }
    setLoading(true);
    try {
      setToken(trimmed);
      const me = await fetchMe();
      if (me.role !== "admin") {
        clearToken();
        setError(
          "This token is not an admin account. Use a user token in the Chrome extension.",
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
          Paste the API token issued when your admin account was created.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              API token
            </label>
            <input
              type="password"
              autoComplete="off"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="rb_…"
              value={token}
              onChange={(e) => setTokenInput(e.target.value)}
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
            {loading ? "Checking…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
