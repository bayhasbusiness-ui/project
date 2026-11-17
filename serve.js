#!/usr/bin/env node
/**
 * Local server for the dashboard: static files plus the same /api/sync route
 * that runs on Vercel, backed by Neon.
 * Usage: node serve.js   (PORT env overrides the default)
 */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname);

for (const file of [".env.development.local", ".env.local", ".env"]) {
  let text;
  try {
    text = fs.readFileSync(path.join(ROOT, file), "utf8");
  } catch {
    continue;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

const { handleSync } = require("./lib/sync-store");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".avif": "image/avif",
};
const STATIC_FILES = new Set([
  "index.html",
  "dhre-security-dashboard.html",
  "react.production.min.js",
  "react-dom.production.min.js",
  "prop-types.min.js",
  "recharts.min.js",
  "dhre-logo.svg",
  "dhre-logo.jpg",
  "dhre-logo.avif",
]);
const PORT = Number(process.env.PORT) || 9119;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/api/sync") return handleSync(req, res);

  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!STATIC_FILES.has(name)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  fs.readFile(path.join(ROOT, name), (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": mime[path.extname(name)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(buf);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Dashboard served on http://localhost:${PORT}/`);
});
