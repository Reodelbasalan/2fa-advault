// Vault — UI
//
// Owns the DOM and the clock; totp.js owns the maths and store.js owns the
// bytes. Nothing in here knows how a code is derived, and nothing in there
// knows a screen exists.

import { totp, parseSecretInput } from "./totp.js";
import * as store from "./store.js";
import * as ids from "./identities.js";

const $ = (sel) => document.querySelector(sel);

// The saved accounts, plus a per-card render cache so the tick loop can touch
// nodes directly instead of re-querying 30 times a second.
let entries = [];
let cards = new Map(); // id -> { el, digits[], bar, num, counter, code }
let filter = "";

const RING_R = 18;
const RING_C = 2 * Math.PI * RING_R;

// Nobody clicks on a phone. Decided once, from whether the device has a real
// hovering pointer, rather than from screen width — a narrow window on a
// laptop still has a mouse.
const COPY_HINT = matchMedia("(hover: none)").matches ? "Tap to copy" : "Click to copy";

// Boot runs at the BOTTOM of this file, not here. It calls render(), which
// paints immediately, and painting touches `let` bindings declared further
// down — reaching them during module evaluation is a temporal-dead-zone
// ReferenceError that throws inside an async function, so it fails silently
// and the first paint never lands.

/* ══ Rendering ══════════════════════════════════════════════════════════ */

function visible() {
  const q = filter.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) =>
    `${e.issuer} ${e.account}`.toLowerCase().includes(q));
}

function monogram(e) {
  const src = (e.issuer || e.account || "?").trim();
  const words = src.split(/[\s@._-]+/).filter(Boolean);
  // Two characters either way: initials when there are two words, the first
  // two letters when there is one. A lone "O" in a 34px tile reads as a typo.
  const pair = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2);
  return pair.toUpperCase();
}

function render() {
  const grid = $("#grid");
  const list = visible();

  grid.innerHTML = "";
  cards.clear();

  // The section heading is for a section that has something in it. With no
  // saved accounts at all it would sit directly above an empty state already
  // saying the same thing.
  $("#saved-head").hidden = entries.length === 0;

  const none = list.length === 0;
  $("#empty").hidden = !none;
  if (none) {
    // Two different empty states: an empty vault is an invitation, an empty
    // search result is a dead end. Same box, different words.
    const searching = entries.length > 0;
    $("#empty-title").textContent = searching ? "No matches" : "Nothing in the vault yet";
    $("#empty-sub").textContent = searching
      ? `Nothing here matches “${filter.trim()}”.`
      : "Add your first account and its code will appear here, refreshing every 30 seconds.";
    return;
  }

  list.forEach((e, i) => grid.appendChild(buildCard(e, i)));
  paint(true);
}

// Digit cells, built once. Whatever drives them only ever writes textContent
// into these — no innerHTML per second, so a digit can animate on its own.
// Split down the middle, which gives the familiar 3+3 for a six-digit code.
function buildDigits(codeEl, count) {
  codeEl.innerHTML = "";
  const cells = [];
  const half = Math.ceil(count / 2);
  for (let d = 0; d < count; d++) {
    if (d === half) {
      const gap = document.createElement("span");
      gap.className = "code__gap";
      codeEl.appendChild(gap);
    }
    const span = document.createElement("span");
    span.className = "code__d";
    span.textContent = "•";
    codeEl.appendChild(span);
    cells.push(span);
  }
  return cells;
}

