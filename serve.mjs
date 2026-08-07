// Local server for the vault.
//
//   node serve.mjs        →  http://127.0.0.1:8787
//
// Needed because the app is built from ES modules, and a browser refuses to
// import one over file:// . Zero dependencies, and bound to 127.0.0.1 so it is
// not reachable from anywhere else on the network.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 8787;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);

  // Refuse anything that climbs out of this folder — "../.." in a URL is the
  // one way a static server hands over the rest of the disk.
  const path = join(ROOT, normalize(rel));
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const body = await readFile(path);
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Vault  →  http://127.0.0.1:${PORT}\n  Ctrl+C to stop\n`);
});
