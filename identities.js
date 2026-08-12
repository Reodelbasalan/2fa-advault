// Saved identities (email + password pairs)
//
// The generated email/password rows the user chose to keep, in localStorage —
// same as store.js, and with the same caveat: stored IN THE CLEAR. The
// passphrase gate in app.js only hides this list from a casual glance in the
// UI; it is NOT encryption. Anyone who opens DevTools can read every row here.
// Don't save anything here you'd truly need protected.

const KEY = "vault.identities.v1";

export function list() {
  try {
    const rows = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function save(rows) {
  localStorage.setItem(KEY, JSON.stringify(rows));
}

export function add(entry) {
  const rows = list();
  const row = {
    id: "id" + Date.now() + Math.random().toString(36).slice(2, 6),
    label: entry.label || "",
    email: entry.email || "",
    password: entry.password || "",
    status: entry.status || "new",
    ts: Date.now(),
  };
  rows.unshift(row); // newest first
  save(rows);
  return row;
}

export function setStatus(id, status) {
  const rows = list();
  const row = rows.find((e) => e.id === id);
  if (row) { row.status = status; save(rows); }
}

export function remove(id) {
  save(list().filter((e) => e.id !== id));
}
