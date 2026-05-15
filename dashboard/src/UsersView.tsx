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

  if (loading)
    return (
      <div className="flex items-center gap-3 text-sm font-medium text-slate-500">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
        Loading users…
      </div>
    );
  if (error)
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
        {error}
      </div>
    );

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-600/90">
          Directory
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Users</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          Create accounts here. <strong className="text-slate-800">Role “user”</strong> accounts are
          for the resume Chrome extensions only — they sign in under the extension&apos;s{" "}
          <strong className="text-slate-800">Account → Sign in</strong>, not on this dashboard.
          Assign profiles so they can sync and generate. Admins can also use this dashboard after
          signing in here.
        </p>
      </div>

      {banner && (
        <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-r from-emerald-50 to-teal-50/80 p-5 text-sm text-emerald-950 shadow-md shadow-emerald-900/5 ring-1 ring-emerald-100">
          <p className="font-medium leading-relaxed">{banner}</p>
          <button
            type="button"
            className="mt-3 text-sm font-semibold text-emerald-800 underline-offset-2 hover:underline"
            onClick={() => setBanner(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-white/95 p-6 shadow-xl shadow-slate-900/5 ring-1 ring-slate-200/80 backdrop-blur-sm sm:p-8">
        <h3 className="text-base font-bold text-slate-900">Add user</h3>
        <form onSubmit={handleCreateUser} className="mt-5 grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-1">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Username
            </label>
            <input
              type="text"
              autoComplete="off"
              className="dash-input font-mono text-sm"
              placeholder="e.g. jamie"
              value={addUsername}
              onChange={(e) => setAddUsername(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-slate-500">Letters, digits, _ and - only.</p>
          </div>
          <div className="sm:col-span-1">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Display name
            </label>
            <input
              type="text"
              className="dash-input"
              placeholder="Shown in the app"
              value={addDisplayName}
              onChange={(e) => setAddDisplayName(e.target.value)}
            />
          </div>
          <div className="sm:col-span-1">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Initial password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              className="dash-input"
              value={addPassword}
              onChange={(e) => setAddPassword(e.target.value)}
            />
          </div>
          <div className="sm:col-span-1">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Confirm password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              className="dash-input"
              value={addPassword2}
              onChange={(e) => setAddPassword2(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Role
            </label>
            <select
              className="dash-input max-w-xs bg-white"
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as "user" | "admin")}
            >
              <option value="user">User (extension login only)</option>
              <option value="admin">Admin (dashboard + extension)</option>
            </select>
          </div>
          {formError && (
            <p className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {formError}
            </p>
          )}
          <div className="sm:col-span-2 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={creating}
              className="dash-btn dash-btn-primary px-6 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create user"}
            </button>
            <button type="button" onClick={resetAddForm} className="dash-btn">
              Clear form
            </button>
          </div>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white/95 shadow-xl shadow-slate-900/5 ring-1 ring-slate-200/80 backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/95 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-4">Username</th>
              <th className="px-5 py-4">Display name</th>
              <th className="px-5 py-4">Role</th>
              <th className="px-5 py-4">Active</th>
              <th className="px-5 py-4">Profiles</th>
              <th className="px-5 py-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className="transition hover:bg-violet-50/50">
                <td className="px-5 py-4 font-mono text-xs font-medium text-slate-800">{u.username}</td>
                <td className="px-5 py-4 font-medium text-slate-800">{u.display_name}</td>
                <td className="px-5 py-4">
                  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-700 ring-1 ring-slate-200/80">
                    {u.role}
                  </span>
                </td>
                <td className="px-5 py-4 text-slate-600">{u.is_active ? "Yes" : "No"}</td>
                <td className="px-5 py-4 tabular-nums text-slate-600">{u.profile_ids.length}</td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <button
                      type="button"
                      className="text-sm font-semibold text-violet-700 underline-offset-2 hover:underline"
                      onClick={() => openAssign(u)}
                    >
                      Assign profiles
                    </button>
                    <button
                      type="button"
                      className="text-sm font-semibold text-violet-700 underline-offset-2 hover:underline"
                      onClick={() => openSetPassword(u.id)}
                    >
                      Set password
                    </button>
                    <button
                      type="button"
                      className="text-sm font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
                      onClick={() => handleToggleActive(u)}
                    >
                      {u.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pwdUserId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200/80 sm:p-8">
            <h3 className="text-lg font-bold text-slate-900">Set password</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              User will use this password in the extension (and in the dashboard if they are an
              admin).
            </p>
            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  New password
                </label>
                <input
                  type="password"
                  className="dash-input"
                  value={pwd1}
                  onChange={(e) => setPwd1(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Confirm password
                </label>
                <input
                  type="password"
                  className="dash-input"
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                />
              </div>
              {pwdError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                  {pwdError}
                </p>
              )}
            </div>
            <div className="mt-8 flex justify-end gap-3">
              <button type="button" className="dash-btn" onClick={() => setPwdUserId(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={pwdSaving}
                className="dash-btn dash-btn-primary disabled:opacity-50"
                onClick={() => void saveSetPassword()}
              >
                {pwdSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {assignUserId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200/80 sm:p-8">
            <h3 className="text-lg font-bold text-slate-900">Assign profiles</h3>
            <div className="mt-5 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/50 p-3">
              {profiles.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm transition hover:bg-white">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500/40"
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
                  <span className="font-medium text-slate-800">
                    {p.name}{" "}
                    <span className="font-normal text-slate-500">({p.model})</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-8 flex justify-end gap-3">
              <button type="button" className="dash-btn" onClick={() => setAssignUserId(null)}>
                Cancel
              </button>
              <button type="button" className="dash-btn dash-btn-primary" onClick={saveAssign}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
