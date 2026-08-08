// Vault — landing page
//
// Two jobs: run the live code demo in the hero (the real engine, so the pitch
// proves itself), and reveal sections as they scroll into view.

import { totp } from "./totp.js";

// The public RFC 6238 test secret. Deliberately not a real account — it exists
// in the standard itself, so showing a live code from it gives nothing away.
const DEMO_SECRET = "GEZDGNBVGY3TQOJQ";
const RING_C = 2 * Math.PI * 18;

const codeEl = document.querySelector("#demo-code");
const ringBar = document.querySelector("#demo-ring .ring__bar");
const ringN = document.querySelector("#demo-ring .ring__n");

// Digit cells, built once — same treatment as the app, so the demo animates
// its digits instead of replacing text wholesale.
const digits = [];
(function build() {
  for (let i = 0; i < 6; i++) {
    if (i === 3) {
      const gap = document.createElement("span");
      gap.className = "code__gap";
      codeEl.appendChild(gap);
    }
    const s = document.createElement("span");
    s.className = "code__d";
    s.textContent = "•";
    codeEl.appendChild(s);
    digits.push(s);
  }
})();

let lastCounter = -1;
let lastCode = "";

async function draw() {
  const now = Date.now();
  const seconds = now / 1000;
  const counter = Math.floor(seconds / 30);
  const elapsed = seconds - counter * 30;
  const remaining = 30 - elapsed;

  ringBar.style.strokeDashoffset = String(RING_C * (elapsed / 30));
  ringN.textContent = String(Math.ceil(remaining));
  document.querySelector(".demo").classList.toggle("is-expiring", remaining <= 5);

  if (counter !== lastCounter) {
    lastCounter = counter;
    const { code } = await totp(DEMO_SECRET, { now });
    code.split("").forEach((ch, i) => {
      const cell = digits[i];
      if (!cell || cell.textContent === ch) return;
      cell.textContent = ch;
      if (lastCode) {
        cell.classList.remove("is-roll");
        void cell.offsetWidth;
        cell.style.animationDelay = `${i * 35}ms`;
        cell.classList.add("is-roll");
      }
    });
    lastCode = code;
  }
  requestAnimationFrame(draw);
}
draw();

// Reveal on scroll. Anything still off-screen fades up as it arrives; if
// IntersectionObserver is missing, everything is shown at once rather than
// left invisible.
const reveals = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  reveals.forEach((el) => io.observe(el));
} else {
  reveals.forEach((el) => el.classList.add("is-in"));
}
