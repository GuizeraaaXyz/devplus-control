import { createFileRoute } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import {
  AlertCircleIcon,
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  LogOutIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Field, FieldLabel } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import {
  createManagedLicense,
  LicenseAdminApiError,
  listManagedLicenses,
  type ManagedLicense,
  updateManagedLicense,
} from "@/lib/license-admin-api.ts";
import { getSupabaseBrowserClient } from "@/lib/supabase-client.ts";
import i18n from "@/lib/i18n";
import { SOULFIRE_LOGO_ICON, staticRouteChrome } from "@/lib/route-title.ts";

export const Route = createFileRoute("/license-admin")({
  beforeLoad: () =>
    staticRouteChrome(() => i18n.t("license-admin:title"), SOULFIRE_LOGO_ICON),
  component: LicenseAdminPage,
});

const apiErrorKeys: Record<string, string> = {
  NOT_CONFIGURED: "errors.notConfigured",
  CONNECTION_FAILED: "errors.connection",
  INVALID_RESPONSE: "errors.invalidResponse",
  UNAUTHORIZED: "errors.unauthorized",
  INVALID_LICENSE_OPTIONS: "errors.invalidOptions",
  LICENSE_NOT_FOUND: "errors.notFound",
  LICENSE_REVOKED: "errors.revoked",
  RATE_LIMITED: "errors.rateLimited",
  LICENSE_SERVICE_UNAVAILABLE: "errors.server",
};