function buildCard(entry, i) {
  const el = document.createElement("article");
  el.className = "card";
  el.style.setProperty("--i", i);
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", `Copy code for ${entry.issuer || entry.account}`);

  el.innerHTML = `
    <header class="card__head">
      <span class="card__mono"></span>
      <span class="card__id">
        <span class="card__issuer"></span>
        <span class="card__acct"></span>
      </span>
      <button class="card__del" type="button" aria-label="Remove this account">
        <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7m-7 0 .8 12.1A1.5 1.5 0 0 0 9.3 20.5h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </header>
    <div class="card__body">
      <div class="code"></div>
      <div class="ring">
        <svg viewBox="0 0 42 42">
          <circle class="ring__track" cx="21" cy="21" r="${RING_R}" fill="none" stroke-width="3"/>
          <circle class="ring__bar" cx="21" cy="21" r="${RING_R}" fill="none" stroke-width="3"
                  stroke-dasharray="${RING_C}" stroke-dashoffset="0"/>
        </svg>
        <span class="ring__n"></span>
      </div>
    </div>
    <div class="card__foot">
      <svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M15 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      <span class="card__hint">${COPY_HINT}</span>
    </div>`;

  el.querySelector(".card__mono").textContent = monogram(entry);
  el.querySelector(".card__issuer").textContent = entry.issuer || entry.account || "Account";
  el.querySelector(".card__acct").textContent = entry.issuer ? entry.account : "";

  const digits = buildDigits(el.querySelector(".code"), entry.digits);

  cards.set(entry.id, {
    el,
    digits,
    bar: el.querySelector(".ring__bar"),
    num: el.querySelector(".ring__n"),
    counter: -1,
    code: "",
  });

  // The cursor-tracking light. Percentages so the gradient follows the pointer
  // regardless of card size.
  el.addEventListener("pointermove", (ev) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((ev.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((ev.clientY - r.top) / r.height) * 100}%`);
  });

  el.addEventListener("click", () => copy(entry.id));
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); copy(entry.id); }
  });

  wireDelete(el.querySelector(".card__del"), entry);
  return el;
}

// Delete asks once, in place. A modal for "remove one row" is heavier than the
// action; the button becoming "Remove?" is enough of a speed bump, and it
// disarms itself so an ignored click can't linger as a trap.
function wireDelete(btn, entry) {
  let armed = false;
  let timer = null;

  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!armed) {
      armed = true;
      btn.classList.add("is-arm");
      btn.textContent = "Remove?";
      timer = setTimeout(() => {
        armed = false;
        btn.classList.remove("is-arm");
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7m-7 0 .8 12.1A1.5 1.5 0 0 0 9.3 20.5h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      }, 3200);
      return;
    }
    clearTimeout(timer);
    store.remove(entry.id);
    entries = store.list();
    render();
    toast(`Removed ${entry.issuer || entry.account}`);
  });
}

/* ══ The clock ══════════════════════════════════════════════════════════ */
//
// One rAF loop for every card. The ring is redrawn each frame so the sweep is
// smooth; the CODE is only recomputed when its counter actually changes, which
// is once per period per card — the crypto is not run 60 times a second.

let painting = false;

function tick() {
  paint(false);
  quickTick(); // no-ops until a secret has actually been submitted
  requestAnimationFrame(tick);
}

async function paint(force) {
  if (painting) return;
  painting = true;
  try {
    await repaint(force);
  } finally {
    // In a finally, so one bad entry can't leave the guard stuck true and
    // freeze every card's countdown permanently.
    painting = false;
  }
}

async function repaint(force) {
  const now = Date.now();

  for (const entry of visible()) {
    const c = cards.get(entry.id);
    if (!c) continue;

    const seconds = now / 1000;
    const counter = Math.floor(seconds / entry.period);
    const elapsed = seconds - counter * entry.period;
    const remaining = entry.period - elapsed;

    c.bar.style.strokeDashoffset = String(RING_C * (elapsed / entry.period));
    c.num.textContent = String(Math.ceil(remaining));
    c.el.classList.toggle("is-expiring", remaining <= 5);

    if (force || counter !== c.counter) {
      c.counter = counter;
      const { code } = await totp(entry.secret, {
        now,
        period: entry.period,
        digits: entry.digits,
        algorithm: entry.algorithm,
      });
      setCode(c, code);
    }
  }
}

function setCode(c, code) {
  const prev = c.code;
  c.code = code;
  code.split("").forEach((ch, i) => {
    const cell = c.digits[i];
    if (!cell || cell.textContent === ch) return;
    cell.textContent = ch;
    // Re-trigger the roll even if the class is already present, and stagger it
    // so the change reads as a sweep across the number.
    cell.classList.remove("is-roll");
    void cell.offsetWidth;
    cell.style.animationDelay = `${i * 35}ms`;
    cell.classList.add("is-roll");
  });
  if (!prev) c.digits.forEach((d) => d.classList.remove("is-roll"));
}

/* ══ Copy ═══════════════════════════════════════════════════════════════ */

async function copy(id) {
  const c = cards.get(id);
  if (!c?.code) return;
  try {
    await navigator.clipboard.writeText(c.code);
  } catch {
    return toast("Couldn't reach the clipboard", true);
  }
  c.el.classList.remove("is-copied");
  void c.el.offsetWidth;
  c.el.classList.add("is-copied");
  c.el.querySelector(".card__hint").textContent = "Copied";
  setTimeout(() => {
    c.el.classList.remove("is-copied");
    const hint = c.el.querySelector(".card__hint");
    if (hint) hint.textContent = COPY_HINT;
  }, 1400);
}

/* ══ Quick code ═════════════════════════════════════════════════════════ */
//
// The plain online tools' whole flow: paste a secret, press a button, get a
// code, copy it — and nothing is written down. It sits on the landing page
// rather than behind a button because it is the one thing most people arrive
// here to do, and a click to reach it is a click too many.

let quick = null; // { parsed, digits, code, counter } while a code is on screen

// The waiting state: six placeholder cells, an empty ring and a dead Copy
// button. Same layout as a real code, so nothing moves when one arrives.
function resetQuickOut() {
  quick = null;
  const out = $("#q-out");
  out.classList.add("is-idle");
  out.classList.remove("is-expiring");
  buildDigits($("#q-code"), 6).forEach((cell) => { cell.textContent = "–"; });
  const ring = $("#q-ring");
  ring.querySelector(".ring__bar").style.strokeDashoffset = String(RING_C);
  ring.querySelector(".ring__n").textContent = "";
  $("#q-copy").disabled = true;
  $("#q-copy-label").textContent = "Copy";
}

$("#quick-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = $("#q-secret").value.trim();
  const err = $("#q-err");
  err.hidden = true;

  if (!raw) return quickErr("Paste a 2FA secret first.");

  let parsed;
  try {
    parsed = parseSecretInput(raw);
  } catch (ex) {
    return quickErr(ex.message);
  }

  $("#q-out").classList.remove("is-idle");
  $("#q-copy").disabled = false;
  quick = {
    parsed,
    digits: buildDigits($("#q-code"), parsed.digits),
    code: "",
    counter: -1,
  };
  await quickTick();
});

function quickErr(msg) {
  const el = $("#q-err");
  el.textContent = msg;
  el.hidden = false;
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  // The output stays on screen, but goes back to waiting — a stale code sitting
  // under a fresh error message is the worst of both.
  resetQuickOut();
}

// Same treatment the cards get: the code refreshes itself and the ring shows
// how long it has left. Without that you are pasting a code with no idea
// whether it is about to expire — which is most of what goes wrong with the
// paste-and-submit sites.
async function quickTick() {
  if (!quick) return;
  const { parsed } = quick;
  const now = Date.now();
  const seconds = now / 1000;
  const counter = Math.floor(seconds / parsed.period);
  const elapsed = seconds - counter * parsed.period;
  const remaining = parsed.period - elapsed;

  const ring = $("#q-ring");
  ring.querySelector(".ring__bar").style.strokeDashoffset =
    String(RING_C * (elapsed / parsed.period));
  ring.querySelector(".ring__n").textContent = String(Math.ceil(remaining));
  $("#q-out").classList.toggle("is-expiring", remaining <= 5);

  if (counter !== quick.counter) {
    quick.counter = counter;
    const { code } = await totp(parsed.secret, {
      now,
      period: parsed.period,
      digits: parsed.digits,
      algorithm: parsed.algorithm,
    });
    setCode(quick, code);
  }
}

$("#q-copy").addEventListener("click", async () => {
  if (!quick?.code) return;
  try {
    await navigator.clipboard.writeText(quick.code);
  } catch {
    return toast("Couldn't reach the clipboard", true);
  }
  $("#q-copy-label").textContent = "Copied";
  setTimeout(() => { $("#q-copy-label").textContent = "Copy"; }, 1400);
  toast("Code copied");
});

/* ══ Add sheet ══════════════════════════════════════════════════════════ */

let pending = null; // the parsed entry, or null while the input is unusable

function openSheet() {
  $("#scrim").hidden = false;
  $("#sheet").hidden = false;
  $("#secret").focus();
}

function closeSheet() {
  $("#scrim").hidden = true;
  $("#sheet").hidden = true;
  $("#add-form").reset();
  $("#add-err").hidden = true;
  $("#preview").dataset.state = "idle";
  $("#preview-code").textContent = "– – –  – – –";
  $("#preview-label").textContent = "Preview";
  $("#add-save").disabled = true;
  pending = null;
}

$("#add-open").addEventListener("click", openSheet);
$("#add-close").addEventListener("click", closeSheet);
$("#add-cancel").addEventListener("click", closeSheet);
$("#scrim").addEventListener("click", closeSheet);

// Reads the secret box on every keystroke and shows the code it would produce.
// Debounced only lightly — this is local maths, not a network call.
let previewTimer = null;
$("#secret").addEventListener("input", () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 180);
});

async function updatePreview() {
  const raw = $("#secret").value.trim();
  const box = $("#preview");
  $("#add-err").hidden = true;

  if (!raw) {
    pending = null;
    box.dataset.state = "idle";
    $("#preview-code").textContent = "– – –  – – –";
    $("#add-save").disabled = true;
    return;
  }

  let parsed;
  try {
    parsed = parseSecretInput(raw);
  } catch (err) {
    pending = null;
    box.dataset.state = "bad";
    $("#preview-label").textContent = "Not valid";
    $("#preview-code").textContent = err.message;
    $("#add-save").disabled = true;
    return;
  }

  // An otpauth:// link carries the names too — fill them in, but never
  // overwrite something already typed by hand.
  if (parsed.issuer && !$("#issuer").value) $("#issuer").value = parsed.issuer;
  if (parsed.account && !$("#account").value) $("#account").value = parsed.account;

  const { code } = await totp(parsed.secret, {
    now: Date.now(),
    period: parsed.period,
    digits: parsed.digits,
    algorithm: parsed.algorithm,
  });

  pending = parsed;
  box.dataset.state = "ok";
  $("#preview-label").textContent = "Code now";
  const half = Math.ceil(code.length / 2);
  $("#preview-code").textContent = `${code.slice(0, half)} ${code.slice(half)}`;
  $("#add-save").disabled = false;
}

$("#add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!pending) return;
  try {
    store.add({
      issuer: $("#issuer").value.trim(),
      account: $("#account").value.trim(),
      secret: pending.secret,
      algorithm: pending.algorithm,
      digits: pending.digits,
      period: pending.period,
    });
  } catch (err) {
    // localStorage can still refuse a write — a full quota, or Safari's private
    // mode. Saying so beats a card that silently never appears.
    const el = $("#add-err");
    el.textContent = err.message;
    el.hidden = false;
    return;
  }
  entries = store.list();
  const name = $("#issuer").value.trim() || $("#account").value.trim() || "account";
  closeSheet();
  filter = "";
  $("#search").value = "";
  render();
  toast(`Added ${name}`);
});

/* ══ Search and keys ════════════════════════════════════════════════════ */

$("#search").addEventListener("input", (e) => {
  filter = e.target.value;
  render();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#sheet").hidden) closeSheet();
  // "/" to search is the convention everywhere else that has a search box.
  if (e.key === "/" && document.activeElement?.tagName !== "INPUT"
      && document.activeElement?.tagName !== "TEXTAREA") {
    e.preventDefault();
    $("#search").focus();
  }
});

/* ══ Toast ══════════════════════════════════════════════════════════════ */

let toastTimer = null;
function toast(msg, bad = false) {
  const el = $("#toast");
  el.innerHTML = bad
    ? `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.9"/><line x1="12" y1="7.5" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.1" fill="currentColor"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  el.appendChild(document.createTextNode(msg));
  el.hidden = false;
  el.classList.remove("is-out");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add("is-out");
    setTimeout(() => { el.hidden = true; }, 250);
  }, 2000);
}

