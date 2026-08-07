// Vault — TOTP engine (RFC 6238 / RFC 4226)
//
// The whole of what a "2FA code generator" is. Deliberately PURE: no DOM, no
// chrome.* , no storage, no clock of its own — `now` is always passed in. That
// is what lets totp.test.mjs run the official RFC vectors under plain node and
// prove the maths before any of it reaches a real account.
//
// Nothing leaves this machine. The secret is turned into a code with
// crypto.subtle locally; there is no request anywhere in this file. That is the
// entire reason for not using a site like 2fa.live — pasting a secret into a
// web page hands over the one thing that IS the second factor.

// ---- Base32 (RFC 4648) ----
//
// Authenticator secrets are Base32 and are shown to humans, so they arrive with
// spaces, lowercase, and sometimes "=" padding. All of that is noise: strip it
// rather than reject it, otherwise a correctly-copied secret fails for having a
// space in it.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input) {
  const s = String(input || "").toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!s) throw new Error("Empty secret");

  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    // 0/1/8/9 are the usual typos — they look like O/I/B/g but aren't in the
    // alphabet. Naming the character beats a generic "invalid secret".
    if (idx === -1) throw new Error(`Not a Base32 character: "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  if (!out.length) throw new Error("Secret is too short");
  return new Uint8Array(out);
}

// ---- HMAC ----
//
// Web Crypto, which exists in the service worker, in the side panel and in
// node >=16 — so one implementation covers every place AdFlow runs.
const HASHES = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };

function hashName(algorithm) {
  const key = String(algorithm || "SHA1").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const name = HASHES[key];
  if (!name) throw new Error(`Unsupported algorithm: ${algorithm}`);
  return name;
}

async function hmac(keyBytes, msgBytes, algorithm) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: { name: hashName(algorithm) } },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, msgBytes));
}

// The RFC 4226 moving factor: an 8-byte big-endian counter. Written through a
// DataView rather than bit-shifts because a JS bitwise op truncates to 32 bits,
// which would silently wrap the counter instead of filling the top four bytes.
function counterBytes(counter) {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  return buf;
}

// ---- HOTP / TOTP ----

/** RFC 4226 counter-based code. TOTP is this with counter = time / period. */
export async function hotp(secretBytes, counter, { digits = 6, algorithm = "SHA1" } = {}) {
  const mac = await hmac(secretBytes, counterBytes(counter), algorithm);
  // Dynamic truncation: the low nibble of the LAST byte picks where to read,
  // so the 4 bytes used vary per code instead of always being the same window.
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/**
 * The code for `secret` at time `now` (ms since epoch — always passed in, never
 * read from the clock here).
 *
 * Returns the code plus the window it belongs to, because the UI needs to know
 * how long it stays valid and that is the same division we just did.
 */
export async function totp(secret, { now = 0, period = 30, digits = 6, algorithm = "SHA1", offset = 0 } = {}) {
  const bytes = typeof secret === "string" ? base32Decode(secret) : secret;
  const seconds = Math.floor(now / 1000) + offset;
  const counter = Math.floor(seconds / period);
  const code = await hotp(bytes, counter, { digits, algorithm });
  return {
    code,
    counter,
    /** Seconds until this code expires — drives the countdown ring. */
    remaining: period - (seconds - counter * period),
  };
}

// ---- otpauth:// ----
//
// What a QR code actually encodes. Supporting it means a secret can be pasted
// as the whole URI, which is what most "show me the setup key" screens hand
// over, instead of the user hunting for the secret= part inside it.
export function parseOtpauth(uri) {
  const raw = String(uri || "").trim();
  if (!/^otpauth:\/\//i.test(raw)) throw new Error("Not an otpauth:// URI");

  const url = new URL(raw);
  const type = url.hostname.toLowerCase();
  if (type !== "totp") throw new Error(`Unsupported otpauth type: ${type}`);

  const secret = url.searchParams.get("secret");
  if (!secret) throw new Error("URI has no secret");

  // The label is "Issuer:account", where the issuer half is optional and the
  // issuer= param wins over it when both are present.
  const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const sep = label.indexOf(":");
  const labelIssuer = sep === -1 ? "" : label.slice(0, sep).trim();
  const account = (sep === -1 ? label : label.slice(sep + 1)).trim();

  const digits = parseInt(url.searchParams.get("digits") || "6", 10);
  const period = parseInt(url.searchParams.get("period") || "30", 10);

  return {
    account,
    issuer: (url.searchParams.get("issuer") || labelIssuer).trim(),
    secret,
    algorithm: (url.searchParams.get("algorithm") || "SHA1").toUpperCase(),
    digits: Number.isFinite(digits) && digits >= 6 && digits <= 10 ? digits : 6,
    period: Number.isFinite(period) && period > 0 ? period : 30,
  };
}

/**
 * Accepts either form the user might paste — a bare Base32 secret or a full
 * otpauth:// URI — and normalises to one shape. One input box, no mode switch.
 */
export function parseSecretInput(text) {
  const raw = String(text || "").trim();
  if (/^otpauth:\/\//i.test(raw)) return parseOtpauth(raw);
  base32Decode(raw); // throws with a useful message if it isn't valid Base32
  return {
    account: "",
    issuer: "",
    secret: raw.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, ""),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  };
}
