import { useCallback, useEffect, useState } from "react";
import {
  createAdminUser,
  fetchAdminProfiles,
  fetchAdminUsers,
  patchAdminUser,
  setAdminUserPassword,
  setAdminUserProfiles,
} from "./api/client";
import type { RegisteredProfileSummary, User } from "./api/types";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function UsersView() {
  const [users, setUsers] = useState<User[]>([]);
  const [profiles, setProfiles] = useState<RegisteredProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [assignUserId, setAssignUserId] = useState<number | null>(null);
  const [selectedProfileIds, setSelectedProfileIds] = useState<number[]>([]);

  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addPassword2, setAddPassword2] = useState("");
  const [addDisplayName, setAddDisplayName] = useState("");
  const [addRole, setAddRole] = useState<"user" | "admin">("user");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [pwdUserId, setPwdUserId] = useState<number | null>(null);
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, p] = await Promise.all([fetchAdminUsers(), fetchAdminProfiles()]);
      setUsers(u);
      setProfiles(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetAddForm() {
    setAddUsername("");
    setAddPassword("");
    setAddPassword2("");
    setAddDisplayName("");
    setAddRole("user");
    setFormError(null);
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const username = addUsername.trim().toLowerCase();
    if (!username) {
      setFormError("Username is required.");
      return;
    }
    if (!USERNAME_PATTERN.test(username)) {
      setFormError("Username may only contain letters, digits, underscores, and hyphens.");
      return;
    }
    if (addPassword.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (addPassword !== addPassword2) {
      setFormError("Passwords do not match.");
      return;
    }
    const displayName = addDisplayName.trim() || username;
    setCreating(true);
    try {
      await createAdminUser({
        username,
        password: addPassword,
        display_name: displayName,
        role: addRole,
      });
      const who =
        addRole === "user"
          ? `Created user “${username}”. They sign in only in the Chrome extension (Account → Sign in) with this username and password.`
          : `Created admin “${username}”. Share the password securely.`;
      setBanner(who);
      resetAddForm();
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  function openSetPassword(userId: number) {
    setPwdUserId(userId);
    setPwd1("");
    setPwd2("");
    setPwdError(null);
  }

  async function saveSetPassword() {
    if (pwdUserId == null) return;
    setPwdError(null);
    if (pwd1.length < 8) {
      setPwdError("Password must be at least 8 characters.");
      return;
    }
    if (pwd1 !== pwd2) {
      setPwdError("Passwords do not match.");
      return;
    }
    setPwdSaving(true);
    try {
      await setAdminUserPassword(pwdUserId, pwd1);
      setBanner("Password updated.");
      setPwdUserId(null);
      await load();
    } catch (e) {
      setPwdError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setPwdSaving(false);
    }
  }

  async function handleToggleActive(user: User) {
    try {
      await patchAdminUser(user.id, { is_active: !user.is_active });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  }

  function openAssign(user: User) {
    setAssignUserId(user.id);
    setSelectedProfileIds([...user.profile_ids]);
  }

  async function saveAssign() {
    if (assignUserId == null) return;
    try {
      await setAdminUserProfiles(assignUserId, selectedProfileIds);
      setAssignUserId(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Assign failed");
    }
  }

  if (loading) return <p className="text-gray-500">Loading users…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Users</h2>
        <p className="text-sm text-gray-600 mt-1 max-w-3xl">
          Create accounts here. <strong>Role “user”</strong> accounts are for the resume Chrome
          extensions only — they sign in under the extension&apos;s{" "}
          <strong>Account / Settings → Sign in</strong>, not on this dashboard. Assign profiles so
          they can sync and generate. Admins can also use this dashboard after signing in here.
        </p>
      </div>

      {banner && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-900">
          <p>{banner}</p>
          <button
            type="button"
            className="mt-2 text-emerald-800 underline"
            onClick={() => setBanner(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">Add user</h3>
        <form onSubmit={handleCreateUser} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Username</label>
            <input
              type="text"
              autoComplete="off"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
              placeholder="e.g. jamie"
              value={addUsername}
              onChange={(e) => setAddUsername(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">Letters, digits, _ and - only.</p>
          </div>
          <div className="sm:col-span-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Display name</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Shown in the app"
              value={addDisplayName}
              onChange={(e) => setAddDisplayName(e.target.value)}
            />
          </div>
          <div className="sm:col-span-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Initial password</label>
            <input
              type="password"
              autoComplete="new-password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={addPassword}
              onChange={(e) => setAddPassword(e.target.value)}
            />
          </div>
          <div className="sm:col-span-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Confirm password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={addPassword2}
              onChange={(e) => setAddPassword2(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
            <select
              className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as "user" | "admin")}
            >
              <option value="user">User (extension login only)</option>
              <option value="admin">Admin (dashboard + extension)</option>
            </select>
          </div>
          {formError && (
            <p className="sm:col-span-2 text-sm text-red-600" role="alert">
              {formError}
            </p>
          )}
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create user"}
            </button>
            <button
              type="button"
              onClick={resetAddForm}
              className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Clear form
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Display name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3">Profiles</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="px-4 py-3 font-mono text-xs">{u.username}</td>
                <td className="px-4 py-3">{u.display_name}</td>
                <td className="px-4 py-3">{u.role}</td>
                <td className="px-4 py-3">{u.is_active ? "Yes" : "No"}</td>
                <td className="px-4 py-3">{u.profile_ids.length}</td>
                <td className="px-4 py-3 space-x-2">
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => openAssign(u)}
                  >
                    Assign profiles
                  </button>
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => openSetPassword(u.id)}
                  >
                    Set password
                  </button>
                  <button
                    type="button"
                    className="text-gray-600 hover:underline"
                    onClick={() => handleToggleActive(u)}
                  >
                    {u.is_active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pwdUserId != null && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-lg">
            <h3 className="font-semibold mb-1">Set password</h3>
            <p className="text-sm text-gray-600 mb-4">
              User will use this password in the extension (and in the dashboard if they are an
              admin).
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New password</label>
                <input
                  type="password"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={pwd1}
                  onChange={(e) => setPwd1(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Confirm password
                </label>
                <input
                  type="password"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                />
              </div>
              {pwdError && (
                <p className="text-sm text-red-600" role="alert">
                  {pwdError}
                </p>
              )}
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button
                type="button"
                className="px-3 py-1.5 text-sm border rounded-lg"
                onClick={() => setPwdUserId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pwdSaving}
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg disabled:opacity-50"
                onClick={() => void saveSetPassword()}
              >
                {pwdSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {assignUserId != null && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-lg">
            <h3 className="font-semibold mb-3">Assign profiles</h3>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {profiles.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedProfileIds.includes(p.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedProfileIds((ids) => [...ids, p.id]);
                      } else {
                        setSelectedProfileIds((ids) =>
                          ids.filter((id) => id !== p.id),
                        );
                      }
                    }}
                  />
                  {p.name} ({p.model})
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button
                type="button"
                className="px-3 py-1.5 text-sm border rounded-lg"
                onClick={() => setAssignUserId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg"
                onClick={saveAssign}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
