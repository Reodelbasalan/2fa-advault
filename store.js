// Storage
//
// The saved accounts, in localStorage. No passphrase, no encryption, no
// unlocking — the app opens straight to the list.
//
// Be clear about what that costs: a TOTP secret is not a password, it IS the
// second factor for every future login on that account. Stored in the clear,
// anyone who can open this browser profile can read every one of them. That is
// the deliberate trade for having no login; the Quick code screen, which saves
// nothing at all, is there for secrets you do not want left behind.

const KEY = "vault.accounts.v1";

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
  const row = { id: "v" + Date.now() + Math.random().toString(36).slice(2, 6), ...entry };
  rows.push(row);
  save(rows);
  return row;
}

export function remove(id) {
  save(list().filter((e) => e.id !== id));
}
