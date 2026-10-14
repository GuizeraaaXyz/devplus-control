import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";

const host = process.env.LICENSE_HOST ?? "127.0.0.1";
const port = Number(process.env.LICENSE_PORT ?? process.env.PORT ?? 8787);
const adminToken = process.env.LICENSE_ADMIN_TOKEN ?? "";
const trustProxyHeaders = process.env.LICENSE_TRUST_PROXY === "true";
const allowedOrigins = new Set(
  (process.env.LICENSE_CORS_ORIGINS ?? "http://localhost:1420,app://soulfire")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const databasePath = path.resolve(
  process.env.LICENSE_DB_PATH ?? "license-server/data/licenses.sqlite",
);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("LICENSE_PORT must be a valid TCP port");
}
if (
  adminToken.length < 32 ||
  adminToken.startsWith("replace-") ||
  adminToken.startsWith("change-me")
) {
  throw new Error(
    "Set LICENSE_ADMIN_TOKEN to a random secret of at least 32 characters",
  );
}

mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath, { create: true, strict: true });
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    device_hash TEXT,
    key_hint TEXT NOT NULL,
    plan TEXT NOT NULL,
    duration_months INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('issued', 'active', 'revoked')),
    created_at TEXT NOT NULL,
    activated_at TEXT,
    expires_at TEXT,
    revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS licenses_created_at_idx ON licenses(created_at);
