# Vault

A 2FA (TOTP) code generator that runs entirely in your own browser.

Same six digits as Google Authenticator or Authy — generated locally, from
secrets that never leave your machine. No account, no login, no licence key,
no server.

---

## Why not just use a website

The usual online 2FA generators ask you to paste your secret key into a text
box on their page. That secret is not a password: it **is** the second factor,
permanently, for every future login on that account. Once it leaves your
machine you have no way to know what happened to it, and no way to take it
back.

This app never sends it anywhere. There is no server and no API call. The
page's Content-Security-Policy sets `connect-src 'none'`, so the browser itself
would block a network request — not merely the absence of one, but a rule that
makes adding one later fail loudly.

Unplug your internet and it still works.

---

## Running it

Needs [Node](https://nodejs.org) — only to serve the files locally. There are
no dependencies to install.

```bash
node serve.mjs
```

Then open **http://127.0.0.1:8787**.

The server binds to `127.0.0.1`, so it is not reachable from anywhere else on
your network. Opening `index.html` directly as a `file://` URL will not work:
browsers refuse to load ES modules over `file://`.

### Putting it online

These are plain static files, so any static host will serve them — GitHub Pages
straight from this repo needs no build step and no configuration. `serve.mjs`
is only for working on it locally.

One thing to be clear about if you do host it: served over HTTPS, the page
still does all its work in the visitor's browser and still cannot phone home.
But visitors are then trusting *you* to keep serving honest JavaScript, which
is a promise a downloaded copy doesn't ask anyone to make.

---

## Using it

It opens straight to the page. There is nothing to log into.

### Quick code

On the landing page itself, not behind a button: paste a secret on the left,
press *Get code*, and it appears on the right. Copy it. Nothing is written to
disk — this is for a secret you were handed once, for an account you don't want
left in this browser.

Unlike the paste-and-submit websites, the code refreshes itself and shows how
many seconds it has left, so you are never pasting one that is about to expire.

### Saved accounts

**Add account** takes either the Base32 secret (`JBSWY3DPEHPK3PXP`) or the
whole `otpauth://totp/…` link that a QR code encodes. Spaces, hyphens and lower
case are all fine, and the link fills in the name for you. A live preview shows
the code the secret produces *before* you save it, so you can check it against
the app you are migrating from.

**Click a card** to put its code on your clipboard. The ring counts down the
seconds and turns red for the last five.

Press `/` to jump to the search box.

---

## What this protects, and what it doesn't

| | |
|---|---|
| **Network** | None. Enforced by CSP, not by convention. |
| **At rest** | Saved accounts sit in `localStorage` **in the clear**. |

That second row is the important one. There is no passphrase, which means
there is nothing to forget and nothing to type — and also no encryption.
Anyone who can open this browser profile can read every secret you have saved.

If that matters for a particular account, don't save it: use **Quick code**,
which keeps nothing.

Nothing browser-based protects against malware already running as you, or
someone reading your screen.

---

## What's in here

| File | |
|---|---|
| `totp.js` | The TOTP engine — RFC 6238 / RFC 4226. Pure: no DOM, no storage, no clock of its own. |
| `totp.test.mjs` | The official RFC test vectors. |
| `store.js` | Reading and writing the saved accounts. |
| `app.js` | UI, and the clock that drives it. |
| `app.css` | The visual system. |
| `serve.mjs` | A zero-dependency local static server. |

### Tests

```bash
node totp.test.mjs
```

45 checks: every HOTP vector from RFC 4226 Appendix D, every TOTP vector from
RFC 6238 Appendix B across SHA-1/SHA-256/SHA-512, plus Base32 edge cases and
`otpauth://` parsing. If these pass, the codes this produces are the codes your
authenticator app produces.

---

## Not built yet

- Export / import (no way to move your accounts between machines)
- QR code scanning from an image or the camera
- Reordering and folders
- An optional passphrase, for people who want the encryption back

---

## Licence

MIT — see [LICENSE](LICENSE). That is the open-source licence saying anyone may
use this code. It is not a licence key: there is nothing to activate.
