import {
  errorResponse,
  isOptions,
  jsonResponse,
  parseJson,
  requestRateLimit,
  sha256,
  supabaseAdmin,
  unauthorizedResponse,
} from "../_shared/license.ts";

type AdminRequest = {
  action?: unknown;
  plan?: unknown;
  durationMonths?: unknown;
  id?: unknown;
};

const allowedAdminIds = new Set(
  (Deno.env.get("LICENSE_ADMIN_USER_IDS") ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean),
);

function generateLicenseKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const base64 = btoa(String.fromCharCode(...bytes));
  const keyBody = base64
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `DVP-${keyBody.toUpperCase()}`;
}

async function getAdminUser(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user || !allowedAdminIds.has(data.user.id.toLowerCase())) {
    return null;
  }
  return data.user;
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f-]{36}$/i.test(value);
}

Deno.serve(async (request) => {
  const cors = jsonResponse(request, "LICENSE_ADMIN_ALLOWED_ORIGINS", {}, 200);
  if (isOptions(request)) {
    if (cors.status === 403) return cors;
    return new Response(null, {
      status: 204,
      headers: cors.headers,
    });
  }

  if (request.method !== "POST") {
    return errorResponse(
      request,
      "LICENSE_ADMIN_ALLOWED_ORIGINS",
      "METHOD_NOT_ALLOWED",
      405,
    );
  }

  const user = await getAdminUser(request);
  if (!user)
    return unauthorizedResponse(request, "LICENSE_ADMIN_ALLOWED_ORIGINS");

  const body = (await parseJson(request)) as AdminRequest | null;
  if (!body || typeof body.action !== "string") {
    return errorResponse(
      request,
      "LICENSE_ADMIN_ALLOWED_ORIGINS",
      "INVALID_REQUEST",
      400,
    );
  }

  try {
    if (!(await requestRateLimit("admin", user.id, 60))) {
      return errorResponse(
        request,
        "LICENSE_ADMIN_ALLOWED_ORIGINS",
        "RATE_LIMITED",
        429,
      );
    }

    let functionName: string;
    let parameters: Record<string, unknown> = {};
    let generatedKey: string | undefined;

    switch (body.action) {
      case "create": {
        const plan =
          typeof body.plan === "string" ? body.plan.trim() : "Dev+ Mensal";
        const durationMonths = Number(body.durationMonths ?? 1);
        if (
          !plan ||
          plan.length > 80 ||
          !Number.isInteger(durationMonths) ||
          durationMonths < 1 ||
          durationMonths > 24
        ) {
          return errorResponse(
            request,
            "LICENSE_ADMIN_ALLOWED_ORIGINS",
            "INVALID_LICENSE_OPTIONS",
            400,
          );
        }
        generatedKey = generateLicenseKey();
        functionName = "license_admin_create";
        parameters = {
          p_key_hash: await sha256(generatedKey),
          p_key_hint: generatedKey.slice(-6),
          p_plan: plan,
          p_duration_months: durationMonths,
        };
        break;
      }
      case "list":
        functionName = "license_admin_list";
        break;
      case "revoke":
      case "renew":
      case "reset-device": {
        if (!isValidId(body.id)) {
          return errorResponse(
            request,
            "LICENSE_ADMIN_ALLOWED_ORIGINS",
            "INVALID_REQUEST",
            400,
          );
        }
        if (body.action === "revoke") {
          functionName = "license_admin_revoke";
          parameters = { p_id: body.id };
        } else if (body.action === "reset-device") {
          functionName = "license_admin_reset_device";
          parameters = { p_id: body.id };
        } else {
          const durationMonths = Number(body.durationMonths ?? 1);
          if (
            !Number.isInteger(durationMonths) ||
            durationMonths < 1 ||
            durationMonths > 24
          ) {
            return errorResponse(
              request,
              "LICENSE_ADMIN_ALLOWED_ORIGINS",
              "INVALID_LICENSE_OPTIONS",
              400,
            );
          }
          functionName = "license_admin_renew";
          parameters = { p_id: body.id, p_duration_months: durationMonths };
        }
        break;
      }
      default:
        return errorResponse(
          request,
          "LICENSE_ADMIN_ALLOWED_ORIGINS",
          "INVALID_REQUEST",
          400,
        );
    }

    const { data, error } = await supabaseAdmin.rpc(functionName, parameters);
    if (error) {
      return errorResponse(
        request,
        "LICENSE_ADMIN_ALLOWED_ORIGINS",
        "LICENSE_SERVICE_UNAVAILABLE",
        500,
      );
    }
    if (typeof data === "object" && data !== null && "error" in data) {
      const code = (data as { error: unknown }).error;
      const knownCode =
        code === "LICENSE_NOT_FOUND" ||
        code === "LICENSE_REVOKED" ||
        code === "INVALID_LICENSE_OPTIONS"
          ? code
          : "LICENSE_SERVICE_UNAVAILABLE";
      const status =
        code === "LICENSE_NOT_FOUND"
          ? 404
          : code === "INVALID_LICENSE_OPTIONS"
            ? 400
            : 409;
      return errorResponse(
        request,
        "LICENSE_ADMIN_ALLOWED_ORIGINS",
        knownCode,
        status,
      );
    }

    return jsonResponse(
      request,
      "LICENSE_ADMIN_ALLOWED_ORIGINS",
      body.action === "create"
        ? { key: generatedKey, license: data }
        : { result: data },
    );
  } catch {
    return errorResponse(
      request,
      "LICENSE_ADMIN_ALLOWED_ORIGINS",
      "LICENSE_SERVICE_UNAVAILABLE",
      500,
    );
  }
});
