import { createClient } from "npm:@supabase/supabase-js@2.112.3";

function getDefaultKey(jsonEnvironmentVariable: string): string | undefined {
  const value = Deno.env.get(jsonEnvironmentVariable);
  if (!value) return undefined;

  try {
    const keys = JSON.parse(value) as Record<string, unknown>;
    const defaultKey = keys.default;
    return typeof defaultKey === "string" ? defaultKey : undefined;
  } catch {
    return undefined;
  }
}

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  getDefaultKey("SUPABASE_SECRET_KEYS");

if (!supabaseUrl || !serviceKey) {
  throw new Error("Supabase URL and server secret key must be configured");
}

export const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

export function corsHeaders(request: Request, envName: string) {
  const allowedOrigins = new Set(
    (
      Deno.env.get(envName) ??
      "app://soulfire,http://localhost:5173,http://localhost:1420"
    )
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  const origin = request.headers.get("Origin");
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, apikey, x-client-info, content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });

  if (!origin || allowedOrigins.has(origin)) {
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    return headers;
  }

  return null;
}

export function jsonResponse(
  request: Request,
  envName: string,
  body: unknown,
  status = 200,
) {
  const headers = corsHeaders(request, envName);
  if (!headers) {
    return Response.json(
      { error: { code: "ORIGIN_NOT_ALLOWED" } },
      { status: 403 },
    );
  }
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return Response.json(body, { status, headers });
}

export function errorResponse(
  request: Request,
  envName: string,
  code: string,
  status: number,
) {
  return jsonResponse(request, envName, { error: { code } }, status);
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function requestRateLimit(
  bucket: "activate" | "status" | "admin",
  subject: string,
  limit: number,
) {
  const subjectHash = await sha256(subject);
  const { data, error } = await supabaseAdmin.rpc("license_check_rate_limit", {
    p_bucket: bucket,
    p_subject_hash: subjectHash,
    p_max_requests: limit,
    p_window_seconds: 60,
  });

  if (error || typeof data !== "boolean") {
    throw new Error("License rate limit storage is unavailable");
  }
  return data;
}

export async function parseJson(request: Request) {
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > 16_384) return null;

  const raw = await request.text();
  if (raw.length > 16_384) return null;

  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function isOptions(request: Request) {
  return request.method === "OPTIONS";
}

export function unauthorizedResponse(request: Request, envName: string) {
  return errorResponse(request, envName, "UNAUTHORIZED", 401);
}
