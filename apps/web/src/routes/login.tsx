import { useState } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { AuthPanel, FieldError } from "@/components/auth/auth-panel";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    if (context.auth.isAuthenticated) {
      throw redirect({ to: "/" });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const auth = useAuth();
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const copy =
    language === "de"
      ? {
          signIn: "Anmelden",
          subtitle: "Dein Archiv läuft auf dieser Maschine.",
          twoFactorTitle: "Zwei-Faktor-Code",
          twoFactorSubtitle: "Der 6-stellige Code aus deiner Authenticator-App.",
          recoverySubtitle: "Einer deiner Wiederherstellungscodes.",
          codeLabel: "Code",
          recoveryLabel: "Wiederherstellungscode",
          useRecovery: "Stattdessen Wiederherstellungscode verwenden",
          useTotp: "Stattdessen Authenticator-Code verwenden",
          verify: "Bestätigen",
          back: "Zurück zur Anmeldung",
          loginFailed: "Anmeldung fehlgeschlagen",
          invalidCode: "Ungültiger Code",
        }
      : {
          signIn: "Sign in",
          subtitle: "Your archive runs on this machine.",
          twoFactorTitle: "Two-factor code",
          twoFactorSubtitle: "The 6-digit code from your authenticator app.",
          recoverySubtitle: "One of your recovery codes.",
          codeLabel: "Code",
          recoveryLabel: "Recovery code",
          useRecovery: "Use a recovery code instead",
          useTotp: "Use an authenticator code instead",
          verify: "Verify",
          back: "Back to login",
          loginFailed: "Login failed",
          invalidCode: "Invalid code",
        };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const result = await auth.login(email, password);
      if (result.requiresTwoFactor) {
        setTwoFactorToken(result.twoFactorToken);
        return;
      }
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loginFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTwoFactorSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!twoFactorToken) return;
    setError("");
    setIsSubmitting(true);
    try {
      await auth.completeTwoFactorLogin(twoFactorToken, code.trim());
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.invalidCode);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (twoFactorToken) {
    return (
      <AuthPanel
        title={copy.twoFactorTitle}
        subtitle={useRecoveryCode ? copy.recoverySubtitle : copy.twoFactorSubtitle}
      >
        <form onSubmit={handleTwoFactorSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="code">
                {useRecoveryCode ? copy.recoveryLabel : copy.codeLabel}
              </FieldLabel>
              <Input
                id="code"
                inputMode={useRecoveryCode ? "text" : "numeric"}
                maxLength={useRecoveryCode ? undefined : 6}
                autoComplete="one-time-code"
                autoFocus
                placeholder={useRecoveryCode ? "xxxx-xxxx" : "123456"}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                aria-invalid={Boolean(error) || undefined}
                className={cn(
                  "num h-11",
                  !useRecoveryCode && "text-center text-lg tracking-[0.35em] md:text-lg",
                )}
              />
              <FieldError>{error}</FieldError>
            </Field>
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? <Spinner /> : null}
              {copy.verify}
            </Button>
          </FieldGroup>
          <div className="mt-4 flex flex-col items-center gap-1">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="text-brand"
              onClick={() => {
                setUseRecoveryCode((current) => !current);
                setCode("");
                setError("");
              }}
            >
              {useRecoveryCode ? copy.useTotp : copy.useRecovery}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                setTwoFactorToken(null);
                setCode("");
                setError("");
              }}
            >
              <ArrowLeftIcon />
              {copy.back}
            </Button>
          </div>
        </form>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      title={copy.signIn}
      subtitle={copy.subtitle}
      footer={
        <span className="text-muted-foreground">
          {t("login.needSetup")}{" "}
          <Link to="/setup" className="font-medium text-brand hover:underline">
            {t("login.goToSetup")}
          </Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">{t("login.email")}</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-10"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">{t("login.password")}</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-invalid={Boolean(error) || undefined}
              className="h-10"
            />
            <FieldError>{error}</FieldError>
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Spinner /> : null}
            {isSubmitting ? t("login.signingIn") : copy.signIn}
          </Button>
        </FieldGroup>
      </form>
    </AuthPanel>
  );
}
