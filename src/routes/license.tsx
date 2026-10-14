import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  activateLicense,
  getLicenseStatus,
  LicenseApiError,
  type LicenseStatus,
} from "@/lib/license-api.ts";
import i18n from "@/lib/i18n";
import { desktop, isDesktopApp } from "@/lib/desktop.ts";
import { SOULFIRE_LOGO_ICON, staticRouteChrome } from "@/lib/route-title.ts";

export const Route = createFileRoute("/license")({
  beforeLoad: () =>
    staticRouteChrome(() => i18n.t("common:license.title"), SOULFIRE_LOGO_ICON),
  component: LicensePage,
});

type Operation = "activate" | "status" | null;

function getErrorMessage(
  error: unknown,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (error instanceof LicenseApiError) {
    return t(`license.errors.${error.kind}`);
  }
  return t("license.errors.unexpected");
}

async function getDesktopDeviceId() {
  try {
    return await desktop.license.getDeviceId();
  } catch {
    throw new LicenseApiError(
      "Secure device storage is unavailable",
      "storage",
    );
  }
}

function LicensePage() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [licenseKey, setLicenseKey] = useState("");
  const [operation, setOperation] = useState<Operation>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    if (!isDesktopApp()) return;
    let cancelled = false;

    void desktop.license
      .getKey()
      .then(async (savedKey) => {
        if (!savedKey || cancelled) return;
        setLicenseKey(savedKey);
        setOperation("status");
        try {
          const deviceId = await getDesktopDeviceId();
          const status = await getLicenseStatus(savedKey, deviceId);
          if (cancelled) return;
          setResult(status);
          if (status.status === "active") {
            await navigate({ to: "/", replace: true });
          }
        } catch (caught) {
          if (!cancelled) setError(getErrorMessage(caught, t));
        } finally {
          if (!cancelled) setOperation(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(getErrorMessage(caught, t));
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, t]);

  async function submit(nextOperation: Exclude<Operation, null>) {
    const key = licenseKey.trim();
    if (!key || operation) return;

    setOperation(nextOperation);
    setError(null);
    setResult(null);
    try {
      const deviceId = isDesktopApp() ? await getDesktopDeviceId() : undefined;
      const device =
        nextOperation === "activate"
          ? { id: deviceId, platform: navigator.platform }
          : undefined;
      const response =
        nextOperation === "activate"
          ? await activateLicense(key, device)
          : await getLicenseStatus(key, deviceId);
      if (response.status === "active" && isDesktopApp()) {
        try {
          await desktop.license.saveKey(key);
        } catch {
          throw new LicenseApiError(
            "Could not securely save the license key",
            "storage",
          );
        }
      }
      setResult(response);
      if (response.status === "active" && isDesktopApp()) {
        await navigate({ to: "/", replace: true });
      }
    } catch (caught) {
      setError(getErrorMessage(caught, t));
    } finally {
      setOperation(null);
    }
  }

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-background px-4 py-8">
      <div className="grid w-full max-w-5xl gap-6 md:grid-cols-[1.1fr_0.9fr]">
        <section className="flex flex-col justify-center gap-6 py-4">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheckIcon className="size-7" />
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              Dev+ Control
            </p>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
              {t("license.title")}
            </h1>
            <p className="max-w-xl text-muted-foreground">
              {t("license.description")}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-card p-4">
              <p className="text-sm font-medium">{t("license.statusTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {result
                  ? t(`license.status.${result.status}`)
                  : t("license.status.notChecked")}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-sm font-medium">{t("license.deviceTitle")}</p>
              <p
                className="mt-1 truncate text-sm text-muted-foreground"
                title={navigator.platform}
              >
                {navigator.platform || t("license.deviceUnavailable")}
              </p>
            </div>
          </div>
          {result && (
            <div className="space-y-1 text-sm text-muted-foreground">
              {result.plan && <p>{t("license.plan", { plan: result.plan })}</p>}
              {result.expiresAt && (
                <p>
                  {t("license.expires", {
                    date: new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                    }).format(new Date(result.expiresAt)),
                  })}
                </p>
              )}
              {result.device && (
                <p>
                  {t("license.deviceUsage", {
                    used: result.device.used ?? "—",
                    limit: result.device.limit ?? "—",
                  })}
                  {result.device.name ? ` · ${result.device.name}` : ""}
                </p>
              )}
            </div>
          )}
        </section>

        <Card className="self-center">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <KeyRoundIcon className="size-5 text-primary" />
              {t("license.formTitle")}
            </CardTitle>
            <CardDescription>{t("license.formDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field>
              <FieldLabel htmlFor="license-key">
                {t("license.keyLabel")}
              </FieldLabel>
              <Input
                id="license-key"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder={t("license.keyPlaceholder")}
                value={licenseKey}
                onChange={(event) => setLicenseKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit("activate");
                }}
                disabled={operation !== null}
              />
              <FieldDescription>{t("license.keyHelp")}</FieldDescription>
            </Field>

            {error && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>{t("license.errorTitle")}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {result && (
              <Alert>
                {result.status === "active" ? (
                  <CheckCircle2Icon />
                ) : (
                  <ShieldCheckIcon />
                )}
                <AlertTitle>{t("license.responseTitle")}</AlertTitle>
                <AlertDescription>
                  {t(`license.response.${result.status}`)}
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                onClick={() => void submit("activate")}
                disabled={!licenseKey.trim() || operation !== null}
              >
                {operation === "activate" ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <KeyRoundIcon />
                )}
                {operation === "activate"
                  ? t("license.activating")
                  : t("license.activate")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void submit("status")}
                disabled={!licenseKey.trim() || operation !== null}
              >
                {operation === "status" && (
                  <LoaderCircleIcon className="animate-spin" />
                )}
                {operation === "status"
                  ? t("license.checking")
                  : t("license.checkStatus")}
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {t("license.privacyNote")}
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
