import { useCallback, useEffect, useState } from "react";
import {
  createAdminUser,
  fetchAdminProfiles,
  fetchAdminUsers,
  patchAdminUser,
  rotateAdminUserToken,
  setAdminUserProfiles,
} from "./api/client";
import type { RegisteredProfileSummary, User } from "./api/types";

export function UsersView() {
  const [users, setUsers] = useState<User[]>([]);
  const [profiles, setProfiles] = useState<RegisteredProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
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
    const name = prompt("Display name for new user:");
    if (!name?.trim()) return;
    const role =
      prompt("Role: admin or user", "user")?.trim().toLowerCase() === "admin"
        ? "admin"
        : "user";
    try {
      const created = await createAdminUser({
        display_name: name.trim(),
        role,
      });
      setNewToken(created.api_token);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Create failed");
    }
  }

  async function handleRotate(id: number) {
    if (!confirm("Rotate token? The old token stops working immediately.")) return;
    try {
      const res = await rotateAdminUserToken(id);
      setNewToken(res.api_token);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Rotate failed");
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

      {newToken && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-amber-900">
            Copy this token now — it won’t be shown again:
          </p>
          <code className="block mt-2 break-all text-xs bg-white p-2 rounded border">
            {newToken}
          </code>
          <button
            type="button"
            className="mt-2 text-amber-800 underline"
            onClick={() => navigator.clipboard.writeText(newToken)}
          >
            Copy to clipboard
          </button>
          <button
            type="button"
            className="ml-4 text-amber-800 underline"
            onClick={() => setNewToken(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3">Profiles</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-gray-100">
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
                    onClick={() => handleRotate(u.id)}
                  >
                    Rotate token
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