function LicenseAdminPage() {
  const { t } = useTranslation("license-admin");
  const supabase = getSupabaseBrowserClient();
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState("Dev+ Mensal");
  const [durationMonths, setDurationMonths] = useState("1");
  const [licenses, setLicenses] = useState<ManagedLicense[]>([]);
  const [loadingLicenses, setLoadingLicenses] = useState(false);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLicenseId, setBusyLicenseId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setCheckingSession(false);
      return;
    }

    let mounted = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) setError(t("errors.connection"));
      setSession(data.session);
      setCheckingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setError(null);
      setNotice(null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase, t]);

  const refreshLicenses = useCallback(async () => {
    setError(null);
    setLoadingLicenses(true);
    try {
      setLicenses(await listManagedLicenses());
    } catch (caught) {
      setError(getApiErrorMessage(caught, t));
    } finally {
      setLoadingLicenses(false);
    }
  }, [t]);

  useEffect(() => {
    if (!session) {
      setLicenses([]);
      return;
    }
    void refreshLicenses();
  }, [refreshLicenses, session]);

  function getApiErrorMessage(caught: unknown, translate: typeof t) {
    if (caught instanceof LicenseAdminApiError) {
      return translate(apiErrorKeys[caught.code] ?? "errors.unexpected");
    }
    return translate("errors.unexpected");
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw new LicenseAdminApiError("UNAUTHORIZED");
    } catch (caught) {
      setError(getApiErrorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
    } catch (caught) {
      setError(getApiErrorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function issueLicense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setIssuedKey(null);
    setCopied(false);
    try {
      const result = await createManagedLicense(plan, Number(durationMonths));
      setIssuedKey(result.key);
      setNotice(t("create.created"));
      await refreshLicenses();
    } catch (caught) {
      setError(getApiErrorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function runLicenseAction(
    action: "renew" | "revoke" | "reset-device",
    license: ManagedLicense,
  ) {
    const confirmationKey =
      action === "revoke"
        ? "actions.confirmRevoke"
        : action === "reset-device"
          ? "actions.confirmReset"
          : null;
    if (confirmationKey && !window.confirm(t(confirmationKey))) return;

    setBusyLicenseId(license.id);
    setError(null);
    setNotice(null);
    try {
      await updateManagedLicense(action, license.id);
      setNotice(t(`actions.${action}Success`));
      await refreshLicenses();
    } catch (caught) {
      setError(getApiErrorMessage(caught, t));
    } finally {
      setBusyLicenseId(null);
    }
  }

  async function copyIssuedKey() {
    if (!issuedKey) return;
    try {
      await navigator.clipboard.writeText(issuedKey);
      setCopied(true);
    } catch {
      setError(t("errors.copy"));
    }
  }

  if (checkingSession) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center p-6">
        <LoaderCircleIcon className="size-6 animate-spin text-primary" />
      </main>
    );
  }

  if (!supabase) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("config.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>{t("config.title")}</AlertTitle>
              <AlertDescription>{t("config.help")}</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-background px-4 py-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheckIcon className="size-6" />
            </div>
            <CardTitle className="pt-2">{t("login.title")}</CardTitle>
            <CardDescription>{t("login.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={signIn}>
              <Field>
                <FieldLabel htmlFor="admin-email">
                  {t("login.email")}
                </FieldLabel>
                <Input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="admin-password">
                  {t("login.password")}
                </FieldLabel>
                <Input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={busy}
                />
              </Field>
              {error && (
                <ErrorAlert message={error} title={t("errors.title")} />
              )}
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <KeyRoundIcon />
                )}
                {busy ? t("login.signingIn") : t("login.submit")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t("login.adminProvisioning")}
              </p>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheckIcon className="size-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                Dev+ Control
              </p>
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
                {t("title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("description")}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => void signOut()}
            disabled={busy}
          >
            <LogOutIcon />
            {t("login.signOut")}
          </Button>
        </header>

        {error && <ErrorAlert message={error} title={t("errors.title")} />}
        {notice && (
          <Alert>
            <CheckIcon />
            <AlertTitle>{t("notice.title")}</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {issuedKey && (
          <Alert>
            <KeyRoundIcon />
            <AlertTitle>{t("create.keyTitle")}</AlertTitle>
            <AlertDescription>
              <div className="flex flex-wrap items-center gap-3">
                <code className="rounded-md bg-muted px-2 py-1 font-mono text-foreground">
                  {issuedKey}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copyIssuedKey()}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? t("create.copied") : t("create.copy")}
                </Button>
                <span>{t("create.keyWarning")}</span>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <section className="grid gap-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.6fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlusIcon className="size-5 text-primary" />
                {t("create.title")}
              </CardTitle>
              <CardDescription>{t("create.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={issueLicense}>
                <Field>
                  <FieldLabel htmlFor="license-plan">
                    {t("create.plan")}
                  </FieldLabel>
                  <Input
                    id="license-plan"
                    value={plan}
                    maxLength={80}
                    onChange={(event) => setPlan(event.target.value)}
                    required
                    disabled={busy}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="license-months">
                    {t("create.duration")}
                  </FieldLabel>
                  <Input
                    id="license-months"
                    type="number"
                    min={1}
                    max={24}
                    step={1}
                    value={durationMonths}
                    onChange={(event) => setDurationMonths(event.target.value)}
                    required
                    disabled={busy}
                  />
                </Field>
                <Button type="submit" disabled={busy || !plan.trim()}>
                  {busy ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : (
                    <PlusIcon />
                  )}
                  {busy ? t("create.creating") : t("create.submit")}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="space-y-1.5">
                <CardTitle>{t("list.title")}</CardTitle>
                <CardDescription>
                  {t("list.count", { count: licenses.length })}
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refreshLicenses()}
                disabled={busyLicenseId !== null}
              >
                <RefreshCwIcon />
                {t("list.refresh")}
              </Button>
            </CardHeader>
            <CardContent>
              {loadingLicenses ? (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  <LoaderCircleIcon className="size-4 animate-spin" />
                  {t("list.loading")}
                </div>
              ) : licenses.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {t("list.empty")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("list.key")}</TableHead>
                      <TableHead>{t("list.plan")}</TableHead>
                      <TableHead>{t("list.status")}</TableHead>
                      <TableHead>{t("list.expiration")}</TableHead>
                      <TableHead>{t("list.devices")}</TableHead>
                      <TableHead>{t("list.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {licenses.map((license) => (
                      <TableRow key={license.id}>
                        <TableCell>
                          <code className="font-mono">
                            ••••{license.keyHint}
                          </code>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{license.plan}</span>
                          <span className="block text-xs text-muted-foreground">
                            {t("list.months", {
                              count: license.durationMonths,
                            })}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(license.status)}>
                            {t(`status.${license.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {license.expiresAt
                            ? new Intl.DateTimeFormat(undefined, {
                                dateStyle: "medium",
                              }).format(new Date(license.expiresAt))
                            : t("list.notActivated")}
                        </TableCell>
                        <TableCell>
                          {t("list.deviceUsage", {
                            used: license.device.used,
                            limit: license.device.limit,
                          })}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={t("actions.renew")}
                              title={t("actions.renew")}
                              disabled={
                                busyLicenseId !== null ||
                                license.status === "revoked"
                              }
                              onClick={() =>
                                void runLicenseAction("renew", license)
                              }
                            >
                              {busyLicenseId === license.id ? (
                                <LoaderCircleIcon className="animate-spin" />
                              ) : (
                                <RotateCcwIcon />
                              )}
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={t("actions.resetDevice")}
                              title={t("actions.resetDevice")}
                              disabled={
                                busyLicenseId !== null ||
                                license.status === "revoked" ||
                                license.device.used === 0
                              }
                              onClick={() =>
                                void runLicenseAction("reset-device", license)
                              }
                            >
                              <RefreshCwIcon />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={t("actions.revoke")}
                              title={t("actions.revoke")}
                              disabled={
                                busyLicenseId !== null ||
                                license.status === "revoked"
                              }
                              onClick={() =>
                                void runLicenseAction("revoke", license)
                              }
                            >
                              <Trash2Icon />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                {t("list.keyStorageNote")}
              </p>
            </CardContent>
          </Card>
        </section>

        <p className="text-xs text-muted-foreground">
          {t("signedInAs", { email: session.user.email ?? session.user.id })}
        </p>
      </div>
    </main>
  );
}

function statusVariant(status: ManagedLicense["status"]) {
  if (status === "active") return "default" as const;
  if (status === "revoked" || status === "expired")
    return "destructive" as const;
  return "secondary" as const;
}

function ErrorAlert(props: { message: string; title: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>{props.title}</AlertTitle>
      <AlertDescription>{props.message}</AlertDescription>
    </Alert>
  );
}
