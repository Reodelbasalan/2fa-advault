// Vault — TOTP engine self-test
//
//   node totp.test.mjs
//
// The official vectors from RFC 4226 Appendix D and RFC 6238 Appendix B. If
// these pass, the codes this produces are the same codes Google Authenticator
// produces — checked here, on this machine, instead of by logging into a real
// account and hoping.

import { totp, hotp, base32Decode, parseOtpauth, parseSecretInput } from "./totp.js";

let pass = 0;
const failures = [];

function check(name, actual, expected) {
  if (actual === expected) { pass++; return; }
  failures.push(`${name}\n     expected ${expected}\n     actual   ${actual}`);
}

const ascii = (s) => new TextEncoder().encode(s);

// ---- RFC 4226 Appendix D: HOTP, secret "12345678901234567890", 6 digits ----
const HOTP_SECRET = ascii("12345678901234567890");
const HOTP = ["755224", "287082", "359152", "969429", "338314",
              "254676", "287922", "162583", "399871", "520489"];

for (let c = 0; c < HOTP.length; c++) {
  check(`HOTP counter=${c}`, await hotp(HOTP_SECRET, c), HOTP[c]);
}

// ---- RFC 6238 Appendix B: TOTP, 8 digits, 30s ----
//
// Each algorithm has its own seed length in the RFC — the SHA-256 and SHA-512
// rows are NOT the SHA-1 seed re-used, which is the classic way to "fail" a
// working implementation.
const SEEDS = {
  SHA1: ascii("12345678901234567890"),
  SHA256: ascii("12345678901234567890123456789012"),
  SHA512: ascii("1234567890123456789012345678901234567890123456789012345678901234"),
};

const VECTORS = [
  [59,          "94287082", "46119246", "90693936"],
  [1111111109,  "07081804", "68084774", "25091201"],
  [1111111111,  "14050471", "67062674", "99943326"],
  [1234567890,  "89005924", "91819424", "93441116"],
  [2000000000,  "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"],
];

for (const [t, sha1, sha256, sha512] of VECTORS) {
  for (const [algorithm, expected] of [["SHA1", sha1], ["SHA256", sha256], ["SHA512", sha512]]) {
    const r = await totp(SEEDS[algorithm], { now: t * 1000, digits: 8, algorithm });
    check(`TOTP t=${t} ${algorithm}`, r.code, expected);
  }
}

// ---- Base32 ----
const decoded = new TextDecoder().decode(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"));
check("base32 decode", decoded, "12345678901234567890");
// The same secret as a human would paste it back out of a setup screen.
check(
  "base32 tolerates spacing/case/padding",
  new TextDecoder().decode(base32Decode("gezd gnbv gy3t qojq-GEZDGNBVGY3TQOJQ===")),
  "12345678901234567890",
);
for (const bad of ["", "ABC1DEF", "!!!!"]) {
  let threw = false;
  try { base32Decode(bad); } catch { threw = true; }
  check(`base32 rejects ${JSON.stringify(bad)}`, threw, true);
}

// ---- Window bookkeeping (what the countdown ring renders) ----
{
  const r = await totp("GEZDGNBVGY3TQOJQ", { now: 1_000_000_025_000 });
  check("remaining", r.remaining, 30 - (Math.floor(1_000_000_025_000 / 1000) % 30));
  const same = await totp("GEZDGNBVGY3TQOJQ", { now: 1_000_000_026_000 });
  check("code is stable inside a window", same.code, r.code);
}

// ---- otpauth:// ----
{
  const p = parseOtpauth(
    "otpauth://totp/AdFlow:adgenius28%40gmail.com?secret=GEZDGNBVGY3TQOJQ&issuer=OpenAI&digits=8&period=60&algorithm=SHA256",
  );
  check("otpauth account", p.account, "adgenius28@gmail.com");
  check("otpauth issuer param wins over label", p.issuer, "OpenAI");
  check("otpauth secret", p.secret, "GEZDGNBVGY3TQOJQ");
  check("otpauth digits", p.digits, 8);
  check("otpauth period", p.period, 60);
  check("otpauth algorithm", p.algorithm, "SHA256");

  const bare = parseOtpauth("otpauth://totp/just-an-account?secret=GEZDGNBVGY3TQOJQ");
  check("otpauth label without issuer", bare.account, "just-an-account");
  check("otpauth defaults digits", bare.digits, 6);

  const plain = parseSecretInput("gezd gnbv gy3t qojq");
  check("plain secret normalised", plain.secret, "GEZDGNBVGY3TQOJQ");
  check("plain secret defaults period", plain.period, 30);
}

// ---- Report ----
if (failures.length) {
  console.log(`\n  ${pass} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`\n  ✓ ${pass} checks passed — RFC 4226 + RFC 6238 vectors match\n`);
