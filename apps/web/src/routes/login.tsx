import { useState } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { OpenKeepLogo } from "@/components/brand/openkeep-logo";
import { useI18n } from "@/lib/i18n";

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
  const { t } = useI18n();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

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
      setError(err instanceof Error ? err.message : "Login failed");
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
      setError(err instanceof Error ? err.message : "Invalid authentication code");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (twoFactorToken) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="mb-4 flex justify-center">
              <OpenKeepLogo markClassName="h-10 w-10" wordmarkClassName="text-lg" />
            </div>
            <CardDescription>
              Enter the 6-digit code from your authenticator app, or a recovery code.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleTwoFactorSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Authentication code</Label>
                <Input
                  id="code"
                  inputMode="text"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? t("login.signingIn") : "Verify"}
              </Button>
              <button
                type="button"
                className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => {
                  setTwoFactorToken(null);
                  setCode("");
                  setError("");
                }}
              >
                Back to login
              </button>
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mb-4 flex justify-center">
            <OpenKeepLogo markClassName="h-10 w-10" wordmarkClassName="text-lg" />
          </div>
          <CardDescription>{t("login.description")}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("login.email")}</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("login.password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t("login.signingIn") : t("login.signIn")}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {t("login.needSetup")} {" "}
              <Link
                to="/setup"
                className="text-primary underline-offset-4 hover:underline"
              >
                {t("login.goToSetup")}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
