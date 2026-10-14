import { z } from "zod";

const licenseStatusSchema = z.object({
  status: z.enum(["active", "inactive", "expired", "revoked"]),
  plan: z.string().optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  device: z
    .object({
      name: z.string().optional(),
      limit: z.number().int().nonnegative().optional(),
      used: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type LicenseStatus = z.infer<typeof licenseStatusSchema>;
export type LicenseApiErrorKind =
  | "not-configured"
  | "storage"
  | "connection"
  | "timeout"
  | "invalid-license"
  | "device-limit"
  | "rate-limit"
  | "unauthorized"
  | "server"
  | "http"
  | "invalid-response";

const errorResponseSchema = z.object({
  error: z.object({ code: z.string() }),
});

const errorCodeKinds: Record<string, LicenseApiErrorKind> = {
  INVALID_LICENSE: "invalid-license",
  LICENSE_NOT_FOUND: "invalid-license",
  DEVICE_LIMIT_REACHED: "device-limit",
  RATE_LIMITED: "rate-limit",
  UNAUTHORIZED: "unauthorized",
  LICENSE_SERVICE_UNAVAILABLE: "server",
};

export class LicenseApiError extends Error {
  constructor(
    message: string,
    readonly kind: LicenseApiErrorKind,
  ) {
    super(message);
    this.name = "LicenseApiError";
  }
}

function isSupabaseApi() {
  return import.meta.env.VITE_LICENSE_API_MODE?.trim() === "supabase";
}

function getApiUrl() {
  const configuredUrl = isSupabaseApi()
    ? import.meta.env.VITE_SUPABASE_URL?.trim() ||
      import.meta.env.VITE_LICENSE_API_URL?.trim()
    : import.meta.env.VITE_LICENSE_API_URL?.trim();
  if (!configuredUrl) {
    throw new LicenseApiError(
      "License API URL is not configured",
      "not-configured",
    );
  }

  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new LicenseApiError("License API URL is invalid", "not-configured");
  }
}

async function postLicenseRequest(
  operation: "activate" | "status",
  licenseKey: string,
  device?: { id?: string; name?: string; platform?: string },
): Promise<LicenseStatus> {
  const baseUrl = getApiUrl();
  const supabaseMode = isSupabaseApi();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (supabaseMode && !publishableKey) {
    throw new LicenseApiError(
      "Supabase publishable key is not configured",
      "not-configured",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(
      supabaseMode
        ? `${baseUrl}/functions/v1/license-api`
        : `${baseUrl}/v1/licenses/${operation}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(supabaseMode
            ? {
                apikey: publishableKey!,
                Authorization: `Bearer ${publishableKey!}`,
              }
            : {}),
        },
        body: JSON.stringify({
          ...(supabaseMode ? { operation } : {}),
          licenseKey,
          ...(device ? { device } : {}),
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      let errorCode: string | undefined;
      try {
        const errorBody: unknown = await response.json();
        const parsedError = errorResponseSchema.safeParse(errorBody);
        if (parsedError.success) errorCode = parsedError.data.error.code;
      } catch {
        // Keep the HTTP status as a fallback when the server has no JSON error body.
      }

      const knownError = errorCode ? errorCodeKinds[errorCode] : undefined;
      if (knownError) {
        throw new LicenseApiError(
          `License API error: ${errorCode}`,
          knownError,
        );
      }
      if (response.status === 429) {
        throw new LicenseApiError(
          "License API rate limit reached",
          "rate-limit",
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new LicenseApiError(
          "License API authorization failed",
          "unauthorized",
        );
      }
      if (response.status >= 500) {
        throw new LicenseApiError("License API server error", "server");
      }
      throw new LicenseApiError(
        `License API returned HTTP ${response.status}`,
        "http",
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LicenseApiError(
        "License API returned invalid JSON",
        "invalid-response",
      );
    }

    const parsed = licenseStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new LicenseApiError(
        "License API returned an unexpected response",
        "invalid-response",
      );
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof LicenseApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new LicenseApiError("License API request timed out", "timeout");
    }
    throw new LicenseApiError(
      "Could not connect to the license API",
      "connection",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function activateLicense(
  licenseKey: string,
  device?: { id?: string; name?: string; platform?: string },
) {
  return postLicenseRequest("activate", licenseKey, device);
}

export function getLicenseStatus(licenseKey: string, deviceId?: string) {
  return postLicenseRequest(
    "status",
    licenseKey,
    deviceId ? { id: deviceId } : undefined,
  );
}
