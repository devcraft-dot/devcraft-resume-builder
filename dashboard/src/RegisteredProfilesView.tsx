import { useCallback, useEffect, useState } from "react";
import {
  createRegisteredProfile,
  deleteRegisteredProfile,
  fetchRegisteredProfiles,
  patchRegisteredProfile,
} from "./api/client";
import type { RegisteredProfile } from "./api/types";

export function RegisteredProfilesView() {
  const [rows, setRows] = useState<RegisteredProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const list = await fetchRegisteredProfiles();
      setRows(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onCreate() {
    setErr(null);
    setBusy(true);
    try {
      await createRegisteredProfile({
        name: newName.trim(),
        profile_text: newText,
      });
      setNewName("");
      setNewText("");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    if (!window.confirm("Delete this registered profile?")) return;
    setErr(null);
    try {
      await deleteRegisteredProfile(id);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="max-w-4xl">
      <p className="text-sm text-gray-600 mb-4">
        These names and texts are the source of truth when the extension mints a token and calls{" "}
        <code className="text-xs bg-gray-100 px-1 rounded">/api/generate/manual</code>. The server
        replaces client-supplied profile text with the text stored here.
      </p>
      {err && (
        <p className="text-sm text-red-600 mb-4 whitespace-pre-wrap break-words">{err}</p>
      )}
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <ul className="space-y-4 mb-8">
          {rows.map((r) => (
            <RegisteredProfileCard key={r.id} row={r} onSaved={reload} onDelete={() => onDelete(r.id)} />
          ))}
          {!rows.length && (
            <li className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg p-6 text-center">
              No profiles yet. Add one below (requires{" "}
              <code className="text-xs">ADMIN_API_KEY</code> on the server and the same key here).
            </li>
          )}
        </ul>
      )}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Add profile</h2>
        <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">
          Profile name
        </label>
        <input
          type="text"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Exact name the extension will use"
        />
        <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">
          Profile text (resume)
        </label>
        <textarea
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 min-h-[160px] font-mono"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Full resume / profile text"
        />
        <button
          type="button"
          disabled={busy || !newName.trim() || !newText.trim()}
          onClick={() => void onCreate()}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Create"}
        </button>
      </div>
    </div>
  );
}

function RegisteredProfileCard({
  row,
  onSaved,
  onDelete,
}: {
  row: RegisteredProfile;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [text, setText] = useState(row.profile_text);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(row.name);
    setText(row.profile_text);
  }, [row.id, row.name, row.profile_text]);

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      await patchRegisteredProfile(row.id, {
        name: name.trim(),
        profile_text: text,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs text-gray-500">id {row.id}</span>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs font-medium text-red-600 hover:text-red-800"
        >
          Delete
        </button>
      </div>
      <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">
        Name
      </label>
      <input
        type="text"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">
        Profile text
      </label>
      <textarea
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 min-h-[140px] font-mono"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      <button
        type="button"
        disabled={saving || !name.trim() || !text.trim()}
        onClick={() => void save()}
        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
    </li>
  );
}
