import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-client.ts";

const licenseSchema = z.object({
  id: z.uuid(),
  keyHint: z.string(),
  plan: z.string(),
  durationMonths: z.number().int().positive(),
  status: z.enum(["active", "inactive", "expired", "revoked"]),
  createdAt: z.iso.datetime({ offset: true }),
  activatedAt: z.iso.datetime({ offset: true }).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  revokedAt: z.iso.datetime({ offset: true }).optional(),
  device: z.object({
    used: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
  }),
});

const createdLicenseSchema = z.object({
  id: z.uuid(),
  keyHint: z.string(),
  plan: z.string(),
  durationMonths: z.number().int().positive(),
  status: z.literal("inactive"),
  createdAt: z.iso.datetime({ offset: true }),
});

export type ManagedLicense = z.infer<typeof licenseSchema>;
export type CreatedLicense = z.infer<typeof createdLicenseSchema>;

export class LicenseAdminApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "LicenseAdminApiError";
  }
}

async function readErrorCode(context: unknown) {
  if (!(context instanceof Response)) return undefined;
  try {
    const body: unknown = await context.clone().json();
    if (typeof body !== "object" || body === null || !("error" in body)) {
      return undefined;
    }
    const error = body.error;
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return undefined;
    }
    return typeof error.code === "string" ? error.code : undefined;
  } catch {
    return undefined;
  }
}

async function requestAdmin<T>(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
  parse: (value: unknown) => T,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<unknown>(
    "license-admin",
    { body },
  );
  if (error) {
    const code = await readErrorCode(error.context);
    throw new LicenseAdminApiError(code ?? "CONNECTION_FAILED");
  }

  try {
    return parse(data);
  } catch {
    throw new LicenseAdminApiError("INVALID_RESPONSE");
  }
}

function configuredClient() {
  const client = getSupabaseBrowserClient();
  if (!client) throw new LicenseAdminApiError("NOT_CONFIGURED");
  return client;
}

export async function createManagedLicense(
  plan: string,
  durationMonths: number,
) {
  const response = await requestAdmin(
    configuredClient(),
    { action: "create", plan, durationMonths },
    (value) => {
      const parsed = z
        .object({
          key: z.string().min(8),
          license: createdLicenseSchema,
        })
        .parse(value);
      return parsed;
    },
  );
  return response;
}

export async function listManagedLicenses() {
  const response = await requestAdmin(
    configuredClient(),
    { action: "list" },
    (value) => {
      const parsed = z.object({ result: z.array(licenseSchema) }).parse(value);
      return parsed.result;
    },
  );
  return response;
}

export async function updateManagedLicense(
  action: "renew" | "revoke" | "reset-device",
  id: string,
  durationMonths = 1,
) {
  return requestAdmin(
    configuredClient(),
    { action, id, ...(action === "renew" ? { durationMonths } : {}) },
    (value) => {
      const parsed = z.object({ result: licenseSchema }).parse(value);
      return parsed.result;
    },
  );
}
