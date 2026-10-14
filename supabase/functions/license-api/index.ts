import {
  errorResponse,
  isOptions,
  jsonResponse,
  parseJson,
  requestRateLimit,
  sha256,
  supabaseAdmin,
} from "../_shared/license.ts";

type LicenseRequest = {
  operation?: unknown;
  licenseKey?: unknown;
  device?: { id?: unknown; platform?: unknown; name?: unknown };
};

function isLicenseResponse(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rateSubject(request: Request) {
  const address =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return address;
}

Deno.serve(async (request) => {
  const cors = jsonResponse(request, "LICENSE_CORS_ORIGINS", {}, 200);
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
      "LICENSE_CORS_ORIGINS",
      "METHOD_NOT_ALLOWED",
      405,
    );
  }

  const body = (await parseJson(request)) as LicenseRequest | null;
  if (
    !body ||
    (body.operation !== "activate" && body.operation !== "status") ||
    typeof body.licenseKey !== "string" ||
    body.licenseKey.trim().length < 8 ||
    body.licenseKey.trim().length > 256 ||
    typeof body.device?.id !== "string" ||
    body.device.id.length < 16 ||
    body.device.id.length > 128
  ) {
    return errorResponse(
      request,
      "LICENSE_CORS_ORIGINS",
      "INVALID_REQUEST",
      400,
    );
  }

  const operation = body.operation;
  const normalizedKey = body.licenseKey.trim().toUpperCase();
  const keyHash = await sha256(normalizedKey);
  const deviceHash = await sha256(body.device.id);

  try {
    const limit = operation === "activate" ? 20 : 120;
    if (!(await requestRateLimit(operation, rateSubject(request), limit))) {
      return errorResponse(
        request,
        "LICENSE_CORS_ORIGINS",
        "RATE_LIMITED",
        429,
      );
    }

    const { data, error } = await supabaseAdmin.rpc(
      operation === "activate" ? "license_activate" : "license_status",
      { p_key_hash: keyHash, p_device_hash: deviceHash },
    );
    if (error || !isLicenseResponse(data)) {
      return errorResponse(
        request,
        "LICENSE_CORS_ORIGINS",
        "LICENSE_SERVICE_UNAVAILABLE",
        500,
      );
    }

    const responseError = data.error;
    if (responseError === "INVALID_LICENSE") {
      return errorResponse(
        request,
        "LICENSE_CORS_ORIGINS",
        "INVALID_LICENSE",
        404,
      );
    }
    if (responseError === "DEVICE_LIMIT_REACHED") {
      return errorResponse(
        request,
        "LICENSE_CORS_ORIGINS",
        "DEVICE_LIMIT_REACHED",
        409,
      );
    }
    if (responseError === "INVALID_REQUEST") {
      return errorResponse(
        request,
        "LICENSE_CORS_ORIGINS",
        "INVALID_REQUEST",
        400,
      );
    }
    if (responseError !== undefined) {
      return errorResponse(
        request,
        "LICENSE_CORS_ORIGINS",
        "LICENSE_SERVICE_UNAVAILABLE",
        500,
      );
    }

    return jsonResponse(request, "LICENSE_CORS_ORIGINS", data);
  } catch {
    return errorResponse(
      request,
      "LICENSE_CORS_ORIGINS",
      "LICENSE_SERVICE_UNAVAILABLE",
      500,
    );
  }
});