`);
const licenseColumns = db.query("PRAGMA table_info(licenses)").all();
if (!licenseColumns.some((column) => column.name === "device_hash")) {
  db.exec("ALTER TABLE licenses ADD COLUMN device_hash TEXT");
}

const rateBuckets = new Map();
const hashKey = (key) =>
  createHash("sha256").update(key.trim().toUpperCase()).digest("hex");
const hashDeviceId = (deviceId) =>
  createHash("sha256").update(deviceId).digest("hex");
const nowIso = () => new Date().toISOString();

function addCalendarMonths(date, months) {
  const targetMonth = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(targetMonth / 12);
  const month = targetMonth % 12;
  const day = Math.min(
    date.getUTCDate(),
    new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
  );
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

function json(data, status = 200, headers = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json(data, {
    status,
    headers: responseHeaders,
  });
}

function fail(status, code, headers = {}) {
  return json({ error: { code } }, status, headers);
}

function applyCors(request, headers) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  if (!allowedOrigins.has(origin)) return fail(403, "ORIGIN_NOT_ALLOWED");
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Max-Age", "600");
  return null;
}

function rateLimit(request, bucket, limit, windowMs = 60_000) {
  const forwardedAddress = trustProxyHeaders
    ? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    : undefined;
  const address =
    forwardedAddress || server.requestIP(request)?.address || "unknown";
  const key = `${bucket}:${address}`;
  const now = Date.now();
  if (rateBuckets.size > 10_000) {
    for (const [bucketKey, value] of rateBuckets) {
      if (value.resetAt <= now) rateBuckets.delete(bucketKey);
    }
  }
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > 16_384) return null;
  const raw = await request.text();
  if (raw.length > 16_384) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function licenseView(license) {
  let status = license.state;
  if (status === "issued") status = "inactive";
  if (
    status === "active" &&
    license.expires_at &&
    Date.parse(license.expires_at) <= Date.now()
  ) {
    status = "expired";
  }

  return {
    status,
    plan: license.plan,
    ...(license.expires_at ? { expiresAt: license.expires_at } : {}),
    device: { used: license.device_hash ? 1 : 0, limit: 1 },
  };
}

function validKey(body) {
  return (
    typeof body?.licenseKey === "string" && body.licenseKey.trim().length >= 8
  );
}

function validDevice(body) {
  return (
    typeof body?.device?.id === "string" &&
    body.device.id.length >= 16 &&
    body.device.id.length <= 128
  );
}

function getLicense(key) {
  return db
    .query("SELECT * FROM licenses WHERE key_hash = ?")
    .get(hashKey(key));
}

function parseMonths(value, fallback = 1) {
  const months = value === undefined ? fallback : Number(value);
  return Number.isInteger(months) && months >= 1 && months <= 24
    ? months
    : null;
}

function makeLicense(body) {
  const months = parseMonths(body.durationMonths);
  const plan = typeof body.plan === "string" ? body.plan.trim() : "Dev+ Mensal";
  if (!months || !plan || plan.length > 80) return null;

  const key = `DVP-${randomBytes(24).toString("base64url").toUpperCase()}`;
  const license = {
    id: randomUUID(),
    key_hash: hashKey(key),
    key_hint: key.slice(-6),
    plan,
    duration_months: months,
    state: "issued",
    created_at: nowIso(),
  };
  db.query(
    `INSERT INTO licenses
      (id, key_hash, key_hint, plan, duration_months, state, created_at)
     VALUES ($id, $key_hash, $key_hint, $plan, $duration_months, $state, $created_at)`,
  ).run(license);

  return { key, license };
}

function adminAuthorized(request) {
  const authorization = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${adminToken}`;
  const actualBuffer = Buffer.from(authorization);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const headers = new Headers();
    const corsError = applyCors(request, headers);
    if (corsError) return corsError;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "ok" }, 200, headers);
    }

    if (url.pathname === "/v1/licenses/activate" && request.method === "POST") {
      if (rateLimit(request, "activate", 20))
        return fail(429, "RATE_LIMITED", headers);
      const body = await readJson(request);
      if (!validKey(body) || !validDevice(body))
        return fail(400, "INVALID_REQUEST", headers);

      const activated = db.transaction(() => {
        const license = getLicense(body.licenseKey);
        if (!license) return null;
        if (license.state === "issued") {
          const activatedAt = new Date();
          const expiresAt = addCalendarMonths(
            activatedAt,
            license.duration_months,
          );
          db.query(
            `UPDATE licenses SET state = 'active', device_hash = ?, activated_at = ?, expires_at = ?
             WHERE id = ? AND state = 'issued'`,
          ).run(
            hashDeviceId(body.device.id),
            activatedAt.toISOString(),
            expiresAt.toISOString(),
            license.id,
          );
          return getLicense(body.licenseKey);
        }
        const deviceHash = hashDeviceId(body.device.id);
        if (license.device_hash && license.device_hash !== deviceHash) {
          return { deviceLimitReached: true };
        }
        if (!license.device_hash) {
          db.query("UPDATE licenses SET device_hash = ? WHERE id = ?").run(
            deviceHash,
            license.id,
          );
          return getLicense(body.licenseKey);
        }
        return license;
      })();

      if (activated?.deviceLimitReached)
        return fail(409, "DEVICE_LIMIT_REACHED", headers);
      if (!activated) return fail(404, "INVALID_LICENSE", headers);
      return json(licenseView(activated), 200, headers);
    }

    if (url.pathname === "/v1/licenses/status" && request.method === "POST") {
      if (rateLimit(request, "status", 120))
        return fail(429, "RATE_LIMITED", headers);
      const body = await readJson(request);
      if (!validKey(body) || !validDevice(body))
        return fail(400, "INVALID_REQUEST", headers);
      const license = getLicense(body.licenseKey);
      if (!license) return fail(404, "INVALID_LICENSE", headers);
      if (
        license.state !== "issued" &&
        license.device_hash !== hashDeviceId(body.device.id)
      ) {
        return fail(409, "DEVICE_LIMIT_REACHED", headers);
      }
      return json(licenseView(license), 200, headers);
    }

    if (url.pathname.startsWith("/admin/")) {
      if (rateLimit(request, "admin", 30))
        return fail(429, "RATE_LIMITED", headers);
      if (!adminAuthorized(request)) return fail(401, "UNAUTHORIZED", headers);

      if (url.pathname === "/admin/licenses" && request.method === "POST") {
        const body = await readJson(request);
        if (!body || typeof body !== "object")
          return fail(400, "INVALID_REQUEST", headers);
        const created = makeLicense(body);
        if (!created) return fail(400, "INVALID_LICENSE_OPTIONS", headers);
        return json(
          {
            key: created.key,
            license: {
              id: created.license.id,
              keyHint: created.license.key_hint,
              plan: created.license.plan,
              durationMonths: created.license.duration_months,
              status: "inactive",
              createdAt: created.license.created_at,
            },
          },
          201,
          headers,
        );
      }

      if (url.pathname === "/admin/licenses" && request.method === "GET") {
        const licenses = db
          .query(
            `SELECT id, key_hint, plan, duration_months, state, created_at,
                    activated_at, expires_at, revoked_at
             FROM licenses ORDER BY created_at DESC LIMIT 500`,
          )
          .all();
        return json({ licenses }, 200, headers);
      }

      const match = url.pathname.match(
        /^\/admin\/licenses\/([\w-]+)\/(revoke|renew|reset-device)$/,
      );
      if (!match || request.method !== "POST")
        return fail(404, "NOT_FOUND", headers);
      const [, id, action] = match;
      const license = db.query("SELECT * FROM licenses WHERE id = ?").get(id);
      if (!license) return fail(404, "LICENSE_NOT_FOUND", headers);

      if (action === "revoke") {
        db.query(
          `UPDATE licenses SET state = 'revoked', revoked_at = ? WHERE id = ?`,
        ).run(nowIso(), id);
      } else if (action === "reset-device") {
        if (license.state === "revoked")
          return fail(409, "LICENSE_REVOKED", headers);
        db.query("UPDATE licenses SET device_hash = NULL WHERE id = ?").run(id);
      } else {
        const body = (await readJson(request)) ?? {};
        const months = parseMonths(body.durationMonths);
        if (!months) return fail(400, "INVALID_LICENSE_OPTIONS", headers);
        if (license.state === "revoked")
          return fail(409, "LICENSE_REVOKED", headers);
        if (license.state === "issued") {
          if (license.duration_months + months > 24) {
            return fail(400, "INVALID_LICENSE_OPTIONS", headers);
          }
          db.query(
            "UPDATE licenses SET duration_months = duration_months + ? WHERE id = ?",
          ).run(months, id);
        } else {
          const currentExpiry = license.expires_at
            ? Date.parse(license.expires_at)
            : Date.now();
          const base = new Date(Math.max(Date.now(), currentExpiry));
          const expiresAt = addCalendarMonths(base, months).toISOString();
          db.query("UPDATE licenses SET expires_at = ? WHERE id = ?").run(
            expiresAt,
            id,
          );
        }
      }

      const updated = db.query("SELECT * FROM licenses WHERE id = ?").get(id);
      return json({ license: { id, ...licenseView(updated) } }, 200, headers);
    }

    return fail(404, "NOT_FOUND", headers);
  },
});

console.log(`Dev+ license API listening on http://${host}:${server.port}`);
console.log(`SQLite database: ${databasePath}`);