/* ══ Generator ══════════════════════════════════════════════════════════ */
//
// Random email + password for filling a signup form. Same promise as the rest
// of the app: made locally with crypto.getRandomValues, nothing saved,
// nothing sent. The email is a display value — a plausible-looking random
// address, not a working inbox.

const GEN_DOMAINS = ["gmail.com", "outlook.com", "proton.me", "yahoo.com", "icloud.com"];
const GEN_WORDS = ["max", "leo", "nova", "kai", "sky", "rio", "zed", "ash", "jax", "fox", "ace", "rey"];

// Uniform pick from an array using rejection sampling, so no modulo bias.
function pick(arr) {
  const max = 256 - (256 % arr.length);
  const buf = new Uint8Array(1);
  let v;
  do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= max);
  return arr[v % arr.length];
}

function randDigits(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += String(pick("0123456789".split("")));
  return s;
}

function randEmail() {
  return `${pick(GEN_WORDS)}${pick(GEN_WORDS)}${randDigits(3)}@${pick(GEN_DOMAINS)}`;
}

// 16 chars from a set with no lookalikes (no 0/O, 1/l/I), guaranteed at least
// one of each class so it satisfies the usual signup rules.
function randPassword() {
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const nums  = "23456789";
  const syms  = "!@#$%^&*?-_+";
  const all = lower + upper + nums + syms;
  const out = [pick(lower.split("")), pick(upper.split("")), pick(nums.split("")), pick(syms.split(""))];
  for (let i = out.length; i < 16; i++) out.push(pick(all.split("")));
  // Fisher–Yates so the guaranteed four aren't stuck at the front.
  for (let i = out.length - 1; i > 0; i--) {
    const j = pick([...Array(i + 1).keys()]);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

function generate() {
  $("#gen-email").textContent = randEmail();
  $("#gen-pass").textContent = randPassword();
}

async function genCopy(valId, btnId, label) {
  const text = $(valId).textContent;
  if (!text || text === "–") return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return toast("Couldn't reach the clipboard", true);
  }
  const btn = $(btnId);
  btn.classList.add("is-copied");
  setTimeout(() => btn.classList.remove("is-copied"), 1400);
  toast(`${label} copied`);
}

$("#gen-new").addEventListener("click", generate);
$("#gen-email-copy").addEventListener("click", () => genCopy("#gen-email", "#gen-email-copy", "Email"));
$("#gen-pass-copy").addEventListener("click", () => genCopy("#gen-pass", "#gen-pass-copy", "Password"));

/* ══ Saved identities ═══════════════════════════════════════════════════ */
//
// The kept email/password rows. A passphrase GATE hides the list in the UI —
// this is casual cover, not encryption: the rows sit in localStorage in the
// clear and DevTools shows them regardless. The passphrase is checked here in
// the client, so it is not a secret from anyone who reads this file either.

// Change this to whatever you want. It's a UI gate, not real protection.
const IDS_PASSPHRASE = "admin123";

let idsUnlocked = false;

function renderIdentities() {
  const listEl = $("#ids-list");
  const emptyEl = $("#ids-empty");
  const rows = ids.list();

  listEl.innerHTML = "";
  emptyEl.hidden = rows.length > 0;

  for (const r of rows) {
    const el = document.createElement("div");
    el.className = "idrow";
    el.innerHTML = `
      <span class="idrow__label"></span>
      <div class="idrow__row2">
        <div class="idrow__pair"><span class="idrow__k">Email</span><span class="idrow__v" data-email></span></div>
        <div class="idrow__pair"><span class="idrow__k">Pass</span><span class="idrow__v idrow__v--mono" data-pass></span></div>
      </div>
      <div class="idrow__acts">
        <button class="idrow__btn" data-copy="email" aria-label="Copy email"><svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M15 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        <button class="idrow__btn" data-copy="pass" aria-label="Copy password"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="9" width="16" height="12" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M8 9V6.5a4 4 0 0 1 8 0V9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        <button class="idrow__btn idrow__btn--del" data-del aria-label="Delete"><svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7m-7 0 .8 12.1A1.5 1.5 0 0 0 9.3 20.5h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>`;

    // textContent, never innerHTML — a generated value is never treated as markup.
    el.querySelector(".idrow__label").textContent = r.label || "";
    el.querySelector("[data-email]").textContent = r.email;
    el.querySelector("[data-pass]").textContent = r.password;

    el.querySelector('[data-copy="email"]').addEventListener("click", (ev) => idCopy(ev.currentTarget, r.email, "Email"));
    el.querySelector('[data-copy="pass"]').addEventListener("click", (ev) => idCopy(ev.currentTarget, r.password, "Password"));
    el.querySelector("[data-del]").addEventListener("click", () => {
      ids.remove(r.id);
      renderIdentities();
      toast("Removed");
    });

    listEl.appendChild(el);
  }
}

async function idCopy(btn, text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return toast("Couldn't reach the clipboard", true);
  }
  btn.classList.add("is-copied");
  setTimeout(() => btn.classList.remove("is-copied"), 1400);
  toast(`${label} copied`);
}

