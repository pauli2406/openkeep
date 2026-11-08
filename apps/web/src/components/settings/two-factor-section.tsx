import { useState } from "react";
import { Check, Copy, ShieldCheck, ShieldOff } from "lucide-react";
import { authFetch, readApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n";
import { SecretBlock, SectionCard, ShownOnceNote, StatusBadge } from "./shared";

async function postAuthJson(
  path: string,
  body: unknown,
  fallbackError: string,
): Promise<Record<string, unknown>> {
  const res = await authFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, fallbackError));
  }
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function TwoFactorSection() {
  const auth = useAuth();
  const { t } = useI18n();
  const enabled = auth.user?.twoFactorEnabled ?? false;

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [step, setStep] = useState<"enrolling" | "codes">("enrolling");
  const [setupData, setSetupData] = useState<{
    secret: string;
    qrDataUrl: string;
    enrollmentToken: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const [disableOpen, setDisableOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codesCopied, setCodesCopied] = useState(false);

  async function startEnrollment() {
    setError("");
    setBusy(true);
    try {
      const data = await postAuthJson("/api/auth/2fa/setup", {}, t("twoFactor.requestFailed"));
      setSetupData({
        secret: String(data.secret),
        qrDataUrl: String(data.qrDataUrl),
        enrollmentToken: String(data.enrollmentToken),
      });
      setStep("enrolling");
      setEnrollOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("twoFactor.startFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    if (!setupData) return;
    setError("");
    setBusy(true);
    try {
      const data = await postAuthJson("/api/auth/2fa/enable", {
        enrollmentToken: setupData.enrollmentToken,
        code: code.trim(),
      }, t("twoFactor.requestFailed"));
      setRecoveryCodes((data.recoveryCodes as string[]) ?? []);
      setStep("codes");
      setCode("");
      await auth.refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("twoFactor.invalidCode"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await postAuthJson("/api/auth/2fa/disable", {
        password,
        code: disableCode.trim(),
      }, t("twoFactor.requestFailed"));
      await auth.refreshUser();
      setDisableOpen(false);
      setPassword("");
      setDisableCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("twoFactor.disableFailed"));
    } finally {
      setBusy(false);
    }
  }

  function handleEnrollOpenChange(open: boolean) {
    if (!open) {
      setEnrollOpen(false);
      setStep("enrolling");
      setSetupData(null);
      setCode("");
      setRecoveryCodes([]);
      setCodesCopied(false);
      setError("");
    }
  }

  function handleDisableOpenChange(open: boolean) {
    setDisableOpen(open);
    if (!open) {
      setPassword("");
      setDisableCode("");
      setError("");
    }
  }

  return (
    <SectionCard
      headingLevel="h2"
      title={t("twoFactor.title")}
      description={t("twoFactor.description")}
      icon={enabled ? <ShieldCheck /> : <ShieldOff />}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
            <StatusBadge tone={enabled ? "ok" : "muted"}>
              {enabled ? t("twoFactor.enabled") : t("twoFactor.disabled")}
            </StatusBadge>
            <span className="text-sm text-muted-foreground">
              {enabled ? t("twoFactor.enabledHint") : t("twoFactor.disabledHint")}
            </span>
          </div>

          {enabled ? (
            <Dialog open={disableOpen} onOpenChange={handleDisableOpenChange}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  {t("twoFactor.disable")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("twoFactor.disableTitle")}</DialogTitle>
                  <DialogDescription>{t("twoFactor.disableDescription")}</DialogDescription>
                </DialogHeader>
                <form onSubmit={confirmDisable} className="flex flex-col gap-5">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="disable-password">{t("twoFactor.password")}</FieldLabel>
                      <Input
                        id="disable-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="disable-code">{t("twoFactor.authCode")}</FieldLabel>
                      <Input
                        id="disable-code"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        value={disableCode}
                        onChange={(e) => setDisableCode(e.target.value)}
                        required
                      />
                    </Field>
                  </FieldGroup>
                  {error ? <FieldError>{error}</FieldError> : null}
                  <DialogFooter>
                    <Button type="submit" variant="destructive" disabled={busy}>
                      {busy ? <Spinner /> : t("twoFactor.disable")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : (
            <Button size="sm" onClick={() => void startEnrollment()} disabled={busy}>
              {busy ? <Spinner /> : t("twoFactor.enable")}
            </Button>
          )}
        </div>

        {!enabled && error && !enrollOpen ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <Dialog open={enrollOpen} onOpenChange={handleEnrollOpenChange}>
        <DialogContent>
          {step === "enrolling" && setupData ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("twoFactor.setupTitle")}</DialogTitle>
                <DialogDescription>{t("twoFactor.setupDescription")}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-5">
                <div className="flex justify-center">
                  {/* QR is a data URL generated by the server. It stays on paper
                      in dark mode, because scanners need the contrast. */}
                  <img
                    src={setupData.qrDataUrl}
                    alt={t("twoFactor.qrAlt")}
                    className="size-48 rounded-lg border border-paper-border bg-paper p-2"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("twoFactor.manualSecret")}
                  </p>
                  <SecretBlock value={setupData.secret} />
                </div>
                <form onSubmit={confirmEnable} className="flex flex-col gap-5">
                  <Field>
                    <FieldLabel htmlFor="enable-code">{t("twoFactor.codeLabel")}</FieldLabel>
                    <Input
                      id="enable-code"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                    />
                  </Field>
                  {error ? <FieldError>{error}</FieldError> : null}
                  <DialogFooter>
                    <Button type="submit" disabled={busy}>
                      {busy ? <Spinner /> : t("twoFactor.confirmEnable")}
                    </Button>
                  </DialogFooter>
                </form>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("twoFactor.recoveryTitle")}</DialogTitle>
                <DialogDescription>{t("twoFactor.recoveryDescription")}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-brand-soft p-3 font-mono text-sm text-brand-soft-foreground ring-1 ring-brand/25">
                  {recoveryCodes.map((rc) => (
                    <span key={rc}>{rc}</span>
                  ))}
                </div>
                <ShownOnceNote>{t("twoFactor.recoveryOnce")}</ShownOnceNote>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(recoveryCodes.join("\n"));
                    setCodesCopied(true);
                  }}
                >
                  {codesCopied ? <Check /> : <Copy />}
                  {codesCopied ? t("twoFactor.copied") : t("twoFactor.copyCodes")}
                </Button>
                <Button onClick={() => handleEnrollOpenChange(false)}>
                  {t("settings.done")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
