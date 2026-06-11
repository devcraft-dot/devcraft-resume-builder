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
  const [form, setForm] = useState({ name: "", model: "gpt-5.5", profile_text: "" });

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
    setEditing({ id: 0, name: "", model: "gpt-5.5", profile_text: "", created_at: "", updated_at: "" });
    setForm({ name: "", model: "gpt-5.5", profile_text: "" });
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

  if (loading)
    return (
      <div className="flex items-center gap-3 text-sm font-medium text-slate-500">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
        Loading profiles…
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-600/90">
            Content
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Registered profiles
          </h2>
          <p className="mt-2 max-w-xl text-sm text-slate-600">
            Candidate templates used by the extensions for generation.
          </p>
        </div>
        <button type="button" onClick={startCreate} className="dash-btn dash-btn-primary shrink-0">
          New profile
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white/95 shadow-xl shadow-slate-900/5 ring-1 ring-slate-200/80 backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/95 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-4">Name</th>
              <th className="px-5 py-4">Model</th>
              <th className="px-5 py-4">Updated</th>
              <th className="px-5 py-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {profiles.map((p) => (
              <tr key={p.id} className="transition hover:bg-violet-50/50">
                <td className="px-5 py-4 font-medium text-slate-900">{p.name}</td>
                <td className="px-5 py-4 font-mono text-xs text-slate-600">{p.model}</td>
                <td className="px-5 py-4 text-slate-600">
                  {new Date(p.updated_at).toLocaleDateString()}
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <button
                      type="button"
                      className="text-sm font-semibold text-violet-700 underline-offset-2 hover:underline"
                      onClick={() => startEdit(p.id)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-sm font-semibold text-red-600 underline-offset-2 hover:underline"
                      onClick={() => handleDelete(p.id)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200/80 sm:p-8">
            <h3 className="text-lg font-bold text-slate-900">
              {editing.id > 0 ? "Edit profile" : "New profile"}
            </h3>
            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Name
                </label>
                <input
                  className="dash-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Model
                </label>
                <select
                  className="dash-input bg-white"
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
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Profile text
                </label>
                <textarea
                  className="dash-input min-h-[220px] font-mono text-xs leading-relaxed"
                  value={form.profile_text}
                  onChange={(e) => setForm({ ...form, profile_text: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-8 flex justify-end gap-3">
              <button type="button" className="dash-btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className="dash-btn dash-btn-primary" onClick={handleSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