function unlockIdentities() {
  idsUnlocked = true;
  $("#ids-gate").hidden = true;
  $("#ids-list").hidden = false;
  $("#ids-lock").hidden = false;
  $("#ids-pass").value = "";
  renderIdentities();
}

function lockIdentities() {
  idsUnlocked = false;
  $("#ids-gate").hidden = false;
  $("#ids-list").hidden = true;
  $("#ids-empty").hidden = true;
  $("#ids-lock").hidden = true;
}

$("#ids-gate-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const err = $("#ids-err");
  if ($("#ids-pass").value === IDS_PASSPHRASE) {
    err.hidden = true;
    unlockIdentities();
  } else {
    err.textContent = "Wrong passphrase.";
    err.hidden = false;
    $("#ids-pass").value = "";
  }
});

$("#ids-lock").addEventListener("click", lockIdentities);

$("#gen-save").addEventListener("click", () => {
  const email = $("#gen-email").textContent;
  const password = $("#gen-pass").textContent;
  if (!email || email === "–") return;
  ids.add({ label: $("#gen-label").value.trim(), email, password });
  $("#gen-label").value = "";
  toast("Saved");
  // Refresh the list if it's already open; otherwise it'll show on unlock.
  if (idsUnlocked) renderIdentities();
});

/* ══ Boot ═══════════════════════════════════════════════════════════════ */
//
// Straight into the list. No passphrase, no unlock step, no waiting. Last in
// the file so every declaration above has already been evaluated.

entries = store.list();
render();
resetQuickOut();
generate();
lockIdentities();
tick();
