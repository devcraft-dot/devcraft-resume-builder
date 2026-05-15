import { useCallback, useEffect, useState } from "react";
import {
  createAdminProfile,
  deleteAdminProfile,
  fetchAdminProfile,
  fetchAdminProfiles,
  patchAdminProfile,
} from "./api/client";
import { ALLOWED_MODELS } from "./api/types";
import type { RegisteredProfile, RegisteredProfileSummary } from "./api/types";

export function ProfilesView() {
  const [profiles, setProfiles] = useState<RegisteredProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RegisteredProfile | null>(null);
  const [form, setForm] = useState({ name: "", model: "gpt-5.4-mini", profile_text: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProfiles(await fetchAdminProfiles());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startCreate() {
    setEditing({ id: 0, name: "", model: "gpt-5.4-mini", profile_text: "", created_at: "", updated_at: "" });
    setForm({ name: "", model: "gpt-5.4-mini", profile_text: "" });
  }

  async function startEdit(id: number) {
    const p = await fetchAdminProfile(id);
    setEditing(p);
    setForm({ name: p.name, model: p.model, profile_text: p.profile_text });
  }

  async function handleSave() {
    if (!form.name.trim() || !form.profile_text.trim()) {
      alert("Name and profile text are required");
      return;
    }
    try {
      if (editing && editing.id > 0) {
        await patchAdminProfile(editing.id, form);
      } else {
        await createAdminProfile(form);
      }
      setEditing(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this profile? Assignments will be removed.")) return;
    try {
      await deleteAdminProfile(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  if (loading) return <p className="text-gray-500">Loading profiles…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Registered profiles</h2>
        <button
          type="button"
          onClick={startCreate}
          className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800"
        >
          New profile
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-t border-gray-100">
                <td className="px-4 py-3">{p.name}</td>
                <td className="px-4 py-3">{p.model}</td>
                <td className="px-4 py-3">
                  {new Date(p.updated_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 space-x-2">
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => startEdit(p.id)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-red-600 hover:underline"
                    onClick={() => handleDelete(p.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full shadow-lg max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold mb-4">
              {editing.id > 0 ? "Edit profile" : "New profile"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                >
                  {ALLOWED_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Profile text
                </label>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[200px] font-mono"
                  value={form.profile_text}
                  onChange={(e) => setForm({ ...form, profile_text: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button
                type="button"
                className="px-3 py-1.5 text-sm border rounded-lg"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg"
                onClick={handleSave}
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
