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

export function UsersView() {
  const [users, setUsers] = useState<User[]>([]);
  const [profiles, setProfiles] = useState<RegisteredProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [assignUserId, setAssignUserId] = useState<number | null>(null);
  const [selectedProfileIds, setSelectedProfileIds] = useState<number[]>([]);

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

  async function handleCreate() {
    const username = prompt("Username (letters, digits, _ or -):", "")?.trim().toLowerCase();
    if (!username) return;
    const password = prompt("Initial password (min 8 characters):", "");
    if (!password || password.length < 8) {
      alert("Password must be at least 8 characters.");
      return;
    }
    const name = prompt("Display name:", username)?.trim();
    if (!name) return;
    const role =
      prompt("Role: admin or user", "user")?.trim().toLowerCase() === "admin"
        ? "admin"
        : "user";
    try {
      await createAdminUser({
        username,
        password,
        display_name: name,
        role,
      });
      setBanner(`Created user “${username}”. Share the password you set with them securely.`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Create failed");
    }
  }

  async function handleSetPassword(id: number) {
    const pw = prompt("New password (min 8 characters):", "");
    if (!pw || pw.length < 8) {
      alert("Password must be at least 8 characters.");
      return;
    }
    if (!confirm("Set a new password? The user must use the new password on next sign-in."))
      return;
    try {
      await setAdminUserPassword(id, pw);
      setBanner("Password updated.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Users</h2>
        <button
          type="button"
          onClick={handleCreate}
          className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800"
        >
          Create user
        </button>
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
                    onClick={() => handleSetPassword(u.id)}
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
