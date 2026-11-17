"use strict";
/**
 * Neon-backed store for the dashboard's /api/sync wire format:
 *   GET  ?collection=sites          -> { payload: [...], rev: 12 }  ({ payload: null, rev: 0 } when empty)
 *   POST { collection, payload }    -> { rev: 13 }
 * Every write bumps `rev` atomically, so every browser converges on the newest copy.
 */
const { neon } = require("@neondatabase/serverless");

const COLLECTIONS = new Set(["sites", "incidents", "accidents"]);
const MAX_BODY_BYTES = 4 * 1024 * 1024;

let sql = null;
let ready = null;

function db() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (!sql) sql = neon(url);
  if (!ready) {
    ready = sql`
      CREATE TABLE IF NOT EXISTS dhre_sync (
        collection TEXT PRIMARY KEY,
        payload    JSONB NOT NULL,
        rev        BIGINT NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`.catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready.then(() => sql);
}

async function readBody(req) {
  if (req.body !== undefined) {
    return typeof req.body === "string" ? JSON.parse(req.body || "null") : req.body;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("payload too large"), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function handleSync(req, res) {
  try {
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const collection = url.searchParams.get("collection");
      if (!COLLECTIONS.has(collection)) return send(res, 400, { error: "unknown collection" });
      const q = await db();
      const rows = await q`SELECT payload, rev FROM dhre_sync WHERE collection = ${collection}`;
      if (!rows.length) return send(res, 200, { payload: null, rev: 0 });
      return send(res, 200, { payload: rows[0].payload, rev: Number(rows[0].rev) });
    }

    if (req.method === "POST") {
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        return send(res, err.status || 400, { error: err.status ? err.message : "invalid JSON" });
      }
      const collection = body && body.collection;
      const payload = body && body.payload;
      if (!COLLECTIONS.has(collection)) return send(res, 400, { error: "unknown collection" });
      if (!Array.isArray(payload)) return send(res, 400, { error: "payload must be an array" });
      const json = JSON.stringify(payload);
      if (Buffer.byteLength(json) > MAX_BODY_BYTES) return send(res, 413, { error: "payload too large" });
      const q = await db();
      const rows = await q`
        INSERT INTO dhre_sync (collection, payload, rev)
        VALUES (${collection}, ${json}::jsonb, 1)
        ON CONFLICT (collection) DO UPDATE
          SET payload = EXCLUDED.payload, rev = dhre_sync.rev + 1, updated_at = now()
        RETURNING rev`;
      return send(res, 200, { rev: Number(rows[0].rev) });
    }

    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "method not allowed" });
  } catch (err) {
    console.error("sync error:", err);
    return send(res, 500, { error: "sync unavailable" });
  }
}

module.exports = { handleSync };
